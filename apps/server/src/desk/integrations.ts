import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  DELIVERY_CHANNELS,
  DeliveryChannelSchema,
  formatDateTimeIST,
  IntegrationTestRequestSchema,
  TEST_SESSION_ID,
  TOOL_NAMES,
  type Delivery,
  type DeliveryChannel,
  type IntegrationsResponse,
  type IntegrationStatus,
  type IntegrationTestInput,
} from '@ave/shared';
import { MCP_SERVER_NAME } from '../tools/mcp.js';
import type { SendOutcome } from './adapters/types.js';
import { toE164 } from './adapters/whatsapp.js';
import { parseAutomationChannels } from './automations.js';
import { newDeliveryId, textToHtml } from './deliveries.js';
import { BRAND_NAME } from './render.js';
import { WHATSAPP_INBOUND_PATH } from './whatsappInbound.js';
import { deskFor, type DeskRuntime } from './runtime.js';

/** Shown as the "buyer" of test sends in the Outbox. */
const TEST_BUYER_NAME = 'Integration test';
const TEST_TITLE = 'Test from the Lead Desk';
const UNEXPECTED_FAILURE = 'Unexpected error while sending; see server logs';

const CHANNEL_NAMES: Record<DeliveryChannel, string> = { email: 'Email', whatsapp: 'WhatsApp', crm: 'HubSpot', slack: 'Slack', jira: 'Jira' };

/** What the automatic pipeline sends on each channel, for the page. */
const CHANNEL_SENDS: Record<DeliveryChannel, string> = {
  whatsapp: 'Visit confirmation with a map link, the recap, and a call-back message when nobody joins',
  email: 'Visit invite with a calendar file, and the recap with consult follow-ups',
  slack: "A thread per lead: visit card, handoff alert with Join call, escalation, call summary",
  jira: 'Site-visit prep, call-backs, follow-ups and approvals from the consult notes',
  crm: 'Contact, deal stage and notes after bookings and recaps',
};

/** What a test send needs. CRM syncs only follow real leads, so it has no test. */
const TEST_INPUT: Record<DeliveryChannel, IntegrationTestInput> = { slack: 'none', jira: 'confirm', email: 'email', whatsapp: 'phone', crm: 'unsupported' };

function providerOf(desk: DeskRuntime, channel: DeliveryChannel): string | null {
  const { deps } = desk;
  const name = channel === 'crm' ? deps.crm?.provider ?? 'none' : deps[channel].provider;
  return name === 'none' ? null : name;
}

function destinationOf(desk: DeskRuntime, channel: DeliveryChannel): string {
  const { config } = desk.ctx;
  switch (channel) {
    case 'email':
      return config.EMAIL_FROM ? `The buyer's email, from ${config.EMAIL_FROM}` : "The buyer's email";
    case 'whatsapp':
      return config.TWILIO_WHATSAPP_FROM && config.WHATSAPP_PROVIDER === 'twilio' ? `The buyer's WhatsApp, from ${config.TWILIO_WHATSAPP_FROM}` : "The buyer's WhatsApp";
    case 'crm':
      return 'HubSpot contacts and deals';
    case 'slack':
      return desk.deps.slack.destination;
    case 'jira':
      return desk.deps.jira.destination;
  }
}

export function integrationsStatus(desk: DeskRuntime): IntegrationsResponse {
  const { config } = desk.ctx;
  const automated = parseAutomationChannels(config.AUTOMATIONS).channels;
  const health = desk.leads.outboxHealth();
  const integrations: IntegrationStatus[] = DELIVERY_CHANNELS.map((channel) => {
    const provider = providerOf(desk, channel);
    return {
      channel,
      name: CHANNEL_NAMES[channel],
      configured: provider !== null,
      provider,
      destination: destinationOf(desk, channel),
      automated: automated.has(channel),
      lastSentAt: health[channel]?.lastSentAt ?? null,
      lastError: health[channel]?.lastError ?? null,
      test: TEST_INPUT[channel],
      sends: CHANNEL_SENDS[channel],
      webhookUrl: channel === 'whatsapp' && config.WHATSAPP_PROVIDER === 'twilio' && config.PUBLIC_BASE_URL ? `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}${WHATSAPP_INBOUND_PATH}` : null,
    };
  });
  return {
    integrations,
    mcp: { server: MCP_SERVER_NAME, tools: TOOL_NAMES.length, transport: config.TOOL_TRANSPORT, reachable: Boolean(config.PUBLIC_BASE_URL) },
  };
}

type TestPlan = { ok: true; to: string; subject: string | null; text: string; send: () => Promise<SendOutcome> } | { ok: false; error: string };

/** Builds a clearly labelled test message for one channel, or says what is missing. */
function planTest(desk: DeskRuntime, channel: DeliveryChannel, input: { to: string | null; confirm: boolean }): TestPlan {
  const { deps } = desk;
  const stamp = formatDateTimeIST(deps.now());
  const text = `${TEST_TITLE} (${stamp}). This is a test of the ${BRAND_NAME} integration; no buyer is involved.`;
  switch (channel) {
    case 'slack':
      return {
        ok: true,
        to: deps.slack.destination,
        subject: null,
        text,
        send: () =>
          deps.slack.send({
            text,
            blocks: [
              { type: 'header', text: { type: 'plain_text', text: TEST_TITLE, emoji: false } },
              { type: 'section', text: { type: 'mrkdwn', text: `Slack is connected. Lead alerts, visit cards and call summaries will post here.\n_Sent ${stamp}; no buyer is involved._` } },
            ],
          }),
      };
    case 'jira':
      if (!input.confirm) return { ok: false, error: `Confirm first: this creates a real issue in ${deps.jira.destination}.` };
      return {
        ok: true,
        to: deps.jira.destination,
        subject: `${TEST_TITLE}: integration check`,
        text,
        send: () => deps.jira.createIssue({ summary: `${TEST_TITLE}: integration check`, description: `${text}\n\nSafe to close.`, dueDate: null }),
      };
    case 'email': {
      const to = input.to?.trim() ?? '';
      if (!z.string().email().safeParse(to).success) return { ok: false, error: 'Enter the email address to send the test to.' };
      return {
        ok: true,
        to,
        subject: TEST_TITLE,
        text,
        send: () => deps.email.send({ to, subject: TEST_TITLE, html: textToHtml(text), text, attachments: [], idempotencyKey: newDeliveryId('test') }),
      };
    }
    case 'whatsapp': {
      const to = input.to ? toE164(input.to) : null;
      if (!to) return { ok: false, error: 'Enter the WhatsApp number to send the test to, with the country code.' };
      return { ok: true, to, subject: null, text, send: () => deps.whatsapp.send({ to, body: text }) };
    }
    case 'crm':
      return { ok: false, error: 'HubSpot syncs only real leads, after a booking or a recap. There is no test send.' };
  }
}

/**
 * Integrations page API: the state of every channel (credentials, last success, last error)
 * and a test send per channel. Test sends are kept in the Outbox under a session id of their
 * own (TEST_SESSION_ID) with purpose `test`, so they never attach to a lead.
 */
export const integrationRoutes: FastifyPluginAsync = async (app) => {
  const desk = () => deskFor(app.ctx);

  app.get('/api/desk/integrations', async () => integrationsStatus(desk()));

  app.post<{ Params: { channel: string } }>('/api/desk/integrations/:channel/test', async (req, reply) => {
    const channel = DeliveryChannelSchema.safeParse(req.params.channel);
    if (!channel.success) return reply.code(404).send({ error: 'No such integration.' });
    const body = IntegrationTestRequestSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'The test request is not valid.' });
    const rt = desk();
    const plan = planTest(rt, channel.data, body.data);
    if (!plan.ok) return reply.code(400).send({ error: plan.error });

    const queued: Delivery = { id: newDeliveryId('test'), channel: channel.data, to: plan.to, status: 'queued', detail: null, at: rt.deps.now(), purpose: 'test', label: TEST_TITLE, ref: null, url: null };
    rt.leads.upsertOutbox({ delivery: queued, sessionId: TEST_SESSION_ID, buyerName: TEST_BUYER_NAME, subject: plan.subject, text: plan.text, html: channel.data === 'email' ? textToHtml(plan.text) : null });
    let outcome: SendOutcome;
    try {
      outcome = await plan.send();
    } catch (err) {
      req.log.error({ channel: channel.data, err: (err as Error).message }, 'integration test failed unexpectedly');
      outcome = { status: 'failed', detail: UNEXPECTED_FAILURE };
    }
    const done: Delivery = {
      ...queued,
      status: outcome.status,
      detail: outcome.detail,
      at: rt.deps.now(),
      ...(outcome.status === 'sent' ? { ref: outcome.providerId, url: outcome.url ?? null } : {}),
    };
    rt.leads.upsertOutbox({ delivery: done, sessionId: TEST_SESSION_ID, buyerName: TEST_BUYER_NAME, subject: null, text: null, html: null });
    req.log.info({ channel: channel.data, status: done.status }, 'integration test sent');
    return { delivery: done };
  });
};
