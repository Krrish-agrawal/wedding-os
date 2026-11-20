import type { FetchLike } from './types.js';

/** Every provider call gives up after this long; the delivery is then recorded as failed. */
export const PROVIDER_TIMEOUT_MS = 10_000;
/** Provider error text kept in the Outbox; long bodies are cut. */
const MAX_REASON_CHARS = 180;

export type HttpResult =
  | { ok: true; status: number; json: unknown }
  | { ok: false; status: number | null; reason: string; json: unknown };

/**
 * JSON-over-HTTP call with a timeout. Never throws: network errors, timeouts and non-2xx
 * responses come back as `{ ok: false, reason }` with a short, readable reason.
 */
export async function requestJson(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<HttpResult> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const e = err as Error;
    const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
    return { ok: false, status: null, reason: timedOut ? `No response within ${Math.round(timeoutMs / 1000)} s` : `Network error: ${short(e.message)}`, json: null };
  }
  const text = await res.text().catch(() => '');
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.ok) return { ok: true, status: res.status, json };
  return { ok: false, status: res.status, reason: `HTTP ${res.status}: ${short(providerMessage(json) ?? text) || res.statusText}`, json };
}

/** Pulls the human-readable message out of the error bodies our providers return. */
function providerMessage(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  // Meta Graph API: { error: { message, error_data: { details } } }
  if (o.error && typeof o.error === 'object') {
    const e = o.error as Record<string, unknown>;
    const details = (e.error_data as Record<string, unknown> | undefined)?.details;
    if (typeof details === 'string') return details;
    if (typeof e.message === 'string') return e.message;
  }
  // Resend, Twilio, HubSpot: { message }
  if (typeof o.message === 'string') return o.message;
  return null;
}

export function short(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > MAX_REASON_CHARS ? `${one.slice(0, MAX_REASON_CHARS - 1)}…` : one;
}

/** Reads a string field from a JSON object without trusting its shape. */
export function field(json: unknown, ...path: (string | number)[]): string | null {
  let cur: unknown = json;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return typeof cur === 'string' || typeof cur === 'number' ? String(cur) : null;
}
