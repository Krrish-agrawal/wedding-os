import { z } from 'zod';
import type { DeliveryChannel, DeliveryPurpose } from './consult.js';
import { leadStage, type LeadStage } from './scoring.js';
import type { Delivery, SessionState } from './session.js';

/**
 * Pipeline board contracts: where each lead stands across the whole sale (not just one call),
 * the integration badges for what fired, the funnel, and the activity feed. Stages are derived
 * from the call record; only Won and Lost are set by hand, as timeline notes on the lead.
 */

export const PIPELINE_STAGES = ['new', 'qualified', 'visit_booked', 'consult', 'follow_up', 'won', 'lost'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  new: 'New call',
  qualified: 'Qualified',
  visit_booked: 'Visit booked',
  consult: 'Human consult',
  follow_up: 'Follow-up',
  won: 'Won',
  lost: 'Lost',
};

/** What the admin can set from a card: close as won or lost, or reopen. */
export const PIPELINE_OUTCOMES = ['won', 'lost', 'open'] as const;
export const PipelineOutcomeSchema = z.enum(PIPELINE_OUTCOMES);
export type PipelineOutcome = z.infer<typeof PipelineOutcomeSchema>;
export const PipelineOutcomeRequestSchema = z.object({ outcome: PipelineOutcomeSchema });

/**
 * Timeline note kinds that record the admin's outcome. The latest one wins, so "open" undoes an
 * earlier won or lost without rewriting history.
 */
export const PIPELINE_OUTCOME_NOTE_KINDS: Record<PipelineOutcome, string> = {
  won: 'pipeline_won',
  lost: 'pipeline_lost',
  open: 'pipeline_reopened',
};

export const PIPELINE_OUTCOME_NOTE_LABELS: Record<PipelineOutcome, string> = {
  won: 'Marked as won',
  lost: 'Marked as lost',
  open: 'Reopened in the pipeline',
};

const OUTCOME_BY_KIND = new Map(Object.entries(PIPELINE_OUTCOME_NOTE_KINDS).map(([outcome, kind]) => [kind, outcome as PipelineOutcome]));

/** Won or lost, from the latest outcome note; null while the deal is open. */
export function pipelineOutcome(state: Pick<SessionState, 'timeline'>): 'won' | 'lost' | null {
  for (let i = state.timeline.length - 1; i >= 0; i--) {
    const outcome = OUTCOME_BY_KIND.get(state.timeline[i]!.kind);
    if (outcome) return outcome === 'open' ? null : outcome;
  }
  return null;
}

/** Call stages that mean the buyer is weighing a property seriously. */
const QUALIFIED_LEAD_STAGES: ReadonlySet<LeadStage> = new Set(['evaluating', 'negotiating', 'visit_booked']);

/** The buyer is a real prospect: they weighed price or paperwork, or told us what they want and can spend. */
export function isQualified(state: SessionState): boolean {
  if (QUALIFIED_LEAD_STAGES.has(leadStage(state))) return true;
  return Boolean(state.lead.purpose?.trim() && state.lead.budget?.trim());
}

/**
 * Where the lead sits on the board. A finished call with a real prospect needs follow-up;
 * a live one moves right as it reaches a booking and then a human consult.
 */
export function pipelineStage(state: SessionState, live: boolean): PipelineStage {
  const outcome = pipelineOutcome(state);
  if (outcome) return outcome;
  const qualified = isQualified(state);
  if (!live && qualified) return 'follow_up';
  if (state.handoff.status !== 'none') return 'consult';
  if (state.booking.status === 'confirmed') return 'visit_booked';
  if (qualified) return 'qualified';
  return 'new';
}

/** Funnel steps across the top of the board, in order. Each counts leads that ever reached it. */
export const PIPELINE_FUNNEL = ['new', 'qualified', 'visit_booked', 'consult', 'won'] as const satisfies readonly PipelineStage[];
export type PipelineFunnelStage = (typeof PIPELINE_FUNNEL)[number];

/** True when the lead got at least as far as `stage` at some point. */
export function reachedStage(state: SessionState, stage: PipelineFunnelStage): boolean {
  const outcome = pipelineOutcome(state);
  switch (stage) {
    case 'new':
      return true;
    case 'qualified':
      return isQualified(state) || state.booking.status === 'confirmed' || state.handoff.status !== 'none' || outcome === 'won';
    case 'visit_booked':
      return state.booking.status === 'confirmed';
    case 'consult':
      return state.handoff.status !== 'none';
    case 'won':
      return outcome === 'won';
  }
}

/* ------------------------------------------------------------------ */
/* REST payloads                                                        */
/* ------------------------------------------------------------------ */

/** What one integration did for a lead: the latest attempt, plus the latest provider reference. */
export interface PipelineBadge {
  channel: DeliveryChannel;
  /** Status of the latest attempt on this channel. */
  status: Delivery['status'];
  /** How many went out successfully on this channel. */
  sent: number;
  /** Provider reference of the latest successful one (Jira key, Slack ts, HubSpot deal id). */
  ref: string | null;
  url: string | null;
  /** Provider detail of the latest attempt, e.g. why it failed. */
  detail: string | null;
  at: number;
}

export interface PipelineCard {
  id: string;
  buyerName: string;
  propertyId: string | null;
  propertyName: string | null;
  stage: PipelineStage;
  live: boolean;
  score: number;
  tier: string;
  tierRank: number;
  tierCount: number;
  handoff: SessionState['handoff']['status'];
  /** Start of the booked site visit (ISO), when there is one. */
  visitStart: string | null;
  lastActivityAt: number;
  badges: PipelineBadge[];
}

export interface PipelineFunnelStep {
  stage: PipelineFunnelStage;
  label: string;
  /** Leads that ever reached this step. */
  reached: number;
  /** Share of all leads, 0 to 100, rounded. */
  pct: number;
}

/** One delivery across all leads, for the live activity feed. */
export interface ActivityItem {
  id: string;
  sessionId: string;
  buyerName: string;
  channel: DeliveryChannel;
  status: Delivery['status'];
  title: string;
  purpose: DeliveryPurpose | null;
  to: string;
  detail: string | null;
  ref: string | null;
  url: string | null;
  at: number;
}

export interface PipelineResponse {
  cards: PipelineCard[];
  funnel: PipelineFunnelStep[];
  /** Won out of everything closed, 0 to 100; null until something is closed. */
  winRate: number | null;
  activity: ActivityItem[];
}

const PURPOSE_TITLES: Record<DeliveryPurpose, string> = {
  recap: 'Call recap',
  visit_confirmed: 'Visit confirmation',
  handoff_alert: 'Handoff alert',
  handoff_timeout: 'Call-back promised',
  call_summary: 'Call summary',
  action_item: 'Action item',
  manual: 'Sent from the Desk',
  test: 'Test message',
};

const CHANNEL_TITLES: Record<DeliveryChannel, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  crm: 'HubSpot sync',
  slack: 'Slack post',
  jira: 'Jira task',
};

/** A short title for a delivery: its own label, else what it was for, else the channel. */
export function deliveryTitle(d: Pick<Delivery, 'label' | 'purpose' | 'channel'>): string {
  if (d.label?.trim()) return d.label.trim();
  if (d.channel === 'crm') return CHANNEL_TITLES.crm;
  return d.purpose ? PURPOSE_TITLES[d.purpose] : CHANNEL_TITLES[d.channel];
}
