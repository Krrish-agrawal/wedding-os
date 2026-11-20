import type { SessionState, ToolName } from '@ave/shared';
import { content, getBundle, otherPropertyId } from '@/content';

/** Example EMI inputs for the console: 30 lakh down over 20 years, as in the golden path. */
const EXAMPLE_DOWN_PAYMENT = 30_00_000;
const EXAMPLE_TENURE_YEARS = 20;
const EXAMPLE_DISCOUNT_PCT = 5;

/**
 * A ready-to-run input for each tool, built from the content of the property on screen,
 * so the console always starts from something valid.
 */
export function toolExample(name: ToolName, state: SessionState | null): Record<string, unknown> {
  const bundle = getBundle(state?.propertyId ?? null) ?? content.properties[0] ?? null;
  const sale = bundle?.property.kind === 'sale';
  const room = bundle?.rooms[0]?.name;
  switch (name) {
    case 'showShortlist':
    case 'getVisitSlots':
      return {};
    case 'openProperty':
      return { propertyId: otherPropertyId(state?.propertyId ?? null) ?? bundle?.property.id ?? '' };
    case 'tourGoTo':
      return { stop: bundle?.tour.stops[0]?.label ?? 'overview' };
    case 'tourWalkthrough':
      return { action: 'start' };
    case 'showBlueprint':
      return { layer: 'electrical', ...(room ? { room } : {}) };
    case 'showLocality':
      return { category: 'schools' };
    case 'showCommute':
      return { destination: bundle?.commute.routes[0]?.label ?? 'airport' };
    case 'showCompass':
      return { overlay: sale ? 'vastu' : 'seating', time: '7:30 am', ...(room ? { room } : {}) };
    case 'showMoney':
      return sale ? { downPayment: EXAMPLE_DOWN_PAYMENT, tenureYears: EXAMPLE_TENURE_YEARS } : { tab: 'lease' };
    case 'applyOffer':
      return { offerId: (bundle && content.offers.properties[bundle.property.id]?.offers[0]?.id) ?? '', confirmed: false };
    case 'requestDiscount':
      return { percent: EXAMPLE_DISCOUNT_PCT };
    case 'showLegal':
      return { document: bundle?.legal.documents[0]?.id ?? '' };
    case 'bookSiteVisit':
      return { slotId: bundle?.visits.find((s) => s.available && Date.parse(s.start) > Date.now())?.id ?? '', confirmed: false };
    case 'updateLead':
      return { purpose: 'Relocating to Bengaluru for work', needs: ['Close to the office'] };
    case 'sendReport':
      return { channels: ['email', 'whatsapp'], confirmed: false };
    case 'requestHuman':
      return { reason: 'Buyer asked to speak with a person' };
  }
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
