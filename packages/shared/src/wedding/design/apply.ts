import { z } from 'zod';
import { sampleVenue } from '../sample.js';
import { DECOR_CATALOG } from '../scene/catalog.js';
import { sceneCost } from '../scene/cost.js';
import { MAX_HISTORY } from '../state.js';
import { STUDIO_ROOMS, studioVenueId } from '../scene/rooms.js';
import { validateAll } from '../scene/placement.js';
import { DecorObjectSchema, MAX_DESIGN_VERSIONS, type DesignVersion, type WeddingState } from '../state.js';
import { DESIGN_SOURCES, DesignFormSchema, MAX_REFERENCE_IMAGES, WeddingDesignBriefSchema } from './brief.js';

/**
 * Reducer logic for AI designs. Every function mutates a working copy of the state and returns an error or null; the
 * caller (`applyWeddingAction`) bumps `rev` and re-validates the whole state, so a failure leaves nothing half-applied.
 */

const Id = z.string().min(1).max(40);
const Label = z.string().trim().min(1).max(60);
const Stamp = z.string().max(40);

export const ApplyDesignPlanSchema = z.object({
  type: z.literal('apply_design_plan'),
  versionId: Id, label: Label, createdAt: Stamp,
  source: z.enum(DESIGN_SOURCES),
  /** The studio venue the plan was computed for; a plan for another venue is stale. */
  venueId: z.string().min(1).max(60),
  brief: WeddingDesignBriefSchema,
  form: DesignFormSchema,
  objects: z.array(DecorObjectSchema).max(300),
  summary: z.string().max(800),
  substitutions: z.array(z.string().max(200)).max(20),
  acceptOverBudget: z.boolean().optional(),
  /** Which deterministic variant of the brief this plan is (0 = first); stored so "another version" continues the sequence. */
  variant: z.number().int().min(0).max(1000).default(0),
});
export const RestoreDesignVersionSchema = z.object({ type: z.literal('restore_design_version'), id: Id });
export const DeleteDesignVersionSchema = z.object({ type: z.literal('delete_design_version'), id: Id });
export const SnapshotDesignVersionSchema = z.object({ type: z.literal('snapshot_design_version'), id: Id, label: Label, createdAt: Stamp });
export const SetReferenceImagesSchema = z.object({ type: z.literal('set_reference_images'), ids: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(MAX_REFERENCE_IMAGES) });

export const DESIGN_ACTION_TYPES = ['apply_design_plan', 'restore_design_version', 'delete_design_version', 'snapshot_design_version', 'set_reference_images'] as const;
/** The subset a browser may send. Plans come from the server's planner only. */
export const CLIENT_DESIGN_ACTIONS = ['restore_design_version', 'delete_design_version', 'snapshot_design_version'] as const;

export type DesignAction = z.infer<typeof ApplyDesignPlanSchema> | z.infer<typeof RestoreDesignVersionSchema> | z.infer<typeof DeleteDesignVersionSchema> | z.infer<typeof SnapshotDesignVersionSchema> | z.infer<typeof SetReferenceImagesSchema>;
export type DesignOutcome = { ok: true } | { ok: false; error: string; hint: string; code?: 'over_limit' };
const bad = (error: string, hint: string, code?: 'over_limit'): DesignOutcome => ({ ok: false, error, hint, ...(code ? { code } : {}) });

function setScene(state: WeddingState, objects: WeddingState['scene']['objects']) {
  state.sceneHistory = { past: [...state.sceneHistory.past, state.scene.objects].slice(-MAX_HISTORY), future: [] };
  state.scene = { objects };
}

export function applyDesignAction(state: WeddingState, a: DesignAction): DesignOutcome {
  switch (a.type) {
    case 'apply_design_plan': {
      if (a.venueId !== studioVenueId(state)) return bad('The venue changed while the design was being made.', 'Generate the design again for this venue.');
      if (state.design.versions.length >= MAX_DESIGN_VERSIONS && !state.design.versions.some((v) => v.id === a.versionId)) return bad(`You can keep ${MAX_DESIGN_VERSIONS} design versions.`, 'Delete an old version first.');
      const room = STUDIO_ROOMS[a.venueId];
      if (!room) return bad('That venue has no 3D room.', 'Pick another venue.');
      const valid = validateAll({ room, catalog: DECOR_CATALOG }, a.objects);
      if (!valid.ok) return bad('The generated layout does not fit the venue.', 'Generate it again or use a larger venue.');
      const cost = sceneCost(a.objects);
      const limit = state.budget.limits.decoration;
      if (limit !== undefined && cost > limit && !a.acceptOverBudget) return bad(`The design costs ₹${cost.toLocaleString('en-IN')} at sample prices, above the ₹${limit.toLocaleString('en-IN')} limit.`, 'Raise the decoration limit or generate a simpler design.', 'over_limit');
      setScene(state, structuredClone(a.objects));
      const version: DesignVersion = { id: a.versionId, label: a.label, createdAt: a.createdAt, source: a.source, venueId: a.venueId, objects: structuredClone(a.objects), brief: structuredClone(a.brief), summary: a.summary, costInr: cost, substitutions: a.substitutions };
      const i = state.design.versions.findIndex((v) => v.id === a.versionId);
      if (i >= 0) state.design.versions[i] = version; else state.design.versions.push(version);
      state.design.brief = structuredClone(a.brief);
      state.design.form = structuredClone(a.form);
      state.design.source = a.source;
      state.design.activeVersionId = a.versionId;
      state.design.variantCounter = a.variant;
      return { ok: true };
    }
    case 'restore_design_version': {
      const v = state.design.versions.find((x) => x.id === a.id);
      if (!v) return bad('No such design version.', 'Pick a version from the list.');
      const room = STUDIO_ROOMS[v.venueId];
      const venue = sampleVenue(v.venueId);
      if (!room || !venue) return bad(`"${v.label}" was made for a venue that is not available.`, 'Generate a new design.');
      if (v.venueId !== studioVenueId(state) && venue.capacity < state.profile.guestCount) return bad(`"${v.label}" was made for ${room.name}, which holds ${venue.capacity} guests but the wedding has ${state.profile.guestCount}.`, 'Change the guest count or generate a new design.');
      if (!validateAll({ room, catalog: DECOR_CATALOG }, v.objects).ok) return bad(`"${v.label}" no longer fits its venue.`, 'The catalogue or venue changed since it was saved.');
      if (v.venueId !== studioVenueId(state)) { state.venueId = v.venueId; state.sceneHistory = { past: [], future: [] }; state.scene = { objects: structuredClone(v.objects) }; }
      else setScene(state, structuredClone(v.objects));
      state.design.brief = v.brief ? structuredClone(v.brief) : state.design.brief;
      state.design.source = v.source === 'manual' ? state.design.source : v.source;
      state.design.activeVersionId = v.id;
      return { ok: true };
    }
    case 'delete_design_version': {
      const i = state.design.versions.findIndex((x) => x.id === a.id);
      if (i < 0) return bad('No such design version.', 'Pick a version from the list.');
      state.design.versions.splice(i, 1);
      if (state.design.activeVersionId === a.id) state.design.activeVersionId = null;
      return { ok: true };
    }
    case 'snapshot_design_version': {
      if (state.design.versions.length >= MAX_DESIGN_VERSIONS && !state.design.versions.some((v) => v.id === a.id)) return bad(`You can keep ${MAX_DESIGN_VERSIONS} design versions.`, 'Delete an old version first.');
      if (state.scene.objects.length === 0) return bad('The scene is empty, so there is nothing to save.', 'Generate or build a design first.');
      const v: DesignVersion = { id: a.id, label: a.label, createdAt: a.createdAt, source: 'manual', venueId: studioVenueId(state), objects: structuredClone(state.scene.objects), brief: state.design.brief ? structuredClone(state.design.brief) : null, summary: 'Saved from the current scene.', costInr: sceneCost(state.scene.objects), substitutions: [] };
      const i = state.design.versions.findIndex((x) => x.id === a.id);
      if (i >= 0) state.design.versions[i] = v; else state.design.versions.push(v);
      state.design.activeVersionId = a.id;
      return { ok: true };
    }
    case 'set_reference_images':
      state.design.referenceImageIds = [...new Set(a.ids)];
      return { ok: true };
  }
}
