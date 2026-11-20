import type { LatLng } from './views.js';
import type { OffersPolicy, PropertyBundle } from './data.js';
import { computeLeaseOfferTotals, computeLeaseTotals, computeSaleTotals, groupLineItems } from './money.js';
import { formatINR, formatSqft } from './format.js';

/**
 * Building blocks for messages the admin sends from the Desk (quick actions and the copilot):
 * links a buyer can open on their phone, and a plain-text price sheet from the same money
 * functions the Pricing view uses.
 */

/** Google Maps "search" link: opens a pin at the coordinates in the app or the browser. */
export const GOOGLE_MAPS_SEARCH_URL = 'https://www.google.com/maps/search/?api=1&query=';

export function mapsPinUrl(location: LatLng): string {
  return `${GOOGLE_MAPS_SEARCH_URL}${location.lat},${location.lng}`;
}

/** Path of the buyer's read-only call summary page, which doubles as their property page. */
export function callSummaryPath(sessionId: string): string {
  return `/call/${encodeURIComponent(sessionId)}/summary`;
}

/** The price breakup as short plain-text lines, with any applied offers taken off. */
export function priceSheetText(bundle: PropertyBundle, offers: OffersPolicy, appliedOfferIds: string[]): string {
  const { property, money } = bundle;
  const policyOffers = offers.properties[property.id]?.offers ?? [];
  const lines = [`${property.name}: ${property.configuration}, ${property.localityName}`];
  if (money.kind === 'sale') {
    const totals = computeSaleTotals(money, property.areas, policyOffers, appliedOfferIds);
    lines.push(`Carpet area ${formatSqft(property.areas.carpetSqft)}`);
    for (const g of groupLineItems(totals.items)) lines.push(`${g.label}: ${formatINR(g.amount)}`);
    for (const d of totals.discounts) lines.push(`${d.title}: -${formatINR(d.amount)}`);
    lines.push(`All-in price: ${formatINR(totals.total)}`);
  } else {
    const lease = computeLeaseTotals(money);
    const withOffers = computeLeaseOfferTotals(money, policyOffers, appliedOfferIds);
    lines.push(`${money.seats} seats, ${formatSqft(property.areas.carpetSqft)} carpet`);
    lines.push(`Rent + maintenance: ${formatINR(lease.monthlyBeforeTax)} a month + ${money.gstPct}% GST = ${formatINR(lease.monthlyTotal)}`);
    lines.push(`Per seat: ${formatINR(lease.perSeatMonthly)} a month`);
    lines.push(`Deposit: ${formatINR(lease.deposit)} (${money.depositMonths} months' rent)`);
    lines.push(`Term ${money.termMonths} months, lock-in ${money.lockInMonths} months`);
    for (const d of withOffers.discounts) lines.push(`${d.title}: -${formatINR(d.amount)} over the term`);
  }
  return lines.join('\n');
}
