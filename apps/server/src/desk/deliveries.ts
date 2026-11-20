import { randomUUID } from 'node:crypto';
import type { Delivery, DeliveryPurpose, OutboundDraft, SessionState } from '@ave/shared';
import type { SendOutcome, SlackBlock } from './adapters/types.js';
import { toE164 } from './adapters/whatsapp.js';
import type { DeskRuntime } from './runtime.js';

const UNEXPECTED_FAILURE = 'Unexpected error while sending; see server logs';
const MS_PER_DAY = 86_400_000;
/** IST is UTC+5:30 all year; Jira due dates are calendar dates in IST. */
const IST_OFFSET_MS = 330 * 60_000;
const JIRA_SUMMARY_MAX = 200;

export interface DeliveryBody {
  subject: string | null;
  text: string | null;
  html: string | null;
}

export function newDeliveryId(prefix = 'dlv'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/** Records a delivery in session state (so every screen sees it) and in the Outbox. */
export function recordDelivery(desk: DeskRuntime, state: SessionState, delivery: Delivery, body: DeliveryBody): Delivery {
  desk.apply(state.id, { type: 'upsert_delivery', delivery }, 'system');
  desk.leads.upsertOutbox({ delivery, sessionId: state.id, buyerName: state.buyer.name, ...body });
  return delivery;
}

/** Moves a queued delivery to its final status, keeping provider references. */
export function finishDelivery(desk: DeskRuntime, state: SessionState, queued: Delivery, outcome: SendOutcome): Delivery {
  const done: Delivery = {
    ...queued,
    status: outcome.status,
    detail: outcome.detail,
    at: desk.deps.now(),
    ...(outcome.status === 'sent' ? { ref: outcome.providerId ?? queued.ref ?? null, url: outcome.url ?? queued.url ?? null } : {}),
  };
  return recordDelivery(desk, state, done, { subject: null, text: null, html: null });
}

/** The ts of the lead's first Slack message, so later posts reply in its thread. */
export function slackThreadTs(state: SessionState): string | null {
  const first = [...state.deliveries].sort((a, b) => a.at - b.at).find((d) => d.channel === 'slack' && d.status === 'sent' && d.ref);
  return first?.ref ?? null;
}

/** YYYY-MM-DD in IST, `days` after `now`. */
export function istDateAfterDays(now: number, days: number): string {
  return new Date(now + IST_OFFSET_MS + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Who a draft goes to, as shown to the admin before sending. */
export function outboundRecipient(desk: DeskRuntime, state: SessionState, channel: OutboundDraft['channel']): string {
  switch (channel) {
    case 'whatsapp':
      return toE164(state.buyer.phone) ?? state.buyer.phone;
    case 'email':
      return state.buyer.email;
    case 'slack':
      return desk.deps.slack.destination;
    case 'jira':
      return desk.deps.jira.destination;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain text as simple HTML paragraphs, for hand-written emails. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).split('\n').join('<br>')}</p>`)
    .join('\n');
}

export interface SendOptions {
  /** Short title for the activity feed. */
  label?: string | null;
  /** Fixed delivery id, used as an idempotency key by the automatic pipeline. */
  id?: string;
}

/**
 * Sends one draft through its channel and records it (queued, then sent, failed or not_configured).
 * The single way the Desk sends something by hand; the automatic pipeline uses it too. Never rejects.
 */
export async function sendOutboundDraft(desk: DeskRuntime, sessionId: string, draft: OutboundDraft, opts: SendOptions = {}): Promise<Delivery | null> {
  const state = desk.getState(sessionId);
  if (!state) return null;
  const to = outboundRecipient(desk, state, draft.channel);
  const purpose: DeliveryPurpose = draft.purpose;
  const subject = draft.subject?.trim() || null;
  const html = draft.channel === 'email' ? textToHtml(draft.text) : null;
  const queued = recordDelivery(
    desk,
    state,
    { id: opts.id ?? newDeliveryId(), channel: draft.channel, to, status: 'queued', detail: null, at: desk.deps.now(), purpose, label: opts.label ?? null, ref: null, url: null },
    { subject, text: draft.text, html },
  );
  let outcome: SendOutcome;
  try {
    outcome = await sendDraft(desk, state, draft, to, subject);
  } catch (err) {
    desk.log.error({ sessionId, channel: draft.channel, err: (err as Error).message }, 'outbound send failed unexpectedly');
    outcome = { status: 'failed', detail: UNEXPECTED_FAILURE };
  }
  const latest = desk.getState(sessionId) ?? state;
  return finishDelivery(desk, latest, queued, outcome);
}

async function sendDraft(desk: DeskRuntime, state: SessionState, draft: OutboundDraft, to: string, subject: string | null): Promise<SendOutcome> {
  const { deps } = desk;
  switch (draft.channel) {
    case 'whatsapp':
      if (!toE164(state.buyer.phone)) return { status: 'failed', detail: `"${state.buyer.phone}" is not a phone number WhatsApp can reach` };
      return deps.whatsapp.send({ to, body: draft.text, mediaUrl: draft.mediaUrl });
    case 'email':
      return deps.email.send({
        to,
        subject: subject ?? `A note from ${desk.ctx.config.ADVISOR_NAME} at Agora Virtual Estates`,
        html: textToHtml(draft.text),
        text: draft.text,
        attachments: [],
        idempotencyKey: newDeliveryId('mail'),
      });
    case 'slack':
      return deps.slack.send({ text: draft.text, threadTs: slackThreadTs(desk.getState(state.id) ?? state) });
    case 'jira': {
      const summary = (subject ?? draft.text.split('\n')[0] ?? '').slice(0, JIRA_SUMMARY_MAX);
      const leadLink = `${desk.ctx.config.WEB_ORIGIN}/desk?lead=${state.id}`;
      return deps.jira.createIssue({
        summary,
        description: `${draft.text}\n\nBuyer: ${state.buyer.name}\nLead: ${leadLink}`,
        dueDate: draft.dueInDays !== null ? istDateAfterDays(deps.now(), draft.dueInDays) : null,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Tracked sends for the automatic pipeline (rich Slack, attachments)  */
/* ------------------------------------------------------------------ */

export interface TrackedSend {
  channel: Delivery['channel'];
  /** Recipient as shown on the Desk. */
  to: string;
  purpose: DeliveryPurpose;
  label?: string | null;
  /** Fixed delivery id (idempotency key); random when omitted. */
  id?: string;
  /** What the Outbox shows as the preview. */
  preview: DeliveryBody;
}

/**
 * Records a queued delivery, runs `send` and records its outcome, like `sendOutboundDraft` but
 * for messages a draft cannot describe (Slack blocks, email attachments). Never rejects.
 */
export async function sendTracked(desk: DeskRuntime, sessionId: string, spec: TrackedSend, send: (state: SessionState) => Promise<SendOutcome>): Promise<Delivery | null> {
  const state = desk.getState(sessionId);
  if (!state) return null;
  const queued = recordDelivery(
    desk,
    state,
    { id: spec.id ?? newDeliveryId(), channel: spec.channel, to: spec.to, status: 'queued', detail: null, at: desk.deps.now(), purpose: spec.purpose, label: spec.label ?? null, ref: null, url: null },
    spec.preview,
  );
  let outcome: SendOutcome;
  try {
    outcome = await send(state);
  } catch (err) {
    desk.log.error({ sessionId, channel: spec.channel, err: (err as Error).message }, 'tracked send failed unexpectedly');
    outcome = { status: 'failed', detail: UNEXPECTED_FAILURE };
  }
  return finishDelivery(desk, desk.getState(sessionId) ?? state, queued, outcome);
}

export interface SlackPost {
  text: string;
  blocks?: SlackBlock[];
  /** Show the thread reply in the channel too. */
  broadcast?: boolean;
}

/**
 * Posts to the lead's Slack thread: the first Slack message for a lead becomes the thread root
 * and every later one replies under it (Slack returns no ts for webhooks, so those stand alone).
 */
export function sendSlackPost(desk: DeskRuntime, sessionId: string, post: SlackPost, opts: { purpose: DeliveryPurpose; label: string; id?: string }): Promise<Delivery | null> {
  return sendTracked(
    desk,
    sessionId,
    { channel: 'slack', to: desk.deps.slack.destination, purpose: opts.purpose, label: opts.label, id: opts.id, preview: { subject: null, text: post.text, html: null } },
    async (state) => {
      const threadTs = slackThreadTs(desk.getState(state.id) ?? state);
      return desk.deps.slack.send({ text: post.text, blocks: post.blocks, threadTs, broadcast: Boolean(threadTs && post.broadcast) });
    },
  );
}
