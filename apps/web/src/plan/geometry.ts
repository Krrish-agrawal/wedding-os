import { polygonCentroid, pointInPolygon, polygonBounds, type Box2, type Vec2 } from '@ave/shared';

/**
 * Maps model (x, z) metres to SVG pixels. The plan is drawn in pixel space (not a scaled viewBox)
 * so strokes, symbols and text keep a fixed, crisp size whatever the stage size is.
 * Model -Z points up on screen, so with a zero north offset north is up.
 */
export interface PlanProjection {
  width: number;
  height: number;
  /** Pixels per metre. */
  scale: number;
  x(mx: number): number;
  y(mz: number): number;
  toScreen(p: Vec2): [number, number];
  toModel(sx: number, sy: number): Vec2;
  /** Screen centre of the plan bounds: the point compass bearings are measured from. */
  centre: [number, number];
  /**
   * Semi-axes (px) of the ellipse the compass ring starts from, centred on `centre`; the plan sits
   * inside it. Null when no ring was asked for.
   */
  ring: { a: number; b: number } | null;
}

export interface FitOptions {
  /** Empty space kept on every side, in px. */
  margin: number;
  /**
   * When set, leave a band this many px wide around the plan for a compass ring. The ring is an
   * ellipse filling the stage, centred on the plan bounds centre, and the plan is scaled to fit inside it.
   */
  ringPx?: number;
  /** Space between the plan's corners and the ring, in px. */
  ringGapPx?: number;
}

/**
 * Fit `rooms` (the built footprint) into the stage. `bounds` is the plan image's rectangle; its centre
 * is where compass bearings are measured from, so the ring is centred there.
 */
export function fitProjection(rooms: Box2, bounds: Box2, width: number, height: number, opts: FitOptions): PlanProjection {
  const { margin } = opts;
  const availW = Math.max(1, width - 2 * margin);
  const availH = Math.max(1, height - 2 * margin);
  let scale: number;
  let ox: number;
  let oy: number;
  let ring: PlanProjection['ring'] = null;
  const bcx = (bounds.minX + bounds.maxX) / 2;
  const bcz = (bounds.minZ + bounds.maxZ) / 2;

  if (opts.ringPx !== undefined) {
    // The plan's farthest extents from the bounds centre, where bearings are measured from.
    const hw = Math.max(Math.abs(rooms.minX - bcx), Math.abs(rooms.maxX - bcx), 1e-6);
    const hh = Math.max(Math.abs(rooms.minZ - bcz), Math.abs(rooms.maxZ - bcz), 1e-6);
    const a = Math.max(1, availW / 2 - opts.ringPx);
    const b = Math.max(1, availH / 2 - opts.ringPx);
    const gap = opts.ringGapPx ?? 0;
    // Largest scale that keeps every corner of the plan inside the ellipse, less the gap.
    scale = 1 / Math.sqrt((hw / Math.max(1, a - gap)) ** 2 + (hh / Math.max(1, b - gap)) ** 2);
    ring = { a, b };
    ox = width / 2 - bcx * scale;
    oy = height / 2 - bcz * scale;
  } else {
    const w = Math.max(1e-6, rooms.maxX - rooms.minX);
    const h = Math.max(1e-6, rooms.maxZ - rooms.minZ);
    scale = Math.min(availW / w, availH / h);
    ox = width / 2 - ((rooms.minX + rooms.maxX) / 2) * scale;
    oy = height / 2 - ((rooms.minZ + rooms.maxZ) / 2) * scale;
  }

  const x = (mx: number) => ox + mx * scale;
  const y = (mz: number) => oy + mz * scale;
  return {
    width,
    height,
    scale,
    x,
    y,
    toScreen: ([mx, mz]) => [x(mx), y(mz)],
    toModel: (sx, sy) => [(sx - ox) / scale, (sy - oy) / scale],
    centre: [x(bcx), y(bcz)],
    ring,
  };
}

/** SVG path data for a polyline or polygon in model space. */
export function pathData(proj: PlanProjection, pts: Vec2[], closed = false): string {
  if (!pts.length) return '';
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${round(proj.x(p[0]))} ${round(proj.y(p[1]))}`).join(' ');
  return closed ? `${d} Z` : d;
}

/** Screen angle (degrees clockwise from up) at which a true bearing points on this plan. */
export function screenAngle(bearingDeg: number, northOffsetDeg: number): number {
  return bearingDeg + northOffsetDeg;
}

/** Point at `radius` px from `centre` in the direction of a screen angle (clockwise from up). */
export function polar(centre: [number, number], radius: number, angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [centre[0] + radius * Math.sin(a), centre[1] - radius * Math.cos(a)];
}

/**
 * Point on the compass ring, `offset` px outside the ring's base ellipse, in the direction of a
 * screen angle (clockwise from up). The ray from the centre meets the ellipse at that angle.
 */
export function ringPoint(proj: PlanProjection, offset: number, angleDeg: number): [number, number] {
  const ring = proj.ring ?? { a: 0, b: 0 };
  const a = ring.a + offset;
  const b = ring.b + offset;
  const t = (angleDeg * Math.PI) / 180;
  const sx = Math.sin(t);
  const sy = -Math.cos(t);
  const r = 1 / Math.sqrt((sx / a) ** 2 + (sy / b) ** 2);
  return [proj.centre[0] + r * sx, proj.centre[1] + r * sy];
}

/** Degrees between samples when drawing ring arcs as polylines. */
const RING_ARC_STEP_DEG = 3;

/** SVG path for a band of the ring between two screen angles and two offsets. */
export function ringSectorPath(proj: PlanProjection, k0: number, k1: number, a0: number, a1: number): string {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / RING_ARC_STEP_DEG));
  const outer: [number, number][] = [];
  const inner: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    outer.push(ringPoint(proj, k1, a));
    inner.push(ringPoint(proj, k0, a));
  }
  const pts = [...outer, ...inner.reverse()];
  return `${pts.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)} ${round(y)}`).join('')}Z`;
}

/** A label anchor inside the polygon: its centroid, or the middle of its bounds if the centroid falls outside. */
export function labelAnchor(poly: Vec2[]): Vec2 {
  const c = polygonCentroid(poly);
  if (pointInPolygon(c, poly)) return c;
  const b = polygonBounds(poly);
  const mid: Vec2 = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  return pointInPolygon(mid, poly) ? mid : poly[0]!;
}

export function expandBox(b: Box2, by: number): Box2 {
  return { minX: b.minX - by, maxX: b.maxX + by, minZ: b.minZ - by, maxZ: b.maxZ + by };
}

export function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
