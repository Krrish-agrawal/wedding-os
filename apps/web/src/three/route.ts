import { Vector3, type Object3D } from 'three';
import type { Vec3 } from '@ave/shared';
import { levelAtHeight, type Level } from './levels';
import { sectionSegments, type Segment } from './section';

/**
 * Route planning for tour moves. Each stop's `via` chain is authored as a walk from the home's main
 * circulation (hall, corridor) into the stop. A move from stop A to stop B considers
 * A's chain backwards, then B's chain, and drops every point it can skip without crossing a wall at
 * eye level. Moves to and from the overview rise above or drop into the room through the cutaway.
 */

/** Heights above each floor at which walls are sampled for line-of-sight checks, metres. */
const SAMPLE_HEIGHTS = [1.0, 1.6] as const;
/** The cutaway (ceilings removed) starts this far above the top floor. */
export const CUTAWAY_ABOVE_TOP_FLOOR = 2.2;
/** The camera switches the cutaway on once it is this far above the cut. */
const CUTAWAY_TRIGGER_MARGIN = 0.5;
/** Height above the cut at which moves to and from the overview travel. */
const RISE_MARGIN = 1.2;
/** Camera eye height above a floor, and how far a point may be from it and still count as "on" that floor. */
const EYE_HEIGHT = 1.6;
const EYE_TOLERANCE = 0.45;
/** Half-width of the corridor a shortcut must keep clear of walls, metres. */
const CLEARANCE = 0.22;
/** Points closer than this are merged. */
const MERGE_DISTANCE = 0.25;

export interface Cutaway {
  /** Height of the clipping plane while the cutaway is on. */
  cutY: number;
  /** The cutaway is on while the camera is above this height. */
  triggerY: number;
}

export function cutawayFor(levels: Level[]): Cutaway {
  const top = levels.reduce((a, b) => (b.floorY > a.floorY ? b : a), levels[0]!);
  const cutY = top.floorY + CUTAWAY_ABOVE_TOP_FLOOR;
  return { cutY, triggerY: cutY + CUTAWAY_TRIGGER_MARGIN };
}

export class CollisionMap {
  private readonly byLevel = new Map<number, Segment[]>();

  constructor(
    structure: Object3D | null,
    private readonly levels: Level[],
  ) {
    for (const level of levels) {
      const segs: Segment[] = [];
      if (structure) for (const h of SAMPLE_HEIGHTS) segs.push(...sectionSegments(structure, level.floorY + h));
      this.byLevel.set(level.index, segs);
    }
  }

  private onFloor(y: number): boolean {
    return this.levels.some((l) => Math.abs(y - (l.floorY + EYE_HEIGHT)) <= EYE_TOLERANCE);
  }

  /**
   * True when a walk between two eye-level points would pass through or brush a wall: the centre
   * line and two lines `CLEARANCE` either side of it are tested.
   */
  blocked(a: Vector3, b: Vector3): boolean {
    // Points on a stair (not at any floor's eye height) are never skipped, and neither is a change of level.
    if (!this.onFloor(a.y) || !this.onFloor(b.y)) return true;
    const la = levelAtHeight(this.levels, a.y).index;
    const lb = levelAtHeight(this.levels, b.y).index;
    if (la !== lb) return true;
    const segs = this.byLevel.get(la) ?? [];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = len > 0 ? (-(b.z - a.z) / len) * CLEARANCE : 0;
    const nz = len > 0 ? ((b.x - a.x) / len) * CLEARANCE : 0;
    for (const k of [0, 1, -1]) {
      const ax = a.x + nx * k;
      const az = a.z + nz * k;
      const bx = b.x + nx * k;
      const bz = b.z + nz * k;
      for (const s of segs) if (segmentsCross(ax, az, bx, bz, s[0], s[1], s[2], s[3])) return true;
    }
    return false;
  }
}

function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = cross(cx, cz, dx, dz, ax, az);
  const d2 = cross(cx, cz, dx, dz, bx, bz);
  const d3 = cross(ax, az, bx, bz, cx, cz);
  const d4 = cross(ax, az, bx, bz, dx, dz);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function cross(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  return (bx - ax) * (pz - az) - (bz - az) * (px - ax);
}

export interface RouteRequest {
  from: Vector3;
  /** The via chain of the stop the camera is at (or was heading to); empty when unknown. */
  fromChain: Vec3[];
  to: Vector3;
  toChain: Vec3[];
  cutaway: Cutaway;
  collision: CollisionMap | null;
}

/** Intermediate points for a move (endpoints excluded). */
export function planRoute({ from, fromChain, to, toChain, cutaway, collision }: RouteRequest): Vec3[] {
  const fromAbove = from.y > cutaway.triggerY;
  const toAbove = to.y > cutaway.triggerY;
  const riseY = cutaway.cutY + RISE_MARGIN;
  if (fromAbove && toAbove) return [];
  if (fromAbove) return [[to.x, riseY, to.z]];
  if (toAbove) return [[from.x, riseY, from.z]];

  const pts = dedupe([from, ...[...fromChain].reverse().map((v) => new Vector3(...v)), ...toChain.map((v) => new Vector3(...v)), to]);
  if (!collision) return pts.slice(1, -1).map((p) => p.toArray());
  const out: Vector3[] = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && collision.blocked(pts[i]!, pts[j]!)) j--;
    if (j < pts.length - 1) out.push(pts[j]!);
    i = j;
  }
  return out.map((p) => p.toArray());
}

/** Merges near-duplicate points, always keeping the first and the last. */
function dedupe(pts: Vector3[]): Vector3[] {
  const out: Vector3[] = [];
  pts.forEach((p, i) => {
    const last = out[out.length - 1];
    if (!last || last.distanceTo(p) > MERGE_DISTANCE) out.push(p);
    else if (i === pts.length - 1) out[out.length - 1] = p;
  });
  return out;
}
