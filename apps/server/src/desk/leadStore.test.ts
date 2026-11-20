import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionState, reduceSession, type SessionState } from '@ave/shared';
import { SessionStore } from '../sessions/store.js';
import { LeadStore } from './leadStore.js';
import { silentLog, T0 } from './testkit.js';

const dirs: string[] = [];
function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ave-leads-'));
  dirs.push(dir);
  return path.join(dir, 'nested', 'leads.sqlite');
}
afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function sample(): SessionState {
  let s = createSessionState('lead1', { name: 'Priya Sharma', phone: '9876543210', email: 'priya@example.com' }, T0);
  const step = (action: Parameters<typeof reduceSession>[1]['action'], at: number) => (s = reduceSession(s, { action, source: 'agent', at }));
  step({ type: 'set_status', status: 'live' }, T0 + 1000);
  step({ type: 'update_lead', patch: { budget: '1.3 crore', objections: ['Price is high'] } }, T0 + 2000);
  step({ type: 'set_property', propertyId: 'apt' }, T0 + 3000);
  step({ type: 'set_view', view: 'money', params: { tab: 'emi', emi: { downPayment: 3_000_000, ratePct: 8.5, tenureYears: 20 } } }, T0 + 4000);
  step({ type: 'apply_offer', propertyId: 'apt', offerId: 'festive' }, T0 + 5000);
  step({ type: 'confirm_booking', propertyId: 'apt', slotId: 's1' }, T0 + 6000);
  step({ type: 'set_handoff', patch: { status: 'requested', reason: 'Discount' } }, T0 + 7000);
  step({ type: 'add_transcript', line: { id: 't1', role: 'buyer', text: 'Can you do better?', final: true, at: T0 + 7500 } }, T0 + 7500);
  step({ type: 'upsert_delivery', delivery: { id: 'd1', channel: 'email', to: 'priya@example.com', status: 'sent', detail: 'ok', at: T0 + 8000 } }, T0 + 8000);
  step({ type: 'set_status', status: 'ended' }, T0 + 9000);
  return s;
}

describe('LeadStore', () => {
  it('survives a restart with everything the Desk shows', () => {
    const file = tempDb();
    const a = new LeadStore(file, silentLog);
    const s = sample();
    a.upsert(s, T0 + 9000);
    a.close();

    const b = new LeadStore(file, silentLog);
    const rec = b.get('lead1');
    expect(rec?.state).toEqual(s);
    expect(rec?.updatedAt).toBe(T0 + 9000);
    expect(rec?.extras.emiByProperty.apt).toEqual({ downPayment: 3_000_000, ratePct: 8.5, tenureYears: 20 });
    b.close();
  });

  it('keeps EMI inputs per property after the session moves on', () => {
    const store = new LeadStore(':memory:', silentLog, 0);
    let s = sample();
    store.upsert(s);
    s = reduceSession(s, { action: { type: 'set_property', propertyId: 'office' }, source: 'agent', at: T0 + 10_000 });
    expect(s.params.money.emi).toBeNull();
    store.upsert(s);
    expect(store.get('lead1')?.extras.emiByProperty.apt?.downPayment).toBe(3_000_000);
    store.close();
  });

  it('debounces writes from the live session store and flushes on close', () => {
    vi.useFakeTimers();
    const file = tempDb();
    const sessions = new SessionStore(() => T0);
    const leads = new LeadStore(file, silentLog, 400);
    leads.attach(sessions);
    const s = sessions.create({ name: 'Arjun Rao', phone: '9000000000', email: 'arjun@example.com' });
    sessions.dispatch(s.id, { type: 'set_status', status: 'live' }, 'system');
    sessions.dispatch(s.id, { type: 'set_view', view: 'tour' }, 'buyer');

    // Memory is current at once; disk only after the debounce.
    expect(leads.get(s.id)?.state.view).toBe('tour');
    expect(new LeadStore(file, silentLog).get(s.id)).toBeUndefined();
    vi.advanceTimersByTime(400);
    expect(new LeadStore(file, silentLog).get(s.id)?.state.view).toBe('tour');

    sessions.dispatch(s.id, { type: 'set_view', view: 'money' }, 'buyer');
    leads.close();
    expect(new LeadStore(file, silentLog).get(s.id)?.state.view).toBe('money');
  });

  it('skips rows that no longer validate instead of failing to start', () => {
    const file = tempDb();
    const a = new LeadStore(file, silentLog);
    a.upsert(sample());
    a.close();
    // Corrupt the stored state through a second connection.
    const raw = new LeadStore(file, silentLog);
    (raw as unknown as { db: { prepare(sql: string): { run(): void } } }).db.prepare("UPDATE leads SET state_json = '{\"buyer\":{\"name\":\"\"}}'").run();
    raw.close();
    const warn = vi.fn();
    const b = new LeadStore(file, { ...silentLog, warn });
    expect(b.list()).toEqual([]);
    expect(warn).toHaveBeenCalled();
    b.close();
  });

  it('stores reports and the outbox with previews', () => {
    const store = new LeadStore(':memory:', silentLog);
    expect(store.getReport('x')).toMatchObject({ summary: null, autoSentAt: null, crmDealId: null });
    store.saveReport({ sessionId: 'x', factsHash: 'abc', summary: { headline: 'H', summary: 'S', priorities: [], openQuestions: [] }, summaryAt: 5 });
    store.saveReport({ sessionId: 'x', crmDealId: 'd1' });
    expect(store.getReport('x')).toMatchObject({ factsHash: 'abc', crmDealId: 'd1', summary: { headline: 'H' } });

    const delivery = { id: 'd1', channel: 'email' as const, to: 'p@example.com', status: 'queued' as const, detail: null, at: 1 };
    store.upsertOutbox({ delivery, sessionId: 'x', buyerName: 'Priya', subject: 'Recap', text: 'Hello', html: '<p>Hello</p>' });
    store.upsertOutbox({ delivery: { ...delivery, status: 'sent', detail: 'Accepted', at: 2 }, sessionId: 'x', buyerName: 'Priya', subject: null, text: null, html: null });
    expect(store.listOutbox()).toEqual([
      { id: 'd1', sessionId: 'x', buyerName: 'Priya', channel: 'email', to: 'p@example.com', status: 'sent', detail: 'Accepted', at: 2, subject: 'Recap', text: 'Hello', html: '<p>Hello</p>' },
    ]);
    store.close();
  });
});
