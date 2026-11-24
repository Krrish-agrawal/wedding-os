import { bounds, type Point, type StudioRoom } from '../scene/geometry.js';

/**
 * Semantic venue zones, computed from the real room outline (never hand-placed per venue). Convention: the stage bay is
 * against the wall at the lowest z (far from the default camera) and faces +z; the entrance is at the opposite end; guests
 * face -z toward the stage. Zones are rectangles in plan view, in metres.
 */

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface VenueZones {
  room: Rect;
  width: number;
  depth: number;
  centreX: number;
  /** Where the wedding stage sits (centre) and its clear bay. */
  stage: Rect & { at: Point };
  /** Centre of the mandap, on the stage. */
  mandap: Point;
  /** The main entrance centre, inside the far end. */
  entrance: Point;
  /** The aisle runs from the entrance to the stage front along x = centreX. */
  aisle: Rect;
  /** Left and right seating blocks either side of the aisle. */
  seating: { left: Rect; right: Rect };
  ceiling: Point;
  sideWalls: { left: Point; right: Point };
  /** Metres of free floor in front of the stage. */
  seatingDepth: number;
}

export const WALL_CLEARANCE = 1.2;
export const AISLE_HALF_WIDTH = 1.0;

export function zonesFor(room: Pick<StudioRoom, 'corners' | 'stageBay'>, stageSize = { width: 7, depth: 4 }): VenueZones {
  const b = bounds(room);
  const width = b.max.x - b.min.x;
  const depth = b.max.z - b.min.z;
  const cx = (b.min.x + b.max.x) / 2;
  const m = WALL_CLEARANCE;
  const stageZ = room.stageBay ? Math.max(room.stageBay.centre.z, b.min.z + stageSize.depth / 2 + 0.3) : b.min.z + m + stageSize.depth / 2;
  const stage = { minX: cx - stageSize.width / 2, maxX: cx + stageSize.width / 2, minZ: stageZ - stageSize.depth / 2, maxZ: stageZ + stageSize.depth / 2, at: { x: cx, z: stageZ } };
  const seatMinZ = stage.maxZ + 1.5;
  const seatMaxZ = b.max.z - 3.2;
  const left: Rect = { minX: b.min.x + m + 0.6, maxX: cx - AISLE_HALF_WIDTH - 0.3, minZ: seatMinZ, maxZ: seatMaxZ };
  const right: Rect = { minX: cx + AISLE_HALF_WIDTH + 0.3, maxX: b.max.x - m - 0.6, minZ: seatMinZ, maxZ: seatMaxZ };
  return {
    room: { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z },
    width, depth, centreX: cx, stage,
    mandap: { x: cx, z: stageZ },
    entrance: { x: cx, z: b.max.z - 1.0 },
    aisle: { minX: cx - AISLE_HALF_WIDTH, maxX: cx + AISLE_HALF_WIDTH, minZ: stage.maxZ + 0.3, maxZ: b.max.z - 1.8 },
    seating: { left, right },
    ceiling: { x: cx, z: (b.min.z + b.max.z) / 2 },
    sideWalls: { left: { x: b.min.x, z: (seatMinZ + seatMaxZ) / 2 }, right: { x: b.max.x, z: (seatMinZ + seatMaxZ) / 2 } },
    seatingDepth: Math.max(0, seatMaxZ - seatMinZ),
  };
}

export const rectWidth = (r: Rect) => r.maxX - r.minX;
export const rectDepth = (r: Rect) => r.maxZ - r.minZ;
