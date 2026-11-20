import {
  parseINRAmount,
  EmiInputsSchema,
  checkDiscount,
  checkLoanToValue,
  checkOfferApplication,
  computeEmi,
  computeLeaseTotals,
  computePaymentPlan,
  defaultEmiInputs,
  matchByName,
  type EmiInputs,
  type MoneyTab,
  type Offer,
  type OfferTotals,
  type PropertyBundle,
  type SaleMoney,
  type SessionState,
  type ToolInput,
  type ToolResult,
} from '@ave/shared';
import type { ToolContext } from '../context.js';
import { amount } from '../format.js';
import { dispatch, fail, isSale, offerTotals, ok, policyFor, resolveProperty, stateOf } from '../kit.js';

const MAX_INCLUSIONS = 4;
const SALE_TABS: MoneyTab[] = ['breakup', 'emi', 'offers', 'schedule'];
const LEASE_TERM_NOTE = 'Rent and maintenance over the full term, before GST';

function offerList(tc: ToolContext, bundle: PropertyBundle, state: SessionState, totals: OfferTotals) {
  const applied = state.appliedOffers[bundle.property.id] ?? [];
  return (policyFor(tc, bundle)?.offers ?? []).map((o) => ({
    id: o.id,
    title: o.title,
    description: o.description,
    saving: amount(totals.offerValues[o.id] ?? 0),
    applied: applied.includes(o.id),
    combinable: o.stackable,
  }));
}

function emiData(money: SaleMoney, totals: OfferTotals, inputs: EmiInputs) {
  const e = computeEmi(totals.total, inputs);
  const ltv = checkLoanToValue(money, totals, inputs);
  return {
    monthly: amount(e.monthlyEmi),
    loan: amount(e.loanAmount),
    downPayment: amount(inputs.downPayment),
    ratePct: inputs.ratePct,
    tenureYears: inputs.tenureYears,
    totalInterest: amount(e.totalInterest),
    totalPayable: amount(e.totalPayable),
    ...(ltv && !ltv.withinLimit
      ? { bankLimit: { withinLimit: false, maxLoan: amount(ltv.maxLoan), minDownPayment: amount(ltv.minDownPayment), capPct: ltv.capPct } }
      : {}),
  };
}

function showSaleMoney(tc: ToolContext, input: ToolInput<'showMoney'>, bundle: PropertyBundle, money: SaleMoney): ToolResult {
  const state = stateOf(tc);
  const totals = offerTotals(tc, bundle, state);
  const spoken = input.downPaymentSpoken ? parseINRAmount(input.downPaymentSpoken) : null;
  if (input.downPaymentSpoken && spoken === null) {
    return fail(tc, `I could not read "${input.downPaymentSpoken}" as an amount.`, 'Ask the buyer for the down payment again, e.g. "2 crore" or "30 lakh".', 'attentive');
  }
  const downPayment = spoken ?? input.downPayment;
  const given = {
    ...(downPayment !== undefined ? { downPayment } : {}),
    ...(input.ratePct !== undefined ? { ratePct: input.ratePct } : {}),
    ...(input.tenureYears !== undefined ? { tenureYears: input.tenureYears } : {}),
  };
  const hasEmi = Object.keys(given).length > 0;
  const tab: MoneyTab = input.tab && SALE_TABS.includes(input.tab) ? input.tab : hasEmi ? 'emi' : 'breakup';

  let emi: EmiInputs | null = null;
  if (hasEmi) {
    const parsed = EmiInputsSchema.safeParse({ ...(state.params.money.emi ?? defaultEmiInputs(money, totals.total)), ...given });
    if (!parsed.success) return fail(tc, 'Those loan numbers are out of range.', 'Ask for a rate up to 30% and a tenure of 1 to 30 years.', 'attentive');
    if (parsed.data.downPayment >= totals.total) {
      return fail(tc, `That down payment covers the whole price of ${amount(totals.total).text}, so there is no loan.`, 'First check your units (1 crore = 10000000, 1 lakh = 100000) and call again if you converted wrongly. Only if the amount really covers the price, say so and ask what down payment they have in mind.', 'attentive');
    }
    emi = parsed.data;
  }

  dispatch(tc, { type: 'set_view', view: 'money', params: { tab, ...(emi ? { emi } : {}) } });
  const after = stateOf(tc);
  const base = {
    property: bundle.property.name,
    total: amount(totals.total),
    ...(totals.discountTotal > 0 ? { beforeOffers: amount(totals.subtotal), offersSaving: amount(totals.discountTotal) } : {}),
    note: money.estimateNote,
  };
  const expression = input.tone ?? 'composed';

  switch (tab) {
    case 'emi':
      return ok(tc, { ...base, emi: emiData(money, totals, emi ?? after.params.money.emi ?? defaultEmiInputs(money, totals.total)) }, expression);
    case 'offers': {
      const offers = offerList(tc, bundle, after, totals);
      return ok(tc, { ...base, offers, ...(offers.length ? {} : { offersNote: 'No offers on this property right now.' }) }, expression);
    }
    case 'schedule': {
      const plan = computePaymentPlan(money, totals);
      return ok(
        tc,
        {
          ...base,
          instalments: plan.stages.map((s) => ({ stage: s.stage, ...(s.due ? { due: s.due } : {}), percent: s.percent, amount: amount(s.amount) })),
          atHandover: { amount: amount(plan.handover.amount), items: plan.handover.items.map((i) => i.label) },
        },
        expression,
      );
    }
    default:
      return ok(tc, { ...base, items: totals.items.map((i) => ({ label: i.label, amount: amount(i.amount) })) }, expression);
  }
}

function showLeaseMoney(tc: ToolContext, input: ToolInput<'showMoney'>, bundle: PropertyBundle): ToolResult {
  if (bundle.money.kind !== 'lease') return fail(tc, 'No lease terms for this property.');
  if (input.downPayment !== undefined || input.downPaymentSpoken !== undefined || input.ratePct !== undefined || input.tenureYears !== undefined) {
    return fail(tc, `EMI applies to buying; ${bundle.property.name} is offered on lease.`, 'Explain that, and offer the monthly rent, deposit and lease terms instead.', 'attentive');
  }
  const lease = bundle.money;
  const t = computeLeaseTotals(lease);
  const tab: MoneyTab = input.tab === 'offers' ? 'offers' : 'lease';
  dispatch(tc, { type: 'set_view', view: 'money', params: { tab } });
  const state = stateOf(tc);
  const totals = offerTotals(tc, bundle, state);
  return ok(
    tc,
    {
      property: bundle.property.name,
      rentMonthly: amount(lease.rentMonthly),
      maintenanceMonthly: amount(lease.maintenanceMonthly),
      gst: { percent: lease.gstPct, monthly: amount(t.gst) },
      monthlyTotal: amount(t.monthlyTotal),
      seats: lease.seats,
      perSeatMonthly: amount(t.perSeatMonthly),
      deposit: { months: lease.depositMonths, amount: amount(t.deposit) },
      lockInMonths: lease.lockInMonths,
      termMonths: lease.termMonths,
      term: monthsAsYears(lease.termMonths),
      lockIn: monthsAsYears(lease.lockInMonths),
      escalation: `${lease.escalationPct}% every ${lease.escalationEveryMonths} months`,
      fitOut: lease.fitOut,
      inclusions: lease.inclusions.slice(0, MAX_INCLUSIONS),
      ...(totals.discountTotal > 0 ? { offersSaving: amount(totals.discountTotal), offersNote: LEASE_TERM_NOTE } : {}),
      ...(tab === 'offers' ? { offers: offerList(tc, bundle, state, totals) } : {}),
      note: lease.estimateNote,
    },
    input.tone ?? 'composed',
  );
}

export function showMoney(tc: ToolContext, input: ToolInput<'showMoney'>): ToolResult {
  const wantsSale =
    input.downPayment !== undefined || input.downPaymentSpoken !== undefined || input.ratePct !== undefined || input.tenureYears !== undefined || (input.tab !== undefined && input.tab !== 'lease' && input.tab !== 'offers');
  const prefer = wantsSale ? isSale : input.tab === 'lease' ? (b: PropertyBundle) => !isSale(b) : undefined;
  const r = resolveProperty(tc, prefer);
  if (!r.bundle) return r.result;
  return r.bundle.money.kind === 'sale' ? showSaleMoney(tc, input, r.bundle, r.bundle.money) : showLeaseMoney(tc, input, r.bundle);
}

/* ------------------------------ Offers ------------------------------ */

export function findOffer(offers: Offer[], query: string): Offer | null {
  return offers.find((o) => o.id === query.trim()) ?? matchByName(offers.map((o) => ({ ...o, name: o.title })), query);
}

export function applyOffer(tc: ToolContext, input: ToolInput<'applyOffer'>): ToolResult {
  const r = resolveProperty(tc);
  if (!r.bundle) return r.result;
  const bundle = r.bundle;
  const policy = policyFor(tc, bundle);
  const offers = policy?.offers ?? [];
  if (!policy || offers.length === 0) {
    return fail(tc, `There are no offers on ${bundle.property.name} right now.`, 'Say so; if they want a better price, check it with requestDiscount.');
  }
  const offer = findOffer(offers, input.offerId);
  if (!offer) {
    return fail(tc, `There is no offer called "${input.offerId}".`, `Available offers: ${offers.map((o) => `${o.id} (${o.title})`).join('; ')}.`);
  }

  // Show the offers either way, so the buyer sees what is being proposed.
  dispatch(tc, { type: 'set_view', view: 'money', params: { tab: isSale(bundle) ? 'offers' : 'lease' } });
  const before = offerTotals(tc, bundle, stateOf(tc));
  const saving = amount(before.offerValues[offer.id] ?? 0);
  const check = checkOfferApplication(policy, before, offer.id);
  const lease = !isSale(bundle);

  switch (check.reason) {
    case 'already_applied':
      return ok(tc, { offer: offer.title, alreadyApplied: true, ...(lease ? {} : { total: amount(before.total) }) }, input.tone ?? 'composed');
    case 'not_stackable': {
      const appliedTitles = before.discounts.map((d) => `"${d.title}"`).join(' and ');
      return fail(tc, `"${offer.title}" can't be combined with ${appliedTitles}.`, 'Explain that only one of these can apply, and offer a senior advisor if they want to compare.');
    }
    case 'over_limit':
      return fail(
        tc,
        `Adding "${offer.title}" would take the total discount to ${check.totalPctAfter}%, past the ${check.maxPct}% I can give.`,
        'Explain that kindly and propose a senior advisor; call requestHuman only after the buyer agrees.',
      );
    case 'unknown_offer':
      return fail(tc, `There is no offer called "${input.offerId}".`, `Available offers: ${offers.map((o) => `${o.id} (${o.title})`).join('; ')}.`);
    case 'ok':
      break;
  }

  if (!input.confirmed) {
    return fail(
      tc,
      'Applying an offer needs the buyer\'s clear yes first.',
      `Describe "${offer.title}" (saves ${saving.text}) and ask whether to apply it. Call again with confirmed true only after a clear yes.`,
      'attentive',
    );
  }

  dispatch(tc, { type: 'apply_offer', propertyId: bundle.property.id, offerId: offer.id });
  const after = offerTotals(tc, bundle, stateOf(tc));
  return ok(
    tc,
    lease
      ? { offer: offer.title, saving, note: LEASE_TERM_NOTE }
      : { offer: offer.title, saving, previousTotal: amount(before.total), total: amount(after.total) },
    input.tone ?? 'delighted',
  );
}

/* ------------------------------ Discounts ------------------------------ */

export function requestDiscount(tc: ToolContext, input: ToolInput<'requestDiscount'>): ToolResult {
  const r = resolveProperty(tc);
  if (!r.bundle) return r.result;
  const bundle = r.bundle;
  const policy = policyFor(tc, bundle);
  if (!policy) return fail(tc, 'There is no discount policy for this property.', 'Offer to bring in a senior advisor to discuss price.');

  const state = stateOf(tc);
  const totals = offerTotals(tc, bundle, state);
  const asked = input.percent !== undefined || input.amount !== undefined;
  const check = checkDiscount(policy, totals, { percent: input.percent, amount: input.amount });
  const lease = !isSale(bundle);
  const offersById = new Map(policy.offers.map((o) => [o.id, o]));
  const availableOffers = check.availableOfferIds
    .map((id) => offersById.get(id))
    .filter((o): o is Offer => Boolean(o))
    .map((o) => ({ id: o.id, title: o.title, saving: amount(totals.offerValues[o.id] ?? 0) }));
  const handoff = check.handoff || (!check.allowed && !check.suggestion);

  dispatch(tc, { type: 'set_view', view: 'money', params: { tab: lease ? 'lease' : 'offers' } });
  if (asked) {
    dispatch(tc, {
      type: 'note',
      kind: 'discount_request',
      label: `Buyer asked for ${check.requestedPct}% off (${check.allowed ? 'within' : 'above'} the ${check.maxPct}% limit)`,
    });
  }

  const offersHint = availableOffers.length ? ' Applying a listed offer needs a clear yes.' : '';
  const guidance = !asked
    ? `Ask what they have in mind.${check.suggestion ? ` You can go up to ${check.suggestion.percent}%.` : ''}${offersHint}`
    : check.allowed
      ? `Within your limit. You may agree to it, and say a senior advisor will confirm the revised price in writing.${offersHint}`
      : check.suggestion
        ? `Above your limit. Do not refuse flatly: offer up to ${check.suggestion.percent}% instead${availableOffers.length ? ' or a listed offer' : ''}${handoff ? ', then propose a senior advisor; call requestHuman only after the buyer agrees' : ''}.`
        : 'Nothing more can be given within policy. Do not refuse flatly: propose a senior advisor, and call requestHuman only after the buyer agrees.';

  return ok(
    tc,
    {
      ...(asked ? { requested: { percent: check.requestedPct, amount: amount(check.requestedAmount) } } : {}),
      of: lease ? LEASE_TERM_NOTE.toLowerCase() : 'the price before offers',
      allowed: check.allowed,
      ...(check.appliedAmount > 0 ? { alreadyGiven: { percent: check.appliedPct, amount: amount(check.appliedAmount) } } : {}),
      canOffer: check.suggestion ? { percent: check.suggestion.percent, amount: amount(check.suggestion.amount) } : null,
      availableOffers,
      handoffRecommended: handoff,
      guidance,
    },
    input.tone ?? (check.allowed || !asked ? 'composed' : 'apologetic'),
  );
}

/** "36 months (3 years)", "12 months (1 year)", "18 months": so the advisor can say it either way and stay grounded. */
function monthsAsYears(months: number): string {
  if (months % 12 !== 0) return `${months} months`;
  const years = months / 12;
  return `${months} months (${years} year${years === 1 ? '' : 's'})`;
}
