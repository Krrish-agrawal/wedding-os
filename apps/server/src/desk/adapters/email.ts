import type { Config } from '../../config.js';
import { field, requestJson } from './http.js';
import type { EmailAdapter, EmailMessage, FetchLike, SendOutcome } from './types.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Resend transactional email API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailAdapter implements EmailAdapter {
  readonly provider = 'Resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(message: EmailMessage): Promise<SendOutcome> {
    const res = await requestJson(this.fetchImpl, RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        // Resend takes base64 content and derives the type from the file name.
        attachments: message.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, 'utf8').toString('base64') })),
      }),
    });
    if (!res.ok) return { status: 'failed', detail: `Resend did not accept the email (${res.reason})` };
    const id = field(res.json, 'id');
    return { status: 'sent', providerId: id, detail: id ? `Accepted by Resend (${id})` : 'Accepted by Resend' };
  }
}

/** Stands in for a provider that is not set up, so the Outbox says so instead of pretending. */
export class UnconfiguredEmailAdapter implements EmailAdapter {
  readonly provider = 'none';
  constructor(private readonly reason: string) {}
  async send(): Promise<SendOutcome> {
    return { status: 'not_configured', detail: this.reason };
  }
}

export function createEmailAdapter(config: Config, fetchImpl: FetchLike = fetch): EmailAdapter {
  switch (config.EMAIL_PROVIDER) {
    case 'none':
      return new UnconfiguredEmailAdapter('Email is not configured (EMAIL_PROVIDER is none)');
    case 'smtp':
      return new UnconfiguredEmailAdapter('SMTP sending needs an SMTP client library, which is not installed. Use EMAIL_PROVIDER=resend.');
    case 'resend':
      if (!config.RESEND_API_KEY || !config.EMAIL_FROM) {
        return new UnconfiguredEmailAdapter('Resend needs RESEND_API_KEY and EMAIL_FROM');
      }
      return new ResendEmailAdapter(config.RESEND_API_KEY, config.EMAIL_FROM, fetchImpl);
  }
}
