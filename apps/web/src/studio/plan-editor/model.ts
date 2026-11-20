import {
  PlanFileSchema,
  pointLevel,
  roomAt,
  roomLevelOf,
  runLevel,
  type Box2,
  type ElectricalKind,
  type PlanFile,
  type PlumbingKind,
  type PlumbingLineKind,
  type Room,
  type Vec2,
} from '@ave/shared';
import type { PlanProjection } from '@/plan/geometry';
import type { RunKind } from '@/plan/symbols';

/** The part of plan.json the editor owns; `bounds` belongs to the 3D workstream and is never edited here. */
export type Layers = Pick<PlanFile, 'electrical' | 'plumbing'>;

export type Selection =
  | { type: 'point'; id: string }
  | { type: 'fixture'; id: string }
  | { type: 'circuit'; id: string }
  | { type: 'line'; id: string }
  | null;

export type Tool =
  | { t: 'select' }
  | { t: 'electrical'; kind: ElectricalKind }
  | { t: 'plumbing'; kind: PlumbingKind }
  | { t: 'run'; kind: RunKind };

/** Grid every placed point snaps to, in metres. */
export const SNAP_M = 0.05;
/** Pointer distances for picking, in px. */
export const PICK_LINE_PX = 6;
export const PICK_HANDLE_PX = 8;
/** A run endpoint jumps onto a symbol this close, in px. */
export const MAGNET_PX = 12;

export const snapTo = (v: number) => Number((Math.round(v / SNAP_M) * SNAP_M).toFixed(2));
export const snapPoint = (p: Vec2): Vec2 => [snapTo(p[0]), snapTo(p[1])];

export function cloneLayers(l: Layers): Layers {
  return structuredClone({ electrical: l.electrical, plumbing: l.plumbing });
}

export function sameLayers(a: Layers, b: Layers): boolean {
  return JSON.stringify({ e: a.electrical, p: a.plumbing }) === JSON.stringify({ e: b.electrical, p: b.plumbing });
}

const ID_PREFIX: Record<ElectricalKind | PlumbingKind | RunKind, string> = {
  db: 'db',
  switchboard: 'sb',
  socket: 'skt',
  power_socket: 'pwr',
  light: 'lt',
  ac: 'ac',
  fan: 'fan',
  data: 'data',
  ev: 'ev',
  wc: 'wc',
  basin: 'basin',
  shower: 'shower',
  sink: 'sink',
  washing_machine: 'wm',
  water_heater: 'heater',
  shaft: 'shaft',
  floor_trap: 'trap',
  tap: 'tap',
  circuit: 'c',
  cold: 'cold',
  hot: 'hot',
  drain: 'drain',
};

export function allIds(l: Layers): string[] {
  return [...l.electrical.points, ...l.electrical.circuits, ...l.plumbing.fixtures, ...l.plumbing.lines].map((x) => x.id);
}

export function nextId(l: Layers, kind: keyof typeof ID_PREFIX): string {
  const used = new Set(allIds(l));
  const prefix = ID_PREFIX[kind];
  let i = 1;
  while (used.has(`${prefix}-${i}`)) i++;
  return `${prefix}-${i}`;
}

/** The room under a point on the given level. */
export function roomIdAt(rooms: Room[], p: Vec2, level: number): string | null {
  return roomAt(rooms.filter((r) => roomLevelOf(r) === level), p)?.id ?? null;
}

/** Only what is drawn on one level: the editor picks, snaps and draws per level. */
export function layersOnLevel(l: Layers, level: number, rooms: Room[]): Layers {
  return {
    electrical: { points: l.electrical.points.filter((p) => pointLevel(p, rooms) === level), circuits: l.electrical.circuits.filter((c) => runLevel(c) === level) },
    plumbing: { fixtures: l.plumbing.fixtures.filter((p) => pointLevel(p, rooms) === level), lines: l.plumbing.lines.filter((c) => runLevel(c) === level) },
  };
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

export interface Visible {
  electrical: boolean;
  plumbing: boolean;
}

/** The item under the pointer (screen px), symbols before runs. */
export function pick(l: Layers, proj: PlanProjection, sx: number, sy: number, symbolPx: number, visible: Visible): Selection {
  const s: Vec2 = [sx, sy];
  const near = (x: number, z: number) => Math.hypot(proj.x(x) - sx, proj.y(z) - sy) <= symbolPx * 0.7;
  if (visible.electrical) {
    const p = [...l.electrical.points].reverse().find((q) => near(q.x, q.z));
    if (p) return { type: 'point', id: p.id };
  }
  if (visible.plumbing) {
    const f = [...l.plumbing.fixtures].reverse().find((q) => near(q.x, q.z));
    if (f) return { type: 'fixture', id: f.id };
  }
  const onPath = (path: Vec2[]) => path.some((a, i) => i > 0 && distToSegment(s, proj.toScreen(path[i - 1]!), proj.toScreen(a)) <= PICK_LINE_PX);
  if (visible.plumbing) {
    const line = [...l.plumbing.lines].reverse().find((x) => onPath(x.path));
    if (line) return { type: 'line', id: line.id };
  }
  if (visible.electrical) {
    const c = [...l.electrical.circuits].reverse().find((x) => onPath(x.path));
    if (c) return { type: 'circuit', id: c.id };
  }
  return null;
}

/** Index of a vertex handle of the selected run under the pointer, or -1. */
export function pickHandle(path: Vec2[], proj: PlanProjection, sx: number, sy: number): number {
  return path.findIndex((p) => Math.hypot(proj.x(p[0]) - sx, proj.y(p[1]) - sy) <= PICK_HANDLE_PX);
}

/** The nearest symbol position within the magnet radius, for snapping run ends onto symbols. */
export function magnet(l: Layers, proj: PlanProjection, sx: number, sy: number): Vec2 | null {
  let best: { p: Vec2; d: number } | null = null;
  for (const q of [...l.electrical.points, ...l.plumbing.fixtures]) {
    const d = Math.hypot(proj.x(q.x) - sx, proj.y(q.z) - sy);
    if (d <= MAGNET_PX && (!best || d < best.d)) best = { p: [q.x, q.z], d };
  }
  return best?.p ?? null;
}

/** Next vertex of a run: horizontal or vertical from the last one unless `free`. */
export function nextVertex(last: Vec2 | null, cursor: Vec2, free: boolean): Vec2 {
  if (!last || free) return snapPoint(cursor);
  const dx = Math.abs(cursor[0] - last[0]);
  const dz = Math.abs(cursor[1] - last[1]);
  return snapPoint(dx >= dz ? [cursor[0], last[1]] : [last[0], cursor[1]]);
}

/** Drops repeated consecutive vertices (a double-click adds the last one twice). */
export function cleanPath(path: Vec2[]): Vec2[] {
  return path.filter((p, i) => i === 0 || p[0] !== path[i - 1]![0] || p[1] !== path[i - 1]![1]);
}

export interface Issue {
  level: 'error' | 'warning';
  text: string;
}

/** Problems that would stop a save (errors) or deserve a look (warnings). */
export function validate(l: Layers, bounds: Box2, rooms: Room[]): Issue[] {
  const issues: Issue[] = [];
  const parsed = PlanFileSchema.safeParse({ bounds, ...l });
  if (!parsed.success) for (const i of parsed.error.issues.slice(0, 5)) issues.push({ level: 'error', text: `${i.path.join('.')}: ${i.message}` });
  const ids = allIds(l);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length) issues.push({ level: 'error', text: `Duplicate ids: ${dupes.join(', ')}` });
  const roomIds = new Set(rooms.map((r) => r.id));
  for (const p of [...l.electrical.points, ...l.plumbing.fixtures]) {
    if (p.roomId && !roomIds.has(p.roomId)) issues.push({ level: 'error', text: `${p.id} names unknown room "${p.roomId}"` });
  }
  const loose = [...l.electrical.points, ...l.plumbing.fixtures].filter((p) => !p.roomId).map((p) => p.id);
  if (loose.length) issues.push({ level: 'warning', text: `Not in any room: ${loose.join(', ')}` });
  if (!l.electrical.points.some((p) => p.kind === 'db')) issues.push({ level: 'warning', text: 'No distribution board placed' });
  if (l.plumbing.fixtures.length && !l.plumbing.fixtures.some((f) => f.kind === 'shaft')) issues.push({ level: 'warning', text: 'Plumbing has no shaft' });
  return issues;
}

export const LINE_KINDS: readonly PlumbingLineKind[] = ['cold', 'hot', 'drain'];

/**
 * Moves a symbol and drags the runs attached to it: run corners sitting on the symbol move with it,
 * and their neighbouring corners slide so straight legs stay straight (unless a neighbour is itself
 * on another symbol, which stays put).
 */
export function moveAttached(l: Layers, from: Vec2, to: Vec2, level: number): void {
  const same = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];
  const anchors = [...l.electrical.points, ...l.plumbing.fixtures].map((p): Vec2 => [p.x, p.z]).filter((p) => !same(p, from));
  const onSymbol = (p: Vec2) => anchors.some((a) => same(a, p));
  for (const run of [...l.electrical.circuits, ...l.plumbing.lines].filter((r) => runLevel(r) === level)) {
    const path = run.path;
    path.forEach((v, i) => {
      if (!same(v, from)) return;
      for (const j of [i - 1, i + 1]) {
        const n = path[j];
        if (!n || same(n, from) || onSymbol(n)) continue;
        if (n[0] === from[0]) n[0] = to[0];
        else if (n[1] === from[1]) n[1] = to[1];
      }
    });
    for (let i = 0; i < path.length; i++) if (same(path[i]!, from)) path[i] = [to[0], to[1]];
  }
}
