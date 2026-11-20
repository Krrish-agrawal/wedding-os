import { z } from 'zod';
import type { EmiInputs, ViewId } from './views.js';
import type { Buyer, Delivery, LeadFields, SessionState, TimelineEvent, TranscriptLine } from './session.js';
import type { LeadStage, ScoreReason } from './scoring.js';

/**
 * Lead Desk contracts: the REST payloads of /api/leads and /api/outbox, the AI recap summary,
 * and the timeline note that records a buyer's request for the recap.
 */

/**
 * Timeline note kind meaning the buyer asked for (or agreed to) the recap.
 * Dispatch `{ type: 'note', kind: REPORT_REQUEST_NOTE_KIND, label }` and the Desk sends the
 * recap once when the call ends.
 */
export const REPORT_REQUEST_NOTE_KIND = 'report_requested';

export const REPORT_CHANNELS = ['email', 'whatsapp'] as const;
export type ReportChannel = (typeof REPORT_CHANNELS)[number];

/** AI-written part of the recap. Validated on the server; facts never come from here. */
export const RecapSummarySchema = z.object({
  /** One line, e.g. what the buyer focused on. */
  headline: z.string(),
  /** Two to four short sentences in the second person. */
  summary: z.string(),
  /** What matters most to the buyer, in their own terms. */
  priorities: z.array(z.string()),
  /** Questions the buyer still has open. */
  openQuestions: z.array(z.string()),
});
export type RecapSummary = z.infer<typeof RecapSummarySchema>;

export interface LeadSummary {
  id: string;
  buyer: Buyer;
  createdAt: number;
  lastActivityAt: number;
  callStatus: SessionState['status'];
  /** The call is running on the server right now. */
  live: boolean;
  /** What the buyer is looking for, as recorded on the call. */
  need: string | null;
  budget: string | null;
  stage: LeadStage;
  stageLabel: string;
  score: number;
  tier: string;
  /** 0 for the lowest tier, tierCount - 1 for the highest. */
  tierRank: number;
  tierCount: number;
  propertyIds: string[];
  handoff: SessionState['handoff']['status'];
  /** Why the buyer or the AI asked for a human, if they did. */
  handoffReason: string | null;
  agentStatus: SessionState['agent']['status'];
}

export interface LeadViewTime {
  view: ViewId;
  seconds: number;
}

export interface LeadPropertyVisit {
  propertyId: string;
  propertyName: string;
  seconds: number;
  views: LeadViewTime[];
}

export interface LeadOffer {
  propertyId: string;
  propertyName: string;
  offerId: string;
  title: string;
  description: string;
  applied: boolean;
  /** Rupees saved when applied, computed from the price breakup. Null for lease properties. */
  saving: number | null;
}

export interface LeadEmi {
  propertyId: string;
  propertyName: string;
  inputs: EmiInputs;
  price: number;
  loanAmount: number;
  monthlyEmi: number;
}

export interface LeadBooking {
  propertyId: string;
  propertyName: string;
  slotId: string;
  start: string | null;
  end: string | null;
  address: string;
}

export interface LeadDetail extends LeadSummary {
  lead: LeadFields;
  reasons: ScoreReason[];
  visits: LeadPropertyVisit[];
  offers: LeadOffer[];
  emi: LeadEmi[];
  booking: LeadBooking | null;
  handoffDetail: SessionState['handoff'];
  timeline: TimelineEvent[];
  transcript: TranscriptLine[];
  deliveries: Delivery[];
  aiSummary: RecapSummary | null;
  aiSummaryAt: number | null;
  /** The recap email as it would be sent now. */
  reportHtml: string;
  reportSubject: string;
  reportWhatsApp: string;
}

export interface OutboxItem {
  id: string;
  sessionId: string;
  buyerName: string;
  channel: Delivery['channel'];
  to: string;
  status: Delivery['status'];
  detail: string | null;
  at: number;
  subject: string | null;
  text: string | null;
  html: string | null;
  purpose?: Delivery['purpose'];
  label?: string | null;
  ref?: string | null;
  url?: string | null;
}

/** Time zone for every date and time shown to buyers and advisors (properties are in Bengaluru). */
export const DISPLAY_TIME_ZONE = 'Asia/Kolkata';
const DISPLAY_LOCALE = 'en-IN';

const dateFmt = new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone: DISPLAY_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone: DISPLAY_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true });
const dateTimeFmt = new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone: DISPLAY_TIME_ZONE, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

/** "Sat, 22 Nov 2026" in India time. */
export function formatDateIST(date: Date | number | string): string {
  const parts = Object.fromEntries(dateFmt.formatToParts(new Date(date)).map((p) => [p.type, p.value]));
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}`;
}

/** "10:00 am" in India time. */
export function formatTimeIST(date: Date | number | string): string {
  return timeFmt.format(new Date(date));
}

/** "22 Nov, 10:00 am" in India time. */
export function formatDateTimeIST(date: Date | number | string): string {
  return dateTimeFmt.format(new Date(date));
}

/** "Sat, 22 Nov 2026" and "10:00 am to 11:00 am" for a site-visit slot. */
export function formatSlot(start: string, end: string): { date: string; time: string } {
  return { date: formatDateIST(start), time: `${formatTimeIST(start)} to ${formatTimeIST(end)}` };
}

/** "4:05" or "1:02:09" for a call length. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "45 s", "3 min", "1 h 5 min" for time spent on something. */
export function formatSpan(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
