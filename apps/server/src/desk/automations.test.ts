import { afterEach, describe, expect, it } from 'vitest';
import { HANDOFF_TIMEOUT_NOTE_KIND, REPORT_REQUEST_NOTE_KIND, type ConsultNotes, type SessionAction } from '@ave/shared';
import type { AppContext } from '../context.js';
import { UnconfiguredSlackAdapter } from './adapters/slack.js';
import { AUTOMATION_RULES, parseAutomationChannels, runRule, startAutomations } from './automations.js';
import { buildRecapFacts } from './facts.js';
import { renderRecap } from './render.js';
import { maybeAutoSendReport } from './reports.js';
import { registerDesk, unregisterDesk, type DeskDeps, type DeskRuntime } from './runtime.js';
import { Clock, FakeCrm, FakeEmail, FakeJira, FakeSlack, FakeWhatsApp, firstProperty, testContext, testRuntime } from './testkit.js';

let ctx: AppContext;
let clock: Clock;
let desk: DeskRuntime;
let stop: () => void;
let slack: FakeSlack;
let jira: FakeJira;
let whatsapp: FakeWhatsApp;
let email: FakeEmail;
let crm: FakeCrm;

async function setup(env: Record<string, string> = {}, deps: Partial<DeskDeps> = {}) {
  clock = new Clock();
  ctx = await testContext(env, clock);
  slack = new FakeSlack();
  jira = new FakeJira();
  whatsapp = new FakeWhatsApp();
  email = new FakeEmail();
  crm = new FakeCrm();
  desk = testRuntime(ctx, clock, { slack, jira, whatsapp, email, crm, ...deps });
  registerDesk(ctx, desk);
  stop = startAutomations(desk);
}
afterEach(() => {
  stop?.();
  if (ctx) unregisterDesk(ctx);
});

function call(language?: 'en' | 'hi' | 'kn') {
  const s = ctx.store.create({ name: 'Priya Sharma', phone: '98765 43210', email: 'priya@example.com' }, language);
  ctx.store.dispatch(s.id, { type: 'set_status', status: 'live' }, 'system');
  return s.id;
}

async function act(id: string, action: SessionAction, source: 'agent' | 'system' | 'advisor' = 'agent') {
  clock.advance(5);
  ctx.store.dispatch(id, action, source);
  await desk.idle(id);
}

const deliveries = (id: string) => ctx.store.get(id)!.deliveries;

function book(id: string, slotIndex = 5) {
  const apt = firstProperty(ctx, 'sale');
  const slot = apt.visits[slotIndex]!;
  return { apt, slot, action: { type: 'confirm_booking', propertyId: apt.property.id, slotId: slot.id } as const };
}

const notes: ConsultNotes = {
  summary: 'Rahul walked Priya through the price; she wants a better deal.',
  buyerAsks: [{ id: 'a1', text: 'Can parking be included?', quote: 'is parking extra?' }],
  promises: [
    { id: 'p1', text: 'Check a 2% discount with the manager', quote: 'let me ask my manager', needsApproval: true },
    { id: 'p2', text: 'Send the floor plan PDF', quote: null, needsApproval: false },
  ],
  objections: ['Price is above budget'],
  nextSteps: [
    { id: 'n1', text: 'Share the parking policy', action: null, doneRef: null },
    { id: 'n2', text: 'Ask legal about the OC', action: { kind: 'jira', summary: 'Confirm occupancy certificate date', dueInDays: 3 }, doneRef: null },
    { id: 'n3', text: 'Show the balcony again', action: { kind: 'view', command: 'show the balcony' }, doneRef: null },
    { id: 'n4', text: 'Send price sheet', action: { kind: 'whatsapp', text: 'Price sheet' }, doneRef: 'dlv_1' },
  ],
};

describe('AUTOMATIONS switch', () => {
  it('parses channel names and reports unknown ones', () => {
    const r = parseAutomationChannels(' Slack, jira ,fax,, ');
    expect([...r.channels]).toEqual(['slack', 'jira']);
    expect(r.unknown).toEqual(['fax']);
  });
});

describe('visit booked', () => {
  it('confirms on WhatsApp and email, posts a Slack card, creates a Jira task and syncs HubSpot', async () => {
    await setup();
    const id = call();
    const { apt, slot, action } = book(id);
    await act(id, action);

    expect(whatsapp.sent).toHaveLength(1);
    const wa = whatsapp.sent[0]!;
    expect(wa.to).toBe('+919876543210');
    expect(wa.body).toContain(apt.property.name);
    expect(wa.body).toContain(`https://www.google.com/maps/search/?api=1&query=${apt.property.location.lat},${apt.property.location.lng}`);
    expect(wa.body).toContain('Asha');

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.attachments[0]).toMatchObject({ filename: 'site-visit.ics' });
    expect(email.sent[0]!.attachments[0]!.content).toContain(`UID:${id}-${slot.id}@`);

    expect(slack.sent).toHaveLength(1);
    const card = slack.sent[0]!;
    expect(card.threadTs).toBeNull();
    expect(card.broadcast).toBe(false);
    expect(JSON.stringify(card.blocks)).toContain(`http://localhost:5173/desk?lead=${id}`);
    expect(JSON.stringify(card.blocks)).toContain('Visit booked');

    // The visit (23 Nov, 11:00 IST) is prepared the day before.
    expect(jira.created).toEqual([expect.objectContaining({ summary: expect.stringMatching(new RegExp(`^Prepare site visit: ${apt.property.name}, .+ \\(Priya Sharma\\)$`)), dueDate: '2026-11-22', labels: ['site-visit'] })]);
    expect(jira.created[0]!.description).toContain(`Lead: http://localhost:5173/desk?lead=${id}`);

    expect(crm.synced).toEqual([expect.objectContaining({ visitBooked: true, email: 'priya@example.com' })]);

    const byChannel = Object.fromEntries(deliveries(id).map((d) => [d.channel, d]));
    expect(Object.keys(byChannel).sort()).toEqual(['crm', 'email', 'jira', 'slack', 'whatsapp']);
    for (const d of deliveries(id)) {
      expect(d).toMatchObject({ purpose: 'visit_confirmed', status: 'sent' });
      expect(d.label).toBeTruthy();
      expect(d.id.startsWith(`auto_visit_booked_${d.channel}_${id}_`)).toBe(true);
    }
    expect(byChannel.jira).toMatchObject({ ref: 'AVE-1', url: 'https://example.atlassian.net/browse/AVE-1' });
    expect(byChannel.slack).toMatchObject({ ref: '1700000000.000100' });

    // Outbox keeps purpose, label, ref and url.
    const outbox = desk.leads.listOutbox();
    expect(outbox.find((o) => o.channel === 'jira')).toMatchObject({ purpose: 'visit_confirmed', label: 'Site visit task', ref: 'AVE-1', url: 'https://example.atlassian.net/browse/AVE-1', subject: jira.created[0]!.summary });
  });

  it('never sends twice for the same booking, even after a restart', async () => {
    await setup();
    const id = call();
    const { action } = book(id);
    await act(id, action);
    await act(id, action);
    const rule = AUTOMATION_RULES.find((r) => r.id === 'visit_booked')!;
    // A restarted server runs the rule again from saved state.
    await desk.enqueue(id, () => runRule(desk, rule, id, rule.when(ctx.store.get(id)!, action)!, new Set(['whatsapp', 'email', 'slack', 'jira', 'crm'])));
    expect([whatsapp.sent.length, email.sent.length, slack.sent.length, jira.created.length, crm.synced.length]).toEqual([1, 1, 1, 1, 1]);

    // Rebooking another slot is a new confirmation.
    await act(id, book(id, 6).action);
    expect(whatsapp.sent).toHaveLength(2);
  });

  it('skips channels switched off in AUTOMATIONS and records unconfigured ones honestly', async () => {
    await setup({ AUTOMATIONS: 'slack,jira' }, { slack: new UnconfiguredSlackAdapter('Slack needs a token') });
    const id = call();
    await act(id, book(id).action);
    expect(whatsapp.sent).toHaveLength(0);
    expect(email.sent).toHaveLength(0);
    expect(crm.synced).toHaveLength(0);
    expect(deliveries(id).map((d) => [d.channel, d.status])).toEqual(
      expect.arrayContaining([
        ['slack', 'not_configured'],
        ['jira', 'sent'],
      ]),
    );
    expect(deliveries(id)).toHaveLength(2);
  });

  it('a visit confirmation is not consent to the recap', async () => {
    await setup();
    const id = call();
    await act(id, book(id).action);
    await act(id, { type: 'set_status', status: 'ended' }, 'system');
    expect(await maybeAutoSendReport(desk, id)).toBeNull();
    expect(whatsapp.sent).toHaveLength(1);
  });
});

describe('handoff', () => {
  it('posts the alert as the thread root with a Join call button, once per request', async () => {
    await setup();
    const id = call();
    await act(id, { type: 'update_lead', patch: { purpose: 'A 2 BHK near the metro', budget: '1.3 crore', objections: ['Price is high'] } });
    await act(id, { type: 'set_handoff', patch: { status: 'requested', reason: 'Wants to negotiate the price', requestedAt: clock.t } });
    await act(id, { type: 'set_handoff', patch: { status: 'requested', reason: 'Wants to negotiate the price', requestedAt: clock.t } });
    expect(slack.sent).toHaveLength(1);
    const alert = slack.sent[0]!;
    expect(alert.threadTs).toBeNull();
    const blocks = JSON.stringify(alert.blocks);
    expect(blocks).toContain(`http://localhost:5173/desk/call/${id}?join=1`);
    expect(blocks).toContain('Join call');
    expect(blocks).toContain('Wants to negotiate the price');
    expect(blocks).toContain('budget 1.3 crore');
    expect(blocks).toContain('Objections: Price is high');
    expect(deliveries(id)[0]).toMatchObject({ channel: 'slack', purpose: 'handoff_alert', label: 'Handoff alert' });
  });

  it('replies in the lead thread and broadcasts when a thread exists', async () => {
    await setup();
    const id = call();
    await act(id, book(id).action);
    await act(id, { type: 'set_handoff', patch: { status: 'requested', reason: 'Price', requestedAt: clock.t } });
    expect(slack.sent).toHaveLength(2);
    expect(slack.sent[1]).toMatchObject({ threadTs: '1700000000.000100', broadcast: true });
  });

  it('escalates when nobody joins: call-back task, Slack escalation with the task, WhatsApp in the call language', async () => {
    await setup();
    const id = call('hi');
    await act(id, { type: 'set_handoff', patch: { status: 'requested', reason: 'Price', requestedAt: clock.t } });
    await act(id, { type: 'note', kind: HANDOFF_TIMEOUT_NOTE_KIND, label: 'Nobody joined in time' }, 'system');
    await act(id, { type: 'note', kind: HANDOFF_TIMEOUT_NOTE_KIND, label: 'Nobody joined in time' }, 'system');

    expect(jira.created).toEqual([expect.objectContaining({ summary: 'Call back Priya Sharma', dueDate: '2026-11-20', labels: ['call-back'] })]);
    expect(jira.created[0]!.description).toContain('+919876543210');
    expect(slack.sent).toHaveLength(2);
    expect(slack.sent[1]).toMatchObject({ threadTs: '1700000000.000100', broadcast: true });
    expect(JSON.stringify(slack.sent[1]!.blocks)).toContain('AVE-1');
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]!.body).toContain('नमस्ते Priya');
    expect(deliveries(id).filter((d) => d.purpose === 'handoff_timeout').map((d) => d.channel).sort()).toEqual(['jira', 'slack', 'whatsapp']);
  });
});

describe('call ended', () => {
  it('posts a summary and creates follow-up and approval tasks from the consult notes', async () => {
    await setup();
    const id = call();
    await act(id, book(id).action);
    await act(id, { type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } }, 'advisor');
    await act(id, { type: 'set_consult', patch: { notes } }, 'system');
    const before = jira.created.length;
    await act(id, { type: 'set_status', status: 'ended' }, 'system');

    const summary = slack.sent.at(-1)!;
    expect(summary.threadTs).toBe('1700000000.000100');
    expect(summary.text).toContain('Call ended: Priya Sharma');
    const body = JSON.stringify(summary.blocks);
    expect(body).toContain('Rahul walked Priya through the price');
    expect(body).toContain('Needs approval');
    expect(body).toContain('Check a 2% discount with the manager');
    expect(body).toContain('Can parking be included?');

    const tasks = jira.created.slice(before);
    expect(tasks.map((t) => t.summary)).toEqual(['Share the parking policy', 'Confirm occupancy certificate date', 'Approval: Check a 2% discount with the manager']);
    expect(tasks[1]!.dueDate).toBe('2026-11-23');
    expect(tasks[2]).toMatchObject({ dueDate: '2026-11-20', labels: ['approval'] });
    expect(tasks[2]!.description).toContain('"let me ask my manager"');

    // Notes that land after the end add only the new step.
    const more: ConsultNotes = { ...notes, nextSteps: [...notes.nextSteps, { id: 'n5', text: 'Book a bank loan call', action: null, doneRef: null }] };
    await act(id, { type: 'set_consult', patch: { notes: more } }, 'system');
    expect(jira.created.slice(before).map((t) => t.summary)).toEqual([...tasks.map((t) => t.summary), 'Book a bank loan call']);
    await act(id, { type: 'set_status', status: 'live' }, 'system');
    await act(id, { type: 'set_status', status: 'ended' }, 'system');
    expect(slack.sent.filter((m) => m.text.startsWith('Call ended'))).toHaveLength(1);
    expect(jira.created.slice(before)).toHaveLength(4);
  });

  it('adds consult notes to the HubSpot note, and only promises without approval to the recap', async () => {
    await setup();
    const id = call();
    await act(id, { type: 'note', kind: REPORT_REQUEST_NOTE_KIND, label: 'Buyer asked for the recap' });
    await act(id, { type: 'set_consult', patch: { notes } }, 'system');
    const state = ctx.store.get(id)!;
    const facts = buildRecapFacts(state, ctx.content, undefined, { advisorName: 'Asha', appUrl: 'http://x.test' });
    expect(facts.followUps).toEqual(['Send the floor plan PDF']);
    const rendered = renderRecap(facts, null);
    expect(rendered.text).toContain('WHAT OUR TEAM IS FOLLOWING UP ON\n- Send the floor plan PDF');
    expect(rendered.html).toContain('What our team is following up on');
    expect(rendered.html).not.toContain('2% discount');

    await act(id, { type: 'set_status', status: 'ended' }, 'system');
    // The Desk plugin sends the recap on "ended"; this test runs the runtime without the plugin.
    await maybeAutoSendReport(desk, id);
    await desk.idle(id);
    expect(email.sent.some((m) => m.text.includes('Send the floor plan PDF'))).toBe(true);
    const note = crm.synced.at(-1)!.note;
    expect(note).toContain('CONSULT NOTES (internal)');
    expect(note).toContain('Check a 2% discount with the manager [needs approval]');
  });
});
