import type { DecorObject } from '../state.js';
import { MAX_SCALE, MIN_SCALE, findEntry, type CatalogEntry } from './catalog.js';
import {
  bounds, distanceToSegment, footprint as rawFootprint, footprintsOverlap, inwardNormal, insideRoom, normaliseAngle, pointInRoom, rotateLocal, round3, walls,
  type Footprint, type Point, type StudioRoom,
} from './geometry.js';

/**
 * Pure placement logic for decorations: where an object may stand, hang or sit, what it collides with, and
 * how it snaps. No React, no Three.js. Adapted from the room-configurator reference (catalog.ts placeItem,
 * move.ts snapPosition/moveItem), extended with stage, wall and ceiling mounts.
 *
 * Conventions: positions are metres; `position.y` is the BOTTOM of the object; an object's forward direction
 * at rotationY = theta is (sin theta, cos theta) in (x, z), as in Three.js. A wall piece's back faces the wall.
 */

export interface SceneContext {
  room: StudioRoom;
  catalog: readonly CatalogEntry[];
}

export type SceneErrorKind =
  | 'unknown-catalog' | 'bad-mount' | 'bad-scale' | 'outside-room' | 'bad-elevation' | 'no-support'
  | 'not-on-wall' | 'no-ceiling' | 'collides' | 'no-free-spot' | 'not-found' | 'blocked-by-children' | 'wall-locked' | 'duplicate-id';

export interface SceneError {
  kind: SceneErrorKind;
  id?: string;
  /** The other object involved (collision, blocking children). */
  other?: string;
}
export type Placed<T> = { ok: true; value: T } | { ok: false; error: SceneError };
const ok = <T>(value: T): Placed<T> => ({ ok: true, value });
const err = (kind: SceneErrorKind, id?: string, other?: string): Placed<never> => ({ ok: false, error: { kind, id, other } });

export const SNAP = { grid: 0.1, wall: 0.15 } as const;
const TOL = 1e-6;

export function sizeOf(entry: CatalogEntry, scale: number) {
  return { width: entry.size.width * scale, depth: entry.size.depth * scale, height: entry.size.height * scale };
}

/** The floor outline the object covers. */
export function footprintOf(entry: CatalogEntry, obj: Pick<DecorObject, 'position' | 'rotationY' | 'scale'>): Footprint {
  const { width, depth } = sizeOf(entry, obj.scale);
  return rawFootprint(entry.shape, width, depth, obj.position, obj.rotationY);
}

/** Top surface of an object (for stage support). */
const topOf = (entry: CatalogEntry, obj: DecorObject) => obj.position.y + entry.size.height * obj.scale;

function entryOf(ctx: SceneContext, obj: DecorObject): CatalogEntry | undefined {
  return findEntry(ctx.catalog, obj.catalogId);
}

/** The highest stage object whose footprint fully contains `fp`, or null. */
export function supportFor(ctx: SceneContext, objects: readonly DecorObject[], selfId: string, fp: Footprint): { stage: DecorObject; top: number } | null {
  let best: { stage: DecorObject; top: number } | null = null;
  for (const o of objects) {
    if (o.id === selfId) continue;
    const e = entryOf(ctx, o);
    if (!e || e.category !== 'stage') continue;
    const sfp = footprintOf(e, o);
    if (fp.every((p) => pointInRoom(p, { corners: sfp }))) {
      const top = topOf(e, o);
      if (!best || top > best.top) best = { stage: o, top };
    }
  }
  return best;
}

/** Objects standing on `stage`. */
export function childrenOf(ctx: SceneContext, objects: readonly DecorObject[], stage: DecorObject): DecorObject[] {
  return objects.filter((o) => {
    if (o.mount !== 'stage' || o.id === stage.id) return false;
    const e = entryOf(ctx, o);
    return !!e && supportFor(ctx, objects, o.id, footprintOf(e, o))?.stage.id === stage.id;
  });
}

const isStage = (ctx: SceneContext, o: DecorObject) => entryOf(ctx, o)?.category === 'stage';

/** Sets `position.y` for the object's mount. Floor: 0. Ceiling: hangs from the ceiling. Stage: on its support. Wall: kept, clamped. */
export function elevate(ctx: SceneContext, others: readonly DecorObject[], obj: DecorObject): Placed<DecorObject> {
  const entry = entryOf(ctx, obj);
  if (!entry) return err('unknown-catalog', obj.id);
  const h = entry.size.height * obj.scale;
  let y = obj.position.y;
  if (obj.mount === 'floor') y = 0;
  else if (obj.mount === 'ceiling') y = round3(ctx.room.height - h);
  else if (obj.mount === 'stage') {
    const s = supportFor(ctx, others, obj.id, footprintOf(entry, obj));
    if (!s) return err('no-support', obj.id);
    y = round3(s.top);
  } else y = round3(Math.max(0, Math.min(y, ctx.room.height - h)));
  return ok({ ...obj, position: { ...obj.position, y } });
}

/** Full validity check of one object against the room and the other objects. */
export function validateObject(ctx: SceneContext, others: readonly DecorObject[], obj: DecorObject): Placed<DecorObject> {
  const entry = entryOf(ctx, obj);
  if (!entry) return err('unknown-catalog', obj.id);
  if (!entry.mounts.includes(obj.mount)) return err('bad-mount', obj.id);
  if (obj.mount === 'ceiling' && ctx.room.outdoor) return err('no-ceiling', obj.id);
  if (!(obj.scale >= MIN_SCALE - TOL && obj.scale <= MAX_SCALE + TOL)) return err('bad-scale', obj.id);
  const fp = footprintOf(entry, obj);
  const h = entry.size.height * obj.scale;
  if (!insideRoom(fp, ctx.room)) return err('outside-room', obj.id);
  if (h > ctx.room.height + TOL) return err('outside-room', obj.id);

  if (obj.mount === 'floor' && Math.abs(obj.position.y) > TOL) return err('bad-elevation', obj.id);
  if (obj.mount === 'ceiling' && Math.abs(obj.position.y - (ctx.room.height - h)) > 1e-3) return err('bad-elevation', obj.id);
  if (obj.mount === 'stage') {
    const s = supportFor(ctx, others, obj.id, fp);
    if (!s) return err('no-support', obj.id);
    if (Math.abs(obj.position.y - s.top) > 1e-3) return err('bad-elevation', obj.id);
  }
  if (obj.mount === 'wall') {
    if (obj.position.y < -TOL || obj.position.y + h > ctx.room.height + TOL) return err('bad-elevation', obj.id);
    if (!isFlushToWall(ctx.room, entry, obj)) return err('not-on-wall', obj.id);
  }

  const y0 = obj.position.y;
  const y1 = y0 + h;
  for (const o of others) {
    if (o.id === obj.id || o.mount !== obj.mount) continue;
    const oe = entryOf(ctx, o);
    if (!oe) continue;
    const oy1 = o.position.y + oe.size.height * o.scale;
    if (o.position.y >= y1 - TOL || oy1 <= y0 + TOL) continue; // no vertical overlap
    if (footprintsOverlap(fp, footprintOf(oe, o))) return err('collides', obj.id, o.id);
  }
  return ok(obj);
}

// ---- walls ---------------------------------------------------------------------------------------------------

/** Pose of a wall piece centred `s` metres along wall `wallIndex` (clamped so it stays on the wall). */
export function wallPose(room: StudioRoom, entry: CatalogEntry, scale: number, wallIndex: number, s: number): { x: number; z: number; rotationY: number } | null {
  const wall = walls(room)[wallIndex];
  if (!wall || wall.length === 0) return null;
  const { width, depth } = sizeOf(entry, scale);
  if (width > wall.length + TOL) return null;
  const along = Math.max(width / 2, Math.min(wall.length - width / 2, s));
  const n = inwardNormal(room, wall);
  const dir = { x: (wall.to.x - wall.from.x) / wall.length, z: (wall.to.z - wall.from.z) / wall.length };
  return {
    x: round3(wall.from.x + dir.x * along + n.x * (depth / 2)),
    z: round3(wall.from.z + dir.z * along + n.z * (depth / 2)),
    rotationY: Math.atan2(n.x, n.z), // exact: rounding would tilt the piece off the wall
  };
}

/** The wall nearest `target` and the pose on it. */
export function nearestWallPose(room: StudioRoom, entry: CatalogEntry, scale: number, target: Point): { x: number; z: number; rotationY: number } | null {
  let best: { index: number; d: number; s: number } | null = null;
  for (const w of walls(room)) {
    if (w.length === 0) continue;
    const d = distanceToSegment(target, w.from, w.to);
    const s = ((target.x - w.from.x) * (w.to.x - w.from.x) + (target.z - w.from.z) * (w.to.z - w.from.z)) / w.length;
    if (!best || d < best.d - 1e-9) best = { index: w.index, d, s };
  }
  return best ? wallPose(room, entry, scale, best.index, best.s) : null;
}

function isFlushToWall(room: StudioRoom, entry: CatalogEntry, obj: DecorObject): boolean {
  const { depth } = sizeOf(entry, obj.scale);
  const n = { x: Math.sin(obj.rotationY), z: Math.cos(obj.rotationY) };
  const back = { x: obj.position.x - n.x * (depth / 2), z: obj.position.z - n.z * (depth / 2) };
  return walls(room).some((w) => {
    if (distanceToSegment(back, w.from, w.to) > 0.02) return false;
    const wn = inwardNormal(room, w);
    return wn.x * n.x + wn.z * n.z > 0.999;
  });
}

// ---- snapping ------------------------------------------------------------------------------------------------

const snapGrid = (v: number, step: number) => (step > 0 ? round3(Math.round(v / step) * step) : round3(v));

/**
 * Where a floor object lands when dragged to `target`: rounded to the grid, then pushed flush against a wall it
 * runs along if within SNAP.wall. A suggestion; validation decides if it is allowed.
 */
export function snapPosition(room: StudioRoom, entry: CatalogEntry, obj: DecorObject, target: Point, wallSnap: boolean): Point {
  let p = { x: snapGrid(target.x, SNAP.grid), z: snapGrid(target.z, SNAP.grid) };
  if (!wallSnap) return p;
  let best: { wall: number; shift: number } | null = null;
  for (const w of walls(room)) {
    const fp = footprintOf(entry, { ...obj, position: { ...obj.position, x: p.x, z: p.z } });
    const n = inwardNormal(room, w);
    const len = w.length || 1;
    const near = fp.filter((q) => {
      const t = ((q.x - w.from.x) * (w.to.x - w.from.x) + (q.z - w.from.z) * (w.to.z - w.from.z)) / (len * len);
      const m = SNAP.wall / len;
      return t >= -m && t <= 1 + m;
    });
    if (near.length === 0) continue;
    const gap = Math.min(...near.map((q) => (q.x - w.from.x) * n.x + (q.z - w.from.z) * n.z));
    if (Math.abs(gap) <= SNAP.wall && (best === null || Math.abs(gap) < Math.abs(best.shift))) best = { wall: w.index, shift: gap };
  }
  if (best) {
    const w = walls(room)[best.wall]!;
    const n = inwardNormal(room, w);
    p = { x: round3(p.x - n.x * best.shift), z: round3(p.z - n.z * best.shift) };
  }
  return p;
}

// ---- operations ----------------------------------------------------------------------------------------------

/**
 * Applies changed objects in order (a stage before the things on it), validating each against everything else.
 * Returns the full list in its original order.
 */
function commit(ctx: SceneContext, objects: readonly DecorObject[], changed: DecorObject[]): Placed<DecorObject[]> {
  const ids = new Set(changed.map((c) => c.id));
  const acc: DecorObject[] = objects.filter((o) => !ids.has(o.id));
  const done = new Map<string, DecorObject>();
  for (const c of changed) {
    const lifted = c.mount === 'stage' ? elevate(ctx, acc, c) : ok(c);
    if (!lifted.ok) return lifted;
    const checked = validateObject(ctx, acc, lifted.value);
    if (!checked.ok) return checked;
    acc.push(checked.value);
    done.set(c.id, checked.value);
  }
  return ok(objects.map((o) => done.get(o.id) ?? o));
}

export function moveObject(ctx: SceneContext, objects: readonly DecorObject[], id: string, target: { x: number; z: number; y?: number }): Placed<DecorObject[]> {
  const obj = objects.find((o) => o.id === id);
  if (!obj) return err('not-found', id);
  const entry = entryOf(ctx, obj);
  if (!entry) return err('unknown-catalog', id);

  if (obj.mount === 'wall') {
    const pose = nearestWallPose(ctx.room, entry, obj.scale, target);
    if (!pose) return err('not-on-wall', id);
    const y = round3(target.y ?? obj.position.y);
    const h = entry.size.height * obj.scale;
    const moved: DecorObject = { ...obj, position: { x: pose.x, y: Math.max(0, Math.min(y, ctx.room.height - h)), z: pose.z }, rotationY: pose.rotationY };
    return commit(ctx, objects, [moved]);
  }

  const p = snapPosition(ctx.room, entry, obj, target, obj.mount === 'floor');
  const moved: DecorObject = { ...obj, position: { x: p.x, y: obj.position.y, z: p.z } };
  const changed = [moved];
  if (isStage(ctx, obj)) {
    const dx = p.x - obj.position.x;
    const dz = p.z - obj.position.z;
    for (const c of childrenOf(ctx, objects, obj)) changed.push({ ...c, position: { x: round3(c.position.x + dx), y: c.position.y, z: round3(c.position.z + dz) } });
  }
  return commit(ctx, objects, changed);
}

export function rotateObject(ctx: SceneContext, objects: readonly DecorObject[], id: string, rotationY: number): Placed<DecorObject[]> {
  const obj = objects.find((o) => o.id === id);
  if (!obj) return err('not-found', id);
  if (obj.mount === 'wall') return err('wall-locked', id);
  if (isStage(ctx, obj)) {
    const kid = childrenOf(ctx, objects, obj)[0];
    if (kid) return err('blocked-by-children', id, kid.id);
  }
  return commit(ctx, objects, [{ ...obj, rotationY: normaliseAngle(rotationY) }]);
}

export function scaleObject(ctx: SceneContext, objects: readonly DecorObject[], id: string, scale: number): Placed<DecorObject[]> {
  const obj = objects.find((o) => o.id === id);
  if (!obj) return err('not-found', id);
  if (!(scale >= MIN_SCALE - TOL && scale <= MAX_SCALE + TOL)) return err('bad-scale', id);
  const entry = entryOf(ctx, obj);
  if (!entry) return err('unknown-catalog', id);
  if (isStage(ctx, obj)) {
    const kid = childrenOf(ctx, objects, obj)[0];
    if (kid) return err('blocked-by-children', id, kid.id);
  }
  let next: DecorObject = { ...obj, scale: round3(scale) };
  if (obj.mount === 'wall') {
    // Depth changes, so re-seat the back against the wall at the same spot along it.
    const pose = nearestWallPose(ctx.room, entry, next.scale, obj.position);
    if (!pose) return err('not-on-wall', id);
    next = { ...next, position: { x: pose.x, y: obj.position.y, z: pose.z }, rotationY: pose.rotationY };
  }
  if (obj.mount === 'ceiling') {
    const lifted = elevate(ctx, objects, next);
    if (!lifted.ok) return lifted;
    next = lifted.value;
  }
  return commit(ctx, objects, [next]);
}

export function setObjectColor(ctx: SceneContext, objects: readonly DecorObject[], id: string, part: string, color: string | null): Placed<DecorObject[]> {
  const obj = objects.find((o) => o.id === id);
  if (!obj) return err('not-found', id);
  const entry = entryOf(ctx, obj);
  if (!entry) return err('unknown-catalog', id);
  if (!entry.parts.some((p) => p.id === part)) return err('unknown-catalog', id, part);
  const colors = { ...obj.colors };
  if (color === null) delete colors[part];
  else colors[part] = color;
  return ok(objects.map((o) => (o.id === id ? { ...o, colors } : o)));
}

export function removeObject(ctx: SceneContext, objects: readonly DecorObject[], id: string): Placed<DecorObject[]> {
  const obj = objects.find((o) => o.id === id);
  if (!obj) return err('not-found', id);
  if (isStage(ctx, obj)) {
    const kid = childrenOf(ctx, objects, obj)[0];
    if (kid) return err('blocked-by-children', id, kid.id);
  }
  return ok(objects.filter((o) => o.id !== id));
}

// ---- adding and duplicating ----------------------------------------------------------------------------------

const MAX_CANDIDATES = 20_000;

/**
 * The nearest valid spot for `template` (its mount, scale, rotation and colours are kept; its position is
 * replaced) searching outward from `around`. Floor and ceiling pieces search a 20 cm grid of the room, stage
 * pieces search the stages, wall pieces search along the walls.
 */
export function findFreeSpot(ctx: SceneContext, objects: readonly DecorObject[], template: DecorObject, around?: Point): Placed<DecorObject> {
  const entry = entryOf(ctx, template);
  if (!entry) return err('unknown-catalog', template.id);
  if (!entry.mounts.includes(template.mount)) return err('bad-mount', template.id);
  const box = bounds(ctx.room);
  const centre = around ?? box.centre;

  type Cand = { x: number; z: number; rot: number; d: number; y?: number };
  const cands: Cand[] = [];
  if (template.mount === 'wall') {
    const y = template.position.y > 0 ? template.position.y : entry.wallY ?? 1;
    const { width } = sizeOf(entry, template.scale);
    for (const w of walls(ctx.room)) {
      for (let s = width / 2; s <= w.length - width / 2 + 1e-9; s += 0.25) {
        const pose = wallPose(ctx.room, entry, template.scale, w.index, s);
        if (pose) cands.push({ x: pose.x, z: pose.z, rot: pose.rotationY, y, d: Math.hypot(pose.x - centre.x, pose.z - centre.z) });
      }
    }
  } else {
    const rots = [template.rotationY, normaliseAngle(template.rotationY + Math.PI / 2)];
    const areas: { min: Point; max: Point; step: number }[] = [];
    if (template.mount === 'stage') {
      for (const o of objects) {
        const e = entryOf(ctx, o);
        if (!e || e.category !== 'stage') continue;
        const b = bounds({ corners: footprintOf(e, o) });
        areas.push({ min: b.min, max: b.max, step: 0.1 });
      }
    } else areas.push({ min: box.min, max: box.max, step: 0.2 });
    for (const a of areas) {
      for (let x = a.min.x; x <= a.max.x + 1e-9; x += a.step) {
        for (let z = a.min.z; z <= a.max.z + 1e-9; z += a.step) {
          for (const rot of rots) cands.push({ x: round3(x), z: round3(z), rot, d: Math.hypot(x - centre.x, z - centre.z) + (rot === rots[0] ? 0 : 0.001) });
        }
      }
    }
    if (around) cands.push({ x: snapGrid(around.x, SNAP.grid), z: snapGrid(around.z, SNAP.grid), rot: rots[0]!, d: -1 });
  }
  cands.sort((a, b) => a.d - b.d);

  for (const c of cands.slice(0, MAX_CANDIDATES)) {
    const base: DecorObject = { ...template, rotationY: c.rot, position: { x: c.x, y: c.y ?? template.position.y, z: c.z } };
    const lifted = elevate(ctx, objects, base);
    if (!lifted.ok) continue;
    const checked = validateObject(ctx, objects, lifted.value);
    if (checked.ok) return checked;
  }
  return template.mount === 'stage' && !objects.some((o) => isStage(ctx, o)) ? err('no-support', template.id) : err('no-free-spot', template.id);
}

export interface AddRequest {
  id: string;
  catalogId: string;
  mount?: DecorObject['mount'];
  x?: number;
  z?: number;
  /** Facing in radians (Three.js rotation.y). Defaults to 0; ignored for wall pieces, which face into the room. */
  rotationY?: number;
  /** Per-part colours (`#rrggbb`) to start with. */
  colors?: Record<string, string>;
}

export function addObject(ctx: SceneContext, objects: readonly DecorObject[], req: AddRequest): Placed<DecorObject[]> {
  if (objects.some((o) => o.id === req.id)) return err('duplicate-id', req.id);
  const entry = findEntry(ctx.catalog, req.catalogId);
  if (!entry) return err('unknown-catalog', req.id);
  const mount = req.mount ?? entry.mounts[0]!;
  if (!entry.mounts.includes(mount)) return err('bad-mount', req.id);
  if (mount === 'ceiling' && ctx.room.outdoor) return err('no-ceiling', req.id);
  for (const part of Object.keys(req.colors ?? {})) if (!entry.parts.some((p) => p.id === part)) return err('unknown-catalog', req.id, part);
  const template: DecorObject = { id: req.id, catalogId: entry.id, position: { x: 0, y: 0, z: 0 }, rotationY: mount === 'wall' ? 0 : req.rotationY ?? 0, scale: 1, materialId: null, mount, colors: { ...(req.colors ?? {}) } };
  const around = req.x !== undefined && req.z !== undefined ? { x: req.x, z: req.z } : undefined;
  const spot = findFreeSpot(ctx, objects, template, around);
  return spot.ok ? ok([...objects, spot.value]) : spot;
}

export function duplicateObject(ctx: SceneContext, objects: readonly DecorObject[], id: string, newId: string): Placed<DecorObject[]> {
  const obj = objects.find((o) => o.id === id);
  if (!obj) return err('not-found', id);
  if (objects.some((o) => o.id === newId)) return err('duplicate-id', newId);
  const spot = findFreeSpot(ctx, objects, { ...obj, id: newId, colors: { ...obj.colors } }, { x: obj.position.x, z: obj.position.z });
  return spot.ok ? ok([...objects, spot.value]) : spot;
}

/** Whether every object is valid in `ctx` (used when the room changes or a design is loaded). Stages first. */
export function validateAll(ctx: SceneContext, objects: readonly DecorObject[]): Placed<DecorObject[]> {
  const ordered = [...objects].sort((a, b) => Number(isStage(ctx, b)) - Number(isStage(ctx, a)));
  const acc: DecorObject[] = [];
  for (const o of ordered) {
    const r = validateObject(ctx, acc, o);
    if (!r.ok) return r;
    acc.push(r.value);
  }
  return ok([...objects]);
}


/** Adds several objects, all or nothing: the first one that cannot be placed fails the whole batch (error.id names it). */
export function addObjects(ctx: SceneContext, objects: readonly DecorObject[], reqs: readonly AddRequest[]): Placed<DecorObject[]> {
  let acc: DecorObject[] = [...objects];
  for (const r of reqs) {
    const next = addObject(ctx, acc, r);
    if (!next.ok) return next;
    acc = next.value;
  }
  return ok(acc);
}

/** Removes several objects at once. A stage may go only together with everything on it. */
export function removeObjects(ctx: SceneContext, objects: readonly DecorObject[], ids: readonly string[]): Placed<DecorObject[]> {
  const set = new Set(ids);
  for (const id of ids) if (!objects.some((o) => o.id === id)) return err('not-found', id);
  for (const id of ids) {
    const obj = objects.find((o) => o.id === id)!;
    if (isStage(ctx, obj)) {
      const kid = childrenOf(ctx, objects, obj).find((k) => !set.has(k.id));
      if (kid) return err('blocked-by-children', id, kid.id);
    }
  }
  return ok(objects.filter((o) => !set.has(o.id)));
}

/** Sets (or clears, with null) one colour part on several objects at once. Every object must have that part. */
export function setObjectsColor(ctx: SceneContext, objects: readonly DecorObject[], ids: readonly string[], part: string, color: string | null): Placed<DecorObject[]> {
  let acc: DecorObject[] = [...objects];
  for (const id of ids) {
    const next = setObjectColor(ctx, acc, id, part, color);
    if (!next.ok) return next;
    acc = next.value;
  }
  return ok(acc);
}
