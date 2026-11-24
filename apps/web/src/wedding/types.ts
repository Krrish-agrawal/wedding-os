import type { SampleVenue, WeddingState } from '@ave/shared';

export interface WeddingMeta {
  plannerMode: 'llm' | 'demo';
  model: string | null;
  notice: string;
  venues: SampleVenue[];
}

/** A change the planner proposed that only the customer can apply. The stored action is never sent to the browser. */
export interface Proposal {
  id: string;
  tool: string;
  summary: string;
  changes: { label: string; from: string; to: string }[];
  expiresAt: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'failed';
}

/** One tool call shown in the chat, updated as the server streams progress. */
export interface ChatStep {
  id: number;
  label: string;
  specialist?: string;
  /** `pending` = waiting for the customer to confirm a proposal. */
  status: 'running' | 'ok' | 'error' | 'pending';
  summary?: string;
  error?: string;
  hint?: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'planner';
  text: string;
  steps?: ChatStep[];
  /** True until the final reply arrives. */
  pending?: boolean;
  error?: boolean;
}

/** Events the server streams while the planner works (newline-delimited JSON). */
export type PlannerStreamEvent =
  | { type: 'tool_start'; id: number; name: string; specialist?: string; label: string }
  | { type: 'tool_end'; id: number; name: string; ok: boolean; summary?: string; error?: string; hint?: string; proposal?: Proposal; state: WeddingState }
  | { type: 'done'; turn: { reply: string; mode: 'llm' | 'demo'; state: WeddingState } }
  | { type: 'error'; message: string };

/** Feature flags as evaluated by the server (Flagsmith, or built-in defaults). The browser can only read them. */
export interface FlagsInfo {
  flags: Record<string, boolean>;
  source: 'flagsmith-local' | 'flagsmith-remote' | 'defaults';
  degraded: boolean;
  defaulted: string[];
  fetchedAt: number | null;
  error: string | null;
  configured: boolean;
  voiceConfigured: boolean;
  descriptions: Record<string, string>;
  names: string[];
}

/** Result of a spoken request: what was heard and the planner turn it produced. */
export interface VoiceResult {
  transcript: string;
  languageCode: string | null;
  turn: { reply: string; mode: 'llm' | 'demo'; state: import('@ave/shared').WeddingState; toolCalls: { id: number; name: string; specialist?: string; label: string; result: { ok: boolean; summary?: string; error?: string; hint?: string; proposal?: Proposal } }[] };
}
