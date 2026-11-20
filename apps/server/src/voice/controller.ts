import type {
  ActionSource,
  AgentStatus,
  SessionAction,
  SessionState,
  VoiceStartResponse,
  VoiceStatusResponse,
  VoiceTextResponse,
} from '@ave/shared';
import type { AppContext } from '../context.js';
import type { Collaborators } from './collaborators.js';
import { AgentExitedError, describeAgoraError, isNameConflict, type AgentGateway, type LiveAgent, type ThinkPolicy, type VoiceLogger } from './gateway.js';
import type { AgentSpec } from './joinConfig.js';
import { CALL_LANGUAGE_INFO, HANDOFF_TIMEOUT_NOTE_KIND } from '@ave/shared';
import { buildAsrKeywords } from './keywords.js';
import { HAND_BACK_EVENT, RESUME_EVENT, VOICE_MESSAGES, handoffTimeoutEvent, handoverLine, languageSwitchEvent } from './lines.js';
import { reactionFor, reactionText, screenKey, type ScreenReaction } from './screen.js';
import type { Resolved, VoiceSettings } from './settings.js';
import { agentNameFor, channelFor } from './tokens.js';
import { missingHistoryLines, resumeContext } from './transcript.js';

/** Screen changes within this window reach the agent as one `update`. */
export const SCREEN_SYNC_DEBOUNCE_MS = 300;
/** Spoken reactions to buyer clicks are rate limited so clicking around never floods the advisor. */
export const MIN_REACTION_GAP_MS = 2500;
/** Consecutive failed screen updates before giving up until the next change (agent probably gone). */
const MAX_SYNC_FAILURES = 3;
/**
 * Starts retried with the next agent name: a name conflict (409), or an agent that exited right after
 * Agora accepted it. Rate limits and 5xx are already retried inside the SDK.
 */
const MAX_START_RETRIES = 3;
/**
 * Long Hindi and Kannada captions arrive over RTM in several chunks (non-Latin text is about three times the
 * bytes), and out-of-order chunks get dropped, losing words after a comma. Shortly after each final advisor
 * caption the server compares it with the agent's own history and repairs it.
 */
const CAPTION_FIX_DELAY_MS = 1200;
/**
 * While the AI advisor is live, the server checks its conversation history this often and adds any
 * line the browser did not relay. Browser captions travel over Agora RTM; if RTM is blocked or drops
 * (seen in a live call on 2026-11-21), captions would otherwise stay empty until the call ended.
 */
const LIVE_CAPTION_SYNC_MS = 2500;
/** A line must have finished this long ago before the server fills it in, so the browser's copy wins when it works. */
const LIVE_CAPTION_SETTLE_MS = 4000;
/** Recent advisor lines checked on each repair pass. */
const CAPTION_FIX_LOOKBACK = 6;
/** After a restart the agent needs a moment in the channel before it can act on `think`. */
export const POST_START_NUDGE_DELAY_MS = 1500;
const POST_START_NUDGE_ATTEMPTS = 3;
/** On server shutdown, stop running agents but never hold the exit longer than this. */
const SHUTDOWN_STOP_TIMEOUT_MS = 5000;

/** A buyer click: answer if listening, queue behind a thought, never cut the advisor off mid-sentence. */
const CLICK_THINK: ThinkPolicy = { onListening: 'interrupt', onThinking: 'append', onSpeaking: 'ignore', interruptable: true };
/** Typed buyer input behaves like the buyer speaking: it takes the floor. */
const TYPED_THINK: ThinkPolicy = { onListening: 'interrupt', onThinking: 'interrupt', onSpeaking: 'interrupt', interruptable: true };
/** Welcome-back nudge after a restart: wait for anything already under way. */
const NUDGE_THINK: ThinkPolicy = { onListening: 'interrupt', onThinking: 'append', onSpeaking: 'append', interruptable: true };

/** Why an agent is being started: the first start greets; the others never replay the greeting. */
type StartMode = 'first' | 'resume' | 'hand_back' | 'language';

interface CallRuntime {
  sessionId: string;
  agent: LiveAgent | null;
  agentStartedAt: number;
  /** Number of start attempts so far; feeds the unique agent name. */
  starts: number;
  greeted: boolean;
  /** Context between the brief and the screen line, kept across screen updates (hand-back, resume). */
  extraSystemMessages: string[];
  /** Screen key of the system messages the agent currently has. */
  lastScreenKey: string | null;
  lastSeen: SessionState | null;
  /** Start, stop and handoff transitions for one call run strictly one after another. */
  queue: Promise<unknown>;
  sync: { timer: ReturnType<typeof setTimeout> | null; running: boolean; again: boolean; failures: number; reaction: ScreenReaction | null; lastReactionAt: number };
}

export class VoiceError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface VoiceControllerDeps {
  ctx: AppContext;
  settings: Resolved<VoiceSettings>;
  gateway: AgentGateway | null;
  collaborators: Collaborators;
  log: VoiceLogger;
  now?: () => number;
}

/**
 * Owns the voice agent of every live call: start and stop, keeping the advisor aware of the screen,
 * spoken reactions to buyer clicks, typed input, human handoff and hand-back, and the transcript
 * cross-check against the agent's history before it leaves. The session store stays the single
 * source of truth; this class writes to it only through `dispatch`.
 */
export class VoiceController {
  private readonly runtimes = new Map<string, CallRuntime>();
  private readonly captionFixTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly keywords: string[];
  private readonly now: () => number;
  private detachListener: (() => void) | null = null;
  private typedCount = 0;
  private liveCaptionTimer: ReturnType<typeof setInterval> | null = null;
  private readonly liveCaptionBusy = new Set<string>();

  constructor(private readonly deps: VoiceControllerDeps) {
    this.keywords = deps.ctx.config.ASR_KEYWORDS === 'off' ? [] : buildAsrKeywords(deps.ctx.content);
    this.now = deps.now ?? Date.now;
  }

  attach(): void {
    const { store } = this.deps.ctx;
    const onChange = (state: SessionState, action: SessionAction, source: ActionSource) => this.onChange(state, action, source);
    store.on('change', onChange);
    this.detachListener = () => store.off('change', onChange);
    this.liveCaptionTimer = setInterval(() => this.syncLiveCaptions(), LIVE_CAPTION_SYNC_MS);
    this.liveCaptionTimer.unref?.();
  }

  /** Fills in captions the browser missed for every call whose AI advisor is on the line. */
  private syncLiveCaptions(): void {
    const { store } = this.deps.ctx;
    for (const rt of this.runtimes.values()) {
      const agent = rt.agent;
      const state = store.get(rt.sessionId);
      if (!agent || !state || state.status !== 'live' || state.handoff.status === 'joined' || this.liveCaptionBusy.has(rt.sessionId)) continue;
      this.liveCaptionBusy.add(rt.sessionId);
      void (async () => {
        try {
          const history = await agent.history();
          const latest = store.get(rt.sessionId);
          if (!latest || rt.agent !== agent) return;
          const now = this.now();
          const lines = missingHistoryLines(latest.transcript, history, {
            agentId: agent.agentId,
            startedAt: rt.agentStartedAt,
            now,
            settledBefore: now - LIVE_CAPTION_SETTLE_MS,
          });
          for (const line of lines) store.dispatch(rt.sessionId, { type: 'add_transcript', line }, 'system');
          if (lines.length) this.deps.log.info({ sessionId: rt.sessionId, added: lines.length }, 'captions filled in from agent history');
        } catch {
          // History is a best-effort backup; the next tick tries again.
        } finally {
          this.liveCaptionBusy.delete(rt.sessionId);
        }
      })();
    }
  }

  availability(): VoiceStatusResponse {
    const { settings, gateway, collaborators } = this.deps;
    if (!settings.ok) return { available: false, reason: settings.reason };
    if (!gateway) return { available: false, reason: VOICE_MESSAGES.startFailed };
    if (!collaborators.prompts) return { available: false, reason: VOICE_MESSAGES.briefMissing };
    return { available: true, warnings: settings.warnings };
  }

  /** Starts the call's agent, or returns the running one. `restart` replaces an agent that stopped responding. */
  async start(sessionId: string, opts: { restart: boolean }): Promise<VoiceStartResponse> {
    const availability = this.availability();
    if (!availability.available) return availability;
    if (!this.deps.ctx.store.get(sessionId)) throw new VoiceError(404, 'Session not found');
    const rt = this.runtime(sessionId);
    const { warnings } = availability;

    return this.enqueue(rt, async (): Promise<VoiceStartResponse> => {
      const state = this.deps.ctx.store.get(sessionId);
      if (!state || state.status === 'ended') return { available: false, reason: VOICE_MESSAGES.callEnded };
      if (state.handoff.status === 'joined') return { available: true, agentId: null, standby: true, warnings };
      if (rt.agent && !opts.restart) return { available: true, agentId: rt.agent.agentId, standby: false, warnings };
      if (rt.agent) await this.leave(rt, { reconcile: true, status: null, farewell: null });
      const agentId = await this.launch(rt, rt.greeted ? 'resume' : 'first');
      return { available: true, agentId, standby: false, warnings };
    });
  }

  /** Stops the call's agent (end of call or the buyer leaving). */
  async stop(sessionId: string): Promise<void> {
    const rt = this.runtimes.get(sessionId);
    if (!rt) return;
    await this.enqueue(rt, () => this.leave(rt, { reconcile: true, status: 'off', farewell: null }));
  }

  /** Typed buyer input: recorded as a buyer line, then handed to the running agent as user input. */
  /** Dev diagnostics: the running agent's history exactly as Agora returns it, or null when no agent runs. */
  async debugHistory(sessionId: string): Promise<unknown> {
    const agent = this.runtimes.get(sessionId)?.agent;
    if (!agent?.rawHistory) return null;
    return agent.rawHistory();
  }

  async sendText(sessionId: string, text: string): Promise<VoiceTextResponse> {
    const { store } = this.deps.ctx;
    const state = store.get(sessionId);
    if (!state) throw new VoiceError(404, 'Session not found');
    const rt = this.runtimes.get(sessionId);
    const at = this.now();
    this.typedCount += 1;
    store.dispatch(sessionId, { type: 'add_transcript', line: { id: `typed-${at.toString(36)}-${this.typedCount}`, role: 'buyer', text, final: true, at } }, 'buyer');

    const agent = rt?.agent;
    if (!agent) return { delivered: false, reason: state.handoff.status === 'joined' ? VOICE_MESSAGES.humanOnCall : VOICE_MESSAGES.advisorAway };
    try {
      await agent.think(text, TYPED_THINK);
      return { delivered: true };
    } catch (err) {
      this.deps.log.warn({ sessionId, ...describeAgoraError(err) }, 'typed message not delivered');
      return { delivered: false, reason: VOICE_MESSAGES.textFailed };
    }
  }

  /** The buyer's browser reports the engine's conversational state; kept on the session for the Desk. */
  setConversationState(sessionId: string, state: AgentStatus['state']): void {
    const rt = this.runtimes.get(sessionId);
    if (!rt?.agent) return;
    this.deps.ctx.store.dispatch(sessionId, { type: 'set_agent', patch: { state } }, 'system');
  }

  /** Stops every running agent (server shutdown) so none keeps a Murf slot or talks to an empty room. */
  async shutdown(): Promise<void> {
    this.detachListener?.();
    this.detachListener = null;
    if (this.liveCaptionTimer) clearInterval(this.liveCaptionTimer);
    this.liveCaptionTimer = null;
    const running = [...this.runtimes.values()].filter((rt) => rt.agent);
    const stops = running.map((rt) => this.leave(rt, { reconcile: false, status: null, farewell: null }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_STOP_TIMEOUT_MS);
    });
    await Promise.race([Promise.allSettled(stops), timeout]);
    clearTimeout(timer);
  }

  /* ---------------------------------------------------------------- */

  private runtime(sessionId: string): CallRuntime {
    let rt = this.runtimes.get(sessionId);
    if (!rt) {
      rt = {
        sessionId,
        agent: null,
        agentStartedAt: 0,
        starts: 0,
        greeted: false,
        extraSystemMessages: [],
        lastScreenKey: null,
        lastSeen: this.deps.ctx.store.get(sessionId) ?? null,
        queue: Promise.resolve(),
        sync: { timer: null, running: false, again: false, failures: 0, reaction: null, lastReactionAt: Number.NEGATIVE_INFINITY },
      };
      this.runtimes.set(sessionId, rt);
    }
    return rt;
  }

  private enqueue<T>(rt: CallRuntime, task: () => Promise<T>): Promise<T> {
    const run = rt.queue.then(task, task);
    rt.queue = run.catch(() => undefined);
    return run;
  }

  private setAgent(sessionId: string, patch: Partial<AgentStatus>): void {
    this.deps.ctx.store.dispatch(sessionId, { type: 'set_agent', patch }, 'system');
  }

  private systemMessages(rt: CallRuntime, state: SessionState): string[] {
    const prompts = this.deps.collaborators.prompts;
    if (!prompts) throw new Error('prompt builders missing');
    return [prompts.systemPrompt(this.deps.ctx, state), ...rt.extraSystemMessages, prompts.screenLine(this.deps.ctx, state)];
  }

  /** Starts a new agent for the call. Runs inside the call's queue. */
  private async launch(rt: CallRuntime, mode: StartMode): Promise<string> {
    const { ctx, gateway, collaborators, settings, log } = this.deps;
    const { sessionId } = rt;
    const state = ctx.store.get(sessionId);
    if (!gateway || !settings.ok || !collaborators.prompts || !state) throw new VoiceError(503, VOICE_MESSAGES.startFailed);

    this.setAgent(sessionId, { status: 'starting', error: null });
    let spec: AgentSpec;
    try {
      const context =
        mode === 'hand_back' ? collaborators.handoffContext(state, ctx.content) : mode === 'resume' || mode === 'language' ? resumeContext(state.transcript) : null;
      rt.extraSystemMessages = context ? [context] : [];
      spec = {
        sessionId,
        name: agentNameFor(sessionId, rt.starts + 1),
        channel: channelFor(sessionId),
        systemMessages: this.systemMessages(rt, state),
        greeting: mode === 'first' ? collaborators.prompts.greeting(ctx, state) : null,
        failureMessage: collaborators.prompts.failureMessage(state),
        // Keywords only for English: ARES proved sensitive to them, and the list is English terms.
        keywords: state.language === 'en' ? this.keywords : [],
        language: { asr: CALL_LANGUAGE_INFO[state.language].asr, ttsLocale: CALL_LANGUAGE_INFO[state.language].ttsLocale, fillers: CALL_LANGUAGE_INFO[state.language].fillers },
        tools: collaborators.tools(settings.value.tools, ctx.store.toolToken(sessionId)),
      };
    } catch (err) {
      log.error({ sessionId, err: (err as Error).message }, 'could not build the agent configuration');
      this.setAgent(sessionId, { status: 'error', agentId: null, error: VOICE_MESSAGES.startFailed });
      throw new VoiceError(500, VOICE_MESSAGES.startFailed);
    }

    let agent: LiveAgent | null = null;
    for (let attempt = 0; !agent; attempt += 1) {
      rt.starts += 1;
      spec.name = agentNameFor(sessionId, rt.starts);
      try {
        agent = await gateway.start(spec);
      } catch (err) {
        if ((isNameConflict(err) || err instanceof AgentExitedError) && attempt < MAX_START_RETRIES) {
          log.warn({ sessionId, name: spec.name, ...describeAgoraError(err) }, 'agent start did not hold; retrying with the next name');
          continue;
        }
        log.error({ sessionId, name: spec.name, ...describeAgoraError(err) }, 'agent start failed');
        this.setAgent(sessionId, { status: 'error', agentId: null, error: VOICE_MESSAGES.startFailed });
        throw new VoiceError(502, VOICE_MESSAGES.startFailed);
      }
    }

    rt.agent = agent;
    rt.agentStartedAt = this.now();
    rt.lastScreenKey = screenKey(state);
    rt.sync.failures = 0;
    if (mode === 'first') rt.greeted = true;
    this.setAgent(sessionId, { status: 'live', agentId: agent.agentId, error: null });
    log.info({ sessionId, agentId: agent.agentId, name: spec.name, mode, tools: spec.tools.kind }, 'agent started');

    if (mode !== 'first') {
      const event = mode === 'hand_back' ? HAND_BACK_EVENT : mode === 'language' ? languageSwitchEvent(CALL_LANGUAGE_INFO[state.language].label) : RESUME_EVENT;
      void this.nudge(rt, agent, event);
    }
    const latest = ctx.store.get(sessionId);
    if (latest && screenKey(latest) !== rt.lastScreenKey) this.scheduleSync(rt);
    return agent.agentId;
  }

  /** A restarted agent has no greeting; prompt it once it is in the channel so it speaks first. */
  private async nudge(rt: CallRuntime, agent: LiveAgent, text: string): Promise<void> {
    for (let attempt = 0; attempt < POST_START_NUDGE_ATTEMPTS; attempt += 1) {
      await delay(POST_START_NUDGE_DELAY_MS);
      if (rt.agent !== agent) return;
      try {
        await agent.think(text, NUDGE_THINK);
        return;
      } catch (err) {
        this.deps.log.warn({ sessionId: rt.sessionId, attempt, ...describeAgoraError(err) }, 'welcome-back prompt failed');
      }
    }
  }

  /**
   * Takes the agent off the call: optional spoken line, history cross-check, then `leave`.
   * `status` null leaves `agent.status` to the caller (a replacement start sets it).
   */
  private async leave(rt: CallRuntime, opts: { reconcile: boolean; status: AgentStatus['status'] | null; farewell: string | null }): Promise<void> {
    const agent = rt.agent;
    if (!agent) {
      if (opts.status) this.setAgent(rt.sessionId, { status: opts.status, agentId: null, state: 'idle' });
      return;
    }
    rt.agent = null;
    this.clearSync(rt);
    const { log } = this.deps;
    if (opts.farewell) {
      try {
        await agent.say(opts.farewell, { interruptable: false });
      } catch (err) {
        log.warn({ sessionId: rt.sessionId, ...describeAgoraError(err) }, 'handover line not spoken');
      }
    }
    if (opts.reconcile) await this.reconcile(rt, agent);
    try {
      await agent.stop();
    } catch (err) {
      log.warn({ sessionId: rt.sessionId, agentId: agent.agentId, ...describeAgoraError(err) }, 'agent leave failed');
    }
    log.info({ sessionId: rt.sessionId, agentId: agent.agentId }, 'agent left');
    if (opts.status) this.setAgent(rt.sessionId, { status: opts.status, agentId: null, state: 'idle', error: null });
  }

  /** Adds any line the browser never relayed, from the agent's own history (only works while it runs). */
  private async reconcile(rt: CallRuntime, agent: LiveAgent): Promise<void> {
    const { store } = this.deps.ctx;
    try {
      const history = await agent.history();
      const state = store.get(rt.sessionId);
      if (!state) return;
      const lines = missingHistoryLines(state.transcript, history, { agentId: agent.agentId, startedAt: rt.agentStartedAt, now: this.now() });
      for (const line of lines) store.dispatch(rt.sessionId, { type: 'add_transcript', line }, 'system');
      if (lines.length) this.deps.log.info({ sessionId: rt.sessionId, added: lines.length }, 'transcript completed from agent history');
    } catch (err) {
      this.deps.log.warn({ sessionId: rt.sessionId, ...describeAgoraError(err) }, 'agent history unavailable');
    }
  }

  private onChange(state: SessionState, action: SessionAction, source: ActionSource): void {
    const rt = this.runtimes.get(state.id);
    if (!rt) return;
    const prev = rt.lastSeen ?? undefined;
    rt.lastSeen = state;

    if (state.status === 'ended' && prev?.status !== 'ended') {
      void this.enqueue(rt, async () => {
        await this.leave(rt, { reconcile: true, status: 'off', farewell: null });
        this.runtimes.delete(rt.sessionId);
      });
      return;
    }
    const handoffBefore = prev?.handoff.status;
    const handoffNow = state.handoff.status;
    if (handoffBefore !== handoffNow) {
      if (handoffNow === 'joined') void this.enqueue(rt, () => this.handOver(rt));
      if (handoffNow === 'returned' && handoffBefore === 'joined') void this.enqueue(rt, () => this.handBack(rt));
    }

    if (prev && prev.language !== state.language && rt.agent && state.handoff.status !== 'joined') {
      void this.enqueue(rt, () => this.switchLanguage(rt));
      return;
    }

    if (!rt.agent) return;
    if (action.type === 'note' && action.kind === HANDOFF_TIMEOUT_NOTE_KIND) {
      void this.offerCallBack(rt, state);
      return;
    }
    if (action.type === 'add_transcript' && action.line.role === 'agent' && action.line.final && source !== 'system') this.scheduleCaptionFix(rt);
    const reaction = reactionFor(prev, state, action, source);
    if (reaction) rt.sync.reaction = reaction;
    if (reaction || screenKey(state) !== rt.lastScreenKey) this.scheduleSync(rt);
  }

  /** Nobody from the team joined in time (desk/handoffTimeout.ts): the agent tells the buyer the team will call back. */
  private async offerCallBack(rt: CallRuntime, state: SessionState): Promise<void> {
    const agent = rt.agent;
    if (!agent) return;
    try {
      await agent.think(handoffTimeoutEvent(CALL_LANGUAGE_INFO[state.language].label), NUDGE_THINK);
    } catch (err) {
      this.deps.log.warn({ sessionId: rt.sessionId, ...describeAgoraError(err) }, 'call-back line not delivered');
    }
  }

  /** A human advisor joined: one short handover line (finished thanks to graceful farewell), then standby. */
  private async handOver(rt: CallRuntime): Promise<void> {
    const state = this.deps.ctx.store.get(rt.sessionId);
    if (!state || state.handoff.status !== 'joined') return;
    if (rt.agent) {
      await this.leave(rt, { reconcile: true, status: 'standby', farewell: handoverLine(state.handoff.humanName) });
    } else if (state.agent.status !== 'off') {
      this.setAgent(rt.sessionId, { status: 'standby', agentId: null, state: 'idle' });
    }
  }

  /** The human handed back: a fresh agent with a new name, no greeting, and the handoff context. */
  /* ------------------------- caption repair ------------------------- */

  private scheduleCaptionFix(rt: CallRuntime): void {
    clearTimeout(this.captionFixTimers.get(rt.sessionId));
    this.captionFixTimers.set(
      rt.sessionId,
      setTimeout(() => {
        this.captionFixTimers.delete(rt.sessionId);
        void this.fixCaptions(rt);
      }, CAPTION_FIX_DELAY_MS),
    );
  }

  /** Replaces advisor captions that lost a chunk in transit with the full text from the agent's history. */
  private async fixCaptions(rt: CallRuntime): Promise<void> {
    const agent = rt.agent;
    if (!agent) return;
    let history;
    try {
      history = await agent.history();
    } catch {
      return;
    }
    const state = this.deps.ctx.store.get(rt.sessionId);
    if (!state) return;
    const replies = history.filter((h) => h.role === 'assistant').map((h) => h.content.trim()).filter(Boolean);
    for (const line of state.transcript.slice(-CAPTION_FIX_LOOKBACK)) {
      if (line.role !== 'agent' || !line.final) continue;
      const full = replies.find((text) => captionLostChunk(line.text, text));
      if (full) this.deps.ctx.store.dispatch(rt.sessionId, { type: 'add_transcript', line: { ...line, text: full } }, 'system');
    }
  }

  /** The buyer picked another call language: restart the agent in it, keeping the conversation so far. */
  private async switchLanguage(rt: CallRuntime): Promise<void> {
    const state = this.deps.ctx.store.get(rt.sessionId);
    if (!state || state.status === 'ended' || !rt.agent || !this.availability().available) return;
    this.deps.log.info({ sessionId: rt.sessionId, language: state.language }, 'switching call language');
    await this.leave(rt, { reconcile: true, status: null, farewell: null });
    try {
      await this.launch(rt, 'language');
    } catch {
      // launch already logged and set agent.status to error.
    }
  }

  private async handBack(rt: CallRuntime): Promise<void> {
    const state = this.deps.ctx.store.get(rt.sessionId);
    if (!state || state.status === 'ended' || state.handoff.status !== 'returned' || rt.agent) return;
    if (!this.availability().available) return;
    try {
      await this.launch(rt, 'hand_back');
    } catch {
      // launch already logged and set agent.status to error.
    }
  }

  /* -------------------------- screen sync --------------------------- */

  private scheduleSync(rt: CallRuntime): void {
    if (rt.sync.timer) clearTimeout(rt.sync.timer);
    rt.sync.timer = setTimeout(() => this.flushSync(rt), SCREEN_SYNC_DEBOUNCE_MS);
  }

  private clearSync(rt: CallRuntime): void {
    if (rt.sync.timer) clearTimeout(rt.sync.timer);
    rt.sync.timer = null;
    rt.sync.reaction = null;
    rt.sync.again = false;
  }

  /** One update (and at most one spoken reaction) at a time; changes during a flight coalesce into the next. */
  private flushSync(rt: CallRuntime): void {
    rt.sync.timer = null;
    if (rt.sync.running) {
      rt.sync.again = true;
      return;
    }
    const agent = rt.agent;
    const state = this.deps.ctx.store.get(rt.sessionId);
    if (!agent || !state) return;
    rt.sync.running = true;

    const run = async () => {
      const key = screenKey(state);
      if (key !== rt.lastScreenKey) {
        await agent.updateSystemMessages(this.systemMessages(rt, state));
        rt.lastScreenKey = key;
      }
      const reaction = rt.sync.reaction;
      rt.sync.reaction = null;
      const at = this.now();
      if (reaction && rt.agent === agent && at - rt.sync.lastReactionAt >= MIN_REACTION_GAP_MS) {
        rt.sync.lastReactionAt = at;
        await agent.think(reactionText(reaction, state, this.deps.ctx.content), CLICK_THINK);
      }
    };

    run()
      .then(() => {
        rt.sync.failures = 0;
      })
      .catch((err: unknown) => {
        rt.sync.failures += 1;
        this.deps.log.warn({ sessionId: rt.sessionId, failures: rt.sync.failures, ...describeAgoraError(err) }, 'screen update failed');
        if (rt.sync.failures < MAX_SYNC_FAILURES) rt.sync.again = true;
      })
      .finally(() => {
        rt.sync.running = false;
        if (rt.sync.again && rt.agent === agent) {
          rt.sync.again = false;
          this.scheduleSync(rt);
        }
      });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Characters compared at each end of a caption to recognise its full reply. */
const CAPTION_MATCH_CHARS = 12;

/**
 * True when `full` is the reply `caption` was cut from: same start and end, but longer (a middle chunk
 * went missing in transit).
 */
export function captionLostChunk(caption: string, full: string): boolean {
  const a = caption.trim();
  const n = Math.min(CAPTION_MATCH_CHARS, Math.floor(a.length / 3));
  if (n < 4 || full.length <= a.length) return false;
  return full.startsWith(a.slice(0, n)) && full.endsWith(a.slice(-n));
}
