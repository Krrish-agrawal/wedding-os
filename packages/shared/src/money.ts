import type { EmiInputs } from './views.js';
import type { LeaseMoney, Offer, OffersPolicy, PayableAt, Property, SaleMoney } from './data.js';
import { formatINR, formatIndianNumber } from './format.js';

/* ------------------------------------------------------------------ */
/* Line items                                                          */
/* ------------------------------------------------------------------ */

export type LineItemGroup = SaleMoney['lineItems'][number]['group'];

/** Display order of line-item groups in a price breakup. */
export const MONEY_GROUP_ORDER: readonly LineItemGroup[] = ['base', 'charges', 'government', 'deposits'];

export const MONEY_GROUP_LABELS: Record<LineItemGroup, string> = {
  base: 'Price of the home',
  charges: 'Builder charges',
  government: 'Taxes and statutory charges',
  deposits: 'Deposits and advances',
};

export const PAYABLE_AT_LABELS: Record<PayableAt, string> = {
  instalments: 'In instalments',
  handover: 'At registration and handover',
};

type AreaKind = 'carpet' | 'builtUp' | 'superBuiltUp';

export const AREA_LABELS: Record<AreaKind, string> = {
  carpet: 'carpet',
  builtUp: 'built-up',
  superBuiltUp: 'super built-up',
};

const DEFAULT_PAYABLE_AT: Record<LineItemGroup, PayableAt> = {
  base: 'instalments',
  charges: 'instalments',
  government: 'handover',
  deposits: 'handover',
};

export interface PricedLineItem {
  id: string;
  label: string;
  group: LineItemGroup;
  amount: number;
  note?: string;
  /** Source URL for a statutory rate. */
  source?: string;
  /** When the buyer pays it. Always set by priceLineItems. */
  payableAt?: PayableAt;
  /** How the amount was worked out, e.g. "5% of ₹1,85,30,200". Absent for fixed amounts. */
  basis?: string;
}

export interface AppliedDiscount {
  offerId: string;
  title: string;
  amount: number;
  /** Line item the offer targets, when it targets one. */
  lineItemId?: string;
}

/** The common shape of sale and lease totals that offers and discounts are checked against. */
export interface OfferTotals {
  items: PricedLineItem[];
  /** Sum before offers. */
  subtotal: number;
  discounts: AppliedDiscount[];
  discountTotal: number;
  /** What the buyer pays after offers. */
  total: number;
  /** Rupee value of every offer in the list passed in, applied or not. */
  offerValues: Record<string, number>;
}

export type SaleTotals = OfferTotals;

/**
 * Price every line item, resolving percentage items against the items they reference.
 * Throws on a cycle or an unknown reference: content errors must surface in validation, not on screen.
 */
export function priceLineItems(money: SaleMoney, areas: Property['areas']): PricedLineItem[] {
  const byId = new Map(money.lineItems.map((li) => [li.id, li]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const areaOf = (kind: AreaKind): number =>
    kind === 'carpet' ? areas.carpetSqft : kind === 'builtUp' ? areas.builtUpSqft : areas.superBuiltUpSqft;

  const amountOf = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const li = byId.get(id);
    if (!li) throw new Error(`Line item "${id}" is referenced but not defined`);
    if (visiting.has(id)) throw new Error(`Line item "${id}" references itself`);
    visiting.add(id);
    let value: number;
    switch (li.calc.type) {
      case 'fixed':
        value = li.calc.amount;
        break;
      case 'per_sqft':
        value = li.calc.rate * areaOf(li.calc.area);
        break;
      case 'percent':
        value = (li.calc.ratePct / 100) * li.calc.of.reduce((s, ref) => s + amountOf(ref), 0);
        break;
    }
    visiting.delete(id);
    const rounded = Math.round(value);
    memo.set(id, rounded);
    return rounded;
  };

  const basisOf =(li: SaleMoney['lineItems'][number]): string | undefined => {
    switch (li.calc.type) {
      case 'fixed':
        return undefined;
      case 'per_sqft':
        return `${formatINR(li.calc.rate)} per sq ft × ${formatIndianNumber(areaOf(li.calc.area))} sq ft ${AREA_LABELS[li.calc.area]}`;
      case 'percent':
        return `${li.calc.ratePct}% of ${formatINR(li.calc.of.reduce((s, ref) => s + amountOf(ref), 0))}`;
    }
  };

  return money.lineItems.map((li) => {
    const basis = basisOf(li);
    return {
      id: li.id,
      label: li.label,
      group: li.group,
      amount: amountOf(li.id),
      ...(li.note ? { note: li.note } : {}),
      ...(li.source ? { source: li.source } : {}),
      payableAt: li.payableAt ?? DEFAULT_PAYABLE_AT[li.group],
      ...(basis ? { basis } : {}),
    };
  });
}

export function computeSaleTotals(money: SaleMoney, areas: Property['areas'], offers: Offer[], appliedOfferIds: string[]): SaleTotals {
  const items = priceLineItems(money, areas);
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const offerValues = Object.fromEntries(offers.map((o) => [o.id, offerValue(o, items, subtotal)]));
  return withDiscounts(items, subtotal, offers, appliedOfferIds, offerValues);
}

export function offerValue(offer: Offer, items: PricedLineItem[], subtotal: number): number {
  const target = offer.lineItemId ? items.find((i) => i.id === offer.lineItemId)?.amount ?? 0 : subtotal;
  switch (offer.type) {
    case 'flat':
      return Math.min(offer.value, target);
    case 'percent':
      return Math.round((offer.value / 100) * target);
    case 'waiver':
      return target;
  }
}

function withDiscounts(
  items: PricedLineItem[],
  subtotal: number,
  offers: Offer[],
  appliedOfferIds: string[],
  offerValues: Record<string, number>,
): OfferTotals {
  const discounts: AppliedDiscount[] = [...new Set(appliedOfferIds)]
    .map((id) => offers.find((o) => o.id === id))
    .filter((o): o is Offer => Boolean(o))
    .map((o) => ({
      offerId: o.id,
      title: o.title,
      amount: offerValues[o.id] ?? 0,
      ...(o.lineItemId ? { lineItemId: o.lineItemId } : {}),
    }));
  const discountTotal = Math.min(subtotal, discounts.reduce((s, d) => s + d.amount, 0));
  return { items, subtotal, discounts, discountTotal, total: subtotal - discountTotal, offerValues };
}

export interface LineItemGroupTotal {
  group: LineItemGroup;
  label: string;
  items: PricedLineItem[];
  amount: number;
}

/** Line items grouped in display order, with a subtotal per group. Empty groups are left out. */
export function groupLineItems(items: PricedLineItem[]): LineItemGroupTotal[] {
  return MONEY_GROUP_ORDER.map((group) => {
    const inGroup = items.filter((i) => i.group === group);
    return { group, label: MONEY_GROUP_LABELS[group], items: inGroup, amount: inGroup.reduce((s, i) => s + i.amount, 0) };
  }).filter((g) => g.items.length > 0);
}

/* ------------------------------------------------------------------ */
/* Payment plan                                                        */
/* ------------------------------------------------------------------ */

export interface PaymentStage {
  id: string;
  stage: string;
  due?: string;
  percent: number;
  amount: number;
}

export interface HandoverItem {
  id: string;
  label: string;
  group: LineItemGroup;
  /** Amount after any offer on this item. */
  amount: number;
  /** Offer amount taken off this item. */
  discount: number;
}

export interface PaymentPlan {
  /** Items paid in instalments, after offers. The schedule percentages apply to this. */
  instalmentBasis: number;
  stages: PaymentStage[];
  /** Paid in one go at registration and handover. */
  handover: { items: HandoverItem[]; amount: number };
  /** Equals the sale total after offers. */
  total: number;
}

/**
 * Splits the price into schedule instalments plus what is paid at registration and handover.
 * An offer comes off the part of the price its line item is paid with; offers on the whole
 * price come off the instalments. Stages and handover always add up to the total.
 */
export function computePaymentPlan(money: SaleMoney, totals: SaleTotals): PaymentPlan {
  const payableOf = (item: PricedLineItem): PayableAt => item.payableAt ?? DEFAULT_PAYABLE_AT[item.group];
  const discountOnItem = new Map<string, number>();
  let instalmentDiscount = 0;
  let remainingDiscount = totals.discountTotal;
  for (const d of totals.discounts) {
    const amount = Math.min(d.amount, remainingDiscount);
    remainingDiscount -= amount;
    const item = d.lineItemId ? totals.items.find((i) => i.id === d.lineItemId) : undefined;
    if (item && payableOf(item) === 'handover') discountOnItem.set(item.id, (discountOnItem.get(item.id) ?? 0) + amount);
    else instalmentDiscount += amount;
  }

  const instalmentGross = totals.items.filter((i) => payableOf(i) === 'instalments').reduce((s, i) => s + i.amount, 0);
  const instalmentBasis = Math.max(0, instalmentGross - instalmentDiscount);

  const stages: PaymentStage[] = [];
  let allotted = 0;
  money.schedule.forEach((s, idx) => {
    const last = idx === money.schedule.length - 1;
    const amount = last ? instalmentBasis - allotted : Math.round((s.percent / 100) * instalmentBasis);
    allotted += amount;
    stages.push({ id: s.id, stage: s.stage, ...(s.due ? { due: s.due } : {}), percent: s.percent, amount });
  });

  const handoverItems: HandoverItem[] = totals.items
    .filter((i) => payableOf(i) === 'handover')
    .map((i) => {
      const discount = Math.min(i.amount, discountOnItem.get(i.id) ?? 0);
      return { id: i.id, label: i.label, group: i.group, amount: i.amount - discount, discount };
    });
  const handoverAmount = handoverItems.reduce((s, i) => s + i.amount, 0);

  return { instalmentBasis, stages, handover: { items: handoverItems, amount: handoverAmount }, total: allotted + handoverAmount };
}

/* ------------------------------------------------------------------ */
/* EMI                                                                 */
/* ------------------------------------------------------------------ */

export interface EmiResult {
  loanAmount: number;
  monthlyEmi: number;
  totalInterest: number;
  totalPayable: number;
  months: number;
}

function monthlyRate(ratePct: number): number {
  return ratePct / 12 / 100;
}

function exactEmi(loanAmount: number, ratePct: number, months: number): number {
  const r = monthlyRate(ratePct);
  if (loanAmount <= 0) return 0;
  return r === 0 ? loanAmount / months : (loanAmount * r * (1 + r) ** months) / ((1 + r) ** months - 1);
}

/** Standard reducing-balance EMI. */
export function computeEmi(price: number, inputs: EmiInputs): EmiResult {
  const loanAmount = Math.max(0, Math.round(price - inputs.downPayment));
  const months = inputs.tenureYears * 12;
  const monthlyEmi = exactEmi(loanAmount, inputs.ratePct, months);
  const totalPayable = Math.round(monthlyEmi * months);
  return {
    loanAmount,
    monthlyEmi: Math.round(monthlyEmi),
    totalInterest: totalPayable - loanAmount,
    totalPayable,
    months,
  };
}

export function defaultEmiInputs(money: SaleMoney, price: number): EmiInputs {
  return {
    downPayment: Math.round((money.emiDefaults.downPaymentPct / 100) * price),
    ratePct: money.emiDefaults.ratePct,
    tenureYears: money.emiDefaults.tenureYears,
  };
}

export interface AmortizationYear {
  /** 1-based loan year. */
  year: number;
  principal: number;
  interest: number;
  /** Outstanding loan at the end of the year. */
  balance: number;
}

const MONTHS_PER_YEAR = 12;

/**
 * Principal and interest paid in each loan year, for a reducing-balance loan.
 * Principal across the years adds up to the loan exactly and the last balance is zero.
 */
export function amortizationByYear(loanAmount: number, ratePct: number, tenureYears: number): AmortizationYear[] {
  const months = tenureYears * MONTHS_PER_YEAR;
  const loan = Math.max(0, Math.round(loanAmount));
  const emi = exactEmi(loan, ratePct, months);
  const r = monthlyRate(ratePct);
  const rows: AmortizationYear[] = [];
  let balance = loan;
  let principalSoFar = 0;
  for (let year = 1; year <= tenureYears; year++) {
    let principal = 0;
    let interest = 0;
    for (let m = 0; m < MONTHS_PER_YEAR; m++) {
      const i = balance * r;
      const p = Math.min(balance, emi - i);
      interest += i;
      principal += p;
      balance -= p;
    }
    const last = year === tenureYears;
    const roundedPrincipal = last ? loan - principalSoFar : Math.round(principal);
    principalSoFar += roundedPrincipal;
    rows.push({ year, principal: roundedPrincipal, interest: Math.round(interest), balance: last ? 0 : Math.max(0, loan - principalSoFar) });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Loan-to-value                                                       */
/* ------------------------------------------------------------------ */

export type LtvSlabs = NonNullable<SaleMoney['ltv']>['slabs'];

/** The largest loan a bank may give on a home of this value, and the LTV cap that applies to it. */
export function maxLoanForValue(value: number, slabs: LtvSlabs): { maxLoan: number; capPct: number } {
  const ordered = [...slabs].sort((a, b) => (a.upToLoan ?? Infinity) - (b.upToLoan ?? Infinity));
  let best = { maxLoan: 0, capPct: ordered[0]?.maxPct ?? 0 };
  let lowerBound = 0;
  for (const slab of ordered) {
    const candidate = Math.floor(Math.min((slab.maxPct / 100) * value, slab.upToLoan ?? Infinity));
    if (candidate > lowerBound && candidate > best.maxLoan) best = { maxLoan: candidate, capPct: slab.maxPct };
    lowerBound = slab.upToLoan ?? Infinity;
  }
  return best;
}

export interface LoanCheck {
  /** Cost of the home a bank lends against: instalment items after offers. */
  propertyValue: number;
  maxLoan: number;
  capPct: number;
  /** Smallest down payment that keeps the loan within the cap. */
  minDownPayment: number;
  loanAmount: number;
  withinLimit: boolean;
  source: string;
}

/** Checks a loan against the RBI loan-to-value ceilings in the money file. Null when the file has none. */
export function checkLoanToValue(money: SaleMoney, totals: SaleTotals, inputs: EmiInputs): LoanCheck | null {
  if (!money.ltv) return null;
  const propertyValue = computePaymentPlan(money, totals).instalmentBasis;
  const { maxLoan, capPct } = maxLoanForValue(propertyValue, money.ltv.slabs);
  const loanAmount = Math.max(0, Math.round(totals.total - inputs.downPayment));
  return {
    propertyValue,
    maxLoan,
    capPct,
    minDownPayment: Math.max(0, totals.total - maxLoan),
    loanAmount,
    withinLimit: loanAmount <= maxLoan,
    source: money.ltv.source,
  };
}

/* ------------------------------------------------------------------ */
/* Lease                                                               */
/* ------------------------------------------------------------------ */

export interface LeaseTotals {
  monthlyBeforeTax: number;
  gst: number;
  monthlyTotal: number;
  perSeatMonthly: number;
  deposit: number;
  /** Rent per month for each escalation period over the term. */
  rentByPeriod: { fromMonth: number; toMonth: number; rentMonthly: number }[];
}

export function computeLeaseTotals(lease: LeaseMoney): LeaseTotals {
  const monthlyBeforeTax = lease.rentMonthly + lease.maintenanceMonthly;
  const gst = Math.round((lease.gstPct / 100) * monthlyBeforeTax);
  const monthlyTotal = monthlyBeforeTax + gst;
  const rentByPeriod: LeaseTotals['rentByPeriod'] = [];
  let rent = lease.rentMonthly;
  for (let from = 1; from <= lease.termMonths; from += lease.escalationEveryMonths) {
    const to = Math.min(lease.termMonths, from + lease.escalationEveryMonths - 1);
    rentByPeriod.push({ fromMonth: from, toMonth: to, rentMonthly: Math.round(rent) });
    rent *= 1 + lease.escalationPct / 100;
  }
  return {
    monthlyBeforeTax,
    gst,
    monthlyTotal,
    perSeatMonthly: Math.round(monthlyTotal / lease.seats),
    deposit: Math.round(lease.depositMonths * lease.rentMonthly),
    rentByPeriod,
  };
}

/** Line item ids a lease offer can target. Each covers the whole term. */
export const LEASE_ITEM_IDS = ['rent', 'maintenance'] as const;
export type LeaseItemId = (typeof LEASE_ITEM_IDS)[number];

export const LEASE_ITEM_LABELS: Record<LeaseItemId, string> = {
  rent: 'Rent over the term',
  maintenance: 'Maintenance over the term',
};

/** Month-by-month rent and maintenance over the term, before GST. */
export function leaseMonthlySchedule(lease: LeaseMoney): Record<LeaseItemId, number[]> {
  const { rentByPeriod } = computeLeaseTotals(lease);
  const rent: number[] = [];
  for (const p of rentByPeriod) for (let m = p.fromMonth; m <= p.toMonth; m++) rent.push(p.rentMonthly);
  return { rent, maintenance: Array.from({ length: lease.termMonths }, () => lease.maintenanceMonthly) };
}

/**
 * What an offer is worth on a lease, before GST. A waiver with `months` covers that many months
 * from the start; without it, the whole term of its item.
 */
export function leaseOfferValue(offer: Offer, lease: LeaseMoney): number {
  const schedule = leaseMonthlySchedule(lease);
  const targetIds: readonly LeaseItemId[] = offer.lineItemId
    ? (LEASE_ITEM_IDS as readonly string[]).includes(offer.lineItemId)
      ? [offer.lineItemId as LeaseItemId]
      : []
    : LEASE_ITEM_IDS;
  const sum = (months: number) => targetIds.reduce((s, id) => s + schedule[id].slice(0, months).reduce((a, b) => a + b, 0), 0);
  const termAmount = sum(lease.termMonths);
  switch (offer.type) {
    case 'flat':
      return Math.min(offer.value, termAmount);
    case 'percent':
      return Math.round((offer.value / 100) * termAmount);
    case 'waiver':
      return sum(Math.min(offer.months ?? lease.termMonths, lease.termMonths));
  }
}

/** Rent and maintenance over the whole term, with offers applied. GST is charged on top. */
export function computeLeaseOfferTotals(lease: LeaseMoney, offers: Offer[], appliedOfferIds: string[]): OfferTotals {
  const schedule = leaseMonthlySchedule(lease);
  const items: PricedLineItem[] = [
    { id: 'rent', label: LEASE_ITEM_LABELS.rent, group: 'base', amount: schedule.rent.reduce((a, b) => a + b, 0), payableAt: 'instalments' },
    { id: 'maintenance', label: LEASE_ITEM_LABELS.maintenance, group: 'charges', amount: schedule.maintenance.reduce((a, b) => a + b, 0), payableAt: 'instalments' },
  ];
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const offerValues = Object.fromEntries(offers.map((o) => [o.id, leaseOfferValue(o, lease)]));
  return withDiscounts(items, subtotal, offers, appliedOfferIds, offerValues);
}

/* ------------------------------------------------------------------ */
/* Offers and discount policy                                          */
/* ------------------------------------------------------------------ */

export type PropertyOfferPolicy = OffersPolicy['properties'][string];

/** Percentages are compared with this tolerance so rounding never flips a decision. */
const PCT_EPSILON = 1e-6;
/** Counter-offers are rounded down to a speakable amount. */
export const DISCOUNT_SUGGESTION_STEP_INR = 1000;

function pctOf(amount: number, base: number): number {
  return base > 0 ? (amount / base) * 100 : 0;
}

function roundPct(pct: number): number {
  return Math.round(pct * 100) / 100;
}

export type OfferCheckReason = 'ok' | 'unknown_offer' | 'already_applied' | 'not_stackable' | 'over_limit';

export interface OfferCheck {
  allowed: boolean;
  reason: OfferCheckReason;
  /** What the offer is worth on this property. */
  amount: number;
  /** Total discount after applying it, as % of the pre-offer total. */
  totalPctAfter: number;
  maxPct: number;
}

/** Whether an offer can be applied on top of the offers already applied, within policy. */
export function checkOfferApplication(policy: PropertyOfferPolicy, totals: OfferTotals, offerId: string): OfferCheck {
  const offer = policy.offers.find((o) => o.id === offerId);
  const amount = totals.offerValues[offerId] ?? 0;
  const totalPctAfter = roundPct(pctOf(totals.discountTotal + amount, totals.subtotal));
  const result = (allowed: boolean, reason: OfferCheckReason): OfferCheck => ({ allowed, reason, amount, totalPctAfter, maxPct: policy.maxDiscountPct });
  if (!offer) return result(false, 'unknown_offer');
  const appliedIds = totals.discounts.map((d) => d.offerId);
  if (appliedIds.includes(offerId)) return result(false, 'already_applied');
  const applied = appliedIds.map((id) => policy.offers.find((o) => o.id === id)).filter((o): o is Offer => Boolean(o));
  if (applied.length > 0 && (!offer.stackable || applied.some((o) => !o.stackable))) return result(false, 'not_stackable');
  if (pctOf(totals.discountTotal + amount, totals.subtotal) > policy.maxDiscountPct + PCT_EPSILON) return result(false, 'over_limit');
  return result(true, 'ok');
}

export interface DiscountRequest {
  /** Extra discount asked for, as % of the pre-offer total. */
  percent?: number;
  /** Extra discount asked for, in rupees. Used when no percent is given. */
  amount?: number;
}

export interface DiscountCheck {
  /** True when the extra discount fits within what the advisor may give. */
  allowed: boolean;
  /** Policy cap on the total discount, as % of the pre-offer total. */
  maxPct: number;
  requestedPct: number;
  requestedAmount: number;
  /** Discount already given through applied offers. */
  appliedPct: number;
  appliedAmount: number;
  /** What the advisor can still give on top of the applied offers. */
  remainingPct: number;
  remainingAmount: number;
  /**
   * What the advisor can offer: the request itself when allowed, otherwise the remaining
   * headroom rounded down to a speakable amount. Null when nothing is left to give.
   */
  suggestion: { percent: number; amount: number } | null;
  /** True when the total asked for is above the handoff threshold: propose a senior advisor. */
  handoff: boolean;
  /** Listed offers not yet applied that can still be applied within policy. Prefer these: they show on screen. */
  availableOfferIds: string[];
  /** What those offers are worth together. */
  availableOffersAmount: number;
}

/**
 * Checks a buyer's request for an extra discount against the offers policy.
 * The request is on top of offers already applied; both are measured against the pre-offer total.
 * A request with neither percent nor amount asks what is possible: it is not allowed, and the
 * suggestion carries the headroom.
 */
export function checkDiscount(policy: PropertyOfferPolicy, totals: OfferTotals, request: DiscountRequest): DiscountCheck {
  const base = totals.subtotal;
  const requestedAmount = Math.max(
    0,
    Math.round(request.percent !== undefined ? (request.percent / 100) * base : request.amount ?? 0),
  );
  const requestedPct = pctOf(requestedAmount, base);
  const appliedAmount = totals.discountTotal;
  const appliedPct = pctOf(appliedAmount, base);
  const capAmount = Math.floor((policy.maxDiscountPct / 100) * base);
  const remainingAmount = Math.max(0, capAmount - appliedAmount);
  const remainingPct = pctOf(remainingAmount, base);

  const allowed = requestedAmount > 0 && appliedPct + requestedPct <= policy.maxDiscountPct + PCT_EPSILON;
  const counter = Math.floor(remainingAmount / DISCOUNT_SUGGESTION_STEP_INR) * DISCOUNT_SUGGESTION_STEP_INR;
  const available = policy.offers.filter((o) => checkOfferApplication(policy, totals, o.id).allowed);
  const suggestion = allowed
    ? { percent: roundPct(requestedPct), amount: requestedAmount }
    : counter > 0
      ? { percent: roundPct(pctOf(counter, base)), amount: counter }
      : null;

  return {
    allowed,
    maxPct: policy.maxDiscountPct,
    requestedPct: roundPct(requestedPct),
    requestedAmount,
    appliedPct: roundPct(appliedPct),
    appliedAmount,
    remainingPct: roundPct(remainingPct),
    remainingAmount,
    suggestion,
    handoff: appliedPct + requestedPct > policy.handoffAbovePct + PCT_EPSILON,
    availableOfferIds: available.map((o) => o.id),
    availableOffersAmount: available.reduce((s, o) => s + (totals.offerValues[o.id] ?? 0), 0),
  };
}
