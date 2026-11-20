import type { IncomingMessage } from 'node:http';
import type { AppContext } from '../context.js';

/** Resolves `Authorization: Bearer <token>` to the session the per-session tool token belongs to. */
export function sessionFromBearer(ctx: AppContext, header: string | undefined): string | undefined {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  if (!m) return undefined;
  const sessionId = ctx.store.sessionForToolToken(m[1]!);
  return sessionId && ctx.store.get(sessionId) ? sessionId : undefined;
}

/** Sets a header on a raw Node request, in both the parsed map and `rawHeaders` (which some adapters read). */
export function setRawHeader(raw: IncomingMessage, name: string, value: string): void {
  const lower = name.toLowerCase();
  raw.headers[lower] = value;
  for (let i = 0; i < raw.rawHeaders.length; i += 2) {
    if (raw.rawHeaders[i]!.toLowerCase() === lower) {
      raw.rawHeaders[i + 1] = value;
      return;
    }
  }
  raw.rawHeaders.push(name, value);
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
