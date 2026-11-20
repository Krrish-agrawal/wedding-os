import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConsultNotes, Delivery, OutboundDraft, OutboundPreview, PipelineResponse } from '@ave/shared';
import type { AppContext } from '../context.js';
import '../context.js';
import { MEDIA_DIR, propertyMedia, resolveMediaFile, whatsAppMediaPath } from './media.js';
import { OUTBOUND_PREVIEW_TTL_MS, PreviewStore, outboundLabel } from './outbound.js';
import { deliveryBadges } from './pipeline.js';
import { deskPlugin } from './plugin.js';
import { deskFor } from './runtime.js';
import { Clock, FakeEmail, FakeJira, FakeSlack, FakeWhatsApp, firstProperty, silentLog, testContext } from './testkit.js';

const apps: FastifyInstance[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Fakes {
  email: FakeEmail;
  whatsapp: FakeWhatsApp;
  slack: FakeSlack;
  jira: FakeJira;
}

/** Names no channel, so the automatic pipeline stays out of these tests' deliveries. */
const AUTOMATIONS_OFF = 'none';

async function start(env: Record<string, string> = {}, fakes: Partial<Fakes> = {}) {
  const clock = new Clock();
  const ctx = await testContext({ AUTOMATIONS: AUTOMATIONS_OFF, ...env }, clock);
  const f: Fakes = { email: new FakeEmail(), whatsapp: new FakeWhatsApp(), slack: new FakeSlack(), jira: new FakeJira(), ...fakes };
  const app = Fastify({ logger: false });
  app.decorate('ctx', ctx);
  await app.register(deskPlugin, { dbPath: ':memory:', deps: { ...f, crm: null, summarize: null, log: silentLog, now: clock.now } });
  await app.ready();
  apps.push(app);
  return { app, ctx, clock, ...f };
}

function newCall(ctx: AppContext): string {
  const s = ctx.store.create({ name: 'Priya Sharma', phone: '98765 43210', email: 'priya@example.com' });
  ctx.store.dispatch(s.id, { type: 'set_status', status: 'live' }, 'system');
  return s.id;
}

const draft = (patch: Partial<OutboundDraft>): OutboundDraft => ({
  channel: 'whatsapp',
  subject: null,
  text: 'Hi Priya, here is the floor plan.',
  mediaUrl: null,
  dueInDays: null,
  purpose: 'manual',
  nextStepId: null,
  ...patch,
});

describe('outbound previews', () => {
  it('previews a WhatsApp message, sends nothing until Send, then sends the edited text once', async () => {
    const { app, ctx, whatsapp } = await start();
    const id = newCall(ctx);

    const res = await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/preview`, payload: draft({}) });
    expect(res.statusCode).toBe(200);
    const preview = res.json() as OutboundPreview;
    expect(preview).toMatchObject({ sessionId: id, channel: 'whatsapp', to: '+919876543210', text: 'Hi Priya, here is the floor plan.' });
    expect(whatsapp.sent).toHaveLength(0);
    expect(ctx.store.get(id)!.deliveries).toHaveLength(0);

    const sent = await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/${preview.id}/send`, payload: { text: 'Hi Priya, the floor plan as promised. Rahul' } });
    const { delivery } = sent.json() as { delivery: Delivery };
    expect(delivery).toMatchObject({ channel: 'whatsapp', status: 'sent', purpose: 'manual', label: 'WhatsApp' });
    expect(whatsapp.sent.map((m) => m.body)).toEqual(['Hi Priya, the floor plan as promised. Rahul']);
    expect(ctx.store.get(id)!.deliveries.map((d) => d.status)).toEqual(['sent']);

    // A sent preview is gone, so a double click cannot send twice.
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/${preview.id}/send` })).statusCode).toBe(404);
    expect(whatsapp.sent).toHaveLength(1);
  });

  it('rejects bad drafts, unknown calls and other sessions, and discards on DELETE', async () => {
    const { app, ctx } = await start();
    const id = newCall(ctx);
    const other = newCall(ctx);
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/preview`, payload: { channel: 'fax', text: 'x' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/preview`, payload: draft({ text: '' }) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/sessions/nope/outbound/preview', payload: draft({}) })).statusCode).toBe(404);

    const preview = (await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/preview`, payload: draft({}) })).json() as OutboundPreview;
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${other}/outbound/${preview.id}/send` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/${preview.id}/send`, payload: { text: '   ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/sessions/${id}/outbound/${preview.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/${preview.id}/send` })).statusCode).toBe(404);
  });

  it('creates a Jira task from a next step and marks that step done with the delivery', async () => {
    const { app, ctx, jira } = await start();
    const id = newCall(ctx);
    const notes: ConsultNotes = {
      summary: 'Priya wants a better price.',
      buyerAsks: [],
      promises: [],
      objections: [],
      nextSteps: [
        { id: 'ns1', text: 'Get manager approval for 2% discount', action: { kind: 'jira', summary: 'Manager approval: 2% discount', dueInDays: 1 }, doneRef: null },
        { id: 'ns2', text: 'Send the floor plan', action: { kind: 'whatsapp', text: 'Floor plan attached' }, doneRef: null },
      ],
    };
    ctx.store.dispatch(id, { type: 'set_consult', patch: { notes } }, 'system');

    const preview = (
      await app.inject({
        method: 'POST',
        url: `/api/sessions/${id}/outbound/preview`,
        payload: draft({ channel: 'jira', subject: 'Manager approval: 2% discount', text: 'Priya asked for 2% off.', dueInDays: 1, purpose: 'action_item', nextStepId: 'ns1' }),
      })
    ).json() as OutboundPreview;
    expect(preview).toMatchObject({ to: 'Jira AVE', dueInDays: 1, mediaUrl: null });

    const { delivery } = (await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/${preview.id}/send` })).json() as { delivery: Delivery };
    expect(delivery).toMatchObject({ channel: 'jira', status: 'sent', ref: 'AVE-1', url: 'https://example.atlassian.net/browse/AVE-1' });
    expect(delivery.label).toBe('Jira task (next step): Manager approval: 2% discount');
    expect(jira.created[0]).toMatchObject({ summary: 'Manager approval: 2% discount', dueDate: '2026-11-21' });
    const steps = ctx.store.get(id)!.consult.notes!.nextSteps;
    expect(steps.map((s) => s.doneRef)).toEqual([delivery.id, null]);
  });

  it('keeps a failed preview for another try and does not mark its step done', async () => {
    const email = new FakeEmail({ status: 'failed', detail: 'Resend said no' });
    const { app, ctx } = await start({}, { email });
    const id = newCall(ctx);
    ctx.store.dispatch(id, { type: 'set_consult', patch: { notes: { summary: '', buyerAsks: [], promises: [], objections: [], nextSteps: [{ id: 'n1', text: 'Email', action: null, doneRef: null }] } } }, 'system');
    const preview = (
      await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/preview`, payload: draft({ channel: 'email', subject: 'Your price sheet', text: 'Attached.', nextStepId: 'n1' }) })
    ).json() as OutboundPreview;
    expect(preview.to).toBe('priya@example.com');

    const first = (await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/${preview.id}/send`, payload: { subject: 'Price sheet for Larkspur Court' } })).json() as { delivery: Delivery };
    expect(first.delivery).toMatchObject({ status: 'failed', detail: 'Resend said no' });
    expect(email.sent[0]!.subject).toBe('Price sheet for Larkspur Court');
    expect(ctx.store.get(id)!.consult.notes!.nextSteps[0]!.doneRef).toBeNull();

    email.outcome = { status: 'sent', providerId: 'em_2', detail: 'ok' };
    const retry = (await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/${preview.id}/send` })).json() as { delivery: Delivery };
    expect(retry.delivery.status).toBe('sent');
    // The edit from the first attempt was kept on the preview.
    expect(email.sent[1]!.subject).toBe('Price sheet for Larkspur Court');
    expect(ctx.store.get(id)!.consult.notes!.nextSteps[0]!.doneRef).toBe(retry.delivery.id);
  });

  it('sends a recap preview as the real recap, ignoring edits', async () => {
    const { app, ctx, email } = await start();
    const id = newCall(ctx);
    const preview = (await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/preview`, payload: draft({ channel: 'email', text: 'placeholder', purpose: 'recap' }) })).json() as OutboundPreview;
    expect(preview.subject).toBeTruthy();
    expect(preview.text).not.toBe('placeholder');
    const { delivery } = (await app.inject({ method: 'POST', url: `/api/sessions/${id}/outbound/${preview.id}/send`, payload: { text: 'edited' } })).json() as { delivery: Delivery };
    expect(delivery).toMatchObject({ channel: 'email', status: 'sent' });
    expect(email.sent[0]!.subject).toBe(preview.subject);
    expect(email.sent[0]!.html).toContain('<!doctype html>');
  });

  it('expires previews after the TTL and caps them per session', () => {
    const clock = new Clock();
    const store = new PreviewStore(clock.now);
    const base = { ...draft({}), sessionId: 's1', to: 'x', createdAt: clock.t };
    store.add({ ...base, id: 'a' });
    expect(store.get('s1', 'a')).toBeDefined();
    expect(store.get('s2', 'a')).toBeUndefined();
    clock.advance(OUTBOUND_PREVIEW_TTL_MS / 1000 + 1);
    expect(store.get('s1', 'a')).toBeUndefined();
    for (let i = 0; i < 25; i++) store.add({ ...base, id: `p${i}`, createdAt: clock.t + i });
    expect(store.list('s1')).toHaveLength(20);
    expect(store.get('s1', 'p0')).toBeUndefined();
    expect(store.claim('p24')).toBe(true);
    expect(store.claim('p24')).toBe(false);
  });

  it('labels drafts for the activity feed', () => {
    expect(outboundLabel(draft({ mediaUrl: 'https://x.example/m.jpg' }))).toBe('WhatsApp photo');
    expect(outboundLabel(draft({ channel: 'slack', text: 'Priya booked a visit\nmore' }))).toBe('Slack post: Priya booked a visit');
    expect(outboundLabel(draft({ channel: 'email', subject: 'Your price sheet' }))).toBe('Email: Your price sheet');
  });
});

describe('public media', () => {
  it('serves property images read-only and refuses anything else', async () => {
    const { app } = await start();
    const hero = await app.inject({ url: '/media/apt-indiranagar/hero.webp' });
    expect(hero.statusCode).toBe(200);
    expect(hero.headers['content-type']).toBe('image/webp');
    expect(hero.rawPayload.length).toBeGreaterThan(1000);
    expect((await app.inject({ method: 'HEAD', url: '/media/apt-indiranagar/hero.jpg' })).statusCode).toBe(200);
    for (const bad of ['/media/../../package.json', '/media/%2e%2e/%2e%2e/package.json', '/media/apt-indiranagar/missing.webp', '/media/', '/media/apt-indiranagar']) {
      expect((await app.inject({ url: bad })).statusCode, bad).toBe(404);
    }
  });

  it('resolves only image files inside the media folder', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ave-media-'));
    dirs.push(root);
    mkdirSync(path.join(root, 'p'));
    writeFileSync(path.join(root, 'p', 'a.jpg'), 'x');
    writeFileSync(path.join(root, 'p', 'notes.txt'), 'x');
    writeFileSync(path.join(root, 'p', '.hidden.png'), 'x');
    const outside = mkdtempSync(path.join(tmpdir(), 'ave-outside-'));
    dirs.push(outside);
    writeFileSync(path.join(outside, 'secret.png'), 'x');
    symlinkSync(path.join(outside, 'secret.png'), path.join(root, 'p', 'link.png'));

    expect(resolveMediaFile(root, 'p/a.jpg')).toMatch(/a\.jpg$/);
    for (const bad of ['p/notes.txt', 'p/.hidden.png', '../p/a.jpg', 'p/../p/a.jpg', 'p//a.jpg', 'p\\a.jpg', 'p/link.png', 'p/a.jpg\0', '']) {
      expect(resolveMediaFile(root, bad), bad).toBeNull();
    }
  });

  it('builds public URLs, preferring JPEG copies WhatsApp can deliver', async () => {
    const { app, ctx } = await start({ PUBLIC_BASE_URL: 'https://demo.example.com/' });
    expect(whatsAppMediaPath('/media/apt-indiranagar/hero.webp')).toBe('/media/apt-indiranagar/hero.jpg');
    expect(whatsAppMediaPath('/media/apt-indiranagar/nothing.webp')).toBe('/media/apt-indiranagar/nothing.webp');
    const office = ctx.content.byId['office-koramangala'];
    if (office) {
      expect(propertyMedia(ctx.config, office, MEDIA_DIR).map((m) => m.label)).toEqual(['Photo', 'Floor plan (Ground level)', 'Floor plan (Mezzanine)']);
    }
    const apt = firstProperty(ctx, 'sale');
    const res = (await app.inject({ url: `/api/media/properties/${apt.property.id}` })).json() as { items: { url: string | null }[]; unavailable: string | null };
    expect(res.unavailable).toBeNull();
    expect(res.items[0]!.url).toBe(`https://demo.example.com${apt.property.heroImage.replace(/\.webp$/, '.jpg')}`);
    expect((await app.inject({ url: '/api/media/properties/nope' })).statusCode).toBe(404);

    const { app: noBase } = await start();
    const none = (await noBase.inject({ url: `/api/media/properties/${apt.property.id}` })).json() as { items: { url: string | null }[]; unavailable: string | null };
    expect(none.unavailable).toMatch(/PUBLIC_BASE_URL/);
    expect(none.items.every((i) => i.url === null)).toBe(true);
  });
});

describe('pipeline board', () => {
  it('places leads by what happened, records won and lost, and lists activity', async () => {
    const { app, ctx, clock } = await start();
    const apt = firstProperty(ctx, 'sale');
    const slot = apt.visits.find((s) => s.available) ?? apt.visits[0]!;

    const fresh = newCall(ctx);
    const booked = newCall(ctx);
    ctx.store.dispatch(booked, { type: 'set_property', propertyId: apt.property.id }, 'agent');
    ctx.store.dispatch(booked, { type: 'confirm_booking', propertyId: apt.property.id, slotId: slot.id }, 'agent');
    const consult = newCall(ctx);
    ctx.store.dispatch(consult, { type: 'update_lead', patch: { purpose: 'Home', budget: '2 crore' } }, 'agent');
    ctx.store.dispatch(consult, { type: 'set_handoff', patch: { status: 'requested', reason: 'Price' } }, 'agent');
    const done = newCall(ctx);
    ctx.store.dispatch(done, { type: 'set_view', view: 'money' }, 'agent');
    ctx.store.dispatch(done, { type: 'set_status', status: 'ended' }, 'system');
    clock.advance(5);

    const preview = (await app.inject({ method: 'POST', url: `/api/sessions/${booked}/outbound/preview`, payload: draft({ channel: 'slack', text: 'Priya booked Larkspur Court' }) })).json() as OutboundPreview;
    await app.inject({ method: 'POST', url: `/api/sessions/${booked}/outbound/${preview.id}/send` });

    const board = (await app.inject({ url: '/api/pipeline' })).json() as PipelineResponse;
    const stageOf = (id: string) => board.cards.find((c) => c.id === id)?.stage;
    expect([stageOf(fresh), stageOf(booked), stageOf(consult), stageOf(done)]).toEqual(['new', 'visit_booked', 'consult', 'follow_up']);
    const card = board.cards.find((c) => c.id === booked)!;
    expect(card).toMatchObject({ propertyName: apt.property.name, visitStart: slot.start });
    expect(card.badges).toEqual([expect.objectContaining({ channel: 'slack', status: 'sent', sent: 1, ref: '1700000000.000100' })]);
    expect(board.funnel.map((f) => [f.stage, f.reached])).toEqual([
      ['new', 4],
      ['qualified', 3],
      ['visit_booked', 1],
      ['consult', 1],
      ['won', 0],
    ]);
    expect(board.winRate).toBeNull();
    expect(board.activity[0]).toMatchObject({ sessionId: booked, buyerName: 'Priya Sharma', channel: 'slack', title: 'Slack post: Priya booked Larkspur Court', status: 'sent' });

    const won = await app.inject({ method: 'POST', url: `/api/leads/${booked}/outcome`, payload: { outcome: 'won' } });
    expect(won.json()).toMatchObject({ card: { id: booked, stage: 'won' } });
    await app.inject({ method: 'POST', url: `/api/leads/${done}/outcome`, payload: { outcome: 'lost' } });
    const after = (await app.inject({ url: '/api/pipeline' })).json() as PipelineResponse;
    expect(after.winRate).toBe(50);
    expect(after.funnel.at(-1)).toMatchObject({ stage: 'won', reached: 1, pct: 25 });
    // Reopening puts the lead back where its call record says.
    const reopened = await app.inject({ method: 'POST', url: `/api/leads/${done}/outcome`, payload: { outcome: 'open' } });
    expect(reopened.json()).toMatchObject({ card: { stage: 'follow_up' } });
    expect(ctx.store.get(done)!.timeline.at(-1)).toMatchObject({ kind: 'pipeline_reopened', source: 'advisor' });

    expect((await app.inject({ method: 'POST', url: `/api/leads/${done}/outcome`, payload: { outcome: 'maybe' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/leads/nope/outcome', payload: { outcome: 'won' } })).statusCode).toBe(404);
    await deskFor(ctx).idle(booked);
  });

  it('shows the latest attempt per channel honestly, with the last provider reference', () => {
    const d = (id: string, channel: Delivery['channel'], status: Delivery['status'], at: number, ref: string | null = null): Delivery => ({ id, channel, to: 'x', status, detail: status === 'failed' ? 'boom' : null, at, ref, url: null });
    const badges = deliveryBadges([d('1', 'jira', 'sent', 1, 'AVE-1'), d('2', 'jira', 'failed', 2), d('3', 'email', 'not_configured', 3)]);
    expect(badges).toEqual([
      expect.objectContaining({ channel: 'email', status: 'not_configured', sent: 0 }),
      expect.objectContaining({ channel: 'jira', status: 'failed', sent: 1, ref: 'AVE-1', detail: 'boom' }),
    ]);
  });
});
