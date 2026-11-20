import { AgoraClient, AgoraError, type AgentSession, type ConversationHistory } from 'agora-agents';
import { buildAgent, buildSessionOptions, toSystemMessages, type AgentSpec } from './joinConfig.js';
import type { VoiceSettings } from './settings.js';

/** One REST call to Agora never blocks a call's lifecycle longer than this (the SDK also retries 429/5xx twice). */
const REQUEST_TIMEOUT_SEC = 20;
/**
 * Agora accepts a start before the agent is in the channel. In live tests about one start in three
 * exited at once ("agent exits with reason: RTC connection error", start_ts == stop_ts), each time
 * right after the engine's MCP `initialize` and before `tools/list`. That shows within two seconds,
 * so the gateway checks once and reports it as a failed start the caller retries with a new name.
 * The buyer hears nothing of this: the greeting only plays once a healthy agent is in the channel.
 */
const START_CHECK_DELAY_MS = 2000;
const EXITED_STATUSES: ReadonlySet<string> = new Set(['FAILED', 'STOPPED', 'STOPPING']);
const HTTP_NOT_FOUND = 404;

/** The agent was accepted but left right away; retrying with a new name usually works. */
export class AgentExitedError extends Error {
  constructor(
    readonly agentId: string,
    readonly status: string,
    detail: string,
  ) {
    super(`agent ${agentId} ${status.toLowerCase()} right after start: ${detail}`);
  }
}

export interface HistoryItem {
  role: 'user' | 'assistant';
  content: string;
  /** When the line finished (epoch ms): speech end for replies, the entry time otherwise. Absent if Agora gave neither. */
  endedAt?: number;
}

/** How a `think` request treats each agent state. Values are the REST API's. */
export interface ThinkPolicy {
  onListening: 'inject' | 'interrupt' | 'append' | 'ignore';
  onThinking: 'interrupt' | 'append' | 'ignore';
  onSpeaking: 'interrupt' | 'append' | 'ignore';
  interruptable: boolean;
}

/** A running agent. Every method talks to Agora's REST API. */
export interface LiveAgent {
  readonly agentId: string;
  /** Replaces `llm.system_messages` (the only prompt field `update` accepts). */
  updateSystemMessages(contents: string[]): Promise<void>;
  /** Injects text as user input; the agent answers it. */
  think(text: string, policy: ThinkPolicy): Promise<void>;
  /** Speaks text through TTS, bypassing the model. */
  say(text: string, opts: { interruptable: boolean }): Promise<void>;
  /** Conversation history; only available while the agent runs. */
  history(): Promise<HistoryItem[]>;
  /** Unfiltered history exactly as Agora returns it (dev diagnostics). */
  rawHistory?(): Promise<unknown>;
  /** Leaves the channel. With graceful farewell the current sentence finishes first. */
  stop(): Promise<void>;
}

/** The seam between the call logic and Agora, so tests can run the logic without the network. */
export interface AgentGateway {
  start(spec: AgentSpec): Promise<LiveAgent>;
}

export interface VoiceLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** True when Agora refused a start because the agent name is taken (reuse returns 409). */
export function isNameConflict(err: unknown): boolean {
  return err instanceof AgoraError && err.statusCode === 409;
}

/** A short, log-safe description of an Agora failure (never includes request bodies or keys). */
export function describeAgoraError(err: unknown): { status: number | null; detail: string } {
  if (err instanceof AgoraError) {
    const body = err.body as { detail?: unknown; reason?: unknown } | undefined;
    const parts = [body?.reason, body?.detail].filter((x): x is string => typeof x === 'string' && x.length > 0);
    return { status: err.statusCode ?? null, detail: parts.join(': ') || err.message };
  }
  return { status: null, detail: err instanceof Error ? err.message : String(err) };
}

function historyItems(res: ConversationHistory): HistoryItem[] {
  return (res.contents ?? [])
    .filter((c): c is { role: 'user' | 'assistant'; content: string } => (c.role === 'user' || c.role === 'assistant') && typeof c.content === 'string')
    .map((c) => {
      // Timing fields are in the REST response but not in the SDK's type.
      const timing = c as { speech_end_ms?: unknown; timestamp?: unknown };
      const end = typeof timing.speech_end_ms === 'number' ? timing.speech_end_ms : typeof timing.timestamp === 'number' ? timing.timestamp : undefined;
      return { role: c.role, content: c.content, ...(end !== undefined ? { endedAt: end } : {}) };
    });
}

function wrap(session: AgentSession, agentId: string): LiveAgent {
  return {
    agentId,
    updateSystemMessages: (contents) => session.update({ llm: { system_messages: toSystemMessages(contents) } }),
    think: async (text, p) => {
      await session.think(text, {
        on_listening_action: p.onListening,
        on_thinking_action: p.onThinking,
        on_speaking_action: p.onSpeaking,
        interruptable: p.interruptable,
      });
    },
    say: (text, opts) => session.say(text, { priority: 'INTERRUPT', interruptable: opts.interruptable }),
    history: async () => historyItems(await session.getHistory()),
    rawHistory: async () => session.getHistory(),
    stop: () => session.stop(),
  };
}

/**
 * Agora gateway in app-credentials mode: App ID + certificate only. The SDK mints the agent's
 * RTC + RTM + ConvoAI token for each start and a fresh REST token for each call.
 */
export function createAgoraGateway(s: VoiceSettings, log: VoiceLogger): AgentGateway {
  const client = new AgoraClient({
    area: s.area,
    appId: s.appId,
    appCertificate: s.appCertificate,
    timeoutInSeconds: REQUEST_TIMEOUT_SEC,
  });
  return {
    async start(spec) {
      const agent = buildAgent(client, s, spec);
      const session = agent.createSession(buildSessionOptions(s, spec, (message) => log.warn({ sessionId: spec.sessionId }, message)));
      const agentId = await session.start();
      if (!agentId) throw new Error('Agora started the agent but returned no agent id');
      await new Promise((resolve) => setTimeout(resolve, START_CHECK_DELAY_MS));
      let exited: { status: string; detail: string } | null = null;
      try {
        const info = await session.getInfo();
        if (info.status && EXITED_STATUSES.has(info.status)) exited = { status: info.status, detail: info.message ?? 'no reason given' };
      } catch (err) {
        const { status, detail } = describeAgoraError(err);
        // "TaskNotFound: ... failed to start" right after a start means the agent already exited.
        if (status === HTTP_NOT_FOUND) exited = { status: 'NOT_FOUND', detail };
        else log.warn({ sessionId: spec.sessionId, agentId, status, detail }, 'agent status check failed; assuming it runs');
      }
      if (exited) {
        await session.stop().catch(() => {}); // never leave a half-started agent behind
        throw new AgentExitedError(agentId, exited.status, exited.detail);
      }
      return wrap(session, agentId);
    },
  };
}
