import type {
  AgentStatus,
  VoiceClientRole,
  VoiceStartResponse,
  VoiceTextResponse,
  VoiceTokenResponse,
} from '@ave/shared';

/** Typed calls to the server's voice routes (/api/sessions/:id/voice/...). Secrets never reach the browser. */

export class VoiceApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const base = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/voice`;

async function post<T>(url: string, body: unknown, opts: { keepalive?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(opts.keepalive ? { keepalive: true } : {}),
    });
  } catch {
    throw new VoiceApiError(0, 'Could not reach the server. Check your connection.');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new VoiceApiError(res.status, data?.error ?? 'The server could not complete that.');
  return data as T;
}

export const voiceApi = {
  token: (sessionId: string, role: VoiceClientRole) => post<VoiceTokenResponse>(`${base(sessionId)}/token`, { role }),
  start: (sessionId: string, restart = false) => post<VoiceStartResponse>(`${base(sessionId)}/start`, { restart }),
  /** keepalive so it still reaches the server when the tab is closing. */
  stop: (sessionId: string) => post<{ stopped: boolean }>(`${base(sessionId)}/stop`, {}, { keepalive: true }),
  text: (sessionId: string, text: string) => post<VoiceTextResponse>(`${base(sessionId)}/text`, { text }),
  state: (sessionId: string, state: AgentStatus['state']) => post<void>(`${base(sessionId)}/state`, { state }),
};
