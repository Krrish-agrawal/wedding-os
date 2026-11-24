import { z } from 'zod';
import { VendorCategorySchema, type VendorCategory } from './vendors/schema.js';
import { DESIGN_SOURCES, DesignFormSchema, MAX_REFERENCE_IMAGES, WeddingDesignBriefSchema } from './design/brief.js';

/**
 * Wedding OS shared state. One schema, one reducer (see actions.ts). Agents, the API and the UI all read
 * and write this shape and nothing else. Money is whole rupees (integers) so totals never drift.
 */

export const WEDDING_STATE_VERSION = 1;

export const BUDGET_CATEGORIES = ['venue', 'catering', 'decoration', 'photography', 'attire', 'entertainment', 'travel', 'miscellaneous'] as const;
export const BudgetCategorySchema = z.enum(BUDGET_CATEGORIES);
export type BudgetCategory = z.infer<typeof BudgetCategorySchema>;

export const MAX_GUESTS = 5000;
/** Ceiling for any single money amount: 100 crore. Rejects typos and prompt-injected absurd values. */
export const MAX_AMOUNT_INR = 1_000_000_000;

const Rupees = z.number().int().min(0).max(MAX_AMOUNT_INR);
const ShortText = z.string().trim().max(80);

/** `YYYY-MM-DD` that is a real calendar date. */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date');

const profileFields = {
  /** e.g. "Aarav & Meera". */
  coupleNames: ShortText,
  city: ShortText,
  date: IsoDateSchema.nullable(),
  guestCount: z.number().int().min(1).max(MAX_GUESTS),
  /** Free-text theme, e.g. "Royal Rajasthani". */
  style: ShortText,
  /** Ceremonies the couple plans, e.g. "Haldi", "Sangeet". */
  events: z.array(z.string().trim().min(1).max(40)).max(12),
  /** True once the couple has finished the welcome questions. */
  onboarded: z.boolean(),
};

export const WeddingProfileSchema = z.object({ ...profileFields, events: profileFields.events.default([]), onboarded: profileFields.onboarded.default(false) });
/** A partial change. Built without defaults so an omitted `events` can never be reset to []. */
export const WeddingProfilePatchSchema = z.object(profileFields).partial();
export type WeddingProfile = z.infer<typeof WeddingProfileSchema>;

export const ExpenseSchema = z.object({
  id: z.string().min(1).max(40),
  category: BudgetCategorySchema,
  label: ShortText.min(1),
  amount: Rupees,
});
export type Expense = z.infer<typeof ExpenseSchema>;

export const BudgetSchema = z.object({
  total: Rupees,
  /** Planned spend per category. Their sum may never exceed `total`. */
  allocations: z.partialRecord(BudgetCategorySchema, Rupees),
  expenses: z.array(ExpenseSchema).max(500),
  /** Ceilings the customer set (e.g. decoration under 2 lakhs). Separate from the plan: a limit is a promise not to exceed. */
  limits: z.partialRecord(BudgetCategorySchema, Rupees).default({}),
});
export type Budget = z.infer<typeof BudgetSchema>;

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((c) => c.toLowerCase());

/** Where a decoration is attached. Used from milestone 2; the schema is fixed now so saved designs stay valid. */
export const MOUNT_KINDS = ['floor', 'stage', 'wall', 'ceiling'] as const;
export const DecorObjectSchema = z.object({
  id: z.string().min(1).max(40),
  catalogId: z.string().min(1).max(60),
  position: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }),
  rotationY: z.number().finite(),
  scale: z.number().finite().min(0.1).max(10),
  materialId: z.string().min(1).max(60).nullable(),
  mount: z.enum(MOUNT_KINDS),
  /** Per-part colour overrides, `#rrggbb`. Parts not listed use the catalogue default. */
  colors: z.record(z.string().max(30), HexColorSchema).default({}),
});
export type DecorObject = z.infer<typeof DecorObjectSchema>;

export const DecorationSceneSchema = z.object({
  objects: z.array(DecorObjectSchema).max(300),
});
export type DecorationScene = z.infer<typeof DecorationSceneSchema>;

export const MAX_HISTORY = 30;
export const MAX_DESIGNS = 20;

/** Snapshots of `scene.objects` for undo and redo. Part of the state so every client and agent shares one history. */
export const SceneHistorySchema = z.object({
  past: z.array(z.array(DecorObjectSchema).max(300)).max(MAX_HISTORY),
  future: z.array(z.array(DecorObjectSchema).max(300)).max(MAX_HISTORY),
});
export type SceneHistory = z.infer<typeof SceneHistorySchema>;

/** A named, saved decoration layout for one studio venue. */
export const SavedDesignSchema = z.object({
  id: z.string().min(1).max(40),
  name: ShortText.min(1).max(60),
  venueId: z.string().min(1).max(60),
  objects: z.array(DecorObjectSchema).max(300),
});
export type SavedDesign = z.infer<typeof SavedDesignSchema>;

export { VendorCategorySchema, type VendorCategory };

export const ShortlistedVendorSchema = z.object({
  vendorId: z.string().min(1).max(60),
  name: ShortText.min(1),
  category: VendorCategorySchema,
  packageId: z.string().max(60).nullable().default(null),
  /** `demo` = DEMO DATA. Never `verified` here: verification lives on the vendor record. */
  source: z.enum(['demo', 'admin']),
});
export type ShortlistedVendor = z.infer<typeof ShortlistedVendorSchema>;

export const SavedOutfitSchema = z.object({
  id: z.string().min(1).max(40),
  label: ShortText.min(1),
  garmentId: z.string().min(1).max(60),
  /** Look metadata only. The photo and the generated image never leave the customer's browser. */
  note: z.string().trim().max(200).default(''),
  createdAt: z.string().max(40).default(''),
});
export type SavedOutfit = z.infer<typeof SavedOutfitSchema>;

export const MAX_DESIGN_VERSIONS = 10;

/** One generated (or saved) design: the scene it produced and the brief behind it. Kept apart from `designs` (manual saves). */
export const DesignVersionSchema = z.object({
  id: z.string().min(1).max(40),
  label: ShortText.min(1).max(60),
  createdAt: z.string().max(40),
  /** `vision` only when a real vision model analysed real images; `demo` for the labelled sample workflow; `manual` for a snapshot of hand edits. */
  source: z.enum([...DESIGN_SOURCES, 'manual']),
  venueId: z.string().min(1).max(60),
  objects: z.array(DecorObjectSchema).max(300),
  brief: WeddingDesignBriefSchema.nullable(),
  summary: z.string().max(800).default(''),
  costInr: z.number().int().min(0).max(MAX_AMOUNT_INR).default(0),
  substitutions: z.array(z.string().max(200)).max(20).default([]),
});
export type DesignVersion = z.infer<typeof DesignVersionSchema>;

/** AI design state. Holds references and the brief, never image bytes: photographs live in private object storage. */
export const DesignStateSchema = z.object({
  form: DesignFormSchema.nullable().default(null),
  brief: WeddingDesignBriefSchema.nullable().default(null),
  source: z.enum(DESIGN_SOURCES).nullable().default(null),
  referenceImageIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(MAX_REFERENCE_IMAGES).default([]),
  versions: z.array(DesignVersionSchema).max(MAX_DESIGN_VERSIONS).default([]),
  activeVersionId: z.string().max(40).nullable().default(null),
  /** How many variations have been generated from the current brief (drives "another version"). */
  variantCounter: z.number().int().min(0).max(1000).default(0),
});
export type DesignState = z.infer<typeof DesignStateSchema>;

export const WeddingStateSchema = z.object({
  version: z.literal(WEDDING_STATE_VERSION),
  id: z.string().min(1).max(64),
  /** Increments on every accepted action; clients ignore snapshots older than what they hold. */
  rev: z.number().int().min(0),
  profile: WeddingProfileSchema,
  venueId: z.string().min(1).max(60).nullable(),
  scene: DecorationSceneSchema,
  sceneHistory: SceneHistorySchema.default({ past: [], future: [] }),
  designs: z.array(SavedDesignSchema).max(MAX_DESIGNS).default([]),
  budget: BudgetSchema,
  vendorShortlist: z.array(ShortlistedVendorSchema).max(60),
  outfits: z.array(SavedOutfitSchema).max(60),
  design: DesignStateSchema.default({ form: null, brief: null, source: null, referenceImageIds: [], versions: [], activeVersionId: null, variantCounter: 0 }),
});
export type WeddingState = z.infer<typeof WeddingStateSchema>;
