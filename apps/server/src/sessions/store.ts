import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  createSessionState,
  reduceSession,
  summarizeSession,
  type ActionSource,
  type Buyer,
  type CallLanguage,
  type SessionAction,
  type SessionState,
  type SessionSummary,
} from '@ave/shared';

export interface SessionEvents {
  /** Fired after any state change. */
  change: [state: SessionState, action: SessionAction, source: ActionSource];
  created: [state: SessionState];
}

/**
 * In-memory source of truth for live calls. Every change goes through `dispatch`,
 * which runs the shared reducer and notifies subscribers (WebSocket hub, lead store).
 */
export class SessionStore extends EventEmitter<SessionEvents> {
  private sessions = new Map<string, SessionState>();
  /** Per-session secret that authorises tool calls from the voice engine. */
  private toolTokens = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  create(buyer: Buyer, language?: CallLanguage): SessionState {
    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    const state = createSessionState(id, buyer, this.now(), language);
    this.sessions.set(id, state);
    this.toolTokens.set(id, randomUUID());
    this.emit('created', state);
    return state;
  }

  get(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  list(): SessionState[] {
    return [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  summaries(): SessionSummary[] {
    return this.list().map(summarizeSession);
  }

  toolToken(id: string): string | undefined {
    return this.toolTokens.get(id);
  }

  sessionForToolToken(token: string): string | undefined {
    for (const [id, t] of this.toolTokens) if (t === token) return id;
    return undefined;
  }

  /** Applies one action. Returns the new state, or undefined if the session does not exist. */
  dispatch(id: string, action: SessionAction, source: ActionSource): SessionState | undefined {
    const prev = this.sessions.get(id);
    if (!prev) return undefined;
    const next = reduceSession(prev, { action, source, at: this.now() });
    if (next !== prev) {
      this.sessions.set(id, next);
      this.emit('change', next, action, source);
    }
    return next;
  }

  /** Applies several actions as one broadcast-worthy batch. */
  dispatchAll(id: string, actions: SessionAction[], source: ActionSource): SessionState | undefined {
    let state: SessionState | undefined = this.sessions.get(id);
    for (const a of actions) state = this.dispatch(id, a, source);
    return state;
  }

  clear(): void {
    this.sessions.clear();
    this.toolTokens.clear();
  }
}
