import { ELECTRICAL_KINDS, PLUMBING_KINDS, type Direction, type PlanFile, type Property, type Room, type Vec2 } from './data.js';
import type { VastuVerdict } from './sun.js';
import type { CompassOverlay } from './views.js';

/**
 * Plan helpers shared by the Blueprint and Compass views, the plan editor and the advisor's tools:
 * names for every plan symbol, per-room counts ("Bedroom: 6 sockets, 1 AC point, 2 light points"),
 * and small polygon utilities in model (x, z) metres.
 */

export type ElectricalKind = (typeof ELECTRICAL_KINDS)[number];
export type PlumbingKind = (typeof PLUMBING_KINDS)[number];
export type PlumbingLineKind = PlanFile['plumbing']['lines'][number]['kind'];
export type ElectricalPoint = PlanFile['electrical']['points'][number];
export type PlumbingFixture = PlanFile['plumbing']['fixtures'][number];
export type Circuit = PlanFile['electrical']['circuits'][number];
export type PlumbingLine = PlanFile['plumbing']['lines'][number];

export interface KindLabel {
  /** Singular, lower case unless an abbreviation: "socket", "AC point". */
  one: string;
  many: string;
  /** Legend entry, sentence case. */
  legend: string;
}

export const ELECTRICAL_KIND_LABELS: Record<ElectricalKind, KindLabel> = {
  db: { one: 'distribution board', many: 'distribution boards', legend: 'Distribution board' },
  switchboard: { one: 'switchboard', many: 'switchboards', legend: 'Switchboard' },
  socket: { one: 'socket', many: 'sockets', legend: 'Socket' },
  power_socket: { one: 'power socket', many: 'power sockets', legend: 'Power socket (heavy appliances)' },
  light: { one: 'light point', many: 'light points', legend: 'Light point' },
  ac: { one: 'AC point', many: 'AC points', legend: 'AC point' },
  fan: { one: 'fan point', many: 'fan points', legend: 'Fan point' },
  data: { one: 'data point', many: 'data points', legend: 'Data point' },
  ev: { one: 'EV charging point', many: 'EV charging points', legend: 'EV charging point' },
};

export const PLUMBING_KIND_LABELS: Record<PlumbingKind, KindLabel> = {
  wc: { one: 'WC', many: 'WCs', legend: 'WC' },
  basin: { one: 'wash basin', many: 'wash basins', legend: 'Wash basin' },
  shower: { one: 'shower', many: 'showers', legend: 'Shower' },
  sink: { one: 'sink', many: 'sinks', legend: 'Sink' },
  washing_machine: { one: 'washing machine point', many: 'washing machine points', legend: 'Washing machine point' },
  water_heater: { one: 'water heater', many: 'water heaters', legend: 'Water heater' },
  shaft: { one: 'plumbing shaft', many: 'plumbing shafts', legend: 'Plumbing shaft' },
  floor_trap: { one: 'floor drain', many: 'floor drains', legend: 'Floor drain' },
  tap: { one: 'tap', many: 'taps', legend: 'Tap' },
};

export const PLUMBING_LINE_LABELS: Record<PlumbingLineKind, string> = {
  cold: 'Cold water supply',
  hot: 'Hot water supply',
  drain: 'Drain line',
};

/** Order in which counts are listed: what buyers ask about first. */
export const ELECTRICAL_FACT_ORDER: readonly ElectricalKind[] = ['socket', 'power_socket', 'ac', 'light', 'fan', 'data', 'ev', 'switchboard', 'db'];
export const PLUMBING_FACT_ORDER: readonly PlumbingKind[] = ['wc', 'basin', 'shower', 'sink', 'tap', 'washing_machine', 'water_heater', 'floor_trap', 'shaft'];

export const DIRECTION_LABELS: Record<Direction, string> = {
  N: 'North',
  NE: 'North-east',
  E: 'East',
  SE: 'South-east',
  S: 'South',
  SW: 'South-west',
  W: 'West',
  NW: 'North-west',
};

/* ------------------------------ Counting ------------------------------ */

export interface CountedItem<K extends string> {
  kind: K;
  count: number;
  /** "6 sockets", "1 AC point" */
  text: string;
}

export interface RoomFacts {
  roomId: string;
  roomName: string;
  electrical: CountedItem<ElectricalKind>[];
  plumbing: CountedItem<PlumbingKind>[];
  /** Supply and drain lines that run through the room. */
  lines: Record<PlumbingLineKind, boolean>;
}

export function countText(n: number, label: KindLabel): string {
  return `${n} ${n === 1 ? label.one : label.many}`;
}

/**
 * The room a point belongs to: its explicit roomId, or the room whose polygon contains it
 * (on the point's own level when it names one).
 */
export function resolveRoomId(point: { x: number; z: number; roomId: string | null; level?: number }, rooms: Pick<Room, 'id' | 'polygon' | 'level'>[]): string | null {
  if (point.roomId) return point.roomId;
  const candidates = point.level === undefined ? rooms : rooms.filter((r) => (r.level ?? 0) === point.level);
  return roomAt(candidates, [point.x, point.z])?.id ?? null;
}

/* ------------------------------ Levels ------------------------------ */

/** Level a room is on (multi-level properties); single-level rooms are on level 0. */
export function roomLevelOf(room: Pick<Room, 'level'>): number {
  return room.level ?? 0;
}

/** Level a plan point is drawn on: its own, else its room's, else level 0. */
export function pointLevel(point: { roomId: string | null; level?: number }, rooms: Pick<Room, 'id' | 'level'>[]): number {
  if (point.level !== undefined) return point.level;
  const room = point.roomId ? rooms.find((r) => r.id === point.roomId) : undefined;
  return room ? roomLevelOf(room) : 0;
}

/** Level a circuit run or pipe is drawn on. */
export function runLevel(run: { level?: number }): number {
  return run.level ?? 0;
}

function countKinds<K extends string>(
  items: { kind: K; x: number; z: number; roomId: string | null; level?: number }[],
  order: readonly K[],
  labels: Record<K, KindLabel>,
  rooms: Pick<Room, 'id' | 'polygon' | 'level'>[],
  roomId: string | null,
): CountedItem<K>[] {
  const counts = new Map<K, number>();
  for (const it of items) {
    if (roomId !== null && resolveRoomId(it, rooms) !== roomId) continue;
    counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
  }
  return order.filter((k) => (counts.get(k) ?? 0) > 0).map((k) => ({ kind: k, count: counts.get(k)!, text: countText(counts.get(k)!, labels[k]) }));
}

/** Sample spacing used to test whether a pipe run passes through a room, in metres. */
const LINE_SAMPLE_STEP_M = 0.1;

export function pathTouchesPolygon(path: Vec2[], poly: Vec2[]): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, z0] = path[i]!;
    const [x1, z1] = path[i + 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / LINE_SAMPLE_STEP_M));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (pointInPolygon([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t], poly)) return true;
    }
  }
  return path.length === 1 && pointInPolygon(path[0]!, poly);
}

/** What one room has on each layer, counted from plan.json. */
export function roomFacts(
  plan: Pick<PlanFile, 'electrical' | 'plumbing'>,
  room: Pick<Room, 'id' | 'name' | 'polygon' | 'level'>,
  rooms: Pick<Room, 'id' | 'polygon' | 'level'>[],
): RoomFacts {
  const lines: Record<PlumbingLineKind, boolean> = { cold: false, hot: false, drain: false };
  const level = roomLevelOf(room);
  for (const l of plan.plumbing.lines) {
    if (!lines[l.kind] && runLevel(l) === level && pathTouchesPolygon(l.path, room.polygon)) lines[l.kind] = true;
  }
  return {
    roomId: room.id,
    roomName: room.name,
    electrical: countKinds(plan.electrical.points, ELECTRICAL_FACT_ORDER, ELECTRICAL_KIND_LABELS, rooms, room.id),
    plumbing: countKinds(plan.plumbing.fixtures, PLUMBING_FACT_ORDER, PLUMBING_KIND_LABELS, rooms, room.id),
    lines,
  };
}

/** Totals for the whole property. */
export function planTotals(plan: Pick<PlanFile, 'electrical' | 'plumbing'>): { electrical: CountedItem<ElectricalKind>[]; plumbing: CountedItem<PlumbingKind>[] } {
  return {
    electrical: countKinds(plan.electrical.points, ELECTRICAL_FACT_ORDER, ELECTRICAL_KIND_LABELS, [], null),
    plumbing: countKinds(plan.plumbing.fixtures, PLUMBING_FACT_ORDER, PLUMBING_KIND_LABELS, [], null),
  };
}

/** "a, b and c" */
export function listText(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Kinds left out of the spoken summary: wiring infrastructure rather than things a buyer uses. */
const SPOKEN_ELECTRICAL_SKIP: readonly ElectricalKind[] = ['switchboard', 'db'];
const SPOKEN_PLUMBING_SKIP: readonly PlumbingKind[] = ['shaft', 'floor_trap'];

/**
 * One line for a room on a layer, for the advisor and the room focus panel:
 * "Bedroom: 6 sockets, 1 AC point and 2 light points".
 */
export function roomFactsSentence(facts: RoomFacts, layer: 'electrical' | 'plumbing'): string {
  // Infrastructure (the board, switchboards, the shaft) is only mentioned when a room has nothing else.
  if (layer === 'electrical') {
    const parts = facts.electrical.filter((c) => !SPOKEN_ELECTRICAL_SKIP.includes(c.kind)).map((c) => c.text);
    const infra = facts.electrical.filter((c) => SPOKEN_ELECTRICAL_SKIP.includes(c.kind)).map((c) => c.text);
    const said = parts.length ? parts : infra;
    return said.length ? `${facts.roomName}: ${listText(said)}` : `${facts.roomName}: no electrical points marked`;
  }
  const parts = facts.plumbing.filter((c) => !SPOKEN_PLUMBING_SKIP.includes(c.kind)).map((c) => c.text);
  const supply = (['cold', 'hot'] as const).filter((k) => facts.lines[k]);
  if (supply.length) parts.push(supply.length === 2 ? 'hot and cold water' : `${supply[0]} water`);
  const infra = facts.plumbing.filter((c) => SPOKEN_PLUMBING_SKIP.includes(c.kind)).map((c) => c.text);
  const said = parts.length ? parts : infra;
  return said.length ? `${facts.roomName}: ${listText(said)}` : `${facts.roomName}: no plumbing`;
}

/** Rooms that have any plumbing fixture, in rooms.json order. */
export function wetRoomIds(plan: Pick<PlanFile, 'plumbing'>, rooms: Pick<Room, 'id' | 'polygon' | 'level'>[]): string[] {
  const ids = new Set(plan.plumbing.fixtures.map((f) => resolveRoomId(f, rooms)).filter((id): id is string => Boolean(id)));
  return rooms.filter((r) => ids.has(r.id)).map((r) => r.id);
}

/* ------------------------------ Geometry ------------------------------ */

/** Even-odd test; points exactly on an edge may fall either way. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  const [px, pz] = p;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function roomAt<R extends Pick<Room, 'polygon'>>(rooms: R[], p: Vec2): R | null {
  return rooms.find((r) => pointInPolygon(p, r.polygon)) ?? null;
}

export interface Box2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function polygonBounds(poly: Vec2[]): Box2 {
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** Bounds of every room together: the built footprint, which may sit inside the plan image bounds. */
export function roomsBounds(rooms: Pick<Room, 'polygon'>[]): Box2 {
  return polygonBounds(rooms.flatMap((r) => r.polygon));
}

export function polygonAreaM2(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]!;
    const [x1, z1] = poly[(i + 1) % poly.length]!;
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a) / 2;
}

const METRES_PER_FOOT = 0.3048;
const INCHES_PER_FOOT = 12;

/** 3.42 m -> 11'3" (the way Indian floor plans mark room sizes). */
export function formatFeetInches(metres: number): string {
  const totalIn = Math.round((metres / METRES_PER_FOOT) * INCHES_PER_FOOT);
  const ft = Math.floor(totalIn / INCHES_PER_FOOT);
  const inch = totalIn % INCHES_PER_FOOT;
  return `${ft}'${inch}"`;
}

/** How much of its bounding box a polygon must fill to be treated as a rectangle. */
const RECTANGULAR_FILL = 0.92;

/**
 * Width by depth of a room in feet and inches, e.g. 11'3" × 10'6".
 * Null for rooms that are not close to rectangular, where a single size would mislead.
 */
export function roomDimensions(poly: Vec2[]): string | null {
  const b = polygonBounds(poly);
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  if (w <= 0 || d <= 0 || polygonAreaM2(poly) / (w * d) < RECTANGULAR_FILL) return null;
  return `${formatFeetInches(w)} × ${formatFeetInches(d)}`;
}

/* ------------------------------ Compass ------------------------------ */

/** Overlays offered per property kind: Vastu for homes, seating for offices. */
export const COMPASS_OVERLAYS_BY_KIND: Record<Property['kind'], readonly CompassOverlay[]> = {
  sale: ['sun', 'vastu'],
  lease: ['sun', 'seating'],
};

/** The overlay to show for this property: an overlay that does not apply maps to the one that does. */
export function resolveCompassOverlay(kind: Property['kind'], overlay: CompassOverlay): CompassOverlay {
  const allowed = COMPASS_OVERLAYS_BY_KIND[kind];
  if (allowed.includes(overlay)) return overlay;
  return allowed.find((o) => o !== 'sun') ?? 'sun';
}

export const VASTU_VERDICT_LABELS: Record<VastuVerdict, string> = {
  ideal: 'Ideal',
  acceptable: 'Acceptable',
  avoid: 'Not preferred',
};

/** Shown wherever Vastu verdicts appear. */
export const VASTU_NOTE =
  'Vastu is traditional guidance, shown for buyers who follow it. It is not a building rule or a measure of quality.';

/** Total desk seats from rooms.json. */
export function totalSeats(rooms: Pick<Room, 'seats'>[]): number {
  return rooms.reduce((s, r) => s + (r.seats ?? 0), 0);
}
