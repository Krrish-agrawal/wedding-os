import type { FastifyPluginAsync } from 'fastify';
import { TOOL_DESCRIPTIONS, TOOL_NAMES, type ToolName } from '@ave/shared';
import { sessionFromBearer } from './auth.js';
import type { ToolDeps } from './context.js';
import { MCP_TIMEOUT_MS } from './mcp.js';
import { isToolName, runTool } from './runner.js';
import { toolJsonSchema, type JsonObjectSchema, type JsonProperty } from './schema.js';

/**
 * Fallback transport (TOOL_TRANSPORT=http): Agora's custom HTTP tools call POST /tools/<name> once per call.
 *
 * Agora fills the request body from `{{args.<name>}}` placeholders and fails the call before reaching us when
 * a referenced argument is missing or null. So in this variant every argument is required, optional ones
 * take an explicit "empty" value ("" / -1 / []), and the purely cosmetic `tone` is left out.
 * `normalizeHttpArgs` turns those empty values back into "not given" and undoes any stringification.
 */

export const HTTP_TOOLS_PREFIX = '/tools';
const OMITTED_ARGS = new Set(['tone']);
/** Keywords Agora advises against in tool schemas; the server validates them anyway. */
const STRIPPED_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format', 'default'];
const NOT_GIVEN_NUMBER = -1;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stripKeywords(prop: JsonProperty): JsonProperty {
  const out: JsonProperty = { ...prop };
  for (const k of STRIPPED_KEYWORDS) delete out[k];
  if (out.items) out.items = stripKeywords(out.items);
  return out;
}

function withEmptyValue(prop: JsonProperty): JsonProperty {
  const say = (s: string) => [prop.description, s].filter(Boolean).join(' ');
  switch (prop.type) {
    case 'number':
    case 'integer':
      return { ...prop, description: say(`Send ${NOT_GIVEN_NUMBER} if not given.`) };
    case 'array':
      return { ...prop, description: say('Send [] if none.') };
    case 'string':
      return prop.enum ? { ...prop, enum: [...prop.enum, ''], description: say('Send "" if not needed.') } : { ...prop, description: say('Send "" if not needed.') };
    default:
      return prop;
  }
}

/** The model-facing parameters for one tool in the HTTP variant. */
export function httpToolParameters(name: ToolName): JsonObjectSchema {
  const base = toolJsonSchema(name);
  const required = new Set(base.required ?? []);
  const properties: Record<string, JsonProperty> = {};
  for (const [key, prop] of Object.entries(base.properties)) {
    if (OMITTED_ARGS.has(key)) continue;
    const clean = stripKeywords(prop);
    properties[key] = required.has(key) ? clean : withEmptyValue(clean);
  }
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function coerce(value: unknown, prop: JsonProperty): unknown {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  switch (prop.type) {
    case 'number':
    case 'integer':
      return s !== '' && Number.isFinite(Number(s)) ? Number(s) : value;
    case 'boolean':
      return s === 'true' ? true : s === 'false' ? false : value;
    case 'array':
      if (s === '') return [];
      try {
        const parsed: unknown = JSON.parse(s);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [value];
      }
    default:
      return value;
  }
}

function isEmptyValue(value: unknown, prop: JsonProperty): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') {
    const exclusiveMin = typeof prop.exclusiveMinimum === 'number' ? prop.exclusiveMinimum : undefined;
    return value < 0 || (exclusiveMin !== undefined && value <= exclusiveMin);
  }
  return false;
}

/** Turns an HTTP tool body back into the tool's input: drops "not given" values, undoes stringification. */
export function normalizeHttpArgs(name: ToolName, body: unknown): Record<string, unknown> {
  const schema = toolJsonSchema(name);
  const required = new Set(schema.required ?? []);
  const src = isRecord(body) ? (isRecord(body.args) ? body.args : body) : {};
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!(key in src)) continue;
    const value = coerce(src[key], prop);
    if (!required.has(key) && isEmptyValue(value, prop)) continue;
    out[key] = value;
  }
  return out;
}

/** One entry of Agora's `llm.tools` array (custom HTTP tool). */
export interface AgoraCustomTool {
  type: 'function';
  function: { name: string; description: string; parameters: JsonObjectSchema };
  execution: { mode: 'sync' };
  server: { method: 'POST'; url: string; headers: Record<string, string>; body: Record<string, string>; timeout_ms: number };
}

/**
 * Builds Agora's custom tool definitions for one session. `baseUrl` must be the public HTTPS origin
 * (PUBLIC_BASE_URL); `token` is `store.toolToken(sessionId)`. Not usable together with a custom LLM URL.
 */
export function buildCustomTools(opts: { baseUrl: string; token: string; timeoutMs?: number }): AgoraCustomTool[] {
  const base = opts.baseUrl.replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) throw new Error('Agora custom tools need an absolute https:// PUBLIC_BASE_URL.');
  return TOOL_NAMES.map((name) => {
    const parameters = httpToolParameters(name);
    return {
      type: 'function',
      function: { name, description: TOOL_DESCRIPTIONS[name], parameters },
      execution: { mode: 'sync' },
      server: {
        method: 'POST',
        url: `${base}${HTTP_TOOLS_PREFIX}/${name}`,
        headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
        body: Object.fromEntries(Object.keys(parameters.properties).map((k) => [k, `{{args.${k}}}`])),
        timeout_ms: opts.timeoutMs ?? MCP_TIMEOUT_MS,
      },
    };
  });
}

export const httpToolRoutes: FastifyPluginAsync<{ deps?: Partial<ToolDeps> }> = async (app, opts) => {
  app.post<{ Params: { name: string } }>(`${HTTP_TOOLS_PREFIX}/:name`, async (req, reply) => {
    const sessionId = sessionFromBearer(app.ctx, req.headers.authorization);
    if (!sessionId) return reply.code(401).header('www-authenticate', 'Bearer').send({ ok: false, error: 'Unauthorized' });
    const { name } = req.params;
    if (!isToolName(name)) return reply.code(404).send({ ok: false, error: `There is no tool called "${name}".` });
    // Tool-level failures are still 200: the body is a normal result the model should read and follow.
    return runTool(app.ctx, sessionId, name, normalizeHttpArgs(name, req.body), { source: 'agent', via: 'http', log: req.log, deps: opts.deps });
  });
};
