import { VENDOR_BUDGET_CATEGORY, type Enquiry, type Vendor, type VendorCategory, type VendorPackage } from './schema.js';
import type { BudgetCategory } from '../state.js';

/** Pure, deterministic vendor search and pricing. No language model is involved in any figure. */

export interface VendorFilter {
  text?: string;
  category?: VendorCategory;
  /** Matches the vendor's base location or any service area (case-insensitive). */
  location?: string;
  /** Keeps vendors with at least one package at or under this estimate for `guests`. */
  maxBudgetInr?: number;
  guests?: number;
  specialisation?: string;
  verifiedOnly?: boolean;
  includeDemo?: boolean;
}

export const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function packageEstimate(p: VendorPackage, guests: number): number {
  return p.pricingUnit === 'per_guest' ? p.priceInr * guests : p.priceInr;
}

export const packageFits = (p: VendorPackage, guests: number) => (p.minGuests === undefined || guests >= p.minGuests) && (p.maxGuests === undefined || guests <= p.maxGuests);

export const servesLocation = (v: Vendor, location: string) => eq(v.location, location) || v.serviceAreas.some((a) => eq(a, location));
export const supportsGuests = (v: Vendor, guests: number) => guests >= v.capacity.min && guests <= v.capacity.max;

/** Cheapest estimate across the vendor's packages that suit `guests` (all packages if none state a limit that fits). */
export function cheapestEstimate(v: Vendor, guests: number): number | null {
  const suitable = v.packages.filter((p) => packageFits(p, guests));
  const list = suitable.length ? suitable : v.packages;
  return list.length ? Math.min(...list.map((p) => packageEstimate(p, guests))) : null;
}

export interface VendorHit { vendor: Vendor; cheapestInr: number | null; matchedBy: string[] }

export function searchVendors(vendors: readonly Vendor[], f: VendorFilter, guestsDefault = 100): VendorHit[] {
  const guests = f.guests ?? guestsDefault;
  const words = (f.text ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const hits: VendorHit[] = [];
  for (const v of vendors) {
    if (f.includeDemo === false && v.source === 'demo') continue;
    if (f.verifiedOnly && v.verification.status !== 'verified') continue;
    if (f.category && v.category !== f.category) continue;
    if (f.location && !servesLocation(v, f.location)) continue;
    if (f.guests !== undefined && !supportsGuests(v, f.guests)) continue;
    if (f.specialisation && !v.specialisations.some((s) => s.toLowerCase().includes(f.specialisation!.toLowerCase()))) continue;
    const cheapest = cheapestEstimate(v, guests);
    if (f.maxBudgetInr !== undefined && (cheapest === null || cheapest > f.maxBudgetInr)) continue;
    const hay = [v.businessName, v.description, ...v.specialisations, ...v.services, v.location, ...v.serviceAreas].join(' ').toLowerCase();
    if (words.length && !words.every((w) => hay.includes(w))) continue;
    hits.push({ vendor: v, cheapestInr: cheapest, matchedBy: [f.category && 'category', f.location && 'location', f.maxBudgetInr !== undefined && 'budget', f.specialisation && 'style', words.length && 'text'].filter(Boolean) as string[] });
  }
  // Verified first, then cheapest, then name: a stable, explainable order.
  return hits.sort((a, b) => Number(b.vendor.verification.status === 'verified') - Number(a.vendor.verification.status === 'verified') || (a.cheapestInr ?? Infinity) - (b.cheapestInr ?? Infinity) || a.vendor.businessName.localeCompare(b.vendor.businessName));
}

export type TrustLabel = 'DEMO DATA' | 'Verified' | 'Verification pending' | 'Unverified';
export function trustLabel(v: Vendor): TrustLabel {
  if (v.source === 'demo') return 'DEMO DATA';
  return v.verification.status === 'verified' ? 'Verified' : v.verification.status === 'pending' ? 'Verification pending' : 'Unverified';
}

export type AvailabilityAnswer = { known: false; note: string } | { known: true; date: string; available: boolean; note: string };
/** We only ever answer from supplied data. Without it, availability is unknown rather than guessed. */
export function checkAvailability(v: Vendor, date: string | null): AvailabilityAnswer {
  if (!v.availability.provided) return { known: false, note: 'This vendor has not supplied availability, so it is unknown. A quotation request is the way to find out.' };
  if (!date) return { known: false, note: 'No wedding date is set, so availability cannot be checked.' };
  const booked = v.availability.bookedDates.includes(date);
  return { known: true, date, available: !booked, note: booked ? 'The vendor marked this date as booked.' : 'The vendor has not marked this date as booked (not a confirmation).' };
}

export const budgetCategoryFor = (c: VendorCategory): BudgetCategory => VENDOR_BUDGET_CATEGORY[c];

export function buildSampleQuotation(v: Vendor, p: VendorPackage | null, guests: number): NonNullable<Enquiry['quotation']> {
  const price = p ? packageEstimate(p, guests) : v.startingPriceInr;
  const basis = p ? (p.pricingUnit === 'per_guest' ? `${p.name}: list price per guest × ${guests} guests` : `${p.name}: list price`) : 'Starting price (no package chosen)';
  return { label: 'SAMPLE QUOTATION', amountInr: price, basis: `${basis}. Computed from the listed price; not an offer from the vendor.` };
}
