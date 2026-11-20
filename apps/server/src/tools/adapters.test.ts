import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOOL_DESCRIPTIONS, TOOL_NAMES, type ToolResult } from '@ave/shared';
import type { AppContext } from '../context.js';
import '../context.js';
import { buildCustomTools, httpToolParameters, normalizeHttpArgs } from './http.js';
import { MCP_PATH, MCP_SERVER_NAME, buildMcpServerConfig } from './mcp.js';
import { toolsPlugin } from './plugin.js';
import { newSession, offlineDeps, saleBundle, toolTestContext } from './testkit.js';

let ctx: AppContext;
let app: FastifyInstance;
let sid: string;
let token: string;

beforeEach(async () => {
  ctx = await toolTestContext();
  sid = newSession(ctx);
  token = ctx.store.toolToken(sid)!;
  app = Fastify({ logger: false });
  app.decorate('ctx', ctx);
  await app.register(toolsPlugin, { deps: offlineDeps });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
let rpcId = 0;
// JSON-RPC responses are probed loosely here; the assertions themselves pin the shape.
/* eslint-disable @typescript-eslint/no-explicit-any */

async function rpc(method: string, params: unknown = {}, headers: Record<string, string> = { authorization: `Bearer ${token}` }) {
  rpcId += 1;
  const res = await app.inject({ method: 'POST', url: MCP_PATH, headers: { ...MCP_HEADERS, ...headers }, payload: { jsonrpc: '2.0', id: rpcId, method, params } });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as Record<string, any>) : null, headers: res.headers };
}

/** The ToolResult inside an MCP tools/call response. */
function toolResultOf(body: Record<string, any> | null): ToolResult {
  expect(body?.error).toBeUndefined();
  expect(body?.result?.isError).toBeFalsy();
  const text = body?.result?.content?.[0]?.text as string;
  expect(typeof text).toBe('string');
  return JSON.parse(text) as ToolResult;
}

describe('MCP endpoint', () => {
  it('rejects requests without the session bearer token', async () => {
    expect((await rpc('tools/list', {}, {})).status).toBe(401);
    expect((await rpc('tools/list', {}, { authorization: 'Bearer not-a-token' })).status).toBe(401);
    expect((await rpc('tools/list', {}, { authorization: token })).status).toBe(401);
  });

  it('initialises statelessly, with no session id', async () => {
    const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(r.status).toBe(200);
    expect(r.body?.result?.serverInfo?.name).toBe(MCP_SERVER_NAME);
    expect(r.body?.result?.capabilities?.tools).toBeTruthy();
    expect(r.headers['mcp-session-id']).toBeUndefined();
  });

  it('lists every tool with its description and an object input schema', async () => {
    const r = await rpc('tools/list');
    expect(r.status).toBe(200);
    const tools = r.body!.result.tools as { name: string; description: string; inputSchema: { type: string; properties: Record<string, unknown> } }[];
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools.length).toBeLessThanOrEqual(32);
    for (const t of tools) {
      expect(t.description).toBe(TOOL_DESCRIPTIONS[t.name as keyof typeof TOOL_DESCRIPTIONS]);
      expect(t.inputSchema.type).toBe('object');
    }
    expect(Object.keys(tools.find((t) => t.name === 'showMoney')!.inputSchema.properties)).toEqual(expect.arrayContaining(['downPayment', 'tenureYears']));
  });

  it('runs a tool against the session the token belongs to', async () => {
    const sale = saleBundle(ctx);
    const r = toolResultOf((await rpc('tools/call', { name: 'openProperty', arguments: { propertyId: sale.property.id } })).body);
    expect(r.ok).toBe(true);
    expect(r.screen).toMatchObject({ propertyId: sale.property.id, view: 'tour' });
    expect(ctx.store.get(sid)!.propertyId).toBe(sale.property.id);

    const other = newSession(ctx, 'Someone Else');
    expect(ctx.store.get(other)!.propertyId).toBeNull();
  });

  it('answers bad arguments and unknown tools as normal results, never protocol errors', async () => {
    const bad = toolResultOf((await rpc('tools/call', { name: 'tourGoTo', arguments: {} })).body);
    expect(bad.ok).toBe(false);
    const unknown = toolResultOf((await rpc('tools/call', { name: 'teleport', arguments: {} })).body);
    expect(unknown.ok).toBe(false);
    const noArgs = toolResultOf((await rpc('tools/call', { name: 'showShortlist' })).body);
    expect(noArgs.ok).toBe(true);
  });

  it('tolerates a client that only accepts JSON', async () => {
    const r = await rpc('tools/list', {}, { authorization: `Bearer ${token}`, accept: 'application/json' });
    expect(r.status).toBe(200);
    expect(r.body?.result?.tools).toHaveLength(TOOL_NAMES.length);
  });

  it('accepts notifications and refuses GET and DELETE', async () => {
    const note = await app.inject({ method: 'POST', url: MCP_PATH, headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` }, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    expect(note.statusCode).toBe(202);
    expect((await app.inject({ method: 'GET', url: MCP_PATH, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(405);
    expect((await app.inject({ method: 'DELETE', url: MCP_PATH, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(405);
  });

  it('works over a real socket, as the engine would call it', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const res = await fetch(`${address}${MCP_PATH}`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'showShortlist', arguments: {} } }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(toolResultOf((await res.json()) as Record<string, any>).ok).toBe(true);
  });

  it('builds the join-config entry Agora expects', () => {
    const cfg = buildMcpServerConfig({ baseUrl: 'https://tools.example.com/', token: 'abc' });
    expect(cfg).toMatchObject({ name: MCP_SERVER_NAME, endpoint: 'https://tools.example.com/mcp', transport: 'streamable_http', headers: { Authorization: 'Bearer abc' } });
    expect(cfg.name).toMatch(/^[A-Za-z0-9]{1,48}$/);
    expect(cfg.timeout_ms).toBeGreaterThan(6000);
  });
});

describe('HTTP tool fallback', () => {
  const post = (name: string, payload: unknown, auth = `Bearer ${token}`) =>
    app.inject({ method: 'POST', url: `/tools/${name}`, headers: { authorization: auth, 'content-type': 'application/json' }, payload: payload as Record<string, unknown> });

  it('builds Agora custom tool definitions with templated bodies and no optional placeholders', () => {
    const tools = buildCustomTools({ baseUrl: 'https://tools.example.com', token: 't0k' });
    expect(tools).toHaveLength(TOOL_NAMES.length);
    for (const t of tools) {
      expect(t.function.name).toMatch(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/);
      expect(t.function.name.toLowerCase().startsWith('mcp')).toBe(false);
      expect(t.server.url).toBe(`https://tools.example.com/tools/${t.function.name}`);
      expect(t.server.headers.Authorization).toBe('Bearer t0k');
      const params = t.function.parameters;
      expect(params.additionalProperties).toBe(false);
      expect(params.required!.sort()).toEqual(Object.keys(params.properties).sort());
      expect(Object.keys(params.properties)).not.toContain('tone');
      for (const [k, v] of Object.entries(t.server.body)) expect(v).toBe(`{{args.${k}}}`);
      expect(Object.keys(t.server.body).sort()).toEqual(Object.keys(params.properties).sort());
    }
    expect(() => buildCustomTools({ baseUrl: 'http://insecure.example.com', token: 'x' })).toThrow(/https/);
  });

  it('turns "not given" values back into omitted arguments', () => {
    expect(httpToolParameters('showMoney').properties.tab!.enum).toContain('');
    expect(normalizeHttpArgs('showMoney', { tab: '', downPayment: 0, ratePct: -1, tenureYears: '20' })).toEqual({ downPayment: 0, tenureYears: 20 });
    expect(normalizeHttpArgs('requestDiscount', { percent: 0, amount: 50000 })).toEqual({ amount: 50000 });
    expect(normalizeHttpArgs('updateLead', { purpose: '', needs: '["2 BHK"]', concerns: [] })).toEqual({ needs: ['2 BHK'] });
    expect(normalizeHttpArgs('applyOffer', { offerId: 'x', confirmed: 'true' })).toEqual({ offerId: 'x', confirmed: true });
    expect(normalizeHttpArgs('showShortlist', { args: { tone: 'warm' } })).toEqual({ tone: 'warm' });
  });

  it('runs a tool for the token holder and answers 200 even when the tool refuses', async () => {
    const ok = await post('showMoney', { tab: '', downPayment: 3_000_000, ratePct: -1, tenureYears: 20 });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as ToolResult).ok).toBe(true);
    expect(ctx.store.get(sid)!.params.money.emi?.tenureYears).toBe(20);

    const refused = await post('bookSiteVisit', { slotId: 'nope', confirmed: false });
    expect(refused.statusCode).toBe(200);
    expect((refused.json() as ToolResult).ok).toBe(false);
  });

  it('rejects a bad token and an unknown tool', async () => {
    expect((await post('showShortlist', {}, 'Bearer wrong')).statusCode).toBe(401);
    expect((await post('teleport', {})).statusCode).toBe(404);
  });

  it('reads a body sent without a JSON content type', async () => {
    const res = await app.inject({ method: 'POST', url: '/tools/showShortlist', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' }, payload: '{}' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ToolResult).ok).toBe(true);
  });
});

describe('Studio tool console', () => {
  it('lists tools and runs one against a session', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/tools' });
    expect((list.json() as { tools: unknown[] }).tools).toHaveLength(TOOL_NAMES.length);
    const run = await app.inject({ method: 'POST', url: `/api/sessions/${sid}/tools/showShortlist`, payload: {} });
    expect(run.statusCode).toBe(200);
    expect((run.json() as { result: ToolResult }).result.ok).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/sessions/nope/tools/showShortlist', payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${sid}/tools/teleport`, payload: {} })).statusCode).toBe(404);
  });

  it('is refused in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect((await app.inject({ method: 'POST', url: `/api/sessions/${sid}/tools/showShortlist`, payload: {} })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: `/api/sim/${sid}/chat`, payload: { message: 'hi' } })).statusCode).toBe(403);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('says clearly when the simulated advisor has no OpenAI key', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/sim/${sid}/chat`, payload: { message: 'Hello' } });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: string }).error).toMatch(/OPENAI_API_KEY/);
  });
});
