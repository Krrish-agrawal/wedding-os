import { describe, expect, it } from 'vitest';
import { createSessionState, reduceSession, type SessionAction, type SessionState } from '@ave/shared';
import { buyerDeliveries, callWindow, deliveryWording, formatDuration, propertiesDiscussed, recapPending, RECAP_WAIT_MS, viewTimes } from './recap';

const BUYER = { name: 'Test Buyer', phone: '9000000000', email: 'buyer@example.com' };
const T0 = 1_000_000;

function run(steps: Array<[number, SessionAction]>): SessionState {
  let s = createSessionState('s1', BUYER, T0);
  for (const [at, action] of steps) s = reduceSession(s, { action, source: 'buyer', at });
  return s;
}

describe('callWindow', () => {
  it('uses the live and ended events', () => {
    const s = run([
      [T0 + 5_000, { type: 'set_status', status: 'live' }],
      [T0 + 65_000, { type: 'set_status', status: 'ended' }],
    ]);
    expect(callWindow(s)).toEqual({ start: T0 + 5_000, end: T0 + 65_000, wasLive: true });
  });

  it('falls back to creation time when the call never went live', () => {
    const s = run([[T0 + 3_000, { type: 'set_status', status: 'ended' }]]);
    expect(callWindow(s)).toEqual({ start: T0, end: T0 + 3_000, wasLive: false });
  });
});

describe('viewTimes', () => {
  it('splits the call into time per view, starting on the shortlist', () => {
    const s = run([
      [T0 + 1_000, { type: 'set_status', status: 'live' }],
      [T0 + 31_000, { type: 'set_property', propertyId: 'a' }],
      [T0 + 31_000, { type: 'set_view', view: 'tour' }],
      [T0 + 91_000, { type: 'set_view', view: 'money' }],
      [T0 + 121_000, { type: 'set_view', view: 'tour' }],
      [T0 + 151_000, { type: 'set_status', status: 'ended' }],
    ]);
    expect(viewTimes(s, T0 + 999_000)).toEqual([
      { view: 'shortlist', ms: 30_000 },
      { view: 'tour', ms: 90_000 },
      { view: 'money', ms: 30_000 },
    ]);
  });

  it('counts up to now while the call is still going', () => {
    const s = run([[T0 + 1_000, { type: 'set_status', status: 'live' }]]);
    expect(viewTimes(s, T0 + 11_000)).toEqual([{ view: 'shortlist', ms: 10_000 }]);
  });
});

describe('propertiesDiscussed', () => {
  it('lists each property once, in the order it was opened', () => {
    const s = run([
      [T0 + 1_000, { type: 'set_property', propertyId: 'b' }],
      [T0 + 2_000, { type: 'set_property', propertyId: 'a' }],
      [T0 + 3_000, { type: 'set_property', propertyId: 'b' }],
    ]);
    expect(propertiesDiscussed(s)).toEqual(['b', 'a']);
  });
});

describe('deliveries', () => {
  const delivery = (id: string, channel: 'email' | 'whatsapp' | 'crm', status: 'queued' | 'sent' | 'failed' | 'not_configured', at: number) =>
    ({ type: 'upsert_delivery', delivery: { id, channel, to: 'x', status, detail: null, at } }) as const;

  it('keeps the latest per channel and hides CRM', () => {
    const s = run([
      [T0 + 1, delivery('e1', 'email', 'failed', T0 + 1)],
      [T0 + 2, delivery('e2', 'email', 'sent', T0 + 2)],
      [T0 + 3, delivery('c1', 'crm', 'sent', T0 + 3)],
    ]);
    expect(buyerDeliveries(s).map((d) => [d.id, d.status])).toEqual([['e2', 'sent']]);
  });

  it('counts only recaps, not a visit confirmation or a call-back message', () => {
    const tagged = (id: string, purpose: 'recap' | 'visit_confirmed' | 'handoff_timeout', at: number) =>
      ({ type: 'upsert_delivery', delivery: { id, channel: 'whatsapp', to: 'x', status: 'sent', detail: null, at, purpose } }) as const;
    const visitOnly = run([[T0 + 1, tagged('w1', 'visit_confirmed', T0 + 1)]]);
    expect(buyerDeliveries(visitOnly)).toEqual([]);
    const both = run([
      [T0 + 1, tagged('w1', 'recap', T0 + 1)],
      [T0 + 2, tagged('w2', 'handoff_timeout', T0 + 2)],
    ]);
    expect(buyerDeliveries(both).map((d) => d.id)).toEqual(['w1']);
  });

  it('never words an unsent delivery as sent', () => {
    for (const status of ['queued', 'failed', 'not_configured'] as const) {
      const w = deliveryWording({ id: 'd', channel: 'email', to: 'a@b.c', status, detail: null, at: 0 });
      expect(w.title.toLowerCase().startsWith('sent')).toBe(false);
    }
  });

  it('does not wait for a recap nobody asked for', () => {
    const ended = run([
      [T0 + 1_000, { type: 'set_status', status: 'live' }],
      [T0 + 2_000, { type: 'set_status', status: 'ended' }],
    ]);
    expect(recapPending(ended, T0 + 3_000)).toBe(false);
  });

  it('waits for a requested recap for a while after the call ends, then stops', () => {
    const ended = run([
      [T0 + 1_000, { type: 'set_status', status: 'live' }],
      [T0 + 1_500, { type: 'note', kind: 'report_requested', label: 'Recap requested' }],
      [T0 + 2_000, { type: 'set_status', status: 'ended' }],
    ]);
    expect(recapPending(ended, T0 + 3_000)).toBe(true);
    expect(recapPending(ended, T0 + 2_000 + RECAP_WAIT_MS + 1)).toBe(false);
    const queued = reduceSession(ended, { action: delivery('e', 'email', 'queued', T0 + 3_000), source: 'system', at: T0 + 3_000 });
    expect(recapPending(queued, T0 + 10 * RECAP_WAIT_MS)).toBe(true);
  });
});

describe('formatDuration', () => {
  it('reads naturally', () => {
    expect(formatDuration(400)).toBe('1 sec');
    expect(formatDuration(40_000)).toBe('40 sec');
    expect(formatDuration(3 * 60_000)).toBe('3 min');
    expect(formatDuration(65 * 60_000)).toBe('1 h 5 min');
  });
});
