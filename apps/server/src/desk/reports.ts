import { randomUUID } from 'node:crypto';
import {
  REPORT_CHANNELS,
  REPORT_REQUEST_NOTE_KIND,
  type Delivery,
  type DeliveryPurpose,
  type RecapSummary,
  type ReportChannel,
  type SessionState,
} from '@ave/shared';
import type { AppContext } from '../context.js';
import type { SendOutcome } from './adapters/types.js';
import { toE164 } from './adapters/whatsapp.js';
import { buildRecapFacts, factsHash, type RecapFacts } from './facts.js';
import { buildVisitIcs, ICS_CONTENT_TYPE, ICS_FILENAME } from './ics.js';
import { consultNotesText } from './notesText.js';
import { renderRecap, type RenderedRecap } from './render.js';
import { deskFor, type DeskRuntime } from './runtime.js';

const UNEXPECTED_FAILURE = 'Unexpected error while sending; see server logs';

export interface BuiltReport {
  facts: RecapFacts;
  summary: RecapSummary | null;
  rendered: RenderedRecap;
}

/** The recap as it stands now, without calling any model or provider (for previews). */
export function previewReport(desk: DeskRuntime, state: SessionState): BuiltReport {
  const facts = factsFor(desk, state);
  const summary = desk.leads.getReport(state.id).summary;
  return { facts, summary, rendered: renderRecap(facts, summary) };
}

/** Recap facts for a session, with this app's advisor name and links. Also used by the automations. */
export function factsFor(desk: DeskRuntime, state: SessionState): RecapFacts {
  const { config, content } = desk.ctx;
  return buildRecapFacts(state, content, desk.leads.get(state.id)?.extras, { advisorName: config.ADVISOR_NAME, appUrl: config.WEB_ORIGIN });
}

/**
 * Builds the recap for a session and sends it on the given channels. Every attempt is recorded
 * with `upsert_delivery` (queued, then sent, failed or not_configured) and kept in the Outbox
 * with a preview. Resolves with the final deliveries; never rejects.
 *
 * Called by the `send_report` tool, the Lead Desk resend button, and automatically when a call
 * ends (see `maybeAutoSendReport`).
 */
export async function sendReport(ctx: AppContext, sessionId: string, channels: ('email' | 'whatsapp')[]): Promise<Delivery[]> {
  const desk = deskFor(ctx);
  return desk.enqueue(sessionId, () => runReport(desk, sessionId, channels));
}

async function runReport(desk: DeskRuntime, sessionId: string, requested: ReportChannel[]): Promise<Delivery[]> {
  const channels = REPORT_CHANNELS.filter((c) => requested.includes(c));
  const state = desk.getState(sessionId);
  if (!state || channels.length === 0) {
    desk.log.warn({ sessionId, channels: requested }, state ? 'report requested with no channels' : 'report requested for an unknown session');
    return [];
  }

  /** Latest known state of each delivery in this run, so a crash cannot leave one "queued". */
  const latest = new Map<string, Delivery>();
  try {
    const facts = factsFor(desk, state);
    const summary = await freshSummary(desk, state, facts);
    const rendered = renderRecap(facts, summary);
    const attachments = facts.visit
      ? [{ filename: ICS_FILENAME, contentType: ICS_CONTENT_TYPE, content: buildVisitIcs({ sessionId, visit: facts.visit, description: facts.nextStep, now: new Date(desk.deps.now()) }) }]
      : [];

    const results = await Promise.all(
      channels.map(async (channel) => {
        const to = channel === 'email' ? state.buyer.email : toE164(state.buyer.phone) ?? state.buyer.phone;
        const queued = record(desk, state, { id: deliveryId(), channel, to, status: 'queued', detail: null, at: desk.deps.now() }, preview(channel, rendered));
        latest.set(queued.id, queued);
        let outcome: SendOutcome;
        if (channel === 'email') {
          outcome = await desk.deps.email.send({ to, subject: rendered.subject, html: rendered.html, text: rendered.text, attachments, idempotencyKey: queued.id });
        } else if (!toE164(state.buyer.phone)) {
          outcome = { status: 'failed', detail: `"${state.buyer.phone}" is not a phone number WhatsApp can reach` };
        } else {
          outcome = await desk.deps.whatsapp.send({ to, body: rendered.whatsapp });
        }
        const done = finish(desk, state, queued, outcome);
        latest.set(done.id, done);
        return done;
      }),
    );

    desk.leads.saveReport({ sessionId, factsHash: factsHash(facts), sentAt: desk.deps.now() });
    desk.log.info({ sessionId, deliveries: results.map((d) => `${d.channel}:${d.status}`) }, 'recap delivery attempted');
    if (desk.deps.crm) void desk.enqueue(sessionId, () => syncCrm(desk, sessionId, { note: recapCrmNote(desk, sessionId, facts, rendered) }));
    return results;
  } catch (err) {
    desk.log.error({ sessionId, err: (err as Error).message }, 'recap delivery failed unexpectedly');
    return [...latest.values()].map((d) => (d.status === 'queued' ? finish(desk, state, d, { status: 'failed', detail: UNEXPECTED_FAILURE }) : d));
  }
}

/** Writes a new AI summary when the transcript allows; otherwise keeps the last good one. */
async function freshSummary(desk: DeskRuntime, state: SessionState, facts: RecapFacts): Promise<RecapSummary | null> {
  const stored = desk.leads.getReport(state.id);
  if (!desk.deps.summarize) return stored.summary;
  const summary = await desk.deps.summarize({ facts, transcript: state.transcript });
  if (!summary) return stored.summary;
  desk.leads.saveReport({ sessionId: state.id, summary, summaryAt: desk.deps.now() });
  return summary;
}

function deliveryId(): string {
  return `dlv_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function preview(channel: Delivery['channel'], r: RenderedRecap): { subject: string | null; text: string | null; html: string | null } {
  return channel === 'email' ? { subject: r.subject, text: r.text, html: r.html } : { subject: null, text: r.whatsapp, html: null };
}

/** Records a delivery in session state (so every screen sees it) and in the Outbox. */
function record(desk: DeskRuntime, state: SessionState, delivery: Delivery, body: { subject: string | null; text: string | null; html: string | null }): Delivery {
  desk.apply(state.id, { type: 'upsert_delivery', delivery }, 'system');
  desk.leads.upsertOutbox({ delivery, sessionId: state.id, buyerName: state.buyer.name, ...body });
  return delivery;
}

function finish(desk: DeskRuntime, state: SessionState, queued: Delivery, outcome: SendOutcome): Delivery {
  const done: Delivery = {
    ...queued,
    status: outcome.status,
    detail: outcome.detail,
    at: desk.deps.now(),
    ...(outcome.status === 'sent' && outcome.providerId ? { ref: outcome.providerId } : {}),
  };
  return record(desk, state, done, { subject: null, text: null, html: null });
}

/** The HubSpot note after a recap: the recap itself, then the human advisor's consult notes (internal). */
function recapCrmNote(desk: DeskRuntime, sessionId: string, facts: RecapFacts, rendered: RenderedRecap): string {
  const notes = desk.getState(sessionId)?.consult.notes ?? null;
  const consult = notes ? consultNotesText(notes) : null;
  return [`Recap sent after a call with ${facts.advisorName}.`, '', rendered.text, ...(consult ? ['', 'CONSULT NOTES (internal)', consult] : [])].join('\n');
}

export interface CrmSyncOptions {
  /** Plain-text note attached to the contact and deal. */
  note: string;
  /** Fixed delivery id (idempotency key for the automatic pipeline). */
  id?: string;
  purpose?: DeliveryPurpose;
  label?: string;
}

/**
 * Mirrors the lead into HubSpot (contact, deal at the stage the call reached, and a note).
 * Recorded as a `crm` delivery. Runs inside the session's queue; never rejects.
 */
export async function syncCrm(desk: DeskRuntime, sessionId: string, opts: CrmSyncOptions): Promise<Delivery | null> {
  const crm = desk.deps.crm;
  const state = desk.getState(sessionId);
  if (!crm || !state) return null;
  const facts = factsFor(desk, state);
  const { note } = opts;
  const queued = record(
    desk,
    state,
    {
      id: opts.id ?? deliveryId(),
      channel: 'crm',
      to: state.buyer.email,
      status: 'queued',
      detail: `Syncing to ${crm.provider}`,
      at: desk.deps.now(),
      ...(opts.purpose ? { purpose: opts.purpose } : {}),
      ...(opts.label ? { label: opts.label } : {}),
    },
    { subject: `${crm.provider} note`, text: note, html: null },
  );
  try {
    const [firstName = state.buyer.name, ...rest] = state.buyer.name.trim().split(/\s+/);
    const sale = facts.properties.find((p) => p.price !== null);
    const outcome = await crm.syncLead({
      email: state.buyer.email,
      firstName,
      lastName: rest.join(' '),
      phone: toE164(state.buyer.phone) ?? state.buyer.phone,
      dealName: facts.properties.length ? `${state.buyer.name}: ${facts.properties.map((p) => p.name).join(' and ')}` : state.buyer.name,
      amount: sale?.price ?? null,
      visitBooked: facts.visit !== null,
      note,
      dealId: desk.leads.getReport(sessionId).crmDealId,
    });
    if (outcome.status === 'sent') desk.leads.saveReport({ sessionId, crmDealId: outcome.dealId });
    return finish(desk, state, queued, outcome.status === 'sent' ? { status: 'sent', providerId: outcome.dealId, detail: outcome.detail } : outcome);
  } catch (err) {
    desk.log.error({ sessionId, err: (err as Error).message }, 'CRM sync failed unexpectedly');
    return finish(desk, state, queued, { status: 'failed', detail: UNEXPECTED_FAILURE });
  }
}

/* ------------------------------------------------------------------ */
/* Automatic send when a call ends                                     */
/* ------------------------------------------------------------------ */

/** Recaps carry no purpose (recorded before purposes existed) or the `recap` purpose. */
export function isRecapDelivery(d: Delivery): boolean {
  return d.purpose === undefined || d.purpose === 'recap';
}

/**
 * Channels the buyer agreed to, or null if they did not. Agreement is either an earlier recap
 * sent on their yes (the `send_report` tool), or a `report_requested` timeline note.
 */
export function consentedChannels(state: SessionState): ReportChannel[] | null {
  // Only recaps count: a visit confirmation or a call-back message is not consent to a recap.
  const earlier = REPORT_CHANNELS.filter((c) => state.deliveries.some((d) => d.channel === c && isRecapDelivery(d)));
  if (earlier.length) return earlier;
  if (state.timeline.some((e) => e.kind === REPORT_REQUEST_NOTE_KIND)) return [...REPORT_CHANNELS];
  return null;
}

/**
 * Sends the final recap once when a call ends, if the buyer agreed to receive it and the recap
 * now says something the last one did not. Returns the deliveries, or null when nothing was sent.
 */
export async function maybeAutoSendReport(desk: DeskRuntime, sessionId: string): Promise<Delivery[] | null> {
  const state = desk.getState(sessionId);
  if (!state || state.status !== 'ended') return null;
  const report = desk.leads.getReport(sessionId);
  if (report.autoSentAt !== null) return null;
  const channels = consentedChannels(state);
  // Mark first so a second "ended" event can never send twice.
  desk.leads.saveReport({ sessionId, autoSentAt: desk.deps.now() });
  if (!channels) return null;
  return desk.enqueue(sessionId, async () => {
    const latest = desk.getState(sessionId);
    if (!latest) return null;
    if (desk.leads.getReport(sessionId).factsHash === factsHash(factsFor(desk, latest))) {
      desk.log.info({ sessionId }, 'call ended; the recap the buyer already has is up to date');
      return null;
    }
    return runReport(desk, sessionId, channels);
  });
}
