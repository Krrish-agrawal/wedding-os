import { z } from 'zod';
import { AGENT_STATES } from './session.js';

/**
 * Voice contracts: the REST payloads under /api/sessions/:id/voice and the RTC/RTM identities
 * every participant uses. UIDs are numeric; the agent API receives them as strings and RTM user
 * ids are `String(uid)`.
 */
export const VOICE_UIDS = {
  agent: 1000,
  buyer: 2001,
  advisor: 3001,
  /** Agora Real-Time STT bot that transcribes the human advisor's consult (publishes captions as stream messages). */
  stt: 4001,
} as const;

export const VOICE_CLIENT_ROLES = ['buyer', 'advisor'] as const;
export const VoiceClientRoleSchema = z.enum(VOICE_CLIENT_ROLES);
export type VoiceClientRole = z.infer<typeof VoiceClientRoleSchema>;

/** POST /api/sessions/:id/voice/token body. */
export const VoiceTokenRequestSchema = z.object({ role: VoiceClientRoleSchema.default('buyer') });

/** POST /api/sessions/:id/voice/token response: one combined RTC + RTM token for one participant. */
export interface VoiceTokenGrant {
  available: true;
  appId: string;
  channel: string;
  uid: number;
  token: string;
  /**
   * Signalling (RTM) login for captions and advisor state. Unique per call and role: RTM allows one login
   * per user id per app, so a shared id let one call knock another call's captions out.
   */
  rtmUserId: string;
  rtmToken: string;
  /** Epoch milliseconds when the token stops working; renew a few minutes before. */
  expiresAt: number;
  agentUid: number;
  buyerUid: number;
  advisorUid: number;
  advisorName: string;
  /**
   * Advisor grants only: uid of the Real-Time STT bot whose stream messages carry the consult captions.
   * The advisor's browser relays them to the session as transcript lines.
   */
  sttBotUid?: number;
}

export interface VoiceUnavailable {
  available: false;
  /** Short reason a person can read, e.g. "Voice is not configured on the server". */
  reason: string;
}

export type VoiceTokenResponse = VoiceTokenGrant | VoiceUnavailable;

/** POST /api/sessions/:id/voice/start body. `restart` replaces an agent that stopped responding. */
export const VoiceStartRequestSchema = z.object({ restart: z.boolean().default(false) });

export type VoiceStartResponse =
  | {
      available: true;
      /** Null while the agent stands by because a human advisor is on the call. */
      agentId: string | null;
      standby: boolean;
      /** Things that work but not fully, e.g. tools off because no public URL is set. */
      warnings: string[];
    }
  | VoiceUnavailable;

/** GET /api/sessions/:id/voice response. */
export type VoiceStatusResponse = { available: true; warnings: string[] } | VoiceUnavailable;

/** Longest typed message the buyer can send in one go. */
export const VOICE_TEXT_MAX_CHARS = 500;

/** POST /api/sessions/:id/voice/text body. */
export const VoiceTextRequestSchema = z.object({ text: z.string().trim().min(1).max(VOICE_TEXT_MAX_CHARS) });

export type VoiceTextResponse = { delivered: true } | { delivered: false; reason: string };

/** POST /api/sessions/:id/voice/state body: the engine's conversational state seen by the buyer's browser. */
export const VoiceStateRequestSchema = z.object({ state: z.enum(AGENT_STATES) });

/**
 * Screen events the server injects into the conversation (through the agent's `think` API) start
 * with this marker, so clients and transcript reconciliation can keep them out of the captions.
 */
export const SCREEN_EVENT_MARKER = '[screen]';

export function isScreenEventText(text: string): boolean {
  return text.trimStart().startsWith(SCREEN_EVENT_MARKER);
}
