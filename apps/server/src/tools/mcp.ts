import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AnyObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { CallToolRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_DESCRIPTIONS, TOOL_INPUTS, TOOL_NAMES, type ToolName } from '@ave/shared';
import type { AppContext } from '../context.js';
import { sessionFromBearer, setRawHeader } from './auth.js';
import type { ToolDeps, ToolLogger } from './context.js';
import { LIVE_ROUTE_TIMEOUT_MS } from './impl/commute.js';
import { resultText, runTool } from './runner.js';

/** Path the Agora engine calls, relative to PUBLIC_BASE_URL. */
export const MCP_PATH = '/mcp';
/** `mcp_servers[].name`: letters and digits only, at most 48 characters. */
export const MCP_SERVER_NAME = 'estates';
const MCP_SERVER_VERSION = '1.0.0';
/** Suggested `mcp_servers[].timeout_ms`: above the live-route lookup, the slowest tool. */
export const MCP_TIMEOUT_MS = LIVE_ROUTE_TIMEOUT_MS + 2000;

/** The Streamable HTTP spec requires clients to accept both; we always answer with plain JSON. */
const ACCEPT_BOTH = 'application/json, text/event-stream';
const JSON_TYPE = 'application/json';

function toCallToolResult(text: string): CallToolResult {
  // Failures are ordinary results ({ ok: false, error, hint }); never isError or a protocol error,
  // because how Agora presents those to the model is undocumented.
  return { content: [{ type: 'text', text }] };
}

/**
 * One MCP server bound to one call. Built per request (stateless transport), so tool handlers close over
 * the session and the model never sees or passes a session id.
 */
export function buildMcpServer(app: AppContext, sessionId: string, opts: { log?: ToolLogger; deps?: Partial<ToolDeps> } = {}): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });
  const call = async (name: string, args: unknown) =>
    toCallToolResult(resultText(await runTool(app, sessionId, name, args, { source: 'agent', via: 'mcp', log: opts.log, deps: opts.deps })));

  for (const name of TOOL_NAMES) {
    const inputSchema: AnyObjectSchema = TOOL_INPUTS[name as ToolName];
    server.registerTool(name, { description: TOOL_DESCRIPTIONS[name], inputSchema }, (args: unknown) => call(name, args));
  }
  // The SDK validates arguments before a registered handler runs and reports a mismatch as isError text.
  // Route tools/call straight to runTool instead: it validates against the same Zod schema and answers a
  // bad argument or unknown name with a normal { ok: false, error, hint } result the model can act on.
  server.server.setRequestHandler(CallToolRequestSchema, (request) => call(request.params.name, request.params.arguments ?? {}));
  return server;
}

const jsonRpcError = (code: number, message: string) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

export const mcpRoutes: FastifyPluginAsync<{ deps?: Partial<ToolDeps> }> = async (app, opts) => {
  app.post(MCP_PATH, async (req, reply) => {
    const sessionId = sessionFromBearer(app.ctx, req.headers.authorization);
    if (!sessionId) {
      return reply.code(401).header('www-authenticate', 'Bearer').send(jsonRpcError(-32001, 'Unauthorized'));
    }

    // Be lenient with header details the transport is strict about: we always reply with JSON anyway.
    const accept = req.headers.accept ?? '';
    if (!accept.includes(JSON_TYPE) || !accept.includes('text/event-stream')) setRawHeader(req.raw, 'Accept', ACCEPT_BOTH);
    if (!(req.headers['content-type'] ?? '').includes(JSON_TYPE)) setRawHeader(req.raw, 'Content-Type', JSON_TYPE);

    const server = buildMcpServer(app.ctx, sessionId, { log: req.log, deps: opts.deps });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      req.log.error({ sessionId, err: (err as Error).message }, 'mcp request failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': JSON_TYPE });
        reply.raw.end(JSON.stringify(jsonRpcError(-32603, 'Internal server error')));
      }
    }
  });

  // Stateless server: no standalone SSE stream and no sessions to delete.
  const notAllowed = async (_req: FastifyRequest, reply: FastifyReply) => reply.code(405).header('allow', 'POST').send(jsonRpcError(-32000, 'Method not allowed.'));
  app.get(MCP_PATH, notAllowed);
  app.delete(MCP_PATH, notAllowed);
};

/** The `llm.mcp_servers[]` entry for Agora's join config. */
export function buildMcpServerConfig(opts: { baseUrl: string; token: string; timeoutMs?: number }) {
  return {
    name: MCP_SERVER_NAME,
    endpoint: `${opts.baseUrl.replace(/\/+$/, '')}${MCP_PATH}`,
    transport: 'streamable_http' as const,
    headers: { Authorization: `Bearer ${opts.token}` },
    timeout_ms: opts.timeoutMs ?? MCP_TIMEOUT_MS,
  };
}
