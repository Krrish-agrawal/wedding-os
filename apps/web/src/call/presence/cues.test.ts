import { describe, expect, it } from 'vitest';
import { createSessionState, reduceSession, type ActionSource, type SessionAction, type SessionState, type TimelineEvent } from '@ave/shared';
import { cursorAtEnd, derivePresenceState, expressionForEvent, readTimeline, stepDriver, type DriverMemory } from './cues';

const BUYER = { name: 'Test Buyer', phone: '9000000000', email: 'buyer@example.com' };
const T0 = 1_000_000;

function apply(s: SessionState, at: number, action: SessionAction, source: ActionSource = 'agent'): SessionState {
  return reduceSession(s, { action, source, at });
}

function liveSession(): SessionState {
  let s = createSessionState('s1', BUYER, T0);
  s = apply(s, T0 + 1, { type: 'set_status', status: 'live' }, 'buyer');
  s = apply(s, T0 + 2, { type: 'set_agent', patch: { status: 'live', state: 'listening' } }, 'system');
  return s;
}

describe('derivePresenceState', () => {
  it('is idle before the call is live and while the agent starts', () => {
    expect(derivePresenceState(null)).toBe('idle');
    expect(derivePresenceState(createSessionState('s1', BUYER, T0))).toBe('idle');
    const s = apply(liveSession(), T0 + 3, { type: 'set_agent', patch: { status: 'starting' } }, 'system');
    expect(derivePresenceState(s)).toBe('idle');
    // …unless the engine itself already reports the greeting.
    expect(derivePresenceState(s, 'speaking')).toBe('speaking');
  });

  it('follows the engine state, preferring the local mirror', () => {
    const s = liveSession();
    expect(derivePresenceState(s)).toBe('listening');
    expect(derivePresenceState(s, 'speaking')).toBe('speaking');
    expect(derivePresenceState(apply(s, T0 + 3, { type: 'set_agent', patch: { state: 'thinking' } }, 'system'))).toBe('thinking');
  });

  it('shows the thinking look while a tool runs, unless the advisor is talking', () => {
    const s = apply(liveSession(), T0 + 3, { type: 'set_activity', label: 'Calculating EMI' }, 'system');
    expect(derivePresenceState(s)).toBe('thinking');
    expect(derivePresenceState(s, 'speaking')).toBe('speaking');
  });

  it('stands by when a human advisor has joined', () => {
    const s = apply(liveSession(), T0 + 3, { type: 'set_handoff', patch: { status: 'joined' } }, 'advisor');
    expect(derivePresenceState(s, 'speaking')).toBe('standby');
  });
});

describe('expressionForEvent', () => {
  const event = (patch: Partial<TimelineEvent>): TimelineEvent => ({ at: T0, source: 'agent', kind: 'note', label: '', propertyId: null, view: null, ...patch });

  it('maps the moments in the plan', () => {
    expect(expressionForEvent(event({ kind: 'offer_applied' }))).toBe('delighted');
    expect(expressionForEvent(event({ kind: 'visit_booked' }))).toBe('delighted');
    expect(expressionForEvent(event({ kind: 'handoff_joined' }))).toBe('nod');
  });

  it('is composed for money and legal, points when the advisor opens a view, quiet when the buyer does', () => {
    expect(expressionForEvent(event({ kind: 'view', view: 'money' }))).toBe('composed');
    expect(expressionForEvent(event({ kind: 'view', view: 'legal', source: 'buyer' }))).toBe('composed');
    expect(expressionForEvent(event({ kind: 'view', view: 'tour' }))).toBe('pointing');
    expect(expressionForEvent(event({ kind: 'view', view: 'tour', source: 'buyer' }))).toBeNull();
  });

  it('uses a tool result expression recorded on the event, and ignores invalid ones', () => {
    expect(expressionForEvent({ ...event({ kind: 'tool' }), expression: 'apologetic' } as TimelineEvent)).toBe('apologetic');
    expect(expressionForEvent({ ...event({ kind: 'tool' }), expression: 'smirk' } as unknown as TimelineEvent)).toBeNull();
  });
});

describe('readTimeline', () => {
  it('returns only events after the cursor, including same-millisecond newcomers', () => {
    const a: TimelineEvent = { at: 10, source: 'agent', kind: 'view', label: 'Opened Tour', propertyId: null, view: 'tour' };
    const b: TimelineEvent = { ...a, kind: 'offer_applied', label: 'Applied offer x' };
    const cursor = cursorAtEnd([a]);
    expect(readTimeline([a], cursor).events).toEqual([]);
    const read = readTimeline([a, b], cursor);
    expect(read.events).toEqual([b]);
    expect(readTimeline([a, b], read.cursor).events).toEqual([]);
  });
});

describe('stepDriver', () => {
  const step = (memory: DriverMemory | null, session: SessionState, state = derivePresenceState(session), interruptedAt: number | null = null) =>
    stepDriver(memory, { session, state, interruptedAt });

  it('does not replay history on first sight', () => {
    let s = liveSession();
    s = apply(s, T0 + 3, { type: 'apply_offer', propertyId: 'p1', offerId: 'o1' });
    const first = step(null, s);
    expect(first.expression).toBeNull();
    expect(step(first.memory, s).expression).toBeNull();
  });

  it('greets once, when the advisor first speaks', () => {
    const s = liveSession();
    const m0 = step(null, s).memory;
    const greet = step(m0, s, 'speaking');
    expect(greet.expression).toBe('warm');
    expect(step(greet.memory, s, 'listening').expression).toBeNull();
    expect(step(greet.memory, s, 'speaking').expression).toBeNull();
  });

  it('does not greet when joining a call already under way', () => {
    let s = liveSession();
    s = apply(s, T0 + 3, { type: 'add_transcript', line: { id: 'a1', role: 'agent', text: 'Hello', final: true, at: T0 + 3 } });
    const m0 = step(null, s).memory;
    expect(step(m0, s, 'speaking').expression).toBeNull();
  });

  it('reacts to new moments, the latest winning', () => {
    let s = liveSession();
    const m0 = step(null, s, 'speaking').memory;
    s = apply(s, T0 + 10, { type: 'set_view', view: 'booking' });
    s = apply(s, T0 + 11, { type: 'confirm_booking', propertyId: 'p1', slotId: 'slot1' });
    expect(step(m0, s, 'speaking').expression).toBe('delighted');
  });

  it('signals an interruption once, and it outranks a moment in the same update', () => {
    let s = liveSession();
    const m0 = step(null, s, 'speaking').memory;
    s = apply(s, T0 + 10, { type: 'apply_offer', propertyId: 'p1', offerId: 'o1' });
    const cut = step(m0, s, 'listening', T0 + 12);
    expect(cut.interrupt).toBe(true);
    expect(cut.expression).toBeNull();
    expect(step(cut.memory, s, 'listening', T0 + 12).interrupt).toBe(false);
  });

  it('looks apologetic once when the agent errors', () => {
    let s = liveSession();
    const m0 = step(null, s).memory;
    s = apply(s, T0 + 10, { type: 'set_agent', patch: { status: 'error', error: 'engine' } }, 'system');
    const err = step(m0, s);
    expect(err.expression).toBe('apologetic');
    expect(step(err.memory, s).expression).toBeNull();
  });

  it('starts over for a different session', () => {
    const s = liveSession();
    const m0 = step(null, s, 'speaking').memory;
    const other = { ...createSessionState('s2', BUYER, T0), status: 'live' as const };
    expect(step(m0, other).memory.sessionId).toBe('s2');
  });
});
