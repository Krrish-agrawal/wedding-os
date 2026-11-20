import { HANDOFF_TIMEOUT_NOTE_KIND, type SessionState } from '@ave/shared';
import type { SessionStore } from '../sessions/store.js';
import type { DeskLogger } from './runtime.js';

const MS_PER_SECOND = 1000;

/** Timeline label written when nobody joined in time. */
export function handoffTimeoutLabel(timeoutMs: number): string {
  return `No advisor joined within ${Math.round(timeoutMs / MS_PER_SECOND)} s; the AI offered a call back`;
}

export interface HandoffTimeoutDeps {
  store: SessionStore;
  timeoutMs: number;
  log: DeskLogger;
}

/**
 * When a buyer asks for a person and nobody joins within HANDOFF_TIMEOUT_MS, writes a timeline note of kind
 * HANDOFF_TIMEOUT_NOTE_KIND. The voice controller reacts to that note by having the agent tell the buyer the
 * team will call back; the integrations pipeline reacts to it with the call-back task and alerts. The request
 * is then closed (handoff back to `none`) so the buyer's screen stops saying a person is on the way; the
 * reason stays on the call, and a late advisor can still join from the Lead Desk.
 */
export class HandoffTimeoutWatcher {
  private readonly timers = new Map<string, { timer: ReturnType<typeof setTimeout>; requestedAt: number | null }>();

  constructor(private readonly deps: HandoffTimeoutDeps) {}

  /** Feed every store change here. */
  onChange(state: SessionState): void {
    const waiting = state.status !== 'ended' && state.handoff.status === 'requested';
    const pending = this.timers.get(state.id);
    if (!waiting) {
      if (pending) this.cancel(state.id);
      return;
    }
    // A new request (a fresh requestedAt) restarts the wait; repeats of the same one do not.
    if (pending && pending.requestedAt === state.handoff.requestedAt) return;
    if (pending) this.cancel(state.id);
    const requestedAt = state.handoff.requestedAt;
    const timer = setTimeout(() => this.fire(state.id, requestedAt), this.deps.timeoutMs);
    this.timers.set(state.id, { timer, requestedAt });
  }

  dispose(): void {
    for (const { timer } of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private cancel(sessionId: string): void {
    const pending = this.timers.get(sessionId);
    if (pending) clearTimeout(pending.timer);
    this.timers.delete(sessionId);
  }

  private fire(sessionId: string, requestedAt: number | null): void {
    this.timers.delete(sessionId);
    const { store, timeoutMs, log } = this.deps;
    const state = store.get(sessionId);
    if (!state || state.status === 'ended' || state.handoff.status !== 'requested' || state.handoff.requestedAt !== requestedAt) return;
    log.info({ sessionId, timeoutMs }, 'nobody joined the handoff in time; offering a call back');
    store.dispatch(sessionId, { type: 'note', kind: HANDOFF_TIMEOUT_NOTE_KIND, label: handoffTimeoutLabel(timeoutMs) }, 'system');
    store.dispatch(sessionId, { type: 'set_handoff', patch: { status: 'none' } }, 'system');
  }
}
