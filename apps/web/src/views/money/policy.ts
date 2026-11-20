import type { PropertyOfferPolicy } from '@ave/shared';
import { content } from '@/content';

/** A property with no entry in the offers policy gets no offers and no discount headroom. */
const NO_OFFERS: PropertyOfferPolicy = { offers: [], maxDiscountPct: 0, handoffAbovePct: 0 };

/** The offers policy for one property, from data/policy/offers.json. */
export function offerPolicyFor(propertyId: string): PropertyOfferPolicy {
  return content.offers.properties[propertyId] ?? NO_OFFERS;
}
