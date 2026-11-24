import { z } from 'zod';

/**
 * The structured result of looking at the customer's inspiration photographs (or, in demo mode, of reading their
 * form). The language model fills this in; it never produces coordinates or code. Every field is required (nullable
 * where unknown) so the schema also works as a strict structured-output schema.
 *
 * `source` records where a brief came from: `vision` only when a real vision model analysed real images, `demo` for the
 * labelled sample workflow that reads the form text only.
 */

const T = (n: number) => z.string().trim().max(n);

export const DESIGN_SOURCES = ['vision', 'demo'] as const;
export const MAX_REFERENCE_IMAGES = 6;

export const FLOWER_USES = ['arrangements', 'garlands', 'wall', 'canopy', 'aisle', 'arch'] as const;
export const LIGHT_FEATURES = ['chandelier', 'fairy_lights', 'lanterns', 'diyas'] as const;
export const CEILING_TREATMENTS = ['none', 'draped', 'floral', 'chandeliers', 'fairy_lights'] as const;
export const ENTRANCE_TREATMENTS = ['none', 'floral_arch', 'garland_curtain'] as const;
export const SEATING_ARRANGEMENTS = ['theatre', 'banquet', 'lounge', 'mixed'] as const;
export const TRADITIONS = ['traditional', 'modern', 'fusion'] as const;

export const WeddingDesignBriefSchema = z.object({
  title: T(80).min(1),
  /** Two or three sentences a customer can read. */
  summary: T(600).min(1),
  tradition: z.enum(TRADITIONS),
  /** Free-text style as seen, e.g. "South Indian temple wedding". */
  style: T(80).min(1),
  /** 1 (simple) to 5 (very grand). Drives quantities. */
  grandness: z.number().int().min(1).max(5),
  mandap: z.object({ style: z.enum(['traditional', 'modern', 'none']), description: T(200) }),
  stage: z.object({ present: z.boolean(), description: T(200) }),
  flowers: z.array(z.object({ name: T(40).min(1), color: T(40).nullable(), use: z.enum(FLOWER_USES) })).max(8),
  /** Colours by name ("maroon", "warm white") or `#rrggbb`. Roles decide which parts they colour. */
  palette: z.array(z.object({ color: T(40).min(1), role: z.enum(['primary', 'secondary', 'accent']) })).min(1).max(6),
  lighting: z.object({ warmth: z.enum(['warm', 'neutral', 'cool']), features: z.array(z.enum(LIGHT_FEATURES)).max(4), description: T(200) }),
  ceiling: z.object({ treatment: z.enum(CEILING_TREATMENTS), description: T(200) }),
  entrance: z.object({ treatment: z.enum(ENTRANCE_TREATMENTS), description: T(200) }),
  seating: z.object({ arrangement: z.enum(SEATING_ARRANGEMENTS), description: T(200) }),
  /** Small ritual and decorative details seen (rangoli, brass lamps, swing, aisle runner...). */
  details: z.array(T(80).min(1)).max(10),
  /** Which reference image inspired which element. `imageIndex` is 0-based, null when it is a general impression. */
  provenance: z.array(z.object({ element: T(60).min(1), imageIndex: z.number().int().min(0).max(MAX_REFERENCE_IMAGES - 1).nullable() })).max(30),
  /** Things in the photos that the studio cannot reproduce. */
  limitations: z.array(T(160)).max(10),
});
export type WeddingDesignBrief = z.infer<typeof WeddingDesignBriefSchema>;

/** What the customer entered on the "Create your dream wedding" page. */
export const DesignFormSchema = z.object({
  description: T(1000),
  style: T(60),
  guestCount: z.number().int().min(1).max(5000),
  /** Decoration budget in whole rupees; null = no limit. */
  decorationBudgetInr: z.number().int().min(0).max(1_000_000_000).nullable(),
  /** Colour names the customer picked. */
  palette: z.array(T(40)).max(6),
});
export type DesignForm = z.infer<typeof DesignFormSchema>;

export const WEDDING_STYLES = ['Traditional South Indian', 'North Indian', 'Royal Rajasthani', 'Modern minimal', 'Floral garden', 'Beach / outdoor'] as const;
