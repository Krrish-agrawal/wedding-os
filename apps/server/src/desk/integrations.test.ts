import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_SESSION_ID, TOOL_NAMES, type IntegrationsResponse, type OutboxItem } from '@ave/shared';
import '../context.js';
import { LeadStore } from './leadStore.js';
import { deskPlugin } from './plugin.js';
import { deskFor } from './runtime.js';
import { Clock, FakeEmail, FakeJira, FakeSlack, FakeWhatsApp, silentLog, testContext } from './testkit.js';
import { twilioSignature, WHATSAPP_INBOUND_PATH, WHATSAPP_REPLY_NOTE_KIND } from './whatsappInbound.js';

const dirs: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ave-int-'));
  dirs.push(dir);
  return path.join(dir, 'leads.sqlite');
}

async function start(env: Record<string, string> = {}) {
  const clock = new Clock();
  const ctx = await testContext(env, clock);
  const fakes = { email: new FakeEmail(), whatsapp: new FakeWhatsApp(), slack: new FakeSlack(), jira: new FakeJira() };
  const app = Fastify({ logger: false });
  app.decorate('ctx', ctx);
  await app.register(deskPlugin, { dbPath: ':memory:', deps: { ...fakes, crm: null, summarize: null, log: silentLog, now: clock.now } });
  await app.ready();
  apps.push(app);
  return { app, ctx, clock, ...fakes };
}

describe('outbox migration', () => {
  it('adds purpose, label, ref and url to a database written before they existed', () => {
    const file = tempDb();
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE outbox (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, buyer_name TEXT NOT NULL, channel TEXT NOT NULL,
      recipient TEXT NOT NULL, status TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL, subject TEXT, body_text TEXT, body_html TEXT)`);
    old.prepare('INSERT INTO outbox VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('d0', 's1', 'Priya', 'email', 'p@example.com', 'sent', 'ok', 1, 'Recap', 'Hi', null);
    old.close();

    const store = new LeadStore(file, silentLog);
    store.upsertOutbox({
      delivery: { id: 'd1', channel: 'jira', to: 'Jira AVE', status: 'sent', detail: 'Created AVE-1', at: 2, purpose: 'action_item', label: 'Follow-up task', ref: 'AVE-1', url: 'https://example.atlassian.net/browse/AVE-1' },
      sessionId: 's1',
      buyerName: 'Priya',
      subject: 'Share the parking policy',
      text: 'Details',
      html: null,
    });
    store.close();

    // Opening again must not try to add the columns twice.
    const again = new LeadStore(file, silentLog);
    const [jira, email] = again.listOutbox();
    expect(jira).toMatchObject({ id: 'd1', purpose: 'action_item', label: 'Follow-up task', ref: 'AVE-1', url: 'https://example.atlassian.net/browse/AVE-1' });
    expect(email).toEqual({ id: 'd0', sessionId: 's1', buyerName: 'Priya', channel: 'email', to: 'p@example.com', status: 'sent', detail: 'ok', at: 1, subject: 'Recap', text: 'Hi', html: null });
    again.close();
  });
});

describe('Integrations API', () => {
  it('lists every channel with its status and the MCP link', async () => {
    const { app } = await start({ AUTOMATIONS: 'slack,jira' });
    const res = (await app.inject({ url: '/api/desk/integrations' })).json() as IntegrationsResponse;
    expect(res.integrations.map((i) => i.channel)).toEqual(['email', 'whatsapp', 'crm', 'slack', 'jira']);
    expect(res.integrations.find((i) => i.channel === 'slack')).toMatchObject({ configured: true, provider: 'fake slack', destination: '#sales-pipeline', automated: true, test: 'none', lastSentAt: null });
    expect(res.integrations.find((i) => i.channel === 'crm')).toMatchObject({ configured: false, provider: null, automated: false, test: 'unsupported' });
    expect(res.mcp).toEqual({ server: 'estates', tools: TOOL_NAMES.length, transport: 'mcp', reachable: false });
  });

  it('sends labelled tests outside any lead and reports the result on the page', async () => {
    const { app, ctx, slack, jira, whatsapp, email } = await start();
    const post = (channel: string, payload?: object) => app.inject({ method: 'POST', url: `/api/desk/integrations/${channel}/test`, payload: payload ?? {} });

    const s = await post('slack');
    expect(s.json()).toMatchObject({ delivery: { channel: 'slack', status: 'sent', purpose: 'test', to: '#sales-pipeline' } });
    expect(slack.sent[0]!.text).toMatch(/^Test from the Lead Desk/);

    expect((await post('jira')).statusCode).toBe(400);
    expect(jira.created).toHaveLength(0);
    expect((await post('jira', { confirm: true })).json()).toMatchObject({ delivery: { status: 'sent', ref: 'AVE-1', url: 'https://example.atlassian.net/browse/AVE-1' } });

    expect((await post('email', { to: 'not an email' })).statusCode).toBe(400);
    expect((await post('email', { to: 'me@example.com' })).statusCode).toBe(200);
    expect(email.sent[0]!.to).toBe('me@example.com');

    expect((await post('whatsapp', { to: '12' })).statusCode).toBe(400);
    expect((await post('whatsapp', { to: '98765 43210' })).statusCode).toBe(200);
    expect(whatsapp.sent[0]!.to).toBe('+919876543210');

    expect((await post('crm')).statusCode).toBe(400);
    expect((await post('fax')).statusCode).toBe(404);

    const outbox = (await app.inject({ url: '/api/outbox' })).json() as { items: OutboxItem[] };
    expect(outbox.items).toHaveLength(4);
    expect(outbox.items.every((i) => i.sessionId === TEST_SESSION_ID && i.purpose === 'test')).toBe(true);
    expect(ctx.store.list()).toHaveLength(0);

    const page = (await app.inject({ url: '/api/desk/integrations' })).json() as IntegrationsResponse;
    expect(page.integrations.find((i) => i.channel === 'jira')!.lastSentAt).not.toBeNull();
  });

  it('shows the last failure', async () => {
    const { app, slack } = await start();
    slack.outcome = { status: 'failed', detail: 'Slack refused the message (not_in_channel)' };
    await app.inject({ method: 'POST', url: '/api/desk/integrations/slack/test', payload: {} });
    const page = (await app.inject({ url: '/api/desk/integrations' })).json() as IntegrationsResponse;
    expect(page.integrations.find((i) => i.channel === 'slack')!.lastError).toMatchObject({ detail: 'Slack refused the message (not_in_channel)' });
  });
});

describe('inbound WhatsApp', () => {
  const env = { TWILIO_AUTH_TOKEN: 'twilio-test-token', PUBLIC_BASE_URL: 'https://tunnel.example.test/' };
  const form = (params: Record<string, string>) => new URLSearchParams(params).toString();
  const reply = (params: Record<string, string>, signature = twilioSignature(env.TWILIO_AUTH_TOKEN, `https://tunnel.example.test${WHATSAPP_INBOUND_PATH}`, params)) => ({
    method: 'POST' as const,
    url: WHATSAPP_INBOUND_PATH,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature },
    payload: form(params),
  });

  it('signs like Twilio\'s documented example', () => {
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
    expect(twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', params)).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  });

  it('refuses unsigned requests and works only when configured', async () => {
    const off = await start();
    expect((await off.app.inject(reply({ From: 'whatsapp:+919876543210', Body: 'Hi' }, 'x'))).statusCode).toBe(503);
    const { app } = await start(env);
    expect((await app.inject(reply({ From: 'whatsapp:+919876543210', Body: 'Hi' }, 'bad'))).statusCode).toBe(403);
  });

  it('adds the reply to the lead and posts it to the lead thread, once', async () => {
    const { app, ctx, slack } = await start(env);
    const s = ctx.store.create({ name: 'Priya Sharma', phone: '98765 43210', email: 'priya@example.com' });
    const params = { From: 'whatsapp:+919876543210', Body: 'Can we make it 12 instead?', MessageSid: 'SM123', ProfileName: 'Priya' };
    const res = await app.inject(reply(params));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/xml/);
    await app.inject(reply(params));
    await deskFor(ctx).idle(s.id);

    const state = ctx.store.get(s.id)!;
    expect(state.timeline.filter((e) => e.kind === WHATSAPP_REPLY_NOTE_KIND).map((e) => e.label)).toEqual(['Replied on WhatsApp: "Can we make it 12 instead?"']);
    expect(slack.sent).toHaveLength(1);
    expect(slack.sent[0]!.text).toBe('Priya Sharma replied on WhatsApp: Can we make it 12 instead?');
    expect(state.deliveries.find((d) => d.channel === 'slack')).toMatchObject({ label: 'Buyer replied on WhatsApp', status: 'sent' });

    const stranger = await app.inject(reply({ From: 'whatsapp:+14155550000', Body: 'Who is this?', MessageSid: 'SM999' }));
    expect(stranger.statusCode).toBe(200);
    expect(slack.sent).toHaveLength(1);
  });
});
