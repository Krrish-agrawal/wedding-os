import { z } from 'zod';
import { formatInr, summarizeBudget } from './budget.js';
import {
  AddDecorSchema, AddDecorsSchema, RemoveDecorsSchema, SetDecorColorsSchema, ClearSceneSchema, DeleteDesignSchema, DuplicateDecorSchema, LoadDesignSchema, MoveDecorSchema, RedoSceneSchema, RemoveDecorSchema, RotateDecorSchema,
  SaveDesignSchema, ScaleDecorSchema, SetDecorColorSchema, UndoSceneSchema, applySceneAction, sceneContext, SCENE_ACTION_TYPES, type SceneAction,
} from './scene/actions.js';
import { studioVenueId } from './scene/rooms.js';
import { ApplyDesignPlanSchema, CLIENT_DESIGN_ACTIONS, DeleteDesignVersionSchema, RestoreDesignVersionSchema, SetReferenceImagesSchema, SnapshotDesignVersionSchema, applyDesignAction, type DesignAction } from './design/apply.js';
import { validateAll } from './scene/placement.js';
import { findGarment } from './tryon/catalog.js';
import { SAMPLE_VENUES, createSampleWedding, sampleVenue } from './sample.js';
import {
  BudgetCategorySchema,
  ExpenseSchema,
  IsoDateSchema,
  MAX_AMOUNT_INR,
  WeddingProfileSchema,
  WeddingProfilePatchSchema,
  ShortlistedVendorSchema,
  WeddingStateSchema,
  type WeddingState,
} from './state.js';

/**
 * The only way wedding state changes. Every agent tool, every UI control and every API route builds one
 * of these actions and hands it to `applyWeddingAction`. Invariants live here, not in the callers, so a
 * client that skips the agent still cannot break them.
 */

const Rupees = z.number().int().min(0).max(MAX_AMOUNT_INR);

export const WeddingActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('update_profile'), patch: WeddingProfilePatchSchema.refine((p) => Object.keys(p).length > 0, 'Provide at least one field') }),
  z.object({ type: z.literal('select_venue'), venueId: z.string().min(1).max(60).nullable() }),
  z.object({ type: z.literal('set_total_budget'), total: Rupees }),
  z.object({ type: z.literal('set_allocations'), allocations: z.partialRecord(BudgetCategorySchema, Rupees) }),
  z.object({ type: z.literal('add_expense'), expense: ExpenseSchema }),
  z.object({ type: z.literal('remove_expense'), expenseId: z.string().min(1).max(40) }),
  /** Server-side only: the server fills name/category/source from the vendor catalogue, so a browser cannot forge them. */
  z.object({ type: z.literal('shortlist_vendor'), vendor: ShortlistedVendorSchema }),
  z.object({ type: z.literal('unshortlist_vendor'), vendorId: z.string().min(1).max(60) }),
  z.object({ type: z.literal('save_outfit'), outfit: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), label: z.string().trim().min(1).max(80), garmentId: z.string().min(1).max(60), note: z.string().trim().max(200).optional() }) }),
  z.object({ type: z.literal('remove_outfit'), outfitId: z.string().min(1).max(40) }),
  ApplyDesignPlanSchema, RestoreDesignVersionSchema, DeleteDesignVersionSchema, SnapshotDesignVersionSchema, SetReferenceImagesSchema,
  z.object({ type: z.literal('reset_to_sample'), id: z.string().min(1).max(64).optional() }),
  AddDecorSchema, AddDecorsSchema, RemoveDecorsSchema, SetDecorColorsSchema, MoveDecorSchema, RotateDecorSchema, ScaleDecorSchema, SetDecorColorSchema, DuplicateDecorSchema, RemoveDecorSchema, ClearSceneSchema,
  UndoSceneSchema, RedoSceneSchema, SaveDesignSchema, LoadDesignSchema, DeleteDesignSchema,
  z.object({ type: z.literal('set_budget_limit'), category: BudgetCategorySchema, amount: Rupees.nullable() }),
]);
export type WeddingAction = z.infer<typeof WeddingActionSchema>;

/** Actions a browser may send directly. Everything else is for server-side code (agent tools) only. */
export const CLIENT_ALLOWED_ACTIONS: readonly WeddingAction['type'][] = ['update_profile', 'select_venue', 'set_total_budget', 'set_allocations', 'add_expense', 'remove_expense', 'set_budget_limit', 'save_outfit', 'remove_outfit', ...CLIENT_DESIGN_ACTIONS, ...SCENE_ACTION_TYPES];

export type ApplyResult =
  | { ok: true; state: WeddingState }
  | { ok: false; error: string; hint: string; code?: 'over_limit' };

const reject = (error: string, hint: string, code?: 'over_limit'): ApplyResult => ({ ok: false, error, hint, ...(code ? { code } : {}) });

/** Validates `action` against `state` and returns the next state (rev + 1) or a recoverable rejection. Pure. */
export function applyWeddingAction(state: WeddingState, raw: unknown): ApplyResult {
  const parsed = WeddingActionSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return reject(`Invalid action: ${first ? `${first.path.join('.') || 'action'}: ${first.message}` : 'unrecognised'}.`, 'Check the argument names and ranges, then try again.');
  }
  const action = parsed.data;
  const next = structuredClone(state);

  switch (action.type) {
    case 'update_profile': {
      const merged = { ...next.profile, ...action.patch };
      const check = WeddingProfileSchema.safeParse(merged);
      if (!check.success) return reject('That profile change is not valid.', 'Use a real YYYY-MM-DD date and a guest count from 1 to 5000.');
      next.profile = check.data;
      break;
    }
    case 'select_venue': {
      if (action.venueId === null) {
        next.venueId = null;
        break;
      }
      const venue = sampleVenue(action.venueId);
      if (!venue) return reject(`No venue with id "${action.venueId}".`, `Pick one of: ${SAMPLE_VENUES.map((v) => v.id).join(', ')}.`);
      if (venue.capacity < next.profile.guestCount) {
        return reject(`${venue.name} holds ${venue.capacity} guests but the wedding has ${next.profile.guestCount}.`, 'Choose a larger venue or change the guest count first.');
      }
      const before = studioVenueId(next);
      next.venueId = venue.id;
      if (studioVenueId(next) !== before) {
        // The 3D room changes: keep the scene only if it still fits, and drop history that belongs to the old room.
        const fits = validateAll(sceneContext(next), next.scene.objects);
        if (!fits.ok) return reject('The decorations would not fit that venue.', 'Clear the decoration scene (or choose a larger venue) first.');
        next.sceneHistory = { past: [], future: [] };
      }
      break;
    }
    case 'set_total_budget': {
      const planned = summarizeBudget(next).allocated;
      if (action.total < planned) {
        return reject(`The total ${formatInr(action.total)} is below the ${formatInr(planned)} already allocated.`, 'Reduce the category allocations first, or choose a higher total.');
      }
      next.budget.total = action.total;
      break;
    }
    case 'set_allocations': {
      const allocations = { ...next.budget.allocations, ...action.allocations };
      const sum = Object.values(allocations).reduce((s, v) => s + (v ?? 0), 0);
      if (sum > next.budget.total) {
        return reject(`Allocations would total ${formatInr(sum)}, above the budget of ${formatInr(next.budget.total)}.`, 'Lower an allocation or raise the total budget first.');
      }
      next.budget.allocations = allocations;
      break;
    }
    case 'add_expense': {
      if (next.budget.expenses.some((e) => e.id === action.expense.id)) return reject(`Expense id "${action.expense.id}" already exists.`, 'Use a new id.');
      next.budget.expenses.push(action.expense);
      break;
    }
    case 'remove_expense': {
      const i = next.budget.expenses.findIndex((e) => e.id === action.expenseId);
      if (i < 0) return reject(`No expense with id "${action.expenseId}".`, 'List the expenses to find the right id.');
      next.budget.expenses.splice(i, 1);
      break;
    }
    case 'set_budget_limit': {
      if (action.amount === null) delete next.budget.limits[action.category];
      else next.budget.limits[action.category] = action.amount;
      break;
    }
    case 'add_decor': case 'add_decors': case 'remove_decors': case 'set_decor_colors': case 'move_decor': case 'rotate_decor': case 'scale_decor': case 'set_decor_color':
    case 'duplicate_decor': case 'remove_decor': case 'clear_scene': case 'undo_scene': case 'redo_scene':
    case 'save_design': case 'load_design': case 'delete_design': {
      const outcome = applySceneAction(next, action as SceneAction);
      if (!outcome.ok) return reject(outcome.error, outcome.hint, outcome.code);
      break;
    }
    case 'shortlist_vendor': {
      const i = next.vendorShortlist.findIndex((v) => v.vendorId === action.vendor.vendorId);
      if (i >= 0) next.vendorShortlist[i] = action.vendor;
      else if (next.vendorShortlist.length >= 60) return reject('The shortlist is full (60 vendors).', 'Remove a vendor first.');
      else next.vendorShortlist.push(action.vendor);
      break;
    }
    case 'unshortlist_vendor': {
      const i = next.vendorShortlist.findIndex((v) => v.vendorId === action.vendorId);
      if (i < 0) return reject(`Vendor "${action.vendorId}" is not on the shortlist.`, 'Read the shortlist to see what is on it.');
      next.vendorShortlist.splice(i, 1);
      break;
    }
    case 'save_outfit': {
      const g = findGarment(action.outfit.garmentId);
      if (!g) return reject(`No garment with id "${action.outfit.garmentId}".`, 'List the garments to find a real id.');
      if (!g.supported) return reject(`${g.name} is a future option and cannot be tried on, so it cannot be saved as a look.`, 'Choose a garment whose status is supported or experimental.');
      if (next.outfits.some((o) => o.id === action.outfit.id)) return reject(`A look with id "${action.outfit.id}" already exists.`, 'Use a new id.');
      if (next.outfits.length >= 60) return reject('The saved looks are full (60).', 'Delete a look first.');
      next.outfits.push({ id: action.outfit.id, label: action.outfit.label, garmentId: g.id, note: action.outfit.note ?? '', createdAt: new Date().toISOString() });
      break;
    }
    case 'remove_outfit': {
      const i = next.outfits.findIndex((o) => o.id === action.outfitId);
      if (i < 0) return reject(`No saved look with id "${action.outfitId}".`, 'List the saved looks to find the right id.');
      next.outfits.splice(i, 1);
      break;
    }
    case 'apply_design_plan': case 'restore_design_version': case 'delete_design_version': case 'snapshot_design_version': case 'set_reference_images': {
      const outcome = applyDesignAction(next, action as DesignAction);
      if (!outcome.ok) return reject(outcome.error, outcome.hint, outcome.code);
      break;
    }
    case 'reset_to_sample': {
      const fresh = createSampleWedding(action.id ?? state.id);
      fresh.rev = state.rev + 1;
      const ok = WeddingStateSchema.safeParse(fresh);
      return ok.success ? { ok: true, state: ok.data } : reject('Reset failed.', 'Report this.');
    }
  }

  next.rev = state.rev + 1;
  const final = WeddingStateSchema.safeParse(next);
  if (!final.success) return reject('The change would leave the wedding in an invalid state.', 'Try a smaller or different change.');
  return { ok: true, state: final.data };
}

export { IsoDateSchema };
