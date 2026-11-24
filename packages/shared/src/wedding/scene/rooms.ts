import type { WeddingState } from '../state.js';
import type { StudioRoom } from './geometry.js';

/**
 * Plan-view rooms for the sample venues that have a 3D model. The venue is data (a polygon and a height); the
 * renderer builds walls and floor from it and never mixes decoration into that geometry.
 * SAMPLE DATA: invented dimensions.
 */
/** Stage at the z=0 end, entrance in the middle of the opposite (z=d) wall, so every sample room faces -z. */
const layout = (w: number, d: number, bay: { w: number; d: number }, bayZ: number) => ({
  front: { x: 0, z: -1 },
  entrance: { wallIndex: 2, at: { x: w / 2, z: d } },
  stageBay: { centre: { x: w / 2, z: bayZ }, width: bay.w, depth: bay.d },
});
const rect = (w: number, d: number) => [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d }];
/** Half-pillars every `gap` metres along the two long walls, inset from the corners. */
const colonnade = (w: number, d: number, gap: number) => {
  const out: { x: number; z: number }[] = [];
  for (let x = gap / 2 + 1; x < w - 1; x += gap) out.push({ x, z: 0 }, { x, z: d });
  return out;
};

export const STUDIO_ROOMS: Readonly<Record<string, StudioRoom>> = {
  'venue-grand-ballroom': { name: 'Sample Grand Ballroom', corners: rect(24, 16), height: 7, theme: 'ballroom', ...layout(24, 16, { w: 9, d: 5 }, 3) },
  // Traditional indoor hall: longer and narrower than the ballroom, with a pillared colonnade, wood panelling and warm light.
  'venue-courtyard-hall': { name: 'Sample Courtyard Hall', corners: rect(18, 12), height: 5.5, theme: 'courtyard', pilasters: colonnade(18, 12, 3), ...layout(18, 12, { w: 8, d: 4.5 }, 2.8) },
  // Open lawn: grass, a hedge-and-lattice boundary, sky. No ceiling, so ceiling-mounted pieces are refused here.
  'venue-lakeside-lawn': { name: 'Sample Lakeside Lawn', corners: rect(30, 22), height: 8, outdoor: true, theme: 'lawn', wallHeight: 2.6, ...layout(30, 22, { w: 11, d: 6 }, 4.2) },
};

export const DEFAULT_STUDIO_VENUE_ID = 'venue-grand-ballroom';

/** The venue shown in the studio: the selected one when it has a 3D room (all three sample venues do), otherwise the default ballroom. */
export function studioVenueId(state: Pick<WeddingState, 'venueId'>): string {
  return state.venueId && STUDIO_ROOMS[state.venueId] ? state.venueId : DEFAULT_STUDIO_VENUE_ID;
}

export function studioRoom(state: Pick<WeddingState, 'venueId'>): StudioRoom {
  return STUDIO_ROOMS[studioVenueId(state)]!;
}
