import type { FlagsInfo, PlannerStreamEvent, Proposal, VoiceResult, WeddingMeta } from './types';
import type { WeddingState } from '@ave/shared';

const TOKEN_PREFIX = 'wedding-os:token:';
const idOf = (url: string) => /\/api\/wedding\/([^/?]+)/.exec(url)?.[1];

/** The workspace token for a wedding URL, as a header. Kept in this browser only (a demo session, not a login). */
export function authHeaders(url: string): Record<string, string> {
  const id = idOf(url);
  if (!id) return {};
  try { const t = localStorage.getItem(TOKEN_PREFIX + id); return t ? { 'x-workspace-token': t } : {}; } catch { return {}; }
}

/** Claims the workspace for this browser if nobody has. Returns false when it belongs to another session. */
export async function claimWorkspace(id: string): Promise<boolean> {
  try { if (localStorage.getItem(TOKEN_PREFIX + id)) return true; } catch { /* fall through */ }
  let res: Response;
  try { res = await fetch(`/api/wedding/${id}/claim`, { method: 'POST' }); } catch { return true; /* server unreachable: load() reports it */ }
  if (res.status === 409) return false;
  if (!res.ok) return true;
  const { token } = (await res.json()) as { token?: string };
  try { if (token) localStorage.setItem(TOKEN_PREFIX + id, token); } catch { /* token only lives for this page then */ }
  return true;
}

/** Thin typed wrappers over the wedding API. Errors carry the server's message and hint. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly hint?: string) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // Send a JSON content-type only with a body: Fastify rejects an empty body that claims to be JSON, which
    // silently broke every body-less POST (confirm, cancel, reset).
    res = await fetch(url, { ...init, headers: { ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}), ...authHeaders(url), ...init?.headers } });
  } catch {
    throw new ApiError('Cannot reach the server. Is it running?', 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.hint);
  return body as T;
}

export const weddingApi = {
  meta: () => call<WeddingMeta>('/api/wedding-meta'),
  flags: () => call<FlagsInfo>('/api/flags'),
  /** Sends a recording to the server, which transcribes it (Sarvam) and runs it through the same planner as typed chat. */
  voice: (id: string, audio: Blob, lang: string, selectedId: string | null) =>
    call<VoiceResult>(`/api/wedding/${id}/voice?lang=${encodeURIComponent(lang)}${selectedId ? `&selectedId=${encodeURIComponent(selectedId)}` : ''}`, { method: 'POST', body: audio, headers: { 'content-type': audio.type || 'audio/webm' } }),
  get: (id: string) => call<{ state: WeddingState }>(`/api/wedding/${id}`),
  act: (id: string, action: unknown) => call<{ state: WeddingState }>(`/api/wedding/${id}/actions`, { method: 'POST', body: JSON.stringify(action) }),
  proposals: (id: string) => call<{ proposals: Proposal[] }>(`/api/wedding/${id}/proposals`),
  /** The only way a proposal is applied: a request from the browser, never from the planner. */
  confirm: (id: string, proposalId: string) => call<{ state: WeddingState; proposal: Proposal }>(`/api/wedding/${id}/proposals/${proposalId}/confirm`, { method: 'POST' }),
  cancel: (id: string, proposalId: string) => call<{ proposal: Proposal }>(`/api/wedding/${id}/proposals/${proposalId}/cancel`, { method: 'POST' }),
  reset: (id: string) => call<{ state: WeddingState }>(`/api/wedding/${id}/reset`, { method: 'POST' }),

  /**
   * Sends a message and reads the planner's progress as it happens. Each event is passed to `onEvent`;
   * resolves when the stream ends. Rejects only when the server cannot be reached or refuses the message.
   */
  async chatStream(id: string, message: string, selectedId: string | null, onEvent: (e: PlannerStreamEvent) => void): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`/api/wedding/${id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders(`/api/wedding/${id}/chat`) }, body: JSON.stringify({ message, selectedId, stream: true }) });
    } catch {
      throw new ApiError('Cannot reach the server. Is it running?', 0);
    }
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) onEvent(JSON.parse(line) as PlannerStreamEvent);
      }
    }
  },
};
