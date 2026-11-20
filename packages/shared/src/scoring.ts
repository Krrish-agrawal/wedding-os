import type { Scoring } from './data.js';
import type { SessionState, TimelineEvent } from './session.js';
import type { ViewId } from './views.js';

/**
 * Lead scoring and call analytics derived from session state. Pure functions: the caller
 * passes `now`, which is the end of the last open stretch for a call that is still live.
 * For a call that is no longer running, pass its last activity time instead.
 */

/** Timeline labels written by the reducer for `set_status` (`Call ${status}`). */
const STATUS_LABEL_LIVE = 'Call live';
const STATUS_LABEL_ENDED = 'Call ended';
/** Every call opens on this view (see `createSessionState`). */
const INITIAL_VIEW: ViewId = 'shortlist';

export interface ScoreReason {
  label: string;
  points: number;
}

export interface LeadScore {
  score: number;
  tier: string;
  reasons: ScoreReason[];
}

/** One uninterrupted stretch of the call on a single view of a single property. */
export interface ViewSegment {
  view: ViewId;
  propertyId: string | null;
  start: number;
  end: number;
}

/**
 * Splits the call into stretches using consecutive `view` timeline events. A property switch
 * starts a new stretch on the same view; the call ending closes the last one. The opening view
 * counts from the moment the call went live.
 */
export function viewSegments(state: SessionState, now: number): ViewSegment[] {
  const events = [...state.timeline].sort((a, b) => a.at - b.at);
  const segments: ViewSegment[] = [];
  let open: Omit<ViewSegment, 'end'> | null = null;
  let view: ViewId = INITIAL_VIEW;
  let propertyId: string | null = null;

  const close = (at: number) => {
    if (open) segments.push({ ...open, end: Math.max(open.start, at) });
    open = null;
  };

  for (const e of events) {
    if (e.kind === 'view' && e.view) {
      close(e.at);
      view = e.view;
      propertyId = e.propertyId;
      open = { view, propertyId, start: e.at };
    } else if (e.kind === 'property') {
      propertyId = e.propertyId;
      if (open) {
        close(e.at);
        open = { view, propertyId, start: e.at };
      }
    } else if (e.kind === 'status' && e.label === STATUS_LABEL_LIVE) {
      if (!open) open = { view, propertyId, start: e.at };
    } else if (e.kind === 'status' && e.label === STATUS_LABEL_ENDED) {
      close(e.at);
      return segments;
    }
  }
  close(now);
  return segments;
}

/** When the call went live (the latest time, if it went live more than once), or null. */
export function callLiveSince(state: SessionState): number | null {
  for (let i = state.timeline.length - 1; i >= 0; i--) {
    const e = state.timeline[i];
    if (e && e.kind === 'status' && e.label === STATUS_LABEL_LIVE) return e.at;
  }
  return null;
}

/** Milliseconds spent on each view, across properties. */
export function timeOnViews(segments: ViewSegment[]): Partial<Record<ViewId, number>> {
  const out: Partial<Record<ViewId, number>> = {};
  for (const s of segments) out[s.view] = (out[s.view] ?? 0) + (s.end - s.start);
  return out;
}

/** Property ids the buyer opened during the call, in the order first opened. */
export function propertiesViewed(state: SessionState): string[] {
  const ids: string[] = [];
  const add = (id: string | null) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  for (const e of state.timeline) if (e.kind === 'property' || e.kind === 'view') add(e.propertyId);
  add(state.propertyId);
  return ids;
}

type Rule = Scoring['rules'][number];

interface ScoringInputs {
  state: SessionState;
  viewsSeen: Set<ViewId | string>;
  msByView: Partial<Record<string, number>>;
  properties: string[];
}

function ruleMatches(when: Rule['when'], x: ScoringInputs): boolean {
  switch (when.type) {
    case 'view_seen':
      return x.viewsSeen.has(when.view);
    case 'time_on_view':
      return (x.msByView[when.view] ?? 0) >= when.seconds * 1000;
    case 'offer_applied':
      return Object.values(x.state.appliedOffers).some((ids) => ids.length > 0);
    case 'visit_booked':
      return x.state.booking.status === 'confirmed';
    case 'lead_field': {
      if (when.field === 'needs') return x.state.lead.needs.length > 0;
      const v = x.state.lead[when.field];
      return typeof v === 'string' && v.trim().length > 0;
    }
    case 'handoff_requested':
      return x.state.handoff.status !== 'none' || x.state.timeline.some((e) => e.kind === 'handoff_requested');
    case 'properties_viewed':
      return x.properties.length >= when.count;
  }
}

/** Picks the highest tier whose minimum the score reaches; falls back to the lowest tier. */
export function tierFor(score: number, tiers: Scoring['tiers']): { label: string; rank: number } {
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  let rank = 0;
  sorted.forEach((t, i) => {
    if (score >= t.min) rank = i;
  });
  return { label: sorted[rank]?.label ?? '', rank };
}

/** Rule-based, explainable lead score. Every point comes with the reason it was given. */
export function scoreLead(state: SessionState, scoring: Scoring, now: number): LeadScore {
  const segments = viewSegments(state, now);
  const inputs: ScoringInputs = {
    state,
    viewsSeen: new Set(segments.map((s) => s.view)),
    msByView: timeOnViews(segments),
    properties: propertiesViewed(state),
  };
  const reasons = scoring.rules
    .filter((r) => ruleMatches(r.when, inputs))
    .map((r) => ({ label: r.label, points: r.points }));
  const score = Math.max(0, reasons.reduce((s, r) => s + r.points, 0));
  return { score, tier: tierFor(score, scoring.tiers).label, reasons };
}

/* ------------------------------------------------------------------ */
/* Pipeline stage                                                      */
/* ------------------------------------------------------------------ */

export const LEAD_STAGES = ['new', 'exploring', 'evaluating', 'negotiating', 'visit_booked'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New',
  exploring: 'Exploring',
  evaluating: 'Evaluating',
  negotiating: 'Negotiating',
  visit_booked: 'Visit booked',
};

/** Views that mean the buyer is weighing price and paperwork, not just looking around. */
const EVALUATION_VIEWS: ReadonlySet<ViewId> = new Set(['money', 'legal', 'booking']);

/** Where the lead stands, from what actually happened on the call. */
export function leadStage(state: SessionState): LeadStage {
  if (state.booking.status === 'confirmed') return 'visit_booked';
  const offers = Object.values(state.appliedOffers).some((ids) => ids.length > 0);
  if (offers || state.lead.objections.length > 0 || state.handoff.status !== 'none') return 'negotiating';
  const viewed = (e: TimelineEvent) => e.kind === 'view' && e.view !== null && EVALUATION_VIEWS.has(e.view);
  if (state.timeline.some(viewed)) return 'evaluating';
  if (propertiesViewed(state).length > 0) return 'exploring';
  return 'new';
}
