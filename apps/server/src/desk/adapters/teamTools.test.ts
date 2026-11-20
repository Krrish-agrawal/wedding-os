import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config.js';
import { createJiraAdapter, JiraCloudAdapter, JIRA_SUMMARY_MAX, textToAdf } from './jira.js';
import { createSlackAdapter, SlackBotAdapter, SlackWebhookAdapter } from './slack.js';
import type { FetchLike } from './types.js';
import { MetaWhatsAppAdapter, TwilioWhatsAppAdapter } from './whatsapp.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (status: number, body: string) => new Response(body, { status, headers: { 'content-type': 'text/plain' } });

function mockFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  });
  return { fn, calls };
}

const body = (call: { init: RequestInit }) => JSON.parse(String(call.init.body)) as Record<string, unknown>;
const headers = (call: { init: RequestInit }) => call.init.headers as Record<string, string>;

describe('Slack bot adapter', () => {
  it('posts with the bot token, keeps the ts and links to the message', async () => {
    const { fn, calls } = mockFetch(json(200, { ok: true, channel: 'C1', ts: '1700000000.000100' }), json(200, { ok: true, permalink: 'https://team.slack.com/archives/C1/p1700000000000100' }));
    const r = await new SlackBotAdapter('xoxb-1', 'C1', '#sales-pipeline', fn).send({ text: 'Visit booked', blocks: [{ type: 'divider' }] });
    expect(r).toEqual({ status: 'sent', providerId: '1700000000.000100', detail: 'Posted to #sales-pipeline (1700000000.000100)', url: 'https://team.slack.com/archives/C1/p1700000000000100' });
    expect(calls[0]!.url).toBe('https://slack.com/api/chat.postMessage');
    expect(headers(calls[0]!).authorization).toBe('Bearer xoxb-1');
    expect(body(calls[0]!)).toEqual({ channel: 'C1', text: 'Visit booked', blocks: [{ type: 'divider' }], unfurl_links: false, unfurl_media: false });
    expect(calls[1]!.url).toBe('https://slack.com/api/chat.getPermalink?channel=C1&message_ts=1700000000.000100');
  });

  it('replies in a thread and can broadcast the reply to the channel', async () => {
    const { fn, calls } = mockFetch(json(200, { ok: true, channel: 'C1', ts: '2.0' }), json(200, { ok: false, error: 'missing_scope' }));
    const r = await new SlackBotAdapter('xoxb-1', 'C1', '#sales', fn).send({ text: 'Join', threadTs: '1.0', broadcast: true });
    expect(r).toMatchObject({ status: 'sent', providerId: '2.0', detail: 'Posted in the thread on #sales (2.0)', url: null });
    expect(body(calls[0]!)).toMatchObject({ thread_ts: '1.0', reply_broadcast: true });
    expect(body(calls[0]!)).not.toHaveProperty('blocks');
  });

  it('treats ok:false on HTTP 200 as a failure with Slack\'s error code', async () => {
    const { fn } = mockFetch(json(200, { ok: false, error: 'not_in_channel' }));
    const r = await new SlackBotAdapter('xoxb-1', 'C1', '#sales', fn).send({ text: 'x' });
    expect(r).toEqual({ status: 'failed', detail: 'Slack refused the message (not_in_channel)' });
  });

  it('reports HTTP and network failures', async () => {
    const http = await new SlackBotAdapter('t', 'C1', '#s', mockFetch(text(500, 'oops')).fn).send({ text: 'x' });
    expect(http).toEqual({ status: 'failed', detail: 'Slack did not accept the message (HTTP 500: oops)' });
    const net = await new SlackBotAdapter('t', 'C1', '#s', mockFetch(new TypeError('fetch failed')).fn).send({ text: 'x' });
    expect(net.status).toBe('failed');
  });
});

describe('Slack webhook adapter', () => {
  it('posts text and blocks, ignores threads and returns no ts', async () => {
    const { fn, calls } = mockFetch(text(200, 'ok'));
    const r = await new SlackWebhookAdapter('https://hooks.slack.test/services/x', '#sales', fn).send({ text: 'Hi', blocks: [{ type: 'divider' }], threadTs: '1.0', broadcast: true });
    expect(r).toEqual({ status: 'sent', providerId: null, detail: 'Posted to #sales through the webhook' });
    expect(calls[0]!.url).toBe('https://hooks.slack.test/services/x');
    expect(body(calls[0]!)).toEqual({ text: 'Hi', blocks: [{ type: 'divider' }], unfurl_links: false, unfurl_media: false });
  });

  it('reports Slack\'s plain-text error', async () => {
    const r = await new SlackWebhookAdapter('https://hooks.slack.test/x', '#s', mockFetch(text(404, 'no_service')).fn).send({ text: 'Hi' });
    expect(r).toEqual({ status: 'failed', detail: 'Slack did not accept the message (HTTP 404: no_service)' });
  });

  it('prefers the bot token, falls back to the webhook, else is not configured', async () => {
    const bot = createSlackAdapter(loadConfig({ SLACK_BOT_TOKEN: 'xoxb', SLACK_CHANNEL_ID: 'C9', SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x' }));
    expect(bot).toBeInstanceOf(SlackBotAdapter);
    expect(bot.destination).toBe('C9');
    const named = createSlackAdapter(loadConfig({ SLACK_BOT_TOKEN: 'xoxb', SLACK_CHANNEL_ID: 'C9', SLACK_CHANNEL_NAME: '#sales-pipeline' }));
    expect(named.destination).toBe('#sales-pipeline');
    expect(createSlackAdapter(loadConfig({ SLACK_WEBHOOK_URL: 'https://hooks.slack.test/x' }))).toBeInstanceOf(SlackWebhookAdapter);
    const none = await createSlackAdapter(loadConfig({ SLACK_BOT_TOKEN: 'xoxb' })).send({ text: 'x' });
    expect(none.status).toBe('not_configured');
  });
});

describe('Jira adapter', () => {
  const jira = (fn: FetchLike) => new JiraCloudAdapter('https://example.atlassian.net/', 'me@example.com', 'tok', 'AVE', 'Task', 'virtual-estates', fn);

  it('creates an issue with ADF, labels and a due date', async () => {
    const { fn, calls } = mockFetch(json(201, { id: '10001', key: 'AVE-7', self: 'https://example.atlassian.net/rest/api/3/issue/10001' }));
    const r = await jira(fn).createIssue({ summary: 'Prepare site visit', description: 'Line one\nLead: https://desk.test/desk?lead=1.\n\nSecond block', dueDate: '2026-11-22', labels: ['site visit'] });
    expect(r).toEqual({ status: 'sent', providerId: 'AVE-7', detail: 'Created AVE-7 in Jira AVE', url: 'https://example.atlassian.net/browse/AVE-7' });
    expect(calls[0]!.url).toBe('https://example.atlassian.net/rest/api/3/issue');
    expect(headers(calls[0]!).authorization).toBe(`Basic ${Buffer.from('me@example.com:tok').toString('base64')}`);
    const fields = body(calls[0]!).fields as Record<string, unknown>;
    expect(fields).toMatchObject({ project: { key: 'AVE' }, summary: 'Prepare site visit', issuetype: { name: 'Task' }, labels: ['virtual-estates', 'site-visit'], duedate: '2026-11-22' });
    expect(fields.description).toEqual({
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Line one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Lead: ' },
            { type: 'text', text: 'https://desk.test/desk?lead=1', marks: [{ type: 'link', attrs: { href: 'https://desk.test/desk?lead=1' } }] },
            { type: 'text', text: '.' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second block' }] },
      ],
    });
  });

  it('retries once without the due date when the project has no such field', async () => {
    const { fn, calls } = mockFetch(
      json(400, { errorMessages: [], errors: { duedate: "Field 'duedate' cannot be set. It is not on the appropriate screen, or unknown." } }),
      json(201, { id: '1', key: 'AVE-8' }),
    );
    const r = await jira(fn).createIssue({ summary: 'Call back Priya', description: '', dueDate: '2026-11-20' });
    expect(r).toMatchObject({ status: 'sent', providerId: 'AVE-8', detail: "Created AVE-8 in Jira AVE without due date (not on the project's create screen)" });
    expect(calls).toHaveLength(2);
    expect(body(calls[1]!).fields).not.toHaveProperty('duedate');
    expect(body(calls[1]!).fields).toHaveProperty('labels');
    expect(body(calls[1]!).fields).not.toHaveProperty('description');
  });

  it('reports Jira\'s own error messages', async () => {
    const { fn, calls } = mockFetch(json(400, { errorMessages: ['Specify a valid project ID or key'], errors: { issuetype: 'Specify a valid issue type' } }));
    const r = await jira(fn).createIssue({ summary: 'x', description: 'y', dueDate: null });
    expect(r).toEqual({ status: 'failed', detail: 'Jira did not create the issue (HTTP 400: Specify a valid project ID or key; issuetype: Specify a valid issue type)' });
    expect(calls).toHaveLength(1);
    const auth = await jira(mockFetch(json(401, { errorMessages: ['Unauthorized'] })).fn).createIssue({ summary: 'x', description: '', dueDate: null });
    expect(auth.detail).toBe('Jira did not create the issue (HTTP 401: Unauthorized)');
  });

  it('keeps summaries to one line of at most 255 characters', async () => {
    const { fn, calls } = mockFetch(json(201, { id: '1', key: 'AVE-9' }));
    await jira(fn).createIssue({ summary: `Line\n${'x'.repeat(400)}`, description: '', dueDate: null });
    const summary = (body(calls[0]!).fields as { summary: string }).summary;
    expect(summary.length).toBe(JIRA_SUMMARY_MAX);
    expect(summary.startsWith('Line x')).toBe(true);
  });

  it('never makes empty ADF text nodes', () => {
    expect(textToAdf('\n\n  \n')).toEqual({ type: 'doc', version: 1, content: [] });
    expect(textToAdf('https://a.test').content[0]!.content).toEqual([{ type: 'text', text: 'https://a.test', marks: [{ type: 'link', attrs: { href: 'https://a.test' } }] }]);
  });

  it('is not configured without every credential', async () => {
    const r = await createJiraAdapter(loadConfig({ JIRA_BASE_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'a@b.c' })).createIssue({ summary: 'x', description: '', dueDate: null });
    expect(r.status).toBe('not_configured');
    const ok = createJiraAdapter(loadConfig({ JIRA_BASE_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 't', JIRA_PROJECT_KEY: 'AVE' }));
    expect(ok.destination).toBe('Jira AVE');
  });
});

describe('WhatsApp media', () => {
  it('sends Twilio MediaUrl with the text as caption', async () => {
    const { fn, calls } = mockFetch(json(201, { sid: 'SM2', status: 'queued' }));
    await new TwilioWhatsAppAdapter('AC1', 'tok', '+14155238886', fn).send({ to: '+919876543210', body: 'Floor plan', mediaUrl: 'https://cdn.test/plan.png' });
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get('MediaUrl')).toBe('https://cdn.test/plan.png');
    expect(form.get('Body')).toBe('Floor plan');
  });

  it('sends a Meta image message with a caption, and text when there is no image', async () => {
    const img = mockFetch(json(200, { messages: [{ id: 'wamid.2' }] }));
    await new MetaWhatsAppAdapter('tok', '1065', img.fn).send({ to: '+919876543210', body: 'Living room', mediaUrl: 'https://cdn.test/room.jpg' });
    expect(body(img.calls[0]!)).toMatchObject({ type: 'image', image: { link: 'https://cdn.test/room.jpg', caption: 'Living room' } });
    expect(body(img.calls[0]!)).not.toHaveProperty('text');

    const long = mockFetch(json(200, { messages: [{ id: 'wamid.3' }] }));
    const r = await new MetaWhatsAppAdapter('tok', '1065', long.fn).send({ to: '+919876543210', body: 'x'.repeat(1100), mediaUrl: 'https://cdn.test/room.jpg' });
    expect(body(long.calls[0]!)).toMatchObject({ type: 'text' });
    expect(r.detail).toMatch(/image left out/);
  });
});
