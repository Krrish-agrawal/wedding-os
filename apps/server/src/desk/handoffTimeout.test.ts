import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HANDOFF_TIMEOUT_NOTE_KIND, type SessionAction } from '@ave/shared';
import { SessionStore } from '../sessions/store.js';
import { BUYER } from '../voice/testkit.js';
import { HandoffTimeoutWatcher } from './handoffTimeout.js';
import { silentLog } from './testkit.js';

const TIMEOUT_MS = 90_000;

let store: SessionStore;
let watcher: HandoffTimeoutWatcher;
let sessionId: string;
let notes: SessionAction[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  store = new SessionStore();
  watcher = new HandoffTimeoutWatcher({ store, timeoutMs: TIMEOUT_MS, log: silentLog });
  notes = [];
  store.on('change', (state, action) => {
    watcher.onChange(state);
    if (action.type === 'note') notes.push(action);
  });
  sessionId = store.create(BUYER).id;
});
afterEach(() => {
  watcher.dispose();
  vi.useRealTimers();
});

const request = (requestedAt = 1) => store.dispatch(sessionId, { type: 'set_handoff', patch: { status: 'requested', reason: 'Discount', requestedAt } }, 'agent');
const handoff = () => store.get(sessionId)!.handoff;

describe('handoff timeout', () => {
  it('writes the timeout note and closes the request when nobody joins in time', async () => {
    request();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(notes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(notes).toEqual([{ type: 'note', kind: HANDOFF_TIMEOUT_NOTE_KIND, label: expect.stringContaining('90 s') }]);
    expect(handoff()).toMatchObject({ status: 'none', reason: 'Discount' });
    const kinds = store.get(sessionId)!.timeline.map((e) => e.kind);
    expect(kinds.indexOf(HANDOFF_TIMEOUT_NOTE_KIND)).toBeLessThan(kinds.lastIndexOf('handoff_none'));
  });

  it('is cancelled when the advisor joins, the request is withdrawn or the call ends', async () => {
    request();
    store.dispatch(sessionId, { type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } }, 'advisor');
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 2);
    expect(notes).toHaveLength(0);

    store.dispatch(sessionId, { type: 'set_handoff', patch: { status: 'returned' } }, 'advisor');
    request(2);
    store.dispatch(sessionId, { type: 'set_handoff', patch: { status: 'none' } }, 'buyer');
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 2);
    expect(notes).toHaveLength(0);

    request(3);
    store.dispatch(sessionId, { type: 'set_status', status: 'ended' }, 'buyer');
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 2);
    expect(notes).toHaveLength(0);
  });

  it('does not restart the wait on unrelated changes, but does for a new request', async () => {
    request(1);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS / 2);
    store.dispatch(sessionId, { type: 'set_view', view: 'money' }, 'agent');
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS / 2);
    expect(notes).toHaveLength(1);

    request(5);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS / 2);
    request(6); // a fresh request restarts the wait
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS / 2);
    expect(notes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS / 2);
    expect(notes).toHaveLength(2);
  });
});
