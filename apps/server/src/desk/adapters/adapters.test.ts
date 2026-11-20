import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config.js';
import { HubSpotCrmAdapter } from './crm.js';
import { createEmailAdapter, ResendEmailAdapter } from './email.js';
import { requestJson } from './http.js';
import type { CrmLead, EmailMessage, FetchLike } from './types.js';
import { createWhatsAppAdapter, MetaWhatsAppAdapter, toE164, TwilioWhatsAppAdapter } from './whatsapp.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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

const email: EmailMessage = {
  to: 'priya@example.com',
  subject: 'Your call recap',
  html: '<p>Hi</p>',
  text: 'Hi',
  attachments: [{ filename: 'site-visit.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' }],
  idempotencyKey: 'dlv_1',
};

describe('requestJson', () => {
  it('turns a timeout into a short failure instead of throwing', async () => {
    const slow: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    const r = await requestJson(slow, 'https://example.test', {}, 20);
    expect(r).toMatchObject({ ok: false, status: null, reason: 'No response within 0 s' });
  });

  it('reports network errors', async () => {
    const { fn } = mockFetch(new TypeError('fetch failed'));
    expect(await requestJson(fn, 'https://example.test', {})).toMatchObject({ ok: false, reason: 'Network error: fetch failed' });
  });
});

describe('Resend email adapter', () => {
  it('sends JSON with base64 attachments and an idempotency key', async () => {
    const { fn, calls } = mockFetch(json(200, { id: 'em_123' }));
    const r = await new ResendEmailAdapter('re_key', 'Agora <recap@example.com>', fn).send(email);
    expect(r).toEqual({ status: 'sent', providerId: 'em_123', detail: 'Accepted by Resend (em_123)' });
    const call = calls[0]!;
    expect(call.url).toBe('https://api.resend.com/emails');
    const headers = call.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer re_key');
    expect(headers['idempotency-key']).toBe('dlv_1');
    const body = JSON.parse(String(call.init.body));
    expect(body).toMatchObject({ from: 'Agora <recap@example.com>', to: ['priya@example.com'], subject: 'Your call recap' });
    expect(Buffer.from(body.attachments[0].content, 'base64').toString()).toBe('BEGIN:VCALENDAR');
  });

  it('records the provider message when it refuses', async () => {
    const { fn } = mockFetch(json(422, { statusCode: 422, name: 'validation_error', message: 'The from address is not verified' }));
    const r = await new ResendEmailAdapter('re_key', 'x@example.com', fn).send(email);
    expect(r).toEqual({ status: 'failed', detail: 'Resend did not accept the email (HTTP 422: The from address is not verified)' });
  });

  it('is not configured without a provider, without keys, or with SMTP', async () => {
    const none = await createEmailAdapter(loadConfig({})).send(email);
    expect(none.status).toBe('not_configured');
    const missing = await createEmailAdapter(loadConfig({ EMAIL_PROVIDER: 'resend' })).send(email);
    expect(missing).toEqual({ status: 'not_configured', detail: 'Resend needs RESEND_API_KEY and EMAIL_FROM' });
    const smtp = await createEmailAdapter(loadConfig({ EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtp://x' })).send(email);
    expect(smtp.status).toBe('not_configured');
    expect(smtp.detail).toMatch(/SMTP client library/);
  });
});

describe('WhatsApp adapters', () => {
  it('normalises Indian numbers to E.164', () => {
    expect(toE164('98765 43210')).toBe('+919876543210');
    expect(toE164('098765-43210')).toBe('+919876543210');
    expect(toE164('919876543210')).toBe('+919876543210');
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
    expect(toE164('0044 20 7946 0958')).toBe('+442079460958');
    expect(toE164('12345')).toBeNull();
  });

  it('sends through Twilio with whatsapp: addresses and form encoding', async () => {
    const { fn, calls } = mockFetch(json(201, { sid: 'SM1', status: 'queued' }));
    const r = await new TwilioWhatsAppAdapter('AC1', 'tok', '+14155238886', fn).send({ to: '+919876543210', body: 'Hi' });
    expect(r).toEqual({ status: 'sent', providerId: 'SM1', detail: 'Accepted by Twilio (queued), SM1' });
    expect(calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get('To')).toBe('whatsapp:+919876543210');
    expect(form.get('From')).toBe('whatsapp:+14155238886');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('AC1:tok').toString('base64')}`);
  });

  it('reports a Twilio refusal, e.g. a recipient who has not joined the sandbox', async () => {
    const { fn } = mockFetch(json(400, { code: 63015, message: 'Channel Sandbox can only send messages to phone numbers that have joined the Sandbox', status: 400 }));
    const r = await new TwilioWhatsAppAdapter('AC1', 'tok', 'whatsapp:+14155238886', fn).send({ to: '+919876543210', body: 'Hi' });
    expect(r.status).toBe('failed');
    expect(r.detail).toMatch(/joined the Sandbox/);
  });

  it('sends through the Meta Cloud API and surfaces its error details', async () => {
    const ok = mockFetch(json(200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.1' }] }));
    const r = await new MetaWhatsAppAdapter('tok', '1065', ok.fn).send({ to: '+919876543210', body: 'Hi' });
    expect(r).toEqual({ status: 'sent', providerId: 'wamid.1', detail: 'Accepted by WhatsApp Cloud API (wamid.1)' });
    expect(ok.calls[0]!.url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/1065\/messages$/);
    expect(JSON.parse(String(ok.calls[0]!.init.body))).toMatchObject({ messaging_product: 'whatsapp', to: '+919876543210', type: 'text', text: { body: 'Hi' } });

    const bad = mockFetch(json(400, { error: { message: '(#131047) Re-engagement message', code: 131047, error_data: { details: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.' } } }));
    const f = await new MetaWhatsAppAdapter('tok', '1065', bad.fn).send({ to: '+919876543210', body: 'Hi' });
    expect(f.status).toBe('failed');
    expect(f.detail).toMatch(/more than 24 hours/);
  });

  it('is not configured until the provider has its credentials', async () => {
    expect((await createWhatsAppAdapter(loadConfig({})).send({ to: '+91', body: '' })).status).toBe('not_configured');
    expect((await createWhatsAppAdapter(loadConfig({ WHATSAPP_PROVIDER: 'twilio' })).send({ to: '+91', body: '' })).status).toBe('not_configured');
    expect((await createWhatsAppAdapter(loadConfig({ WHATSAPP_PROVIDER: 'meta' })).send({ to: '+91', body: '' })).status).toBe('not_configured');
  });
});

describe('HubSpot CRM adapter', () => {
  const lead: CrmLead = {
    email: 'priya@example.com',
    firstName: 'Priya',
    lastName: 'Sharma',
    phone: '+919876543210',
    dealName: 'Priya Sharma: Apartment',
    amount: 12_600_000,
    visitBooked: true,
    note: 'Recap\nline two <b>',
    dealId: null,
  };

  it('upserts the contact, creates a deal and attaches the note', async () => {
    const { fn, calls } = mockFetch(json(200, { results: [{ id: 'c1' }] }), json(201, { id: 'd1' }), json(201, { id: 'n1' }));
    const r = await new HubSpotCrmAdapter('pat', fn).syncLead(lead);
    expect(r).toMatchObject({ status: 'sent', contactId: 'c1', dealId: 'd1', noteId: 'n1' });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'POST https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert',
      'POST https://api.hubapi.com/crm/v3/objects/deals',
      'POST https://api.hubapi.com/crm/v3/objects/notes',
    ]);
    const upsert = JSON.parse(String(calls[0]!.init.body));
    expect(upsert.inputs[0]).toMatchObject({ idProperty: 'email', id: 'priya@example.com', properties: { firstname: 'Priya' } });
    const deal = JSON.parse(String(calls[1]!.init.body));
    expect(deal.properties).toMatchObject({ dealname: 'Priya Sharma: Apartment', amount: '12600000', dealstage: 'appointmentscheduled' });
    expect(deal.associations[0]).toEqual({ to: { id: 'c1' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] });
    const note = JSON.parse(String(calls[2]!.init.body));
    expect(note.properties.hs_note_body).toBe('Recap<br>line two &lt;b&gt;');
    expect(note.associations.map((a: { types: { associationTypeId: number }[] }) => a.types[0]!.associationTypeId)).toEqual([202, 214]);
  });

  it('updates the deal from an earlier sync instead of creating another', async () => {
    const { fn, calls } = mockFetch(json(200, { results: [{ id: 'c1' }] }), json(200, { id: 'd9' }), json(201, { id: 'n2' }));
    const r = await new HubSpotCrmAdapter('pat', fn).syncLead({ ...lead, dealId: 'd9' });
    expect(r).toMatchObject({ status: 'sent', dealId: 'd9' });
    expect(calls[1]!.init.method).toBe('PATCH');
    expect(calls[1]!.url).toBe('https://api.hubapi.com/crm/v3/objects/deals/d9');
  });

  it('fails softly with the reason', async () => {
    const { fn } = mockFetch(json(401, { status: 'error', message: 'Authentication credentials not found.' }));
    const r = await new HubSpotCrmAdapter('pat', fn).syncLead(lead);
    expect(r).toEqual({ status: 'failed', detail: 'HubSpot contact upsert failed (HTTP 401: Authentication credentials not found.)' });
  });
});
