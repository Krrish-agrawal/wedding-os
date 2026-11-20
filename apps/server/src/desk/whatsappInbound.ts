import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { SessionState } from '@ave/shared';
import { toE164 } from './adapters/whatsapp.js';
import { automationDeliveryId, leadUrl, parseAutomationChannels } from './automations.js';
import { sendSlackPost } from './deliveries.js';
import { deskFor, type DeskRuntime } from './runtime.js';

/**
 * Two-way WhatsApp (Twilio): the buyer's replies arrive at this webhook, are checked against
 * Twilio's signature, matched to a lead by phone number, added to the lead's timeline and posted
 * to the lead's Slack thread. Point the Twilio sandbox's "When a message comes in" at
 * `${PUBLIC_BASE_URL}/api/integrations/whatsapp/inbound` (HTTP POST).
 */

export const WHATSAPP_INBOUND_PATH = '/api/integrations/whatsapp/inbound';
/** Timeline note kind for a buyer's WhatsApp reply. */
export const WHATSAPP_REPLY_NOTE_KIND = 'whatsapp_reply';
const SIGNATURE_HEADER = 'x-twilio-signature';
const WHATSAPP_PREFIX = 'whatsapp:';
/** Replies longer than this are cut in the timeline and Slack; the full text stays in Twilio. */
const MAX_REPLY_CHARS = 500;
/** Empty TwiML: acknowledge without an automatic answer (people answer, not the webhook). */
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const RULE_ID = 'whatsapp_reply';
/** Message ids remembered to drop Twilio's quick retries (restarts are covered by the delivery id). */
const SEEN_MESSAGES_MAX = 500;

/**
 * Twilio's request signature: base64 HMAC-SHA1, keyed with the auth token, of the full URL
 * followed by every POST parameter name and value, sorted by name
 * (https://www.twilio.com/docs/usage/security#validating-requests).
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The most recent lead with this phone number, live calls included. */
export function findLeadByPhone(desk: DeskRuntime, e164: string): SessionState | null {
  const candidates = new Map<string, SessionState>();
  for (const rec of desk.leads.list()) candidates.set(rec.state.id, rec.state);
  for (const live of desk.ctx.store.list()) candidates.set(live.id, live);
  const matches = [...candidates.values()].filter((s) => toE164(s.buyer.phone) === e164).sort((a, b) => b.createdAt - a.createdAt);
  return matches[0] ?? null;
}

function clip(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > MAX_REPLY_CHARS ? `${one.slice(0, MAX_REPLY_CHARS - 1)}…` : one;
}

function mrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const whatsappInboundRoutes: FastifyPluginAsync = async (app) => {
  const seen: string[] = [];
  const firstTime = (messageSid: string | null) => {
    if (!messageSid) return true;
    if (seen.includes(messageSid)) return false;
    seen.push(messageSid);
    if (seen.length > SEEN_MESSAGES_MAX) seen.shift();
    return true;
  };

  // Twilio posts form-encoded bodies; scoped to this plugin's route only.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(typeof body === 'string' ? body : body.toString('utf8'))));
  });

  app.post(WHATSAPP_INBOUND_PATH, async (req, reply) => {
    const { config } = app.ctx;
    if (!config.TWILIO_AUTH_TOKEN || !config.PUBLIC_BASE_URL) {
      return reply.code(503).send({ error: 'Inbound WhatsApp needs TWILIO_AUTH_TOKEN and PUBLIC_BASE_URL.' });
    }
    const params = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>;
    const url = `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}${req.url}`;
    const signature = req.headers[SIGNATURE_HEADER];
    if (!validTwilioSignature(config.TWILIO_AUTH_TOKEN, url, params, typeof signature === 'string' ? signature : undefined)) {
      req.log.warn({ path: WHATSAPP_INBOUND_PATH }, 'rejected an inbound WhatsApp request with a bad signature');
      return reply.code(403).send({ error: 'Invalid signature.' });
    }

    const twiml = () => reply.type('text/xml').send(EMPTY_TWIML);
    const from = toE164((params.From ?? '').replace(WHATSAPP_PREFIX, ''));
    const text = clip(params.Body ?? '');
    const messageSid = params.MessageSid ?? params.SmsMessageSid ?? null;
    if (!from || !text) return twiml();

    const desk = deskFor(app.ctx);
    const lead = findLeadByPhone(desk, from);
    if (!lead) {
      req.log.info({ messageSid }, 'WhatsApp reply from a number with no lead; ignored');
      return twiml();
    }
    const id = automationDeliveryId(RULE_ID, 'slack', lead.id, messageSid ?? String(desk.deps.now()), null);
    // Twilio retries on timeouts; the message id keeps a retry from adding the reply twice.
    if (!firstTime(messageSid) || lead.deliveries.some((d) => d.id === id)) return twiml();

    desk.apply(lead.id, { type: 'note', kind: WHATSAPP_REPLY_NOTE_KIND, label: `Replied on WhatsApp: "${text}"` }, 'buyer');
    if (!parseAutomationChannels(config.AUTOMATIONS).channels.has('slack')) {
      req.log.info({ sessionId: lead.id }, 'WhatsApp reply added; Slack is switched off in AUTOMATIONS');
      return twiml();
    }
    void desk.enqueue(lead.id, () =>
      sendSlackPost(
        desk,
        lead.id,
        {
          text: `${lead.buyer.name} replied on WhatsApp: ${text}`,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*${mrkdwn(lead.buyer.name)} replied on WhatsApp*\n>${mrkdwn(text)}` } },
            { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in Lead Desk', emoji: false }, url: leadUrl(config, lead.id), style: 'primary' }] },
          ],
          broadcast: true,
        },
        { purpose: 'action_item', label: 'Buyer replied on WhatsApp', id },
      ),
    );
    req.log.info({ sessionId: lead.id, messageSid }, 'WhatsApp reply added to the lead');
    return twiml();
  });
};
