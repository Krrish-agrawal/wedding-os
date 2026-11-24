import { z } from 'zod';

/**
 * Plan-view geometry for the wedding studio. Ported and adapted from the room-configurator reference
 * (room.ts, catalog.ts): polygon rooms, point-in-polygon, wall-crossing and separating-axis overlap tests.
 * Differences: angles are radians and follow Three.js `rotation.y` (so what is tested is what is drawn), and
 * the plan axes are x and z with y up.
 */

export interface Point {
  x: number;
  z: number;
}

export const PointSchema = z.object({ x: z.number().finite(), z: z.number().finite() });

export interface StudioRoom {
  name: string;
  /** Floor outline, in metres. Either winding. */
  corners: Point[];
  /** Floor to ceiling, metres. */
  height: number;
  /** Open-air venue: no ceiling, so nothing can hang from one. Defaults to false. */
  outdoor?: boolean;
  /** Look of the shell (the renderer picks materials from it). Defaults to 'ballroom'. */
  theme?: 'ballroom' | 'courtyard' | 'lawn';
  /** Height of the wall or boundary as drawn, metres (a lawn has a low fence, not walls to the sky). Defaults to `height`. */
  wallHeight?: number;
  /** Decorative half-pillars against the walls (plan positions). Visual only: they do not block placement. */
  pilasters?: Point[];
  /** Unit vector pointing from the entrance toward the stage bay (the way the room "faces"). */
  front?: Point;
  /** Where guests enter: the wall (index into `walls(room)`) and the doorway's midpoint on it. */
  entrance?: { wallIndex: number; at: Point };
  /** The designated stage area: centre and size in metres (axis-aligned). */
  stageBay?: { centre: Point; width: number; depth: number };
}

export const StudioRoomSchema = z.object({ name: z.string(), corners: z.array(PointSchema).min(3).max(64), height: z.number().min(2).max(30), outdoor: z.boolean().default(false), theme: z.enum(['ballroom', 'courtyard', 'lawn']).default('ballroom'), wallHeight: z.number().min(0.3).max(30).optional(), pilasters: z.array(PointSchema).max(64).optional(), front: PointSchema.optional(), entrance: z.object({ wallIndex: z.number().int().min(0), at: PointSchema }).optional(), stageBay: z.object({ centre: PointSchema, width: z.number().positive(), depth: z.number().positive() }).optional() });

export type Footprint = Point[];

export interface Wall {
  index: number;
  from: Point;
  to: Point;
  length: number;
}

/** Millimetre tolerance. */
const EPSILON = 0.001;

export const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function walls(room: Pick<StudioRoom, 'corners'>): Wall[] {
  return room.corners.map((from, index) => {
    const to = room.corners[(index + 1) % room.corners.length]!;
    return { index, from, to, length: Math.hypot(to.x - from.x, to.z - from.z) };
  });
}

export function bounds(room: Pick<StudioRoom, 'corners'>) {
  const xs = room.corners.map((p) => p.x);
  const zs = room.corners.map((p) => p.z);
  const min = { x: Math.min(...xs), z: Math.min(...zs) };
  const max = { x: Math.max(...xs), z: Math.max(...zs) };
  return { min, max, width: max.x - min.x, depth: max.z - min.z, centre: { x: (min.x + max.x) / 2, z: (min.z + max.z) / 2 } };
}

/** +1 when the corners run anticlockwise in x/z (inside is left of each wall), -1 otherwise. */
export function winding(room: Pick<StudioRoom, 'corners'>): number {
  let twice = 0;
  room.corners.forEach((p, i) => {
    const q = room.corners[(i + 1) % room.corners.length]!;
    twice += p.x * q.z - q.x * p.z;
  });
  return twice > 0 ? 1 : -1;
}

/** Unit normal of a wall pointing into the room. */
export function inwardNormal(room: Pick<StudioRoom, 'corners'>, wall: Wall): Point {
  const w = winding(room);
  const len = wall.length || 1;
  return { x: (-(wall.to.z - wall.from.z) / len) * w, z: ((wall.to.x - wall.from.x) / len) * w };
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

function onSegment(p: Point, a: Point, b: Point): boolean {
  return Math.min(a.x, b.x) - EPSILON <= p.x && p.x <= Math.max(a.x, b.x) + EPSILON && Math.min(a.z, b.z) - EPSILON <= p.z && p.z <= Math.max(a.z, b.z) + EPSILON;
}

export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  if (((d1 > EPSILON && d2 < -EPSILON) || (d1 < -EPSILON && d2 > EPSILON)) && ((d3 > EPSILON && d4 < -EPSILON) || (d3 < -EPSILON && d4 > EPSILON))) return true;
  if (Math.abs(d1) <= EPSILON && onSegment(a1, b1, b2)) return true;
  if (Math.abs(d2) <= EPSILON && onSegment(a2, b1, b2)) return true;
  if (Math.abs(d3) <= EPSILON && onSegment(b1, a1, a2)) return true;
  if (Math.abs(d4) <= EPSILON && onSegment(b2, a1, a2)) return true;
  return false;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** Even-odd rule; a point on the boundary (to the millimetre) counts as inside. */
export function pointInRoom(point: Point, room: Pick<StudioRoom, 'corners'>): boolean {
  if (walls(room).some((w) => distanceToSegment(point, w.from, w.to) < EPSILON)) return true;
  let inside = false;
  const c = room.corners;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const a = c[i]!;
    const b = c[j]!;
    if (a.z > point.z !== b.z > point.z) {
      const x = ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

function strictlyInside(point: Point, polygon: Footprint): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const side = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
    if (Math.abs(side) < 1e-6) return false;
    if (sign === 0) sign = Math.sign(side);
    else if (Math.sign(side) !== sign) return false;
  }
  return true;
}

/** Whether segment a-b only touches the wall line c-d (an end on it, or entirely on one side), to 0.1 mm. */
function touchesOnly(a: Point, b: Point, c: Point, d: Point): boolean {
  const len = Math.hypot(d.x - c.x, d.z - c.z) || 1;
  const side = (p: Point) => ((d.x - c.x) * (p.z - c.z) - (d.z - c.z) * (p.x - c.x)) / len; // signed distance
  const sa = side(a);
  const sb = side(b);
  return Math.abs(sa) < 1e-4 || Math.abs(sb) < 1e-4 || Math.sign(sa) === Math.sign(sb);
}

/** The whole footprint is on the floor: every corner inside and no wall cutting through it. */
export function insideRoom(fp: Footprint, room: Pick<StudioRoom, 'corners'>): boolean {
  if (!fp.every((p) => pointInRoom(p, room))) return false;
  if (room.corners.some((corner) => strictlyInside(corner, fp))) return false;
  for (const wall of walls(room)) {
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i]!;
      const b = fp[(i + 1) % fp.length]!;
      if (segmentsIntersect(a, b, wall.from, wall.to) && !touchesOnly(a, b, wall.from, wall.to)) return false;
    }
  }
  return true;
}

/** Separating-axis overlap of two convex footprints; touching edges or corners do not overlap. */
export function footprintsOverlap(a: Footprint, b: Footprint, tolerance = 1e-6): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i]!;
      const q = polygon[(i + 1) % polygon.length]!;
      const axis = { x: -(q.z - p.z), z: q.x - p.x };
      const project = (pts: Footprint) => pts.map((pt) => pt.x * axis.x + pt.z * axis.z);
      const pa = project(a);
      const pb = project(b);
      const length = Math.hypot(axis.x, axis.z) || 1;
      const gap = Math.max(Math.min(...pa) - Math.max(...pb), Math.min(...pb) - Math.max(...pa)) / length;
      if (gap >= -tolerance) return false;
    }
  }
  return true;
}

/** Local (lx, lz) to world offset for rotation `theta` about +y, as Three.js does it. */
export function rotateLocal(lx: number, lz: number, theta: number): Point {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

/** Normalises an angle to (-PI, PI]. */
export function normaliseAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return Math.round(r * 1e9) / 1e9;
}

/** Floor outline of a `width` x `depth` box or ellipse centred at `at`, turned by `rotationY`. */
export function footprint(shape: 'box' | 'cylinder', width: number, depth: number, at: Point, rotationY: number): Footprint {
  const local: Point[] =
    shape === 'cylinder'
      ? Array.from({ length: 16 }, (_, i) => {
          const t = (i / 16) * Math.PI * 2;
          return { x: (Math.cos(t) * width) / 2, z: (Math.sin(t) * depth) / 2 };
        })
      : [{ x: -width / 2, z: -depth / 2 }, { x: width / 2, z: -depth / 2 }, { x: width / 2, z: depth / 2 }, { x: -width / 2, z: depth / 2 }];
  return local.map((p) => {
    const w = rotateLocal(p.x, p.z, rotationY);
    return { x: at.x + w.x, z: at.z + w.z };
  });
}
