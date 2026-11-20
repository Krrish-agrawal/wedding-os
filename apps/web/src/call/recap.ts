import { REPORT_REQUEST_NOTE_KIND, propertiesViewed, timeOnViews, viewSegments, type Delivery, type SessionState, type ViewId } from '@ave/shared';

/** Timeline labels written by the shared reducer for status changes. */
const LIVE_LABEL = 'Call live';
const ENDED_LABEL = 'Call ended';
/** How long after the call ends the summary keeps waiting for a recap to be sent. */
export const RECAP_WAIT_MS = 90_000;

/** Channels the buyer hears about. CRM sync is internal and stays on the Lead Desk. */
const BUYER_CHANNELS: ReadonlySet<Delivery['channel']> = new Set(['email', 'whatsapp']);

export interface CallWindow {
  /** When the buyer accepted, or when the session was created if it never went live. */
  start: number;
  /** When the call ended, or null while it is still going. */
  end: number | null;
  wasLive: boolean;
}

export function callWindow(state: SessionState): CallWindow {
  let live: number | null = null;
  let ended: number | null = null;
  for (const e of state.timeline) {
    if (e.kind !== 'status') continue;
    if (e.label === LIVE_LABEL && live === null) live = e.at;
    if (e.label === ENDED_LABEL) ended = e.at;
  }
  return { start: live ?? state.createdAt, end: ended, wasLive: live !== null };
}

export interface ViewTime {
  view: ViewId;
  ms: number;
}

/**
 * Time spent on each view during the call, in order of first visit. Uses the same view
 * segments as the Lead Desk (shared `viewSegments`), so both screens agree.
 */
export function viewTimes(state: SessionState, now: number): ViewTime[] {
  const { end } = callWindow(state);
  const segments = viewSegments(state, end ?? now);
  const totals = timeOnViews(segments);
  const order: ViewId[] = [];
  for (const s of segments) if (!order.includes(s.view)) order.push(s.view);
  return order.map((view) => ({ view, ms: totals[view] ?? 0 })).filter((v) => v.ms > 0);
}

/** Property ids that were open during the call, plus any booked or with offers applied, in order. */
export function propertiesDiscussed(state: SessionState): string[] {
  const ids = propertiesViewed(state);
  const add = (id: string | null) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  add(state.booking.propertyId);
  for (const [id, offers] of Object.entries(state.appliedOffers)) if (offers.length) add(id);
  return ids;
}

/**
 * Recaps only: no purpose (recorded before purposes existed) or `recap`. A visit confirmation or
 * a call-back message on WhatsApp is not the recap and must not show as "recap sent".
 */
function isRecap(d: Delivery): boolean {
  return d.purpose === undefined || d.purpose === 'recap';
}

/** The latest recap delivery per buyer-facing channel (a retry replaces an earlier failure). */
export function buyerDeliveries(state: SessionState): Delivery[] {
  const latest = new Map<string, Delivery>();
  for (const d of [...state.deliveries].sort((a, b) => a.at - b.at)) {
    if (BUYER_CHANNELS.has(d.channel) && isRecap(d)) latest.set(d.channel, d);
  }
  return [...latest.values()];
}

export const CHANNEL_LABELS: Record<Delivery['channel'], string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  crm: 'CRM',
  slack: 'Slack',
  jira: 'Jira',
};

export type DeliveryTone = 'success' | 'waiting' | 'error' | 'muted';

/** Honest words for each delivery state. Never says "sent" unless it was. */
export function deliveryWording(d: Delivery): { title: string; body: string | null; tone: DeliveryTone } {
  const channel = CHANNEL_LABELS[d.channel];
  switch (d.status) {
    case 'sent':
      return { title: `Sent to ${d.to}`, body: null, tone: 'success' };
    case 'queued':
      return { title: `Sending to ${d.to}`, body: null, tone: 'waiting' };
    case 'failed':
      return {
        title: `Couldn't send to ${d.to}`,
        body: `${d.detail ? `${d.detail.replace(/\.$/, '')}. ` : ''}Our advisors can see this and can send it again.`,
        tone: 'error',
      };
    case 'not_configured':
      return { title: 'Not sent', body: `${channel} isn't set up in this demo, so nothing went to ${d.to}.`, tone: 'muted' };
  }
}

/** True while it is still worth waiting for the recap to go out. */
export function recapPending(state: SessionState, now: number): boolean {
  const deliveries = buyerDeliveries(state);
  if (deliveries.some((d) => d.status === 'queued')) return true;
  if (deliveries.length > 0) return false;
  // Only wait when the buyer asked for a recap; otherwise none is coming and the page must say so.
  if (!state.timeline.some((e) => e.kind === REPORT_REQUEST_NOTE_KIND)) return false;
  const { end } = callWindow(state);
  return end === null || now - end < RECAP_WAIT_MS;
}

/** "40 sec", "3 min", "1 h 5 min" */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${Math.max(1, s)} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
