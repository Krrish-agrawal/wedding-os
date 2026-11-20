import { createHash } from 'node:crypto';
import {
  computeEmi,
  computeLeaseTotals,
  computeSaleTotals,
  formatDateIST,
  formatINR,
  formatINRShort,
  formatSlot,
  formatSqft,
  formatTimeIST,
  propertiesViewed,
  VIEW_LABELS,
  viewSegments,
  type Content,
  type EmiInputs,
  type SessionState,
  type ViewId,
} from '@ave/shared';
import type { LeadExtras } from './leadStore.js';
import { promisesToFollowUp } from './notesText.js';

/**
 * The factual part of the recap, computed from session state and /data only.
 * Every number here comes from the shared money functions; nothing is typed by hand or by a model.
 */

export interface RecapRow {
  label: string;
  value: string;
}

export interface RecapEmi {
  downPayment: string;
  loan: string;
  monthly: string;
  tenureYears: number;
  ratePct: number;
}

export interface RecapProperty {
  id: string;
  name: string;
  configuration: string;
  locality: string;
  kind: 'sale' | 'lease';
  /** Views the buyer opened for this property, in the order first opened. */
  viewsSeen: string[];
  rows: RecapRow[];
  /** The one number that sums the property up: price after offers, or the monthly total. */
  headline: RecapRow;
  /** Offers applied; `saving` is null where the money engine has no rupee figure (leases). */
  offers: { title: string; saving: string | null }[];
  emi: RecapEmi | null;
  estimateNote: string;
  /** Price after offers (sale) for the CRM deal amount; null for leases. */
  price: number | null;
}

export interface RecapVisit {
  propertyId: string;
  propertyName: string;
  slotId: string;
  start: string;
  end: string;
  date: string;
  time: string;
  address: string;
}

export interface RecapFacts {
  sessionId: string;
  buyer: { name: string; firstName: string; email: string; phone: string };
  advisorName: string;
  callDate: string;
  stated: { purpose: string | null; budget: string | null; timeline: string | null; needs: string[] };
  properties: RecapProperty[];
  visit: RecapVisit | null;
  /** Name of the human advisor who joined, if one did. */
  humanAdvisor: string | null;
  /** What the human advisor promised to follow up on (never the promises that still need approval). */
  followUps: string[];
  nextStep: string;
  appUrl: string;
}

/** Views that are about a specific property (the shortlist is about both). */
const PROPERTY_VIEWS: ReadonlySet<ViewId> = new Set(['tour', 'blueprint', 'locality', 'commute', 'compass', 'money', 'legal', 'booking']);

export interface FactsOptions {
  advisorName: string;
  appUrl: string;
}

export function buildRecapFacts(state: SessionState, content: Content, extras: LeadExtras | undefined, opts: FactsOptions): RecapFacts {
  const segments = viewSegments(state, state.createdAt);
  const properties: RecapProperty[] = [];

  for (const id of propertiesViewed(state)) {
    const bundle = content.byId[id];
    if (!bundle) continue;
    const { property, money } = bundle;
    const viewsSeen: string[] = [];
    for (const s of segments) {
      if (s.propertyId === id && PROPERTY_VIEWS.has(s.view) && !viewsSeen.includes(VIEW_LABELS[s.view])) viewsSeen.push(VIEW_LABELS[s.view]);
    }
    const base = {
      id,
      name: property.name,
      configuration: property.configuration,
      locality: property.localityName,
      viewsSeen,
      estimateNote: money.estimateNote,
    };

    if (money.kind === 'sale') {
      const offers = content.offers.properties[id]?.offers ?? [];
      const totals = computeSaleTotals(money, property.areas, offers, state.appliedOffers[id] ?? []);
      const rows: RecapRow[] = [];
      const headline: RecapRow = { label: totals.discountTotal > 0 ? 'Your price after offers' : 'All-in price', value: `${formatINR(totals.total)} (${formatINRShort(totals.total)})` };
      if (totals.discountTotal > 0) rows.push({ label: 'Price before offers', value: formatINR(totals.subtotal) });
      rows.push(headline);
      rows.push({ label: 'Carpet area', value: formatSqft(property.areas.carpetSqft) });
      const emiInputs: EmiInputs | null = extras?.emiByProperty[id] ?? (state.propertyId === id ? state.params.money.emi : null);
      let emi: RecapEmi | null = null;
      if (emiInputs) {
        const r = computeEmi(totals.total, emiInputs);
        emi = {
          downPayment: formatINRShort(emiInputs.downPayment),
          loan: formatINRShort(r.loanAmount),
          monthly: formatINR(r.monthlyEmi),
          tenureYears: emiInputs.tenureYears,
          ratePct: emiInputs.ratePct,
        };
      }
      properties.push({
        ...base,
        kind: 'sale',
        rows,
        headline,
        offers: totals.discounts.map((d) => ({ title: d.title, saving: formatINR(d.amount) })),
        emi,
        price: totals.total,
      });
    } else {
      const t = computeLeaseTotals(money);
      const leaseOffers = content.offers.properties[id]?.offers ?? [];
      const applied = (state.appliedOffers[id] ?? [])
        .map((offerId) => leaseOffers.find((o) => o.id === offerId))
        .filter((o) => o !== undefined)
        .map((o) => ({ title: o.title, saving: null }));
      const headline: RecapRow = { label: 'Monthly total with maintenance and GST', value: formatINR(t.monthlyTotal) };
      properties.push({
        ...base,
        kind: 'lease',
        headline,
        rows: [
          { label: 'Monthly rent', value: formatINR(money.rentMonthly) },
          headline,
          { label: 'Per seat per month', value: `${formatINR(t.perSeatMonthly)} for ${money.seats} seats` },
          { label: 'Security deposit', value: formatINR(t.deposit) },
          { label: 'Lock-in', value: `${money.lockInMonths} months` },
        ],
        offers: applied,
        emi: null,
        price: null,
      });
    }
  }

  let visit: RecapVisit | null = null;
  const { booking } = state;
  if (booking.status === 'confirmed' && booking.propertyId && booking.slotId) {
    const bundle = content.byId[booking.propertyId];
    const slot = bundle?.visits.find((v) => v.id === booking.slotId);
    if (bundle && slot) {
      visit = {
        propertyId: bundle.property.id,
        propertyName: bundle.property.name,
        slotId: slot.id,
        start: slot.start,
        end: slot.end,
        ...formatSlot(slot.start, slot.end),
        address: bundle.property.address,
      };
    }
  }

  const humanAdvisor = state.handoff.status === 'joined' || state.handoff.status === 'returned' ? state.handoff.humanName : null;
  const firstName = state.buyer.name.trim().split(/\s+/)[0] ?? state.buyer.name;

  return {
    sessionId: state.id,
    buyer: { name: state.buyer.name, firstName, email: state.buyer.email, phone: state.buyer.phone },
    advisorName: opts.advisorName,
    callDate: formatDateIST(state.createdAt),
    stated: { purpose: state.lead.purpose, budget: state.lead.budget, timeline: state.lead.timeline, needs: state.lead.needs },
    properties,
    visit,
    humanAdvisor,
    followUps: promisesToFollowUp(state.consult.notes).map((p) => p.text),
    nextStep: nextStep(state, visit, opts.appUrl),
    appUrl: opts.appUrl,
  };
}

function nextStep(state: SessionState, visit: RecapVisit | null, appUrl: string): string {
  if (visit) return `See you at ${visit.propertyName} on ${visit.date} at ${formatTimeIST(visit.start)}.`;
  if (state.handoff.status !== 'none') return 'A senior advisor has the notes from this call and can pick up where you left off.';
  return `When you would like to see a property in person, start a new call at ${appUrl} and book a site visit.`;
}

/** Stable fingerprint of the facts, so an identical recap is not sent twice automatically. */
export function factsHash(facts: RecapFacts): string {
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 16);
}
