import type { SessionState } from '@ave/shared';

/** Consult-mode calls: the incoming-call brief, OpenAI fallback audio chunks, and STT problem reports. */

export interface CallBrief {
  brief: string;
  buyerName: string;
  propertyName: string | null;
  reason: string | null;
  requestedAt: number | null;
  handoff: SessionState['handoff']['status'];
}

export type ConsultSpeaker = 'buyer' | 'human';

const sessionPath = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}`;

export const consultApi = {
  async brief(sessionId: string): Promise<CallBrief> {
    const res = await fetch(`${sessionPath(sessionId)}/brief`);
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    return (await res.json()) as CallBrief;
  },

  /** One standalone audio file for one speaker. Resolves false when the server could not use it. */
  async uploadChunk(sessionId: string, speaker: ConsultSpeaker, audio: Blob): Promise<boolean> {
    try {
      const res = await fetch(`${sessionPath(sessionId)}/consult/audio?speaker=${speaker}`, {
        method: 'POST',
        headers: { 'content-type': audio.type || 'audio/webm' },
        body: audio,
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  /** Tells the server this browser cannot read the STT captions, so it switches to OpenAI chunks. */
  async reportSttProblem(sessionId: string, detail: string): Promise<void> {
    await fetch(`${sessionPath(sessionId)}/consult/stt-problem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ detail }),
    }).catch(() => undefined);
  },
};
