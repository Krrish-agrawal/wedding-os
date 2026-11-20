import { CALL_LANGUAGE_INFO, VOICE_UIDS, type Consult, type SessionState } from '@ave/shared';
import type { Config } from '../config.js';
import type { SessionStore } from '../sessions/store.js';
import type { RtcSettings } from '../voice/settings.js';
import { channelFor, issueBotRtcToken } from '../voice/tokens.js';
import type { DeskLogger } from './runtime.js';

/**
 * Live transcription while a human advisor talks with the buyer (the AI agent has left the channel, so
 * nothing else hears them). Primary: Agora Real-Time STT, a bot that joins the call's channel, listens to
 * the buyer and the advisor, and publishes captions as RTC stream messages that the advisor's browser
 * relays to the session. Fallback: the advisor's browser records both voices and the server transcribes
 * the chunks with OpenAI (see consultAudio.ts). `consult.transcriptSource` tells the browser which one runs.
 *
 * REST reference (checked 2026-11-20):
 *   POST https://api.agora.io/api/speech-to-text/v1/projects/{appId}/join                 -> { agent_id, create_ts, status }
 *   POST https://api.agora.io/api/speech-to-text/v1/projects/{appId}/agents/{agentId}/leave (no body)
 * Both use Basic auth with the Agora customer id and secret.
 */

export const STT_API_BASE = 'https://api.agora.io/api/speech-to-text/v1/projects';
/** The bot leaves on its own when nobody publishes audio for this long (a safety net if our stop is lost). */
export const STT_MAX_IDLE_SEC = 120;
/** One STT REST call never holds the handoff longer than this. */
const STT_REQUEST_TIMEOUT_MS = 10_000;
/** Always recognised next to the call language: advisors and buyers in India switch to English freely. */
export const STT_EXTRA_LANGUAGE = 'en-IN';
/** Agora accepts at most this many recognition languages per task. */
const MAX_STT_LANGUAGES = 4;
/** Task names are unique per start and at most 64 characters. */
const STT_NAME_PREFIX = 'ave-stt';
const MAX_STT_NAME_CHARS = 64;
/** Error details from Agora are trimmed to this length before they reach the notes panel. */
const MAX_DETAIL_CHARS = 140;
/** On server shutdown, stop running STT bots but never hold the exit longer than this. */
const SHUTDOWN_STOP_TIMEOUT_MS = 5000;

export const CONSULT_STT_MESSAGES = {
  missingCredentials: 'Agora Real-Time STT needs AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET on the server.',
  missingRtc: 'Agora Real-Time STT needs AGORA_APP_ID and AGORA_APP_CERTIFICATE on the server.',
  startFailed: (detail: string) => `Agora Real-Time STT did not start (${detail}).`,
  browserProblem: (detail: string) => `Agora Real-Time STT captions could not be read (${detail}).`,
  usingOpenAi: 'Transcribing with OpenAI instead.',
  noOpenAi: 'Live notes have no transcript: set OPENAI_API_KEY or enable Real-Time STT in Agora Console.',
  off: 'Live transcription is turned off on this server (CONSULT_STT=off). Notes you type still count.',
} as const;

export interface SttStartRequest {
  name: string;
  languages: string[];
  maxIdleTime: number;
  rtcConfig: {
    channelName: string;
    pubBotUid: string;
    pubBotToken?: string;
    subscribeAudioUids: string[];
    /** Gzip-compressed JSON captions instead of protobuf, so the browser decodes them without a library. */
    enableJsonProtocol: boolean;
  };
}

/** The Real-Time STT REST API, behind a seam so the lifecycle can be tested without the network. */
export interface SttClient {
  start(body: SttStartRequest): Promise<{ agentId: string }>;
  stop(agentId: string): Promise<void>;
}

export class SttRequestError extends Error {
  constructor(
    readonly status: number | null,
    readonly detail: string,
  ) {
    super(status ? `${status}: ${detail}` : detail);
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function clip(s: string, max = MAX_DETAIL_CHARS): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { reason?: unknown; detail?: unknown; message?: unknown };
    const parts = [body.reason, body.detail, body.message].filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (parts.length) return clip(parts.join(': '));
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return clip(text || res.statusText || 'no reason given');
}

export function createAgoraSttClient(opts: { appId: string; customerId: string; customerSecret: string; fetch?: FetchLike }): SttClient {
  const doFetch: FetchLike = opts.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${opts.customerId}:${opts.customerSecret}`).toString('base64')}`;
  const base = `${STT_API_BASE}/${encodeURIComponent(opts.appId)}`;

  const call = async (url: string, body: unknown | undefined): Promise<Response> => {
    try {
      return await doFetch(url, {
        method: 'POST',
        headers: body === undefined ? { authorization: auth } : { authorization: auth, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(STT_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new SttRequestError(null, err instanceof Error ? clip(err.message) : 'network error');
    }
  };

  return {
    async start(body) {
      const res = await call(`${base}/join`, body);
      if (!res.ok) throw new SttRequestError(res.status, await errorDetail(res));
      const json = (await res.json().catch(() => null)) as { agent_id?: unknown; agentId?: unknown } | null;
      const agentId = typeof json?.agent_id === 'string' ? json.agent_id : typeof json?.agentId === 'string' ? json.agentId : null;
      if (!agentId) throw new SttRequestError(res.status, 'Agora returned no agent id');
      return { agentId };
    },
    async stop(agentId) {
      const res = await call(`${base}/agents/${encodeURIComponent(agentId)}/leave`, undefined);
      if (!res.ok) throw new SttRequestError(res.status, await errorDetail(res));
    },
  };
}

/** The call language's recognition tag plus English, deduplicated, at most four. */
export function sttLanguages(state: SessionState): string[] {
  return [...new Set([CALL_LANGUAGE_INFO[state.language].asr, STT_EXTRA_LANGUAGE])].slice(0, MAX_STT_LANGUAGES);
}

export function sttTaskName(sessionId: string, now: number): string {
  return `${STT_NAME_PREFIX}-${sessionId}-${now.toString(36)}`.slice(0, MAX_STT_NAME_CHARS);
}

export function buildSttStartRequest(state: SessionState, rtc: RtcSettings | null, now: number): SttStartRequest {
  return {
    name: sttTaskName(state.id, now),
    languages: sttLanguages(state),
    maxIdleTime: STT_MAX_IDLE_SEC,
    rtcConfig: {
      channelName: channelFor(state.id),
      pubBotUid: String(VOICE_UIDS.stt),
      ...(rtc ? { pubBotToken: issueBotRtcToken(rtc, state.id, VOICE_UIDS.stt) } : {}),
      subscribeAudioUids: [String(VOICE_UIDS.buyer), String(VOICE_UIDS.advisor)],
      enableJsonProtocol: true,
    },
  };
}

export interface ConsultTranscriptionDeps {
  store: SessionStore;
  config: Pick<Config, 'CONSULT_STT' | 'OPENAI_API_KEY'>;
  /** Null when the Agora customer credentials are missing. */
  stt: SttClient | null;
  /** Null when the app id or certificate is missing (then no bot token can be made). */
  rtc: RtcSettings | null;
  log: DeskLogger;
  now?: () => number;
}

interface Running {
  agentId: string | null;
  /** Start and stop for one call run strictly one after another. */
  queue: Promise<unknown>;
}

/**
 * Starts transcription when a human advisor joins (handoff `joined`) and stops it on hand-back, at the
 * end of the call, or on server shutdown. Every state change it makes goes through `set_consult`.
 */
export class ConsultTranscription {
  private readonly calls = new Map<string, Running>();
  private readonly lastHandoff = new Map<string, SessionState['handoff']['status']>();
  private readonly now: () => number;

  constructor(private readonly deps: ConsultTranscriptionDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Feed every store change here. Never dispatches synchronously (other listeners must see changes in order). */
  onChange(state: SessionState): void {
    const before = this.lastHandoff.get(state.id) ?? 'none';
    const ended = state.status === 'ended';
    const now = ended ? 'ended' : state.handoff.status;
    if (ended) this.lastHandoff.delete(state.id);
    else this.lastHandoff.set(state.id, state.handoff.status);
    if (now === before) return;
    if (now === 'joined') void this.begin(state.id);
    else if (before === 'joined') void this.end(state.id);
  }

  /** The advisor's browser could not read the STT captions: stop the bot and switch to OpenAI chunks. */
  async fallBack(sessionId: string, detail: string): Promise<void> {
    await this.enqueue(sessionId, async () => {
      const state = this.deps.store.get(sessionId);
      if (!state || state.handoff.status !== 'joined' || state.consult.transcriptSource !== 'agora_stt') return;
      await this.stopBot(sessionId);
      this.deps.log.warn({ sessionId, detail }, 'consult transcription switched to OpenAI after a browser report');
      this.patch(sessionId, this.openAiOr(CONSULT_STT_MESSAGES.browserProblem(clip(detail))));
    });
  }

  /** Stops every running bot (server shutdown) without holding the exit for long. */
  async shutdown(): Promise<void> {
    const ids = [...this.calls.entries()].filter(([, c]) => c.agentId).map(([id]) => id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_STOP_TIMEOUT_MS);
    });
    await Promise.race([Promise.allSettled(ids.map((id) => this.stopBot(id))), timeout]);
    clearTimeout(timer);
  }

  /* ---------------------------------------------------------------- */

  private enqueue(sessionId: string, task: () => Promise<void>): Promise<void> {
    let call = this.calls.get(sessionId);
    if (!call) {
      call = { agentId: null, queue: Promise.resolve() };
      this.calls.set(sessionId, call);
    }
    const run = call.queue.then(task, task);
    call.queue = run.catch((err: unknown) => this.deps.log.error({ sessionId, err: (err as Error).message }, 'consult transcription step failed'));
    return run;
  }

  private patch(sessionId: string, patch: Partial<Consult>): void {
    if (this.deps.store.get(sessionId)) this.deps.store.dispatch(sessionId, { type: 'set_consult', patch }, 'system');
  }

  /** The OpenAI fallback when it can run, else an honest error. `why` says why Agora is not used. */
  private openAiOr(why: string | null): Partial<Consult> {
    if (this.deps.config.OPENAI_API_KEY) {
      return { status: 'listening', transcriptSource: 'openai', error: why ? `${why} ${CONSULT_STT_MESSAGES.usingOpenAi}` : null };
    }
    return { status: 'error', transcriptSource: 'none', error: why ? `${why} ${CONSULT_STT_MESSAGES.noOpenAi}` : CONSULT_STT_MESSAGES.noOpenAi };
  }

  private begin(sessionId: string): Promise<void> {
    return this.enqueue(sessionId, async () => {
      const state = this.deps.store.get(sessionId);
      if (!state || state.status === 'ended' || state.handoff.status !== 'joined') return;
      const { config, stt, rtc, log } = this.deps;

      if (config.CONSULT_STT === 'off') {
        this.patch(sessionId, { status: 'idle', transcriptSource: 'none', error: CONSULT_STT_MESSAGES.off });
        return;
      }
      if (config.CONSULT_STT === 'openai') {
        this.patch(sessionId, this.openAiOr(null));
        return;
      }
      if (!stt) {
        this.patch(sessionId, this.openAiOr(CONSULT_STT_MESSAGES.missingCredentials));
        return;
      }
      if (!rtc) {
        this.patch(sessionId, this.openAiOr(CONSULT_STT_MESSAGES.missingRtc));
        return;
      }

      const request = buildSttStartRequest(state, rtc, this.now());
      try {
        const { agentId } = await stt.start(request);
        const call = this.calls.get(sessionId);
        if (call) call.agentId = agentId;
        log.info({ sessionId, agentId, languages: request.languages }, 'consult transcription started (Agora Real-Time STT)');
      } catch (err) {
        const detail = err instanceof SttRequestError ? err.message : err instanceof Error ? err.message : String(err);
        log.warn({ sessionId, detail }, 'Agora Real-Time STT did not start');
        this.patch(sessionId, this.openAiOr(CONSULT_STT_MESSAGES.startFailed(clip(detail))));
        return;
      }
      // The advisor may have handed back while the bot was starting.
      const latest = this.deps.store.get(sessionId);
      if (!latest || latest.status === 'ended' || latest.handoff.status !== 'joined') {
        await this.stopBot(sessionId);
        return;
      }
      this.patch(sessionId, { status: 'listening', transcriptSource: 'agora_stt', error: null });
    });
  }

  private end(sessionId: string): Promise<void> {
    return this.enqueue(sessionId, async () => {
      await this.stopBot(sessionId);
      this.patch(sessionId, { status: 'idle', transcriptSource: 'none', error: null });
      const state = this.deps.store.get(sessionId);
      if (!state || state.status === 'ended') this.calls.delete(sessionId);
    });
  }

  private async stopBot(sessionId: string): Promise<void> {
    const call = this.calls.get(sessionId);
    const agentId = call?.agentId;
    if (!call || !agentId || !this.deps.stt) return;
    call.agentId = null;
    try {
      await this.deps.stt.stop(agentId);
      this.deps.log.info({ sessionId, agentId }, 'consult transcription stopped');
    } catch (err) {
      // The bot also leaves by itself after STT_MAX_IDLE_SEC without audio.
      this.deps.log.warn({ sessionId, agentId, detail: err instanceof Error ? err.message : String(err) }, 'Agora Real-Time STT leave failed');
    }
  }
}
