import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LegalFileSchema,
  MoneyFileSchema,
  OffersPolicySchema,
  VisitsFileSchema,
  type LeaseMoney,
  type Offer,
  type Property,
  type SaleMoney,
} from './data.js';
import {
  amortizationByYear,
  checkDiscount,
  checkLoanToValue,
  checkOfferApplication,
  computeEmi,
  computeLeaseOfferTotals,
  computeLeaseTotals,
  computePaymentPlan,
  computeSaleTotals,
  defaultEmiInputs,
  groupLineItems,
  leaseMonthlySchedule,
  leaseOfferValue,
  maxLoanForValue,
  priceLineItems,
  type PropertyOfferPolicy,
} from './money.js';
import { describeSlot, formatSlotRange, groupSlotsByDay, isWeekendSlot, slotLocalParts } from './visits.js';

const LAKH = 1_00_000;
const AREAS: Property['areas'] = { carpetSqft: 600, builtUpSqft: 700, superBuiltUpSqft: 1000 };

const sale: SaleMoney = {
  kind: 'sale',
  lineItems: [
    { id: 'base', label: 'Base price', group: 'base', calc: { type: 'per_sqft', rate: 10000, area: 'superBuiltUp' } },
    { id: 'parking', label: 'Parking', group: 'charges', calc: { type: 'fixed', amount: 5 * LAKH } },
    { id: 'legal', label: 'Legal', group: 'charges', calc: { type: 'fixed', amount: 50000 }, payableAt: 'handover' },
    { id: 'gst', label: 'GST', group: 'government', calc: { type: 'percent', ratePct: 5, of: ['base', 'parking'] }, payableAt: 'instalments', source: 'https://example.com/gst' },
    { id: 'stamp', label: 'Stamp duty', group: 'government', calc: { type: 'percent', ratePct: 5, of: ['base', 'parking'] } },
    { id: 'cess', label: 'Cess', group: 'government', calc: { type: 'percent', ratePct: 10, of: ['stamp'] } },
    { id: 'corpus', label: 'Corpus', group: 'deposits', calc: { type: 'per_sqft', rate: 100, area: 'carpet' } },
  ],
  schedule: [
    { id: 'booking', stage: 'Booking', percent: 10 },
    { id: 'agreement', stage: 'Agreement', percent: 33.3 },
    { id: 'keys', stage: 'Keys', percent: 56.7, due: 'On handover' },
  ],
  emiDefaults: { downPaymentPct: 25, ratePct: 8.5, tenureYears: 20 },
  ltv: {
    slabs: [
      { upToLoan: 30 * LAKH, maxPct: 90 },
      { upToLoan: 75 * LAKH, maxPct: 80 },
      { upToLoan: null, maxPct: 75 },
    ],
    source: 'https://example.com/ltv',
  },
  estimateNote: 'Estimate.',
};

// base 1,00,00,000; parking 5,00,000; legal 50,000; gst 5,25,000; stamp 5,25,000; cess 52,500; corpus 60,000
const SUBTOTAL = 1_00_00_000 + 5_00_000 + 50_000 + 5_25_000 + 5_25_000 + 52_500 + 60_000;

const saleOffers: Offer[] = [
  { id: 'parking-free', title: 'Free parking', description: '', type: 'waiver', value: 0, lineItemId: 'parking', stackable: true },
  { id: 'flat', title: 'Flat off', description: '', type: 'flat', value: 1 * LAKH, stackable: true },
  { id: 'pct', title: 'One percent', description: '', type: 'percent', value: 1, stackable: true },
  { id: 'cess-free', title: 'Cess paid by builder', description: '', type: 'waiver', value: 0, lineItemId: 'cess', stackable: true },
  { id: 'solo', title: 'Exclusive', description: '', type: 'flat', value: 50000, stackable: false },
];

const salePolicy: PropertyOfferPolicy = { offers: saleOffers, maxDiscountPct: 2, handoffAbovePct: 3 };

describe('priceLineItems', () => {
  const items = priceLineItems(sale, AREAS);
  const amount = (id: string) => items.find((i) => i.id === id)?.amount;

  it('prices fixed, per-sq-ft and chained percentage items', () => {
    expect(amount('base')).toBe(1_00_00_000);
    expect(amount('parking')).toBe(5_00_000);
    expect(amount('gst')).toBe(5_25_000);
    expect(amount('stamp')).toBe(5_25_000);
    expect(amount('cess')).toBe(52_500);
    expect(amount('corpus')).toBe(60_000);
  });

  it('defaults when each item is paid by group, and honours an explicit override', () => {
    const at = (id: string) => items.find((i) => i.id === id)?.payableAt;
    expect(at('base')).toBe('instalments');
    expect(at('parking')).toBe('instalments');
    expect(at('legal')).toBe('handover');
    expect(at('gst')).toBe('instalments');
    expect(at('stamp')).toBe('handover');
    expect(at('corpus')).toBe('handover');
  });

  it('explains how each computed amount was worked out and keeps sources', () => {
    const base = items.find((i) => i.id === 'base');
    expect(base?.basis).toBe('₹10,000 per sq ft × 1,000 sq ft super built-up');
    expect(items.find((i) => i.id === 'cess')?.basis).toBe('10% of ₹5,25,000');
    expect(items.find((i) => i.id === 'parking')?.basis).toBeUndefined();
    expect(items.find((i) => i.id === 'gst')?.source).toBe('https://example.com/gst');
  });

  it('throws on a reference cycle or an unknown item', () => {
    const cyclic: SaleMoney = {
      ...sale,
      lineItems: [
        { id: 'a', label: 'A', group: 'base', calc: { type: 'percent', ratePct: 1, of: ['b'] } },
        { id: 'b', label: 'B', group: 'base', calc: { type: 'percent', ratePct: 1, of: ['a'] } },
      ],
    };
    expect(() => priceLineItems(cyclic, AREAS)).toThrow(/references itself/);
    const dangling: SaleMoney = { ...sale, lineItems: [{ id: 'a', label: 'A', group: 'base', calc: { type: 'percent', ratePct: 1, of: ['zzz'] } }] };
    expect(() => priceLineItems(dangling, AREAS)).toThrow(/not defined/);
  });

  it('groups items in display order with group subtotals', () => {
    const groups = groupLineItems(items);
    expect(groups.map((g) => g.group)).toEqual(['base', 'charges', 'government', 'deposits']);
    expect(groups.find((g) => g.group === 'charges')?.amount).toBe(5_50_000);
    expect(groups.reduce((s, g) => s + g.amount, 0)).toBe(SUBTOTAL);
  });
});

describe('computeSaleTotals', () => {
  it('totals without offers', () => {
    const t = computeSaleTotals(sale, AREAS, saleOffers, []);
    expect(t.subtotal).toBe(SUBTOTAL);
    expect(t.discountTotal).toBe(0);
    expect(t.total).toBe(SUBTOTAL);
  });

  it('values every offer, applied or not', () => {
    const t = computeSaleTotals(sale, AREAS, saleOffers, []);
    expect(t.offerValues).toEqual({
      'parking-free': 5_00_000,
      flat: 1 * LAKH,
      pct: Math.round(SUBTOTAL / 100),
      'cess-free': 52_500,
      solo: 50_000,
    });
  });

  it('applies waivers, flat and percentage offers, once each, ignoring unknown ids', () => {
    const t = computeSaleTotals(sale, AREAS, saleOffers, ['parking-free', 'flat', 'flat', 'nope']);
    expect(t.discounts.map((d) => d.offerId)).toEqual(['parking-free', 'flat']);
    expect(t.discounts[0]?.lineItemId).toBe('parking');
    expect(t.discountTotal).toBe(6_00_000);
    expect(t.total).toBe(SUBTOTAL - 6_00_000);
  });

  it('caps a flat offer at the item it targets', () => {
    const big: Offer = { id: 'big', title: 'Big', description: '', type: 'flat', value: 10 * LAKH, lineItemId: 'parking', stackable: true };
    const t = computeSaleTotals(sale, AREAS, [big], ['big']);
    expect(t.discountTotal).toBe(5_00_000);
  });
});

describe('computePaymentPlan', () => {
  it('splits the price into stages plus registration and handover, adding up to the total', () => {
    const t = computeSaleTotals(sale, AREAS, saleOffers, []);
    const plan = computePaymentPlan(sale, t);
    expect(plan.instalmentBasis).toBe(1_00_00_000 + 5_00_000 + 5_25_000);
    expect(plan.stages.map((s) => s.amount)).toEqual([11_02_500, 36_71_325, 62_51_175]);
    expect(plan.stages[2]?.due).toBe('On handover');
    expect(plan.handover.items.map((i) => i.id)).toEqual(['legal', 'stamp', 'cess', 'corpus']);
    expect(plan.handover.amount).toBe(50_000 + 5_25_000 + 52_500 + 60_000);
    expect(plan.stages.reduce((s, x) => s + x.amount, 0) + plan.handover.amount).toBe(t.total);
    expect(plan.total).toBe(t.total);
  });

  it('takes an offer off the part of the price its item is paid with', () => {
    const t = computeSaleTotals(sale, AREAS, saleOffers, ['parking-free', 'cess-free', 'flat']);
    const plan = computePaymentPlan(sale, t);
    expect(plan.instalmentBasis).toBe(1_00_00_000 + 5_25_000 - 1 * LAKH);
    const cess = plan.handover.items.find((i) => i.id === 'cess');
    expect(cess).toMatchObject({ amount: 0, discount: 52_500 });
    expect(plan.total).toBe(t.total);
  });
});

describe('computeEmi', () => {
  it('matches the standard reducing-balance formula', () => {
    const r = computeEmi(1_25_00_000, { downPayment: 25 * LAKH, ratePct: 8.5, tenureYears: 20 });
    expect(r.loanAmount).toBe(1_00_00_000);
    expect(r.months).toBe(240);
    expect(r.monthlyEmi).toBe(86_782);
    expect(r.totalPayable).toBe(r.totalInterest + r.loanAmount);
    expect(r.totalInterest).toBeGreaterThan(1_08_00_000);
    expect(r.totalInterest).toBeLessThan(1_09_00_000);
  });

  it('handles a zero rate and a down payment that covers the price', () => {
    expect(computeEmi(12 * LAKH, { downPayment: 0, ratePct: 0, tenureYears: 1 }).monthlyEmi).toBe(1 * LAKH);
    const none = computeEmi(10 * LAKH, { downPayment: 20 * LAKH, ratePct: 9, tenureYears: 10 });
    expect(none).toMatchObject({ loanAmount: 0, monthlyEmi: 0, totalInterest: 0, totalPayable: 0 });
  });

  it('derives default inputs from the money file', () => {
    expect(defaultEmiInputs(sale, 1_00_00_000)).toEqual({ downPayment: 25 * LAKH, ratePct: 8.5, tenureYears: 20 });
  });
});

describe('amortizationByYear', () => {
  const loan = 1_00_00_000;
  const rows = amortizationByYear(loan, 8.5, 20);

  it('has one row per year, repays the loan exactly and ends at zero', () => {
    expect(rows).toHaveLength(20);
    expect(rows.reduce((s, r) => s + r.principal, 0)).toBe(loan);
    expect(rows.at(-1)?.balance).toBe(0);
  });

  it('shifts each year from interest to principal', () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.principal).toBeGreaterThan(rows[i - 1]!.principal);
      expect(rows[i]!.interest).toBeLessThan(rows[i - 1]!.interest);
      expect(rows[i]!.balance).toBeLessThan(rows[i - 1]!.balance);
    }
  });

  it('agrees with the EMI totals to within rounding', () => {
    const emi = computeEmi(loan, { downPayment: 0, ratePct: 8.5, tenureYears: 20 });
    const interest = rows.reduce((s, r) => s + r.interest, 0);
    expect(Math.abs(interest - emi.totalInterest)).toBeLessThanOrEqual(20);
    expect(Math.abs(rows[0]!.principal + rows[0]!.interest - emi.monthlyEmi * 12)).toBeLessThanOrEqual(12);
  });

  it('returns zero rows for a zero loan', () => {
    expect(amortizationByYear(0, 8.5, 2)).toEqual([
      { year: 1, principal: 0, interest: 0, balance: 0 },
      { year: 2, principal: 0, interest: 0, balance: 0 },
    ]);
  });
});

describe('loan-to-value', () => {
  const slabs = sale.ltv!.slabs;

  it('picks the largest loan the slabs allow', () => {
    expect(maxLoanForValue(20 * LAKH, slabs)).toEqual({ maxLoan: 18 * LAKH, capPct: 90 });
    // 90% of 35 lakh would cross 30 lakh, where the cap drops to 80%; 30 lakh at 85.7% is still allowed.
    expect(maxLoanForValue(35 * LAKH, slabs)).toEqual({ maxLoan: 30 * LAKH, capPct: 90 });
    expect(maxLoanForValue(50 * LAKH, slabs)).toEqual({ maxLoan: 40 * LAKH, capPct: 80 });
    expect(maxLoanForValue(2_00_00_000, slabs)).toEqual({ maxLoan: 1_50_00_000, capPct: 75 });
  });

  it('checks a loan against the cost of the home, not the statutory charges', () => {
    const t = computeSaleTotals(sale, AREAS, saleOffers, []);
    const value = 1_00_00_000 + 5_00_000 + 5_25_000;
    const maxLoan = Math.floor(0.75 * value);
    const tooLittle = checkLoanToValue(sale, t, { downPayment: 10 * LAKH, ratePct: 8.5, tenureYears: 20 });
    expect(tooLittle).toMatchObject({ propertyValue: value, maxLoan, capPct: 75, withinLimit: false, minDownPayment: t.total - maxLoan });
    const enough = checkLoanToValue(sale, t, { downPayment: t.total - maxLoan, ratePct: 8.5, tenureYears: 20 });
    expect(enough?.withinLimit).toBe(true);
    expect(checkLoanToValue({ ...sale, ltv: undefined }, t, { downPayment: 0, ratePct: 8.5, tenureYears: 20 })).toBeNull();
  });
});

const lease: LeaseMoney = {
  kind: 'lease',
  rentMonthly: 1 * LAKH,
  maintenanceMonthly: 10_000,
  gstPct: 18,
  depositMonths: 6,
  seats: 10,
  fitOut: 'Furnished',
  lockInMonths: 12,
  termMonths: 30,
  escalationPct: 5,
  escalationEveryMonths: 12,
  inclusions: [],
  estimateNote: 'Estimate.',
};

describe('lease', () => {
  it('computes the monthly cost, per seat cost, deposit and escalation periods', () => {
    const t = computeLeaseTotals(lease);
    expect(t).toMatchObject({ monthlyBeforeTax: 1_10_000, gst: 19_800, monthlyTotal: 1_29_800, perSeatMonthly: 12_980, deposit: 6 * LAKH });
    expect(t.rentByPeriod).toEqual([
      { fromMonth: 1, toMonth: 12, rentMonthly: 1_00_000 },
      { fromMonth: 13, toMonth: 24, rentMonthly: 1_05_000 },
      { fromMonth: 25, toMonth: 30, rentMonthly: 1_10_250 },
    ]);
  });

  it('lays out rent and maintenance month by month', () => {
    const s = leaseMonthlySchedule(lease);
    expect(s.rent).toHaveLength(30);
    expect(s.rent[11]).toBe(1_00_000);
    expect(s.rent[12]).toBe(1_05_000);
    expect(s.maintenance.every((m) => m === 10_000)).toBe(true);
  });

  const rentFree: Offer = { id: 'rent-free', title: 'Rent-free month', description: '', type: 'waiver', value: 0, lineItemId: 'rent', months: 1, stackable: true };
  const maint: Offer = { id: 'maint', title: 'Maintenance waived', description: '', type: 'waiver', value: 0, lineItemId: 'maintenance', months: 2, stackable: true };
  const pct: Offer = { id: 'pct', title: 'Two percent', description: '', type: 'percent', value: 2, lineItemId: 'rent', stackable: true };
  const flat: Offer = { id: 'flat', title: 'Flat', description: '', type: 'flat', value: 25_000, stackable: true };

  it('values lease offers over the months they cover', () => {
    expect(leaseOfferValue(rentFree, lease)).toBe(1_00_000);
    expect(leaseOfferValue(maint, lease)).toBe(20_000);
    expect(leaseOfferValue({ ...rentFree, months: 13 }, lease)).toBe(12 * 1_00_000 + 1_05_000);
    const termRent = 12 * 1_00_000 + 12 * 1_05_000 + 6 * 1_10_250;
    expect(leaseOfferValue(pct, lease)).toBe(Math.round(0.02 * termRent));
    expect(leaseOfferValue(flat, lease)).toBe(25_000);
    expect(leaseOfferValue({ ...rentFree, lineItemId: 'parking' }, lease)).toBe(0);
  });

  it('totals the term with offers applied', () => {
    const t = computeLeaseOfferTotals(lease, [rentFree, maint, pct, flat], ['rent-free', 'maint']);
    const termRent = 12 * 1_00_000 + 12 * 1_05_000 + 6 * 1_10_250;
    expect(t.items.map((i) => [i.id, i.amount])).toEqual([
      ['rent', termRent],
      ['maintenance', 30 * 10_000],
    ]);
    expect(t.subtotal).toBe(termRent + 3_00_000);
    expect(t.discountTotal).toBe(1_20_000);
    expect(t.total).toBe(t.subtotal - 1_20_000);
  });
});

describe('checkOfferApplication', () => {
  const totals = (applied: string[]) => computeSaleTotals(sale, AREAS, saleOffers, applied);

  it('allows an offer within the limit', () => {
    const r = checkOfferApplication(salePolicy, totals([]), 'flat');
    expect(r).toMatchObject({ allowed: true, reason: 'ok', amount: 1 * LAKH, maxPct: 2 });
  });

  it('refuses unknown and already applied offers', () => {
    expect(checkOfferApplication(salePolicy, totals([]), 'zzz').reason).toBe('unknown_offer');
    expect(checkOfferApplication(salePolicy, totals(['flat']), 'flat').reason).toBe('already_applied');
  });

  it('keeps a non-stackable offer on its own', () => {
    expect(checkOfferApplication(salePolicy, totals(['flat']), 'solo').reason).toBe('not_stackable');
    expect(checkOfferApplication(salePolicy, totals(['solo']), 'flat').reason).toBe('not_stackable');
    expect(checkOfferApplication(salePolicy, totals([]), 'solo').allowed).toBe(true);
  });

  it('refuses an offer that would take the total discount past the limit', () => {
    // Parking (5 lakh) is about 4.2% of the subtotal; the limit is 2%.
    const r = checkOfferApplication(salePolicy, totals([]), 'parking-free');
    expect(r).toMatchObject({ allowed: false, reason: 'over_limit' });
    expect(r.totalPctAfter).toBeCloseTo((5_00_000 / SUBTOTAL) * 100, 2);
  });
});

describe('checkDiscount', () => {
  const none = computeSaleTotals(sale, AREAS, saleOffers, []);
  const capAmount = Math.floor(0.02 * SUBTOTAL);

  it('allows a request within the limit and offers exactly that', () => {
    const r = checkDiscount(salePolicy, none, { percent: 1.5 });
    expect(r.allowed).toBe(true);
    expect(r.handoff).toBe(false);
    expect(r.requestedPct).toBe(1.5);
    expect(r.suggestion).toEqual({ percent: 1.5, amount: Math.round(0.015 * SUBTOTAL) });
  });

  it('counters above the limit with the headroom, without a handoff below the threshold', () => {
    const r = checkDiscount(salePolicy, none, { percent: 2.5 });
    expect(r.allowed).toBe(false);
    expect(r.handoff).toBe(false);
    expect(r.remainingAmount).toBe(capAmount);
    expect(r.suggestion?.amount).toBe(Math.floor(capAmount / 1000) * 1000);
    expect(r.suggestion?.percent).toBeLessThanOrEqual(2);
  });

  it('recommends a human above the handoff threshold', () => {
    const r = checkDiscount(salePolicy, none, { percent: 5 });
    expect(r).toMatchObject({ allowed: false, handoff: true, maxPct: 2 });
    expect(r.suggestion).not.toBeNull();
  });

  it('accepts a rupee amount and counts offers already applied', () => {
    const applied = computeSaleTotals(sale, AREAS, saleOffers, ['flat', 'pct']);
    const r = checkDiscount(salePolicy, applied, { amount: 1 * LAKH });
    expect(r.appliedAmount).toBe(1 * LAKH + Math.round(SUBTOTAL / 100));
    expect(r.requestedAmount).toBe(1 * LAKH);
    expect(r.allowed).toBe(false);
    expect(r.remainingAmount).toBe(capAmount - r.appliedAmount);
  });

  it('has no counter-offer when the limit is used up', () => {
    const policy: PropertyOfferPolicy = { ...salePolicy, maxDiscountPct: 0.5, handoffAbovePct: 0.5 };
    const applied = computeSaleTotals(sale, AREAS, saleOffers, ['flat', 'pct']);
    const r = checkDiscount(policy, applied, { percent: 1 });
    expect(r).toMatchObject({ allowed: false, suggestion: null, handoff: true, remainingAmount: 0 });
    expect(r.availableOfferIds).toEqual([]);
  });

  it('treats an empty request as asking what is possible', () => {
    const r = checkDiscount(salePolicy, none, {});
    expect(r.allowed).toBe(false);
    expect(r.handoff).toBe(false);
    expect(r.suggestion?.amount).toBeGreaterThan(0);
  });

  it('lists the listed offers that can still be applied', () => {
    const r = checkDiscount(salePolicy, computeSaleTotals(sale, AREAS, saleOffers, ['flat']), { percent: 0.1 });
    expect(r.availableOfferIds).toEqual(['pct', 'cess-free']);
    expect(r.availableOffersAmount).toBe(Math.round(SUBTOTAL / 100) + 52_500);
  });
});

describe('visit slots', () => {
  const slots = [
    { id: 'b', start: '2026-11-22T16:00:00+05:30', end: '2026-11-22T17:00:00+05:30', available: true },
    { id: 'a', start: '2026-11-22T10:00:00+05:30', end: '2026-11-22T11:00:00+05:30', available: false },
    { id: 'c', start: '2026-11-23T11:30:00+05:30', end: '2026-11-23T12:30:00+05:30', available: true },
  ];

  it('reads the property-local date and time without converting time zones', () => {
    expect(slotLocalParts('2026-11-22T10:30:00+05:30')).toEqual({ date: '2026-11-22', minutes: 630 });
    expect(slotLocalParts('not a date')).toBeNull();
  });

  it('formats slots for the screen and for speech', () => {
    expect(formatSlotRange(slots[0]!)).toBe('4:00 PM – 5:00 PM');
    expect(describeSlot(slots[1]!)).toBe('Sunday, 22 November, 10:00 AM to 11:00 AM');
    expect(isWeekendSlot(slots[1]!)).toBe(true);
    expect(isWeekendSlot(slots[2]!)).toBe(false);
  });

  it('groups slots by day in time order', () => {
    const days = groupSlotsByDay(slots);
    expect(days.map((d) => d.date)).toEqual(['2026-11-22', '2026-11-23']);
    expect(days[0]?.slots.map((s) => s.id)).toEqual(['a', 'b']);
    expect(days[0]?.label).toBe('Sunday, 22 November');
  });
});

/* ------------------------------------------------------------------ */
/* The real content files this workstream owns                         */
/* ------------------------------------------------------------------ */

const readData = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../../data/${rel}`, import.meta.url), 'utf8'));
const policyFile = OffersPolicySchema.parse(readData('policy/offers.json'));
const PROPERTY_IDS = ['apt-indiranagar', 'office-koramangala'] as const;

describe('content: money, offers, legal and visits', () => {
  for (const id of PROPERTY_IDS) {
    const money = MoneyFileSchema.parse(readData(`properties/${id}/money.json`));
    const { areas } = readData(`properties/${id}/property.json`) as Pick<Property, 'areas'>;
    const policy = policyFile.properties[id];

    it(`${id}: every listed offer can be applied together within the advisor's limit`, () => {
      expect(policy).toBeDefined();
      const offers = policy!.offers;
      const totals = money.kind === 'sale'
        ? computeSaleTotals(money, areas, offers, offers.map((o) => o.id))
        : computeLeaseOfferTotals(money, offers, offers.map((o) => o.id));
      expect(totals.discounts).toHaveLength(offers.length);
      for (const d of totals.discounts) expect(d.amount).toBeGreaterThan(0);
      expect((totals.discountTotal / totals.subtotal) * 100).toBeLessThanOrEqual(policy!.maxDiscountPct);
      expect(policy!.handoffAbovePct).toBeGreaterThanOrEqual(policy!.maxDiscountPct);
    });

    it(`${id}: legal documents are plainly sample references with at least one honest pending item`, () => {
      const legal = LegalFileSchema.parse(readData(`properties/${id}/legal.json`));
      expect(legal.documents.some((d) => d.status === 'pending')).toBe(true);
      expect(legal.documents.filter((d) => d.status === 'verified').length).toBeGreaterThan(legal.documents.length / 2);
      for (const d of legal.documents) {
        // Anything shaped like a registration or certificate number must say it is a sample.
        if (/\d/.test(d.reference) && /[/-]/.test(d.reference)) expect(d.reference).toMatch(/SAMPLE/);
      }
    });

    it(`${id}: visit slots are near 21 November 2026, in IST, with some unavailable`, () => {
      const { slots } = VisitsFileSchema.parse(readData(`properties/${id}/visits.json`));
      for (const s of slots) {
        expect(s.start.endsWith('+05:30')).toBe(true);
        expect(Date.parse(s.end)).toBeGreaterThan(Date.parse(s.start));
        expect(s.start >= '2026-11-21' && s.start < '2026-12-01').toBe(true);
      }
      expect(slots.some((s) => !s.available)).toBe(true);
      expect(slots.filter((s) => s.available).length).toBeGreaterThan(slots.length / 2);
    });
  }

  it('apt-indiranagar: statutory charges follow current Karnataka rates on the agreement value', () => {
    const money = MoneyFileSchema.parse(readData('properties/apt-indiranagar/money.json')) as SaleMoney;
    const { areas } = readData('properties/apt-indiranagar/property.json') as Pick<Property, 'areas'>;
    const items = priceLineItems(money, areas);
    const amount = (id: string) => items.find((i) => i.id === id)?.amount ?? NaN;
    const agreementValue = amount('base') + amount('floor_rise') + amount('parking') + amount('club');
    expect(amount('stamp_duty')).toBe(Math.round(0.05 * agreementValue));
    expect(amount('registration')).toBe(Math.round(0.02 * agreementValue));
    expect(amount('stamp_cess')).toBe(Math.round(0.1 * amount('stamp_duty')));
    expect(amount('stamp_surcharge')).toBe(Math.round(0.02 * amount('stamp_duty')));
    for (const id of ['gst_home', 'gst_services', 'stamp_duty', 'stamp_cess', 'stamp_surcharge', 'registration']) {
      expect(items.find((i) => i.id === id)?.source).toMatch(/^https:\/\//);
    }
    const totals = computeSaleTotals(money, areas, [], []);
    const plan = computePaymentPlan(money, totals);
    expect(plan.total).toBe(totals.total);
    // The default down payment must leave a loan banks can actually give.
    const ltv = checkLoanToValue(money, totals, defaultEmiInputs(money, totals.total));
    expect(ltv?.withinLimit).toBe(true);
  });
});
