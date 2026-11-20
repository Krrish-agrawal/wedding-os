import type { Config } from '../../config.js';
import { field, requestJson, short } from './http.js';
import type { FetchLike, SendOutcome, SlackAdapter, SlackMessage } from './types.js';

const SLACK_API_BASE = 'https://slack.com/api';
/** Shown as the recipient when only a webhook is set up and no channel name is given. */
const WEBHOOK_DESTINATION = 'Slack webhook';

/** Slack's JSON body for chat.postMessage and incoming webhooks. Links are not unfurled: the cards carry their own. */
function messageBody(message: SlackMessage, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    text: message.text,
    ...(message.blocks?.length ? { blocks: message.blocks } : {}),
    unfurl_links: false,
    unfurl_media: false,
    ...extra,
  });
}

/**
 * Slack Web API with a bot token (scope chat:write, bot invited to the channel).
 * Slack answers HTTP 200 with `{ ok: false, error }` when it refuses a message, so the body
 * decides the outcome, not the status code. The message ts is the provider id: later posts
 * for the same lead pass it back as `threadTs` to reply in its thread.
 */
export class SlackBotAdapter implements SlackAdapter {
  readonly provider = 'Slack';

  constructor(
    private readonly token: string,
    private readonly channelId: string,
    readonly destination: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private headers() {
    return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json; charset=utf-8' };
  }

  async send(message: SlackMessage): Promise<SendOutcome> {
    const thread = message.threadTs ? { thread_ts: message.threadTs, ...(message.broadcast ? { reply_broadcast: true } : {}) } : {};
    const res = await requestJson(this.fetchImpl, `${SLACK_API_BASE}/chat.postMessage`, {
      method: 'POST',
      headers: this.headers(),
      body: messageBody(message, { channel: this.channelId, ...thread }),
    });
    if (!res.ok) return { status: 'failed', detail: `Slack did not accept the message (${res.reason})` };
    const body = res.json as { ok?: unknown } | null;
    if (body?.ok !== true) {
      return { status: 'failed', detail: `Slack refused the message (${short(field(res.json, 'error') ?? 'no reason given')})` };
    }
    const ts = field(res.json, 'ts');
    const url = ts ? await this.permalink(field(res.json, 'channel') ?? this.channelId, ts) : null;
    const where = message.threadTs ? `in the thread on ${this.destination}` : `to ${this.destination}`;
    return { status: 'sent', providerId: ts, detail: `Posted ${where}${ts ? ` (${ts})` : ''}`, url };
  }

  /** Link to the posted message, for the Desk. Best effort: a missing link never fails the send. */
  private async permalink(channel: string, ts: string): Promise<string | null> {
    const query = new URLSearchParams({ channel, message_ts: ts });
    const res = await requestJson(this.fetchImpl, `${SLACK_API_BASE}/chat.getPermalink?${query.toString()}`, { method: 'GET', headers: this.headers() });
    if (!res.ok || (res.json as { ok?: unknown } | null)?.ok !== true) return null;
    return field(res.json, 'permalink');
  }
}

/**
 * Slack incoming webhook: one fixed channel and no threads (Slack returns no ts), so
 * `threadTs` is ignored and every post stands alone. Slack answers "ok" as plain text.
 */
export class SlackWebhookAdapter implements SlackAdapter {
  readonly provider = 'Slack webhook';

  constructor(
    private readonly webhookUrl: string,
    readonly destination: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(message: SlackMessage): Promise<SendOutcome> {
    const res = await requestJson(this.fetchImpl, this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: messageBody(message),
    });
    if (!res.ok) return { status: 'failed', detail: `Slack did not accept the message (${res.reason})` };
    return { status: 'sent', providerId: null, detail: `Posted to ${this.destination} through the webhook` };
  }
}

/** Stands in for Slack when it is not set up, so the Outbox says so instead of pretending. */
export class UnconfiguredSlackAdapter implements SlackAdapter {
  readonly provider = 'none';
  readonly destination = 'Slack';
  constructor(private readonly reason: string) {}
  async send(): Promise<SendOutcome> {
    return { status: 'not_configured', detail: this.reason };
  }
}

/** Bot token first (threads, message links); the webhook is the fallback without threads. */
export function createSlackAdapter(config: Config, fetchImpl: FetchLike = fetch): SlackAdapter {
  if (config.SLACK_BOT_TOKEN && config.SLACK_CHANNEL_ID) {
    return new SlackBotAdapter(config.SLACK_BOT_TOKEN, config.SLACK_CHANNEL_ID, config.SLACK_CHANNEL_NAME ?? config.SLACK_CHANNEL_ID, fetchImpl);
  }
  if (config.SLACK_WEBHOOK_URL) {
    return new SlackWebhookAdapter(config.SLACK_WEBHOOK_URL, config.SLACK_CHANNEL_NAME ?? WEBHOOK_DESTINATION, fetchImpl);
  }
  return new UnconfiguredSlackAdapter('Slack needs SLACK_BOT_TOKEN and SLACK_CHANNEL_ID, or SLACK_WEBHOOK_URL');
}
