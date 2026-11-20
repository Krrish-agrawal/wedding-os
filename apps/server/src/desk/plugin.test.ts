import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { REPORT_REQUEST_NOTE_KIND, type LeadDetail, type LeadSummary, type OutboxItem } from '@ave/shared';
import type { AppContext } from '../context.js';
import '../context.js';
import { deskPlugin } from './plugin.js';
import { deskFor } from './runtime.js';
import { Clock, FakeEmail, FakeWhatsApp, firstProperty, silentLog, testContext } from './testkit.js';

const dirs: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function start(ctx: AppContext, dbPath: string, email = new FakeEmail(), whatsapp = new FakeWhatsApp()) {
  const app = Fastify({ logger: false });
  app.decorate('ctx', ctx);
  await app.register(deskPlugin, { dbPath, deps: { email, whatsapp, crm: null, summarize: null, log: silentLog } });
  await app.ready();
  apps.push(app);
  return app;
}

function tempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ave-desk-'));
  dirs.push(dir);
  return path.join(dir, 'leads.sqlite');
}

describe('Desk plugin', () => {
  it('runs the handoff, lists and details leads, and resends the recap', async () => {
    const clock = new Clock();
    const ctx = await testContext({}, clock);
    const app = await start(ctx, ':memory:');
    const apt = firstProperty(ctx, 'sale');
    const s = ctx.store.create({ name: 'Priya Sharma', phone: '9876543210', email: 'priya@example.com' });
    ctx.store.dispatch(s.id, { type: 'set_status', status: 'live' }, 'system');
    ctx.store.dispatch(s.id, { type: 'set_property', propertyId: apt.property.id }, 'agent');
    clock.advance(30);
    ctx.store.dispatch(s.id, { type: 'set_view', view: 'money' }, 'agent');
    clock.advance(90);

    expect((await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/handoff/return` })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/handoff/join`, payload: { humanName: ' ' } })).statusCode).toBe(400);
    const join = await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/handoff/join`, payload: { humanName: 'Rahul' } });
    expect(join.json()).toMatchObject({ handoff: { status: 'joined', humanName: 'Rahul' } });
    const other = await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/handoff/join`, payload: { humanName: 'Meera' } });
    expect(other.statusCode).toBe(409);
    const back = await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/handoff/return` });
    expect(back.json()).toMatchObject({ handoff: { status: 'returned' } });
    expect((await app.inject({ method: 'POST', url: '/api/sessions/missing/handoff/join', payload: { humanName: 'Rahul' } })).statusCode).toBe(404);

    const leads = (await app.inject({ url: '/api/leads' })).json() as { leads: LeadSummary[] };
    expect(leads.leads).toHaveLength(1);
    expect(leads.leads[0]).toMatchObject({ id: s.id, live: true, stage: 'negotiating', propertyIds: [apt.property.id] });
    expect(leads.leads[0]!.score).toBeGreaterThan(0);

    const detail = (await app.inject({ url: `/api/leads/${s.id}` })).json() as { lead: LeadDetail };
    expect(detail.lead.visits[0]?.views.map((v) => v.view)).toContain('money');
    expect(detail.lead.reasons.map((r) => r.label)).toContain('Asked for a human advisor');
    expect(detail.lead.reportHtml).toContain('<!doctype html>');
    expect((await app.inject({ url: '/api/leads/nope' })).statusCode).toBe(404);

    const resend = await app.inject({ method: 'POST', url: `/api/leads/${s.id}/report`, payload: { channels: ['email'] } });
    expect(resend.json()).toMatchObject({ deliveries: [{ channel: 'email', status: 'sent' }] });
    expect((await app.inject({ method: 'POST', url: `/api/leads/${s.id}/report`, payload: { channels: ['fax'] } })).statusCode).toBe(400);
    const outbox = (await app.inject({ url: '/api/outbox' })).json() as { items: OutboxItem[] };
    expect(outbox.items.map((i) => [i.channel, i.status])).toEqual([['email', 'sent']]);
  });

  it('sends the recap automatically when a call ends after the buyer asked for it', async () => {
    const clock = new Clock();
    const ctx = await testContext({}, clock);
    const email = new FakeEmail();
    await start(ctx, ':memory:', email);
    const s = ctx.store.create({ name: 'Priya Sharma', phone: '9876543210', email: 'priya@example.com' });
    ctx.store.dispatch(s.id, { type: 'note', kind: REPORT_REQUEST_NOTE_KIND, label: 'Buyer asked for the recap' }, 'agent');
    ctx.store.dispatch(s.id, { type: 'set_status', status: 'ended' }, 'system');
    ctx.store.dispatch(s.id, { type: 'set_status', status: 'live' }, 'system');
    ctx.store.dispatch(s.id, { type: 'set_status', status: 'ended' }, 'system');
    await deskFor(ctx).idle(s.id);
    expect(email.sent).toHaveLength(1);
  });

  it('shows past calls after a restart', async () => {
    const file = tempDb();
    const clock = new Clock();
    const ctx = await testContext({}, clock);
    const app = await start(ctx, file);
    const s = ctx.store.create({ name: 'Arjun Rao', phone: '9000000000', email: 'arjun@example.com' });
    ctx.store.dispatch(s.id, { type: 'update_lead', patch: { budget: '2 lakh a month' } }, 'agent');
    await app.close();
    apps.splice(apps.indexOf(app), 1);

    const fresh = await testContext({}, clock);
    const again = await start(fresh, file);
    const leads = (await again.inject({ url: '/api/leads' })).json() as { leads: LeadSummary[] };
    expect(leads.leads).toEqual([expect.objectContaining({ id: s.id, live: false, budget: '2 lakh a month' })]);
    expect((await again.inject({ url: `/api/leads/${s.id}` })).statusCode).toBe(200);
  });
});
