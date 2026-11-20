import { afterEach, describe, expect, it } from 'vitest';
import { computeEmi, computeSaleTotals, formatINR, REPORT_REQUEST_NOTE_KIND, type RecapSummary } from '@ave/shared';
import type { AppContext } from '../context.js';
import { UnconfiguredEmailAdapter } from './adapters/email.js';
import { buildRecapFacts } from './facts.js';
import { buildHandoffContext } from './handoff.js';
import { renderRecap } from './render.js';
import { consentedChannels, maybeAutoSendReport, sendReport } from './reports.js';
import { registerDesk, unregisterDesk, type DeskRuntime } from './runtime.js';
import { ungroundedNumbers } from './summary.js';
import { Clock, FakeCrm, FakeEmail, FakeWhatsApp, firstProperty, playSession, testContext, testRuntime } from './testkit.js';

let ctx: AppContext;
let clock: Clock;
let desk: DeskRuntime;

async function setup(deps: Parameters<typeof testRuntime>[2] = {}) {
  clock = new Clock();
  ctx = await testContext({}, clock);
  desk = testRuntime(ctx, clock, deps);
  registerDesk(ctx, desk);
}
afterEach(() => {
  if (ctx) unregisterDesk(ctx);
});

/** A full sale call: lead details, tour, EMI, an offer, and a booked visit. */
function saleCall(extra: Parameters<typeof playSession>[2] = []) {
  const apt = firstProperty(ctx, 'sale');
  const offer = ctx.content.offers.properties[apt.property.id]?.offers[0];
  const slot = apt.visits[0]!;
  const offerStep: Parameters<typeof playSession>[2] = offer ? [[30, { type: 'apply_offer', propertyId: apt.property.id, offerId: offer.id }]] : [];
  const state = playSession(ctx, clock, [
    [1, { type: 'set_status', status: 'live' }],
    [5, { type: 'update_lead', patch: { purpose: 'A home near the metro', budget: '1.3 crore', timeline: 'Within 3 months' } }],
    [5, { type: 'set_property', propertyId: apt.property.id }],
    [0, { type: 'set_view', view: 'tour' }],
    [60, { type: 'set_view', view: 'money', params: { tab: 'emi', emi: { downPayment: 3_000_000, ratePct: 8.5, tenureYears: 20 } } }],
    ...offerStep,
    [30, { type: 'confirm_booking', propertyId: apt.property.id, slotId: slot.id }],
    [5, { type: 'add_transcript', line: { id: 'l1', role: 'buyer', text: 'Morning sun matters a lot to us.', final: true, at: clock.t } }],
    ...extra,
  ]);
  return { state, apt, offer, slot };
}

describe('recap facts', () => {
  it('computes every number with the shared money functions', async () => {
    await setup();
    const { state, apt, offer, slot } = saleCall();
    const facts = buildRecapFacts(state, ctx.content, desk.leads.get(state.id)?.extras, { advisorName: 'Asha', appUrl: 'http://localhost:5173' });
    const prop = facts.properties[0]!;
    if (apt.money.kind !== 'sale') throw new Error('expected a sale property');
    const totals = computeSaleTotals(apt.money, apt.property.areas, ctx.content.offers.properties[apt.property.id]?.offers ?? [], offer ? [offer.id] : []);
    expect(prop.name).toBe(apt.property.name);
    expect(prop.headline.value).toContain(formatINR(totals.total));
    expect(prop.viewsSeen).toEqual(['3D tour', 'Pricing']);
    expect(prop.emi?.monthly).toBe(formatINR(computeEmi(totals.total, { downPayment: 3_000_000, ratePct: 8.5, tenureYears: 20 }).monthlyEmi));
    if (offer) expect(prop.offers.map((o) => o.title)).toEqual([offer.title]);
    expect(facts.visit).toMatchObject({ slotId: slot.id, address: apt.property.address, propertyName: apt.property.name });
    expect(facts.nextStep).toContain(apt.property.name);
    expect(facts.buyer.firstName).toBe('Priya');
  });

  it('remembers EMI inputs after the buyer moves to the office', async () => {
    await setup();
    const office = firstProperty(ctx, 'lease');
    const { state } = saleCall([[10, { type: 'set_property', propertyId: office.property.id }]]);
    const facts = buildRecapFacts(state, ctx.content, desk.leads.get(state.id)?.extras, { advisorName: 'Asha', appUrl: 'http://x.test' });
    expect(facts.properties.map((p) => p.kind)).toEqual(['sale', 'lease']);
    expect(facts.properties[0]!.emi).not.toBeNull();
    expect(facts.properties[1]!.headline.label).toMatch(/Monthly total/);
  });
});

describe('rendering', () => {
  it('escapes buyer-supplied text and labels sample data', async () => {
    await setup();
    const state = playSession(ctx, clock, [[1, { type: 'update_lead', patch: { purpose: '<script>alert(1)</script>' } }]]);
    const facts = buildRecapFacts(state, ctx.content, undefined, { advisorName: 'Asha', appUrl: 'http://x.test' });
    const r = renderRecap({ ...facts, buyer: { ...facts.buyer, firstName: 'Priya <b>' } }, null);
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain('Priya &lt;b&gt;');
    expect(r.html).toMatch(/sample data/i);
    expect(r.whatsapp).toMatch(/Sample data/);
    expect(r.html).not.toContain('In short');
  });

  it('shows the AI summary as its own block when there is one', async () => {
    await setup();
    const { state } = saleCall();
    const facts = buildRecapFacts(state, ctx.content, undefined, { advisorName: 'Asha', appUrl: 'http://x.test' });
    const summary: RecapSummary = { headline: 'A sunny home near the metro', summary: 'You liked the light.', priorities: ['Morning sun'], openQuestions: [] };
    const r = renderRecap(facts, summary);
    expect(r.html).toContain('In short');
    expect(r.html).toContain('A sunny home near the metro');
    expect(r.html).toContain('Morning sun');
    expect(r.html).not.toContain('Still to answer');
  });
});

describe('sendReport', () => {
  it('records queued then the provider outcome, with previews in the Outbox and an invite attached', async () => {
    const email = new FakeEmail();
    const whatsapp = new FakeWhatsApp();
    await setup({ email, whatsapp });
    const { state, slot } = saleCall();
    const seen: string[] = [];
    ctx.store.on('change', (_s, action) => {
      if (action.type === 'upsert_delivery') seen.push(`${action.delivery.channel}:${action.delivery.status}`);
    });

    const deliveries = await sendReport(ctx, state.id, ['email', 'whatsapp']);

    expect(deliveries.map((d) => [d.channel, d.status, d.to])).toEqual([
      ['email', 'sent', 'priya@example.com'],
      ['whatsapp', 'sent', '+919876543210'],
    ]);
    expect(seen).toEqual(['email:queued', 'whatsapp:queued', 'email:sent', 'whatsapp:sent']);
    expect(ctx.store.get(state.id)?.deliveries.map((d) => d.status)).toEqual(['sent', 'sent']);

    const mail = email.sent[0]!;
    expect(mail.attachments[0]?.filename).toBe('site-visit.ics');
    expect(mail.attachments[0]?.content).toContain(`UID:${state.id}-${slot.id}@`);
    expect(mail.attachments[0]?.content).toContain(`DTSTART:${new Date(slot.start).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
    expect(mail.idempotencyKey).toBe(deliveries[0]!.id);
    expect(whatsapp.sent[0]!.body).toContain('Site visit');

    const outbox = desk.leads.listOutbox();
    expect(outbox).toHaveLength(2);
    expect(outbox.find((o) => o.channel === 'email')).toMatchObject({ status: 'sent', subject: mail.subject, html: mail.html });
    expect(outbox.find((o) => o.channel === 'whatsapp')).toMatchObject({ status: 'sent', text: whatsapp.sent[0]!.body, html: null });
  });

  it('never reports sent when the provider is not set up', async () => {
    await setup({ email: new UnconfiguredEmailAdapter('Email is not configured') });
    const { state } = saleCall();
    const [d] = await sendReport(ctx, state.id, ['email']);
    expect(d).toMatchObject({ channel: 'email', status: 'not_configured', detail: 'Email is not configured' });
  });

  it('fails WhatsApp for an unusable number but still sends the email', async () => {
    const whatsapp = new FakeWhatsApp();
    await setup({ whatsapp });
    const state = ctx.store.create({ name: 'Kiran', phone: '12-34', email: 'kiran@example.com' });
    const deliveries = await sendReport(ctx, state.id, ['whatsapp', 'email']);
    expect(deliveries.map((d) => [d.channel, d.status])).toEqual([
      ['email', 'sent'],
      ['whatsapp', 'failed'],
    ]);
    expect(deliveries[1]!.detail).toMatch(/not a phone number/);
    expect(whatsapp.sent).toHaveLength(0);
  });

  it('turns an adapter crash into failed deliveries instead of rejecting', async () => {
    const broken = new FakeEmail();
    broken.send = async () => {
      throw new Error('boom');
    };
    await setup({ email: broken });
    const { state } = saleCall();
    const deliveries = await sendReport(ctx, state.id, ['email', 'whatsapp']);
    expect(deliveries.find((d) => d.channel === 'email')?.status).toBe('failed');
    expect(ctx.store.get(state.id)?.deliveries.some((d) => d.status === 'queued')).toBe(false);
  });

  it('returns nothing for an unknown session', async () => {
    await setup();
    expect(await sendReport(ctx, 'nope', ['email'])).toEqual([]);
  });

  it('keeps a good AI summary and syncs the CRM after the recap, reusing the deal', async () => {
    const crm = new FakeCrm();
    const summary: RecapSummary = { headline: 'Home near the metro', summary: 'You liked the morning light.', priorities: [], openQuestions: [] };
    await setup({ crm, summarize: async () => summary });
    const { state } = saleCall();
    await sendReport(ctx, state.id, ['email']);
    await desk.idle(state.id);
    expect(desk.leads.getReport(state.id).summary).toEqual(summary);
    expect(crm.synced).toHaveLength(1);
    expect(crm.synced[0]).toMatchObject({ email: 'priya@example.com', firstName: 'Priya', lastName: 'Sharma', visitBooked: true, dealId: null });
    expect(ctx.store.get(state.id)?.deliveries.find((d) => d.channel === 'crm')?.status).toBe('sent');

    await sendReport(ctx, state.id, ['email']);
    await desk.idle(state.id);
    expect(crm.synced[1]?.dealId).toBe('d1');
  });

  it('resends for a past lead that is no longer in memory', async () => {
    await setup();
    const { state } = saleCall([[5, { type: 'set_status', status: 'ended' }]]);
    ctx.store.clear();
    const deliveries = await sendReport(ctx, state.id, ['email']);
    expect(deliveries[0]?.status).toBe('sent');
    expect(desk.leads.get(state.id)?.state.deliveries.map((d) => d.status)).toEqual(['sent']);
  });
});

describe('automatic recap when the call ends', () => {
  it('does nothing without the buyer agreeing', async () => {
    const email = new FakeEmail();
    await setup({ email });
    const { state } = saleCall([[5, { type: 'set_status', status: 'ended' }]]);
    expect(consentedChannels(state)).toBeNull();
    expect(await maybeAutoSendReport(desk, state.id)).toBeNull();
    expect(email.sent).toHaveLength(0);
  });

  it('sends once on a report request note', async () => {
    const email = new FakeEmail();
    await setup({ email });
    const { state } = saleCall([
      [5, { type: 'note', kind: REPORT_REQUEST_NOTE_KIND, label: 'Buyer asked for the recap after the call' }],
      [5, { type: 'set_status', status: 'ended' }],
    ]);
    const first = await maybeAutoSendReport(desk, state.id);
    expect(first?.map((d) => d.channel)).toEqual(['email', 'whatsapp']);
    expect(await maybeAutoSendReport(desk, state.id)).toBeNull();
    expect(email.sent).toHaveLength(1);
  });

  it('skips the end-of-call send when the buyer already has an identical recap', async () => {
    const email = new FakeEmail();
    await setup({ email });
    const { state } = saleCall();
    await sendReport(ctx, state.id, ['email']);
    clock.advance(5);
    ctx.store.dispatch(state.id, { type: 'set_status', status: 'ended' }, 'system');
    expect(await maybeAutoSendReport(desk, state.id)).toBeNull();
    expect(email.sent).toHaveLength(1);
  });

  it('sends the updated recap on the channels agreed to when something changed', async () => {
    const email = new FakeEmail();
    const whatsapp = new FakeWhatsApp();
    await setup({ email, whatsapp });
    const office = firstProperty(ctx, 'lease');
    const { state } = saleCall();
    await sendReport(ctx, state.id, ['whatsapp']);
    clock.advance(30);
    ctx.store.dispatch(state.id, { type: 'set_property', propertyId: office.property.id }, 'agent');
    ctx.store.dispatch(state.id, { type: 'set_status', status: 'ended' }, 'system');
    const sent = await maybeAutoSendReport(desk, state.id);
    expect(sent?.map((d) => d.channel)).toEqual(['whatsapp']);
    expect(whatsapp.sent).toHaveLength(2);
    expect(whatsapp.sent[1]!.body).toContain(office.property.name);
    expect(email.sent).toHaveLength(0);
  });
});

describe('AI summary grounding', () => {
  it('flags numbers the call never mentioned', () => {
    const s: RecapSummary = { headline: 'Visit on 22 Nov', summary: 'EMI of 1,57,849 a month and a 5% discount.', priorities: [], openQuestions: [] };
    expect(ungroundedNumbers(s, 'Monthly EMI ₹1,57,849 on Sun, 22 Nov 2026')).toEqual(['5']);
    expect(ungroundedNumbers({ ...s, summary: 'EMI of 1,57,849 a month.' }, 'EMI ₹1,57,849 on 22 Nov')).toEqual([]);
  });
});

describe('buildHandoffContext', () => {
  it('summarises where things stand for the AI on hand-back', async () => {
    await setup();
    const { state, apt } = saleCall([
      [5, { type: 'set_handoff', patch: { status: 'requested', reason: 'Wants a bigger discount' } }],
      [5, { type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } }, 'advisor'],
    ]);
    clock.advance(5);
    ctx.store.dispatch(state.id, { type: 'add_transcript', line: { id: 'h1', role: 'human', text: 'We can look at the parking charge.', final: true, at: clock.t } }, 'system');
    clock.advance(10);
    ctx.store.dispatch(state.id, { type: 'set_handoff', patch: { status: 'returned' } }, 'advisor');
    const text = buildHandoffContext(ctx.store.get(state.id) ?? state, ctx.content);
    expect(text).toContain('Rahul');
    expect(text).toContain('Wants a bigger discount');
    expect(text).toContain(apt.property.name);
    expect(text).toContain('site visit booked');
    expect(text).toContain('Human advisor: We can look at the parking charge.');
    expect(text.split('\n').length).toBeLessThanOrEqual(10);
  });

  it('passes on the live notes: what the human promised, flagged when not approved, and the open asks', async () => {
    await setup();
    const { state } = saleCall([
      [5, { type: 'set_handoff', patch: { status: 'requested', reason: 'Wants a bigger discount' } }],
      [5, { type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } }, 'advisor'],
    ]);
    clock.advance(5);
    ctx.store.dispatch(state.id, { type: 'add_transcript', line: { id: 'h1', role: 'human', text: 'Let me check 2% with my manager.', final: true, at: clock.t } }, 'system');
    clock.advance(5);
    ctx.store.dispatch(
      state.id,
      {
        type: 'set_consult',
        patch: {
          updatedAt: clock.t,
          notes: {
            summary: 'Rahul is checking a 2% discount on parking with his manager.',
            buyerAsks: [{ id: 'a1', text: 'Lower parking charge', quote: null }],
            promises: [
              { id: 'p1', text: 'Send the floor plan on WhatsApp', quote: null, needsApproval: false },
              { id: 'p2', text: '2% discount on parking', quote: 'I can try for 2%', needsApproval: true },
            ],
            objections: ['Parking is expensive'],
            nextSteps: [{ id: 's1', text: 'Get manager approval', action: null, doneRef: null }],
          },
        },
      },
      'system',
    );
    clock.advance(5);
    ctx.store.dispatch(state.id, { type: 'add_transcript', line: { id: 'b9', role: 'buyer', text: 'Thanks, talk soon.', final: true, at: clock.t } }, 'system');
    ctx.store.dispatch(state.id, { type: 'set_handoff', patch: { status: 'returned' } }, 'advisor');
    const text = buildHandoffContext(ctx.store.get(state.id) ?? state, ctx.content);
    expect(text).toContain('What Rahul covered: Rahul is checking a 2% discount');
    expect(text).toContain('- Send the floor plan on WhatsApp\n');
    expect(text).toContain('- 2% discount on parking (not approved yet — do not confirm it)');
    expect(text).toContain("Buyer's open asks: Lower parking charge.");
    expect(text).toContain('Agreed next steps: Get manager approval.');
    // Lines the notes already cover are not repeated; what came after them is.
    expect(text).not.toContain('Let me check 2% with my manager.');
    expect(text).toContain('Buyer: Thanks, talk soon.');
    expect(text).toContain('never confirm anything marked not approved yet');
  });

  it('calls only buyer recaps a recap, and never mentions internal Slack or Jira sends', async () => {
    await setup();
    const { state } = saleCall([[5, { type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } }, 'advisor']]);
    const sent = (id: string, channel: 'email' | 'whatsapp' | 'slack' | 'jira', purpose?: 'visit_confirmed' | 'recap') =>
      ctx.store.dispatch(state.id, { type: 'upsert_delivery', delivery: { id, channel, to: 'x', status: 'sent', detail: null, at: clock.t, ...(purpose ? { purpose } : {}) } }, 'system');
    sent('d1', 'whatsapp', 'visit_confirmed');
    sent('d2', 'slack', 'visit_confirmed');
    sent('d3', 'jira', 'visit_confirmed');
    let text = buildHandoffContext(ctx.store.get(state.id)!, ctx.content);
    expect(text).not.toContain('recap sent');
    expect(text).toContain('visit confirmation sent by WhatsApp');
    expect(text).not.toMatch(/slack|jira/i);
    sent('d4', 'email', 'recap');
    sent('d5', 'whatsapp');
    text = buildHandoffContext(ctx.store.get(state.id)!, ctx.content);
    expect(text).toContain('recap sent by email and WhatsApp');
  });
});
