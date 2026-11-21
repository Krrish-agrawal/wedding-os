import type { Config } from '../../config.js';
import { field, requestJson } from './http.js';
import type { FetchLike, SendOutcome, WhatsAppAdapter, WhatsAppMessage } from './types.js';

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';
const META_GRAPH_BASE = 'https://graph.facebook.com';
/** Graph API version used for the Cloud API messages endpoint. */
export const META_GRAPH_VERSION = 'v27.0';
const WHATSAPP_PREFIX = 'whatsapp:';
/** Longest caption the Cloud API accepts on an image message. */
const META_CAPTION_MAX_CHARS = 1024;

/** Default country for numbers typed without one: the product serves buyers in India. */
export const DEFAULT_COUNTRY_CODE = '91';
const NATIONAL_NUMBER_DIGITS = 10;
const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;

/**
 * Normalises a phone number to E.164 ("+919876543210").
 * Accepts "+91 98765 43210", "09876543210", "919876543210", "9876543210". Returns null if unusable.
 */
export function toE164(raw: string, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return isE164Length(digits) ? `+${digits}` : null;
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
    return isE164Length(digits) ? `+${digits}` : null;
  }
  if (digits.length === NATIONAL_NUMBER_DIGITS + 1 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === NATIONAL_NUMBER_DIGITS) return `+${countryCode}${digits}`;
  if (digits.length === NATIONAL_NUMBER_DIGITS + countryCode.length && digits.startsWith(countryCode)) return `+${digits}`;
  return null;
}

function isE164Length(digits: string): boolean {
  return digits.length >= E164_MIN_DIGITS && digits.length <= E164_MAX_DIGITS;
}

/**
 * Twilio Programmable Messaging with a WhatsApp sender (the sandbox number in development).
 * The recipient must have joined the sandbox, and free-form text only reaches them inside the
 * 24-hour window after their last message; otherwise Twilio reports the failure.
 */
export class TwilioWhatsAppAdapter implements WhatsAppAdapter {
  readonly provider = 'Twilio';

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(message: WhatsAppMessage): Promise<SendOutcome> {
    const from = this.from.startsWith(WHATSAPP_PREFIX) ? this.from : `${WHATSAPP_PREFIX}${this.from}`;
    const body = new URLSearchParams({ To: `${WHATSAPP_PREFIX}${message.to}`, From: from, Body: message.body });
    // Twilio fetches the image itself, so it must be a public URL; the body becomes its caption.
    if (message.mediaUrl) body.set('MediaUrl', message.mediaUrl);
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    const res = await requestJson(this.fetchImpl, `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) return { status: 'failed', detail: `Twilio did not accept the message (${res.reason})` };
    const status = field(res.json, 'status');
    if (status === 'failed' || status === 'undelivered') {
      return { status: 'failed', detail: `Twilio reported ${status}: ${field(res.json, 'error_message') ?? field(res.json, 'error_code') ?? 'no reason given'}` };
    }
    const sid = field(res.json, 'sid');
    return { status: 'sent', providerId: sid, detail: `Accepted by Twilio${status ? ` (${status})` : ''}${sid ? `, ${sid}` : ''}` };
  }
}

/**
 * Meta WhatsApp Cloud API. A free-form text message is only delivered inside the 24-hour
 * customer service window opened by the buyer's last message; the test number only reaches
 * recipients verified in the app dashboard.
 */
export class MetaWhatsAppAdapter implements WhatsAppAdapter {
  readonly provider = 'Meta WhatsApp Cloud API';

  constructor(
    private readonly token: string,
    private readonly phoneNumberId: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(message: WhatsAppMessage): Promise<SendOutcome> {
    const content = metaContent(message);
    const res = await requestJson(this.fetchImpl, `${META_GRAPH_BASE}/${META_GRAPH_VERSION}/${encodeURIComponent(this.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: message.to, ...content }),
    });
    if (!res.ok) return { status: 'failed', detail: `WhatsApp Cloud API did not accept the message (${res.reason})` };
    const id = field(res.json, 'messages', 0, 'id');
    const imageLeftOut = message.mediaUrl && content.type === 'text' ? '; image left out because the text is too long for a caption' : '';
    return { status: 'sent', providerId: id, detail: `${id ? `Accepted by WhatsApp Cloud API (${id})` : 'Accepted by WhatsApp Cloud API'}${imageLeftOut}` };
  }
}

/**
 * Cloud API message content: an image with the text as its caption when there is a media URL and
 * the text fits a caption, otherwise plain text (a long text is never cut to fit).
 */
function metaContent(message: WhatsAppMessage): Record<string, unknown> {
  if (message.mediaUrl && message.body.length <= META_CAPTION_MAX_CHARS) {
    return { type: 'image', image: { link: message.mediaUrl, ...(message.body ? { caption: message.body } : {}) } };
  }
  return { type: 'text', text: { preview_url: false, body: message.body } };
}

export class UnconfiguredWhatsAppAdapter implements WhatsAppAdapter {
  readonly provider = 'none';
  constructor(private readonly reason: string) {}
  async send(): Promise<SendOutcome> {
    return { status: 'not_configured', detail: this.reason };
  }
}

/**
 * Preview mode: every message is composed and kept in the Outbox (the Lead Desk shows it in a phone
 * mock-up), and none is sent. Recorded as not configured, so nothing ever claims it was delivered.
 */
export const WHATSAPP_PREVIEW_DETAIL = 'Preview only: WhatsApp sending is off for this demo, so the message is shown on the Lead Desk instead.';

export class PreviewWhatsAppAdapter implements WhatsAppAdapter {
  readonly provider = 'none';
  async send(): Promise<SendOutcome> {
    return { status: 'not_configured', detail: WHATSAPP_PREVIEW_DETAIL };
  }
}

export function createWhatsAppAdapter(config: Config, fetchImpl: FetchLike = fetch): WhatsAppAdapter {
  switch (config.WHATSAPP_PROVIDER) {
    case 'preview':
      return new PreviewWhatsAppAdapter();
    case 'none':
      return new UnconfiguredWhatsAppAdapter('WhatsApp is not configured (WHATSAPP_PROVIDER is none)');
    case 'twilio':
      if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN || !config.TWILIO_WHATSAPP_FROM) {
        return new UnconfiguredWhatsAppAdapter('Twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM');
      }
      return new TwilioWhatsAppAdapter(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN, config.TWILIO_WHATSAPP_FROM, fetchImpl);
    case 'meta':
      if (!config.META_WA_TOKEN || !config.META_WA_PHONE_NUMBER_ID) {
        return new UnconfiguredWhatsAppAdapter('WhatsApp Cloud API needs META_WA_TOKEN and META_WA_PHONE_NUMBER_ID');
      }
      return new MetaWhatsAppAdapter(config.META_WA_TOKEN, config.META_WA_PHONE_NUMBER_ID, fetchImpl);
  }
}
