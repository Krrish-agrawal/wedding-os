import { z } from 'zod';
import { HexColorSchema, MAX_DESIGNS, MAX_HISTORY, type DecorObject, type WeddingState } from '../state.js';
import { DECOR_CATALOG, MIN_SCALE, MAX_SCALE, findEntry } from './catalog.js';
import { sceneCost } from './cost.js';
import { sampleVenue } from '../sample.js';
import { studioRoom, studioVenueId, STUDIO_ROOMS } from './rooms.js';
import {
  addObject, addObjects, duplicateObject, moveObject, removeObject, removeObjects, rotateObject, scaleObject, setObjectColor, setObjectsColor, validateAll,
  type Placed, type SceneContext, type SceneError,
} from './placement.js';

/**
 * Scene actions. Each is validated by the shared domain and applied through `applyWeddingAction`, so a person
 * dragging in the studio and (from milestone 3) an agent tool go through the same checks and share one undo history.
 */

const Id = z.string().min(1).max(40);
const Metres = z.number().finite().min(-1000).max(1000);

const Colors = z.record(z.string().max(30), HexColorSchema);
const Mount = z.enum(['floor', 'stage', 'wall', 'ceiling']);
/** `acceptOverBudget` lets an add go past the customer's decoration limit. Only the customer's own explicit choice should set it. */
export const AddDecorSchema = z.object({ type: z.literal('add_decor'), id: Id, catalogId: z.string().min(1).max(60), mount: Mount.optional(), x: Metres.optional(), z: Metres.optional(), colors: Colors.optional(), acceptOverBudget: z.boolean().optional() });
export const AddDecorsSchema = z.object({
  type: z.literal('add_decors'),
  items: z.array(z.object({ id: Id, catalogId: z.string().min(1).max(60), mount: Mount.optional(), x: Metres.optional(), z: Metres.optional(), rotationY: z.number().finite().min(-100).max(100).optional(), colors: Colors.optional() })).min(1).max(30),
  acceptOverBudget: z.boolean().optional(),
});
export const RemoveDecorsSchema = z.object({ type: z.literal('remove_decors'), ids: z.array(Id).min(1).max(100) });
export const SetDecorColorsSchema = z.object({ type: z.literal('set_decor_colors'), ids: z.array(Id).min(1).max(100), part: z.string().min(1).max(30), color: HexColorSchema.nullable() });
export const MoveDecorSchema = z.object({ type: z.literal('move_decor'), id: Id, x: Metres, z: Metres, y: Metres.optional() });
export const RotateDecorSchema = z.object({ type: z.literal('rotate_decor'), id: Id, rotationY: z.number().finite().min(-100).max(100) });
export const ScaleDecorSchema = z.object({ type: z.literal('scale_decor'), id: Id, scale: z.number().finite().min(MIN_SCALE).max(MAX_SCALE) });
export const SetDecorColorSchema = z.object({ type: z.literal('set_decor_color'), id: Id, part: z.string().min(1).max(30), color: HexColorSchema.nullable() });
export const DuplicateDecorSchema = z.object({ type: z.literal('duplicate_decor'), id: Id, newId: Id, acceptOverBudget: z.boolean().optional() });
export const RemoveDecorSchema = z.object({ type: z.literal('remove_decor'), id: Id });
export const ClearSceneSchema = z.object({ type: z.literal('clear_scene') });
export const UndoSceneSchema = z.object({ type: z.literal('undo_scene') });
export const RedoSceneSchema = z.object({ type: z.literal('redo_scene') });
export const SaveDesignSchema = z.object({ type: z.literal('save_design'), id: Id, name: z.string().trim().min(1).max(60) });
export const LoadDesignSchema = z.object({ type: z.literal('load_design'), id: Id });
export const DeleteDesignSchema = z.object({ type: z.literal('delete_design'), id: Id });

export const SCENE_ACTION_TYPES = ['add_decor', 'add_decors', 'remove_decors', 'set_decor_colors', 'move_decor', 'rotate_decor', 'scale_decor', 'set_decor_color', 'duplicate_decor', 'remove_decor', 'clear_scene', 'undo_scene', 'redo_scene', 'save_design', 'load_design', 'delete_design'] as const;

export type SceneAction = z.infer<typeof AddDecorSchema> | z.infer<typeof AddDecorsSchema> | z.infer<typeof RemoveDecorsSchema> | z.infer<typeof SetDecorColorsSchema> | z.infer<typeof MoveDecorSchema> | z.infer<typeof RotateDecorSchema> | z.infer<typeof ScaleDecorSchema> | z.infer<typeof SetDecorColorSchema> | z.infer<typeof DuplicateDecorSchema> | z.infer<typeof RemoveDecorSchema> | z.infer<typeof ClearSceneSchema> | z.infer<typeof UndoSceneSchema> | z.infer<typeof RedoSceneSchema> | z.infer<typeof SaveDesignSchema> | z.infer<typeof LoadDesignSchema> | z.infer<typeof DeleteDesignSchema>;

/** `code` lets callers tell a customer-limit refusal from any other refusal without parsing text. */
export type SceneOutcome = { ok: true } | { ok: false; error: string; hint: string; code?: 'over_limit' };
const bad = (error: string, hint: string, code?: 'over_limit'): SceneOutcome => ({ ok: false, error, hint, ...(code ? { code } : {}) });

export const sceneContext = (state: Pick<WeddingState, 'venueId'>): SceneContext => ({ room: studioRoom(state), catalog: DECOR_CATALOG });

function nameOf(state: WeddingState, id?: string): string {
  const o = state.scene.objects.find((x) => x.id === id);
  return (o && findEntry(DECOR_CATALOG, o.catalogId)?.name) ?? 'the object';
}

function explain(state: WeddingState, e: SceneError): SceneOutcome {
  const me = nameOf(state, e.id);
  switch (e.kind) {
    case 'collides': return bad(`${me} would overlap ${nameOf(state, e.other)}.`, 'Choose a free spot, or move the other object first.');
    case 'outside-room': return bad(`${me} would not fit inside the venue there.`, 'Pick a spot fully inside the walls.');
    case 'no-support': return bad(`${me} needs a wedding stage under it.`, 'Add a wedding stage and place the object on it.');
    case 'no-ceiling': return bad(`${me} hangs from a ceiling, and this venue is open-air.`, 'Choose an indoor venue for ceiling pieces, or use floor, stage or wall decorations here.');
    case 'not-on-wall': return bad(`${me} must be attached to a wall.`, 'Move it next to a wall.');
    case 'wall-locked': return bad('Wall decorations face into the room and cannot be turned.', 'Move it to another wall to change where it faces.');
    case 'blocked-by-children': return bad(`${me} has ${nameOf(state, e.other)} on it.`, 'Move or remove what is on the stage first.');
    case 'bad-mount': return bad(`${me} cannot be mounted that way.`, 'Use one of the mounts the catalogue allows for it.');
    case 'bad-scale': return bad('That size is outside the allowed range.', `Use a scale from ${MIN_SCALE} to ${MAX_SCALE}.`);
    case 'bad-elevation': return bad(`${me} is at an invalid height.`, 'Move it to a valid spot.');
    case 'no-free-spot': return bad(`There is no free space left for ${me}.`, 'Remove or move something, or use a larger venue.');
    case 'unknown-catalog': return bad('That decoration or colour part does not exist.', 'Use an id from the catalogue.');
    case 'duplicate-id': return bad('That object id is already in use.', 'Use a new id.');
    case 'not-found': return bad('No such object in the scene.', 'Select an object that exists.');
  }
}

function setObjects(state: WeddingState, objects: DecorObject[]): void {
  state.sceneHistory = { past: [...state.sceneHistory.past, state.scene.objects].slice(-MAX_HISTORY), future: [] };
  state.scene = { objects };
}

function run(state: WeddingState, r: Placed<DecorObject[]>, guard?: { acceptOverBudget?: boolean }): SceneOutcome {
  if (!r.ok) return explain(state, r.error);
  if (guard && !guard.acceptOverBudget) {
    // The customer's decoration limit is enforced here, not in the callers, so no tool or client can skip it.
    const limit = state.budget.limits.decoration;
    const before = sceneCost(state.scene.objects);
    const after = sceneCost(r.value);
    if (limit !== undefined && after > before && after > limit) {
      return bad(`This would bring the decoration estimate to ₹${after.toLocaleString('en-IN')}, above the ₹${limit.toLocaleString('en-IN')} limit. (Sample prices.)`, 'Tell the customer, then remove something, choose cheaper pieces, or raise the decoration limit with their agreement.', 'over_limit');
    }
  }
  setObjects(state, r.value);
  return { ok: true };
}

/** Mutates `state` (a working copy) for a scene action. The caller bumps `rev` and re-validates the whole state. */
export function applySceneAction(state: WeddingState, action: SceneAction): SceneOutcome {
  const ctx = sceneContext(state);
  const objects = state.scene.objects;
  switch (action.type) {
    case 'add_decor': return run(state, addObject(ctx, objects, { id: action.id, catalogId: action.catalogId, mount: action.mount, x: action.x, z: action.z, colors: action.colors }), action);
    case 'add_decors': return run(state, addObjects(ctx, objects, action.items), action);
    case 'remove_decors': return run(state, removeObjects(ctx, objects, action.ids));
    case 'set_decor_colors': return run(state, setObjectsColor(ctx, objects, action.ids, action.part, action.color));
    case 'move_decor': return run(state, moveObject(ctx, objects, action.id, { x: action.x, z: action.z, y: action.y }));
    case 'rotate_decor': return run(state, rotateObject(ctx, objects, action.id, action.rotationY));
    case 'scale_decor': return run(state, scaleObject(ctx, objects, action.id, action.scale));
    case 'set_decor_color': return run(state, setObjectColor(ctx, objects, action.id, action.part, action.color));
    case 'duplicate_decor': return run(state, duplicateObject(ctx, objects, action.id, action.newId), action);
    case 'remove_decor': return run(state, removeObject(ctx, objects, action.id));
    case 'clear_scene':
      if (objects.length === 0) return bad('The scene is already empty.', 'Nothing to clear.');
      setObjects(state, []);
      return { ok: true };
    case 'undo_scene': {
      const prev = state.sceneHistory.past.at(-1);
      if (!prev) return bad('Nothing to undo.', 'No earlier change is recorded.');
      state.sceneHistory = { past: state.sceneHistory.past.slice(0, -1), future: [...state.sceneHistory.future, objects].slice(-MAX_HISTORY) };
      state.scene = { objects: prev };
      return { ok: true };
    }
    case 'redo_scene': {
      const next = state.sceneHistory.future.at(-1);
      if (!next) return bad('Nothing to redo.', 'No undone change is waiting.');
      state.sceneHistory = { past: [...state.sceneHistory.past, objects].slice(-MAX_HISTORY), future: state.sceneHistory.future.slice(0, -1) };
      state.scene = { objects: next };
      return { ok: true };
    }
    case 'save_design': {
      const i = state.designs.findIndex((d) => d.id === action.id);
      const design = { id: action.id, name: action.name, venueId: studioVenueId(state), objects: structuredClone(objects) };
      if (i >= 0) state.designs[i] = design;
      else if (state.designs.length >= MAX_DESIGNS) return bad(`You can keep ${MAX_DESIGNS} designs.`, 'Delete an old design first.');
      else state.designs.push(design);
      return { ok: true };
    }
    case 'load_design': {
      const d = state.designs.find((x) => x.id === action.id);
      if (!d) return bad('No such saved design.', 'Pick a design from the list.');
      let loadCtx = ctx;
      let switchTo: string | null = null;
      if (d.venueId !== studioVenueId(state)) {
        // A design belongs to one venue. Switch to it when the wedding can use it; otherwise say exactly why not.
        const room = STUDIO_ROOMS[d.venueId];
        const venue = sampleVenue(d.venueId);
        const where = room?.name ?? 'another venue';
        if (!room || !venue) return bad(`"${d.name}" was designed for ${where}, which is not available.`, 'Delete this design or recreate it in a current venue.');
        if (venue.capacity < state.profile.guestCount) return bad(`"${d.name}" was designed for ${where}, which holds ${venue.capacity} guests but the wedding has ${state.profile.guestCount}.`, 'Change the guest count, or recreate the design in a larger venue.');
        switchTo = d.venueId;
        loadCtx = { room, catalog: DECOR_CATALOG };
      }
      const valid = validateAll(loadCtx, d.objects);
      if (!valid.ok) return bad(`"${d.name}" no longer fits this venue.`, 'The catalogue or venue changed since it was saved.');
      if (switchTo) {
        state.venueId = switchTo;
        state.sceneHistory = { past: [], future: [] }; // history belongs to the old room
        state.scene = { objects: structuredClone(d.objects) };
      } else setObjects(state, structuredClone(d.objects));
      return { ok: true };
    }
    case 'delete_design': {
      const i = state.designs.findIndex((x) => x.id === action.id);
      if (i < 0) return bad('No such saved design.', 'Pick a design from the list.');
      state.designs.splice(i, 1);
      return { ok: true };
    }
  }
}
