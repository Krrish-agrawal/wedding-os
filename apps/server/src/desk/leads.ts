import {
  computeEmi,
  computeSaleTotals,
  LEAD_STAGE_LABELS,
  leadStage,
  offerValue,
  priceLineItems,
  propertiesViewed,
  scoreLead,
  tierFor,
  viewSegments,
  type LeadDetail,
  type LeadEmi,
  type LeadOffer,
  type LeadPropertyVisit,
  type LeadSummary,
  type SessionState,
} from '@ave/shared';
import type { LeadRecord } from './leadStore.js';
import { previewReport } from './reports.js';
import type { DeskRuntime } from './runtime.js';

const MS_PER_SECOND = 1000;

/** Most recent moment anything happened on the call. */
export function lastActivityAt(state: SessionState, updatedAt: number): number {
  const lastEvent = state.timeline.at(-1)?.at ?? 0;
  const lastLine = state.transcript.at(-1)?.at ?? 0;
  return Math.max(state.createdAt, updatedAt, lastEvent, lastLine);
}

interface Resolved {
  state: SessionState;
  record: LeadRecord | undefined;
  live: boolean;
  /** End of the last open view stretch: now for a running call, last activity otherwise. */
  clock: number;
  lastActivityAt: number;
}

function resolve(desk: DeskRuntime, id: string, now: number): Resolved | null {
  const record = desk.leads.get(id);
  const state = desk.ctx.store.get(id) ?? record?.state;
  if (!state) return null;
  const live = desk.isLive(id);
  const last = lastActivityAt(state, record?.updatedAt ?? state.createdAt);
  return { state, record, live, clock: live ? now : last, lastActivityAt: last };
}

function summaryOf(desk: DeskRuntime, r: Resolved): { summary: LeadSummary; reasons: ReturnType<typeof scoreLead>['reasons'] } {
  const { state } = r;
  const { scoring } = desk.ctx.content;
  const score = scoreLead(state, scoring, r.clock);
  const tier = tierFor(score.score, scoring.tiers);
  const stage = leadStage(state);
  const summary: LeadSummary = {
    id: state.id,
    buyer: state.buyer,
    createdAt: state.createdAt,
    lastActivityAt: r.lastActivityAt,
    callStatus: state.status,
    live: r.live,
    need: state.lead.purpose ?? state.lead.needs[0] ?? null,
    budget: state.lead.budget,
    stage,
    stageLabel: LEAD_STAGE_LABELS[stage],
    score: score.score,
    tier: tier.label,
    tierRank: tier.rank,
    tierCount: scoring.tiers.length,
    propertyIds: propertiesViewed(state),
    handoff: state.handoff.status,
    handoffReason: state.handoff.reason,
    agentStatus: state.agent.status,
  };
  return { summary, reasons: score.reasons };
}

/** Every lead: live calls first by recency of activity, then past calls. */
export function listLeads(desk: DeskRuntime, now: number): LeadSummary[] {
  const ids = new Set([...desk.leads.list().map((r) => r.state.id), ...desk.ctx.store.list().map((s) => s.id)]);
  const out: LeadSummary[] = [];
  for (const id of ids) {
    const r = resolve(desk, id, now);
    if (r) out.push(summaryOf(desk, r).summary);
  }
  return out.sort((a, b) => Number(b.live) - Number(a.live) || b.lastActivityAt - a.lastActivityAt);
}

export function leadDetail(desk: DeskRuntime, id: string, now: number): LeadDetail | null {
  const r = resolve(desk, id, now);
  if (!r) return null;
  const { state } = r;
  const { content } = desk.ctx;
  const { summary, reasons } = summaryOf(desk, r);

  const visits: LeadPropertyVisit[] = [];
  const segments = viewSegments(state, r.clock);
  for (const propertyId of propertiesViewed(state)) {
    const bundle = content.byId[propertyId];
    const views = new Map<LeadPropertyVisit['views'][number]['view'], number>();
    // The shortlist is about every property, so it is not counted against one.
    for (const s of segments) if (s.propertyId === propertyId && s.view !== 'shortlist') views.set(s.view, (views.get(s.view) ?? 0) + (s.end - s.start));
    const list = [...views.entries()].map(([view, ms]) => ({ view, seconds: Math.round(ms / MS_PER_SECOND) }));
    visits.push({
      propertyId,
      propertyName: bundle?.property.name ?? propertyId,
      seconds: list.reduce((s, v) => s + v.seconds, 0),
      views: list,
    });
  }

  const offers: LeadOffer[] = [];
  const emi: LeadEmi[] = [];
  for (const v of visits) {
    const bundle = content.byId[v.propertyId];
    if (!bundle) continue;
    const policy = content.offers.properties[v.propertyId];
    const applied = state.appliedOffers[v.propertyId] ?? [];
    const { money, property } = bundle;
    if (money.kind === 'sale') {
      const items = priceLineItems(money, property.areas);
      const subtotal = items.reduce((s, i) => s + i.amount, 0);
      for (const o of policy?.offers ?? []) {
        offers.push({ propertyId: v.propertyId, propertyName: property.name, offerId: o.id, title: o.title, description: o.description, applied: applied.includes(o.id), saving: offerValue(o, items, subtotal) });
      }
      const inputs = r.record?.extras.emiByProperty[v.propertyId] ?? (state.propertyId === v.propertyId ? state.params.money.emi : null);
      if (inputs) {
        const price = computeSaleTotals(money, property.areas, policy?.offers ?? [], applied).total;
        const e = computeEmi(price, inputs);
        emi.push({ propertyId: v.propertyId, propertyName: property.name, inputs, price, loanAmount: e.loanAmount, monthlyEmi: e.monthlyEmi });
      }
    } else {
      for (const o of policy?.offers ?? []) {
        offers.push({ propertyId: v.propertyId, propertyName: property.name, offerId: o.id, title: o.title, description: o.description, applied: applied.includes(o.id), saving: null });
      }
    }
  }

  let booking: LeadDetail['booking'] = null;
  if (state.booking.status === 'confirmed' && state.booking.propertyId && state.booking.slotId) {
    const bundle = content.byId[state.booking.propertyId];
    const slot = bundle?.visits.find((s) => s.id === state.booking.slotId);
    booking = {
      propertyId: state.booking.propertyId,
      propertyName: bundle?.property.name ?? state.booking.propertyId,
      slotId: state.booking.slotId,
      start: slot?.start ?? null,
      end: slot?.end ?? null,
      address: bundle?.property.address ?? '',
    };
  }

  const report = desk.leads.getReport(id);
  const preview = previewReport(desk, state);
  return {
    ...summary,
    lead: state.lead,
    reasons,
    visits,
    offers,
    emi,
    booking,
    handoffDetail: state.handoff,
    timeline: state.timeline,
    transcript: state.transcript,
    deliveries: state.deliveries,
    aiSummary: report.summary,
    aiSummaryAt: report.summaryAt,
    reportHtml: preview.rendered.html,
    reportSubject: preview.rendered.subject,
    reportWhatsApp: preview.rendered.whatsapp,
  };
}
