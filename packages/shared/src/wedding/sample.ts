import type { WeddingState } from './state.js';
import { WEDDING_STATE_VERSION } from './state.js';

/**
 * SAMPLE DATA. Every venue, vendor and price below is invented for the demo. Nothing here is a real
 * business or a real quote, and the UI must say so wherever these appear.
 */
export const SAMPLE_DATA_NOTICE = 'Sample data: these venues, vendors and prices are illustrative, not real quotes.';

export interface SampleVenue {
  id: string;
  name: string;
  city: string;
  capacity: number;
  /** Indicative hire for one day, rupees. */
  pricePerDay: number;
  indoor: boolean;
  blurb: string;
  source: 'sample';
}

export const SAMPLE_VENUES: readonly SampleVenue[] = [
  { id: 'venue-grand-ballroom', name: 'Sample Grand Ballroom', city: 'Bengaluru', capacity: 400, pricePerDay: 450_000, indoor: true, blurb: 'Indoor ballroom with a raised stage bay and high ceiling.', source: 'sample' },
  { id: 'venue-courtyard-hall', name: 'Sample Courtyard Hall', city: 'Bengaluru', capacity: 180, pricePerDay: 220_000, indoor: true, blurb: 'Mid-size hall with pillars and warm wood panelling.', source: 'sample' },
  { id: 'venue-lakeside-lawn', name: 'Sample Lakeside Lawn', city: 'Mysuru', capacity: 600, pricePerDay: 350_000, indoor: false, blurb: 'Open lawn with a covered mandap platform.', source: 'sample' },
];

export function sampleVenue(id: string): SampleVenue | undefined {
  return SAMPLE_VENUES.find((v) => v.id === id);
}

/** A fresh workspace with a clearly fictional couple, so the dashboard is never empty. */
export function createSampleWedding(id: string): WeddingState {
  return {
    version: WEDDING_STATE_VERSION,
    id,
    rev: 0,
    profile: { coupleNames: 'Aarav & Meera (sample)', city: 'Bengaluru', date: null, guestCount: 250, style: 'Royal Rajasthani', events: [], onboarded: false },
    venueId: null,
    scene: { objects: [] },
    sceneHistory: { past: [], future: [] },
    designs: [],
    budget: { total: 0, allocations: {}, expenses: [], limits: {} },
    vendorShortlist: [],
    outfits: [],
    design: { form: null, brief: null, source: null, referenceImageIds: [], versions: [], activeVersionId: null, variantCounter: 0 },
  };
}
