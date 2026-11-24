import { describe, expect, it } from 'vitest';
import { MAX_DESIGNS, MAX_HISTORY, WeddingStateSchema, applyWeddingAction, createSampleWedding, type DecorObject, type WeddingAction, type WeddingState } from '../index.js';
import {
  DECOR_CATALOG, STUDIO_ROOMS, SCENE_FILE_VERSION, addObject, bounds, childrenOf, duplicateObject, findEntry, footprintOf, footprintsOverlap, moveObject, parseSceneFile,
  removeObject, rotateObject, walls, scaleObject, serializeScene, setObjectColor, studioVenueId, validateAll, validateCatalog, type SceneContext,
} from './index.js';

const ctx: SceneContext = { room: STUDIO_ROOMS['venue-grand-ballroom']!, catalog: DECOR_CATALOG };

/** Adds and unwraps, failing the test with the error kind if refused. */
function add(objs: DecorObject[], id: string, catalogId: string, o: { mount?: DecorObject['mount']; x?: number; z?: number } = {}): DecorObject[] {
  const r = addObject(ctx, objs, { id, catalogId, ...o });
  if (!r.ok) throw new Error(`add ${catalogId} refused: ${r.error.kind}`);
  return r.value;
}
const get = (objs: DecorObject[], id: string) => objs.find((o) => o.id === id)!;
const must = <T,>(r: { ok: true; value: T } | { ok: false; error: { kind: string } }): T => {
  if (!r.ok) throw new Error(`refused: ${r.error.kind}`);
  return r.value;
};
const kind = (r: { ok: boolean; error?: { kind: string } }) => (r.ok ? 'ok' : r.error!.kind);

describe('catalogue', () => {
  it('is valid and covers everything the brief asks for', () => {
    expect(validateCatalog(DECOR_CATALOG)).toBeNull();
    const ids = DECOR_CATALOG.map((e) => e.id).join(' ');
    for (const w of ['mandap-traditional', 'mandap-modern', 'stage', 'arch', 'flowers', 'chair', 'sofa', 'chandelier', 'lights']) expect(ids).toContain(w);
  });
  it('rejects a bad catalogue', () => {
    const e = DECOR_CATALOG[0]!;
    expect(validateCatalog([e, e])).toMatch(/duplicate/);
    expect(validateCatalog([{ ...e, size: { width: 0, depth: 1, height: 1 } }])).toMatch(/size/);
    expect(validateCatalog([{ ...e, mounts: [] }])).toMatch(/mounts/);
  });
});

describe('geometry follows the renderer', () => {
  it('a quarter turn swaps width and depth', () => {
    const stage = findEntry(DECOR_CATALOG, 'stage-wedding')!; // 7 x 4
    const at = { position: { x: 10, y: 0, z: 10 }, scale: 1 };
    const flat = bounds({ corners: footprintOf(stage, { ...at, rotationY: 0 }) });
    const turned = bounds({ corners: footprintOf(stage, { ...at, rotationY: Math.PI / 2 }) });
    expect([flat.width, flat.depth].map((v) => +v.toFixed(3))).toEqual([7, 4]);
    expect([turned.width, turned.depth].map((v) => +v.toFixed(3))).toEqual([4, 7]);
  });
  it('scale grows the footprint', () => {
    const chair = findEntry(DECOR_CATALOG, 'chair-banquet')!;
    const b = bounds({ corners: footprintOf(chair, { position: { x: 5, y: 0, z: 5 }, rotationY: 0, scale: 2 }) });
    expect(+b.width.toFixed(3)).toBe(1);
  });
});

describe('placement on the floor', () => {
  it('places a mandap inside the room at floor level', () => {
    const o = get(add([], 'm', 'mandap-traditional'), 'm');
    expect(o.mount).toBe('floor');
    expect(o.position.y).toBe(0);
    expect(validateAll(ctx, [o]).ok).toBe(true);
  });
  it('two things added at the same spot do not overlap', () => {
    let objs = add([], 'a', 'mandap-traditional', { x: 12, z: 8 });
    objs = add(objs, 'b', 'mandap-traditional', { x: 12, z: 8 });
    const e = findEntry(DECOR_CATALOG, 'mandap-traditional')!;
    expect(footprintsOverlap(footprintOf(e, get(objs, 'a')), footprintOf(e, get(objs, 'b')))).toBe(false);
  });
  it('a chair flush against a wall can still be turned a quarter', () => {
    let objs = add([], 'c', 'chair-banquet', { x: 5, z: 5 });
    objs = must(moveObject(ctx, objs, 'c', { x: 0.33, z: 5 })); // flush with the west wall
    objs = must(rotateObject(ctx, objs, 'c', Math.PI / 2));
    expect(get(objs, 'c').position.x).toBeCloseTo(0.25, 3);
  });
  it('rotates, scales, moves with grid snapping', () => {
    let objs = add([], 'c', 'chair-banquet', { x: 5, z: 5 });
    objs = must(moveObject(ctx, objs, 'c', { x: 3.04, z: 3.06 }));
    expect(get(objs, 'c').position).toMatchObject({ x: 3, z: 3.1 });
    objs = must(rotateObject(ctx, objs, 'c', Math.PI / 2));
    expect(get(objs, 'c').rotationY).toBeCloseTo(Math.PI / 2, 3);
    objs = must(scaleObject(ctx, objs, 'c', 1.5));
    expect(get(objs, 'c').scale).toBe(1.5);
  });
  it('refuses to move out of the room or into another object', () => {
    let objs = add([], 'a', 'chair-banquet', { x: 3, z: 3 });
    objs = add(objs, 'b', 'chair-banquet', { x: 5, z: 3 });
    expect(kind(moveObject(ctx, objs, 'a', { x: -2, z: 3 }))).toBe('outside-room');
    expect(kind(moveObject(ctx, objs, 'a', { x: 100, z: 3 }))).toBe('outside-room');
    const hit = moveObject(ctx, objs, 'b', { x: 3, z: 3 });
    expect(hit.ok).toBe(false);
    if (!hit.ok) expect(hit.error).toMatchObject({ kind: 'collides', other: 'a' });
    expect(get(objs, 'b').position.x).toBe(5); // input untouched
  });
  it('snaps flush to a wall within range, not beyond it', () => {
    let objs = add([], 'c', 'chair-banquet', { x: 5, z: 5 });
    expect(get(must(moveObject(ctx, objs, 'c', { x: 0.33, z: 5 })), 'c').position.x).toBeCloseTo(0.25, 3);
    expect(get(must(moveObject(ctx, objs, 'c', { x: 1.0, z: 5 })), 'c').position.x).toBeCloseTo(1.0, 3);
  });
  it('rejects unknown ids, catalogue ids and bad scale', () => {
    const objs = add([], 'c', 'chair-banquet');
    expect(kind(moveObject(ctx, objs, 'zz', { x: 1, z: 1 }))).toBe('not-found');
    expect(kind(addObject(ctx, objs, { id: 'n', catalogId: 'nope' }))).toBe('unknown-catalog');
    expect(kind(addObject(ctx, objs, { id: 'c', catalogId: 'chair-banquet' }))).toBe('duplicate-id');
    expect(kind(scaleObject(ctx, objs, 'c', 9))).toBe('bad-scale');
    expect(kind(addObject(ctx, objs, { id: 'w', catalogId: 'chair-banquet', mount: 'ceiling' }))).toBe('bad-mount');
  });
  it('fills a hall with chairs without overlaps, quickly', () => {
    const t0 = Date.now();
    let objs: DecorObject[] = [];
    for (let i = 0; i < 40; i++) objs = add(objs, `c${i}`, 'chair-banquet', { x: 12, z: 8 });
    expect(objs).toHaveLength(40);
    expect(validateAll(ctx, objs).ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('stage mount', () => {
  it('needs a stage; sits on top of it once there is one', () => {
    expect(kind(addObject(ctx, [], { id: 'm', catalogId: 'mandap-traditional', mount: 'stage' }))).toBe('no-support');
    let objs = add([], 's', 'stage-wedding', { x: 12, z: 4 });
    objs = add(objs, 'm', 'mandap-traditional', { mount: 'stage' });
    const m = get(objs, 'm');
    expect(m.mount).toBe('stage');
    expect(m.position.y).toBeCloseTo(0.6, 3);
    expect(childrenOf(ctx, objs, get(objs, 's')).map((o) => o.id)).toEqual(['m']);
  });
  it('moving the stage carries what is on it', () => {
    let objs = add([], 's', 'stage-wedding', { x: 12, z: 4 });
    objs = add(objs, 'k', 'sofa-loveseat', { mount: 'stage' });
    const before = { ...get(objs, 'k').position };
    const s0 = { ...get(objs, 's').position };
    objs = must(moveObject(ctx, objs, 's', { x: 14, z: 5 }));
    const s1 = get(objs, 's').position;
    const k1 = get(objs, 'k').position;
    expect(k1.x - before.x).toBeCloseTo(s1.x - s0.x, 3);
    expect(k1.z - before.z).toBeCloseTo(s1.z - s0.z, 3);
    expect(k1.y).toBeCloseTo(0.6, 3);
  });
  it('protects the stage while it has things on it, and objects cannot leave it by dragging into the air', () => {
    let objs = add([], 's', 'stage-wedding', { x: 12, z: 4 });
    objs = add(objs, 'k', 'chair-banquet', { mount: 'stage' });
    expect(kind(removeObject(ctx, objs, 's'))).toBe('blocked-by-children');
    expect(kind(rotateObject(ctx, objs, 's', 1))).toBe('blocked-by-children');
    expect(kind(scaleObject(ctx, objs, 's', 1.2))).toBe('blocked-by-children');
    expect(kind(moveObject(ctx, objs, 'k', { x: 3, z: 12 }))).toBe('no-support');
    expect(kind(removeObject(ctx, removeObject(ctx, objs, 'k').ok ? must(removeObject(ctx, objs, 'k')) : objs, 's'))).toBe('ok');
  });
  it('floor objects cannot overlap a stage; stage objects cannot overlap each other', () => {
    let objs = add([], 's', 'stage-wedding', { x: 12, z: 4 });
    objs = add(objs, 'f', 'chair-banquet', { x: 3, z: 12 });
    expect(kind(moveObject(ctx, objs, 'f', { x: 12, z: 4 }))).toBe('collides');
    objs = add(objs, 'a', 'sofa-loveseat', { mount: 'stage' });
    objs = add(objs, 'b', 'sofa-loveseat', { mount: 'stage' });
    const e = findEntry(DECOR_CATALOG, 'sofa-loveseat')!;
    expect(footprintsOverlap(footprintOf(e, get(objs, 'a')), footprintOf(e, get(objs, 'b')))).toBe(false);
  });
});

describe('wall mount', () => {
  it('attaches flush, facing into the room, at its base height', () => {
    const objs = add([], 'p', 'flowers-wall-panel', { x: 12, z: 0.2 });
    const p = get(objs, 'p');
    expect(p.mount).toBe('wall');
    expect(p.position.y).toBeCloseTo(0.6, 3);
    expect(p.position.z).toBeCloseTo(0.15, 3);
    expect(p.rotationY).toBeCloseTo(0, 3); // faces +z, into the room
  });
  it('moves to another wall and turns to face in', () => {
    let objs = add([], 'p', 'flowers-wall-panel', { x: 12, z: 0.2 });
    objs = must(moveObject(ctx, objs, 'p', { x: 23.9, z: 8 }));
    const p = get(objs, 'p');
    expect(p.position.x).toBeCloseTo(24 - 0.15, 3);
    expect(p.rotationY).toBeCloseTo(-Math.PI / 2, 3);
    expect(validateAll(ctx, objs).ok).toBe(true);
  });
  it('cannot be turned, stays flush when resized, and can be raised', () => {
    let objs = add([], 'p', 'flowers-wall-panel', { x: 12, z: 0.2 });
    expect(kind(rotateObject(ctx, objs, 'p', 1))).toBe('wall-locked');
    objs = must(scaleObject(ctx, objs, 'p', 1.5));
    expect(get(objs, 'p').position.z).toBeCloseTo((0.3 * 1.5) / 2, 3);
    objs = must(moveObject(ctx, objs, 'p', { x: 12, z: 0.2, y: 1.5 }));
    expect(get(objs, 'p').position.y).toBeCloseTo(1.5, 3);
  });
  it('wall pieces on the same wall do not overlap', () => {
    let objs = add([], 'a', 'flowers-wall-panel', { x: 12, z: 0.2 });
    objs = add(objs, 'b', 'flowers-wall-panel', { x: 12, z: 0.2 });
    expect(get(objs, 'a').position.x).not.toBeCloseTo(get(objs, 'b').position.x, 1);
  });
});

describe('ceiling mount', () => {
  it('hangs from the ceiling, clear of floor objects below it', () => {
    let objs = add([], 'm', 'mandap-traditional', { x: 12, z: 8 });
    objs = add(objs, 'c', 'chandelier-crystal', { x: 12, z: 8 });
    const c = get(objs, 'c');
    expect(c.mount).toBe('ceiling');
    expect(c.position.y).toBeCloseTo(7 - 1.4, 3);
    expect(c.position.x).toBeCloseTo(12, 1); // allowed straight above the mandap
  });
  it('two chandeliers do not overlap', () => {
    let objs = add([], 'a', 'chandelier-crystal', { x: 12, z: 8 });
    objs = add(objs, 'b', 'chandelier-crystal', { x: 12, z: 8 });
    expect(kind(moveObject(ctx, objs, 'b', { x: 12, z: 8 }))).toBe('collides');
  });
});

describe('colours and duplicates keep objects independent', () => {
  it('sets, resets and rejects colours; originals are not mutated', () => {
    const objs = add([], 'm', 'mandap-traditional');
    const red = must(setObjectColor(ctx, objs, 'm', 'flowers', '#ff0000'));
    expect(get(red, 'm').colors).toEqual({ flowers: '#ff0000' });
    expect(get(objs, 'm').colors).toEqual({});
    expect(get(must(setObjectColor(ctx, red, 'm', 'flowers', null)), 'm').colors).toEqual({});
    expect(kind(setObjectColor(ctx, objs, 'm', 'nope', '#ffffff'))).toBe('unknown-catalog');
  });
  it('a duplicate keeps colour and mount but does not share state with the original', () => {
    let objs = must(setObjectColor(ctx, add([], 'm', 'mandap-traditional'), 'm', 'flowers', '#00ff00'));
    objs = must(duplicateObject(ctx, objs, 'm', 'm2'));
    expect(get(objs, 'm2').colors).toEqual({ flowers: '#00ff00' });
    objs = must(setObjectColor(ctx, objs, 'm', 'flowers', '#0000ff'));
    expect(get(objs, 'm2').colors.flowers).toBe('#00ff00');
    expect(kind(duplicateObject(ctx, objs, 'm', 'm2'))).toBe('duplicate-id');
  });
});

// ---------- reducer level ----------

const fresh = () => createSampleWedding('w');
const act = (s: WeddingState, a: WeddingAction | Record<string, unknown>) => {
  const r = applyWeddingAction(s, a);
  if (!r.ok) throw new Error(`${r.error} ${r.hint}`);
  return r.state;
};

describe('scene actions through the reducer', () => {
  it('every accepted action bumps rev; a refused one changes nothing', () => {
    let s = act(fresh(), { type: 'add_decor', id: 'a', catalogId: 'chair-banquet' });
    expect(s.rev).toBe(1);
    const before = JSON.stringify(s);
    const r = applyWeddingAction(s, { type: 'move_decor', id: 'a', x: -50, z: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint).toBeTruthy();
    expect(JSON.stringify(s)).toBe(before);
  });
  it('undo and redo walk the history; a new change clears redo', () => {
    let s = act(fresh(), { type: 'add_decor', id: 'a', catalogId: 'chair-banquet', x: 5, z: 5 });
    s = act(s, { type: 'move_decor', id: 'a', x: 8, z: 8 });
    expect(s.scene.objects[0]!.position.x).toBe(8);
    s = act(s, { type: 'undo_scene' });
    expect(s.scene.objects[0]!.position.x).toBe(5);
    s = act(s, { type: 'redo_scene' });
    expect(s.scene.objects[0]!.position.x).toBe(8);
    s = act(act(s, { type: 'undo_scene' }), { type: 'rotate_decor', id: 'a', rotationY: 1 });
    expect(applyWeddingAction(s, { type: 'redo_scene' }).ok).toBe(false);
    s = act(act(s, { type: 'undo_scene' }), { type: 'undo_scene' });
    expect(s.scene.objects).toHaveLength(0);
    const r = applyWeddingAction(s, { type: 'undo_scene' });
    expect(r.ok).toBe(false);
  });
  it('caps history', () => {
    let s = act(fresh(), { type: 'add_decor', id: 'a', catalogId: 'chair-banquet', x: 5, z: 5 });
    for (let i = 0; i < MAX_HISTORY + 10; i++) s = act(s, { type: 'rotate_decor', id: 'a', rotationY: (i % 2) + 0.5 });
    expect(s.sceneHistory.past.length).toBe(MAX_HISTORY);
  });
  it('colour changes are undoable', () => {
    let s = act(fresh(), { type: 'add_decor', id: 'm', catalogId: 'mandap-traditional' });
    s = act(s, { type: 'set_decor_color', id: 'm', part: 'flowers', color: '#FF00AA' });
    expect(s.scene.objects[0]!.colors.flowers).toBe('#ff00aa'); // normalised to lower case
    s = act(s, { type: 'undo_scene' });
    expect(s.scene.objects[0]!.colors).toEqual({});
  });
  it('saves, clears and reloads a design; saved designs are snapshots', () => {
    let s = act(fresh(), { type: 'add_decor', id: 'm', catalogId: 'mandap-traditional', x: 12, z: 8 });
    s = act(s, { type: 'add_decor', id: 'c', catalogId: 'chair-banquet', x: 4, z: 4 });
    s = act(s, { type: 'save_design', id: 'd1', name: 'Reception A' });
    const saved = JSON.stringify(s.scene.objects);
    s = act(act(s, { type: 'move_decor', id: 'c', x: 6, z: 6 }), { type: 'clear_scene' });
    expect(s.scene.objects).toHaveLength(0);
    s = act(s, { type: 'load_design', id: 'd1' });
    expect(JSON.stringify(s.scene.objects)).toBe(saved);
    s = act(s, { type: 'undo_scene' }); // loading is itself undoable
    expect(s.scene.objects).toHaveLength(0);
  });
  it('keeps several designs, overwrites by id, deletes, and enforces the limit', () => {
    let s = act(fresh(), { type: 'add_decor', id: 'c', catalogId: 'chair-banquet' });
    s = act(s, { type: 'save_design', id: 'a', name: 'One' });
    s = act(s, { type: 'save_design', id: 'b', name: 'Two' });
    s = act(s, { type: 'save_design', id: 'a', name: 'One v2' });
    expect(s.designs.map((d) => d.name)).toEqual(['One v2', 'Two']);
    s = act(s, { type: 'delete_design', id: 'b' });
    expect(s.designs).toHaveLength(1);
    expect(applyWeddingAction(s, { type: 'delete_design', id: 'zz' }).ok).toBe(false);
    for (let i = 0; i < MAX_DESIGNS; i++) {
      const r = applyWeddingAction(s, { type: 'save_design', id: `x${i}`, name: `D${i}` });
      if (r.ok) s = r.state;
    }
    expect(s.designs).toHaveLength(MAX_DESIGNS);
    expect(applyWeddingAction(s, { type: 'save_design', id: 'overflow', name: 'No' }).ok).toBe(false);
  });
  it('loading a design made for another venue switches to that venue when it fits', () => {
    let s = act(fresh(), { type: 'update_profile', patch: { guestCount: 100 } });
    s = act(s, { type: 'add_decor', id: 'c', catalogId: 'chair-banquet', x: 3, z: 3 });
    s = act(s, { type: 'save_design', id: 'd', name: 'Ballroom plan' }); // default studio venue: ballroom
    s = act(act(s, { type: 'clear_scene' }), { type: 'select_venue', venueId: 'venue-courtyard-hall' });
    expect(studioVenueId(s)).toBe('venue-courtyard-hall');
    const loaded = act(s, { type: 'load_design', id: 'd' });
    expect(studioVenueId(loaded)).toBe('venue-grand-ballroom');
    expect(loaded.venueId).toBe('venue-grand-ballroom');
    expect(loaded.scene.objects).toHaveLength(1);
    expect(loaded.sceneHistory).toEqual({ past: [], future: [] });
  });
  it('explains clearly when the design venue cannot hold the guests, and changes nothing', () => {
    let s = act(fresh(), { type: 'update_profile', patch: { guestCount: 100 } });
    s = act(s, { type: 'select_venue', venueId: 'venue-courtyard-hall' });
    s = act(s, { type: 'add_decor', id: 'c', catalogId: 'chair-banquet', x: 3, z: 3 });
    s = act(s, { type: 'save_design', id: 'd', name: 'Courtyard plan' });
    s = act(act(s, { type: 'update_profile', patch: { guestCount: 300 } }), { type: 'select_venue', venueId: 'venue-grand-ballroom' });
    const r = applyWeddingAction(s, { type: 'load_design', id: 'd' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/holds 180 guests but the wedding has 300/);
    expect(s.venueId).toBe('venue-grand-ballroom');
  });
  it('refuses to switch venue when the decorations would not fit the new room', () => {
    let s = act(fresh(), { type: 'update_profile', patch: { guestCount: 100 } });
    s = act(s, { type: 'add_decor', id: 'c', catalogId: 'chair-banquet', x: 20, z: 3 }); // x=20 is outside the 16 m courtyard
    const r = applyWeddingAction(s, { type: 'select_venue', venueId: 'venue-courtyard-hall' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint).toMatch(/clear/i);
  });
  it('rejects malformed scene actions', () => {
    for (const bad of [{ type: 'set_decor_color', id: 'a', part: 'x', color: 'red' }, { type: 'scale_decor', id: 'a', scale: 99 }, { type: 'move_decor', id: 'a', x: 'left', z: 0 }, { type: 'add_decor', id: '', catalogId: 'x' }]) {
      expect(applyWeddingAction(fresh(), bad).ok).toBe(false);
    }
  });
});

describe('persistence and versions', () => {
  it('a saved state survives a JSON round trip and re-validates', () => {
    let s = act(fresh(), { type: 'add_decor', id: 'm', catalogId: 'mandap-modern' });
    s = act(s, { type: 'save_design', id: 'd', name: 'X' });
    const back = WeddingStateSchema.parse(JSON.parse(JSON.stringify(s)));
    expect(back).toEqual(s);
  });
  it('a workspace saved before the studio existed still loads', () => {
    const old = JSON.parse(JSON.stringify(fresh()));
    delete old.sceneHistory;
    delete old.designs;
    const parsed = WeddingStateSchema.parse(old);
    expect(parsed.designs).toEqual([]);
    expect(parsed.sceneHistory).toEqual({ past: [], future: [] });
    old.scene.objects = [{ id: 'a', catalogId: 'chair-banquet', position: { x: 1, y: 0, z: 1 }, rotationY: 0, scale: 1, materialId: null, mount: 'floor' }];
    expect(WeddingStateSchema.parse(old).scene.objects[0]!.colors).toEqual({});
  });
  it('scene files round-trip, migrate v0, and refuse newer or broken input', () => {
    const objs = add([], 'm', 'mandap-traditional');
    const parsed = parseSceneFile(serializeScene('venue-grand-ballroom', objs));
    expect(parsed.ok && parsed.file.objects).toEqual(objs);
    const v0 = JSON.stringify({ version: 0, venueId: 'venue-grand-ballroom', objects: [{ id: 'a', catalogId: 'chair-banquet', position: { x: 1, y: 0, z: 1 }, rotationY: 0, scale: 1 }] });
    const m = parseSceneFile(v0);
    expect(m.ok && m.file.version).toBe(SCENE_FILE_VERSION);
    expect(m.ok && m.file.objects[0]!.mount).toBe('floor');
    expect(parseSceneFile(JSON.stringify({ version: 99, venueId: 'x', objects: [] }))).toEqual({ ok: false, error: 'newer-version' });
    expect(parseSceneFile('nope')).toEqual({ ok: false, error: 'not-json' });
    expect(parseSceneFile('[]')).toEqual({ ok: false, error: 'not-a-scene' });
    expect(parseSceneFile(JSON.stringify({ version: 1, venueId: 'x', objects: [{ id: 'a' }] }))).toEqual({ ok: false, error: 'not-a-scene' });
  });
});


describe('venues, lawn and the extended catalogue', () => {
  const ROOM_IDS = ['venue-grand-ballroom', 'venue-courtyard-hall', 'venue-lakeside-lawn'];
  it('every sample venue has its own 3D room (no silent fallback to the ballroom)', () => {
    for (const id of ROOM_IDS) {
      const s = { ...createSampleWedding('t'), venueId: id };
      expect(studioVenueId(s)).toBe(id);
    }
    expect(new Set(ROOM_IDS.map((id) => STUDIO_ROOMS[id]!.name)).size).toBe(3);
    expect(STUDIO_ROOMS['venue-lakeside-lawn']).toMatchObject({ outdoor: true, theme: 'lawn' });
    expect(STUDIO_ROOMS['venue-courtyard-hall']!.pilasters!.length).toBeGreaterThan(0);
  });
  it('every room exposes the geometry a zone planner needs: polygon, bounds, front, entrance, stage bay, ceiling or outdoor', () => {
    for (const [id, r] of Object.entries(STUDIO_ROOMS)) {
      expect(r.corners.length, id).toBeGreaterThanOrEqual(3);
      const b = bounds(r);
      expect(b.width).toBeGreaterThan(0);
      expect(Math.hypot(r.front!.x, r.front!.z)).toBeCloseTo(1);
      expect(r.entrance!.wallIndex).toBeLessThan(r.corners.length);
      // The entrance lies on its wall, and the stage bay sits inside the room, toward `front` from the entrance.
      const w = walls(r)[r.entrance!.wallIndex]!;
      const cross = (r.entrance!.at.x - w.from.x) * (w.to.z - w.from.z) - (r.entrance!.at.z - w.from.z) * (w.to.x - w.from.x);
      expect(Math.abs(cross), id).toBeLessThan(1e-6);
      const bay = r.stageBay!;
      expect(bay.centre.x - bay.width / 2).toBeGreaterThanOrEqual(b.min.x);
      expect(bay.centre.x + bay.width / 2).toBeLessThanOrEqual(b.max.x);
      expect(bay.centre.z - bay.depth / 2).toBeGreaterThanOrEqual(b.min.z);
      const toBay = { x: bay.centre.x - r.entrance!.at.x, z: bay.centre.z - r.entrance!.at.z };
      expect(toBay.x * r.front!.x + toBay.z * r.front!.z).toBeGreaterThan(0);
      expect(typeof (r.outdoor ?? false)).toBe('boolean');
      expect(r.height).toBeGreaterThan(2);
    }
  });
  it('refuses ceiling pieces on the open lawn with a clear hint, but allows floor, stage and wall pieces', () => {
    let s = act(fresh(), { type: 'update_profile', patch: { guestCount: 100 } });
    s = act(s, { type: 'select_venue', venueId: 'venue-lakeside-lawn' });
    const r = applyWeddingAction(s, { type: 'add_decor', id: 'ch', catalogId: 'chandelier-crystal' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toMatch(/open-air/); expect(r.hint).toMatch(/indoor venue/); }
    const garland = applyWeddingAction(s, { type: 'add_decor', id: 'g', catalogId: 'garland-marigold-curtain', mount: 'ceiling' });
    expect(garland.ok).toBe(false);
    s = act(s, { type: 'add_decor', id: 'st', catalogId: 'stage-wedding' });
    s = act(s, { type: 'add_decor', id: 'm', catalogId: 'mandap-traditional', mount: 'stage' });
    s = act(s, { type: 'add_decor', id: 'w', catalogId: 'garland-marigold-curtain', mount: 'wall' });
    expect(s.scene.objects).toHaveLength(3);
  });
  it('will not move into the lawn while a chandelier hangs in the scene', () => {
    let s = act(fresh(), { type: 'update_profile', patch: { guestCount: 100 } });
    s = act(s, { type: 'add_decor', id: 'ch', catalogId: 'chandelier-crystal', x: 8, z: 8 });
    expect(applyWeddingAction(s, { type: 'select_venue', venueId: 'venue-lakeside-lawn' }).ok).toBe(false);
  });
  it('every catalogue entry has a sample price and a unique procedural model key', () => {
    expect(validateCatalog(DECOR_CATALOG)).toBeNull();
    expect(DECOR_CATALOG.length).toBeGreaterThanOrEqual(17);
    expect(new Set(DECOR_CATALOG.map((e) => e.model)).size).toBe(DECOR_CATALOG.length);
    for (const e of DECOR_CATALOG) expect(e.samplePrice).toBeGreaterThan(0);
  });
  it('places each new piece in the ballroom with a free spot', () => {
    for (const id of ['garland-marigold-curtain', 'lamp-brass-stand', 'aisle-runner-floral', 'table-round-banquet', 'swing-jhula', 'rangoli-floor']) {
      const r = addObject(ctx, [], { id: 'x', catalogId: id });
      expect(r.ok, id).toBe(true);
    }
  });
});
