import { z } from 'zod';

/**
 * Try-on garment catalogue. Every garment here is ORIGINAL procedural flat-lay ARTWORK drawn by the app (an
 * illustration, not a product photo and not a real retail item). `status` says honestly what the in-browser
 * engine can do with a category:
 *  - `supported`: the engine has a warp path for this shape (single-piece garment with shoulder/waist/hem anchors).
 *  - `experimental`: same warp path, but not validated for this garment type.
 *  - `future`: shown so people know it is planned; it cannot be tried on and is never offered as a preview.
 * No saree/drape support exists in the engine, so saree is not a category.
 */

export const GARMENT_CATEGORIES = ['lehenga', 'gown', 'traditional_women', 'kurta', 'sherwani', 'traditional_men'] as const;
export const GarmentCategorySchema = z.enum(GARMENT_CATEGORIES);
export type GarmentCategory = z.infer<typeof GarmentCategorySchema>;

export const CATEGORY_LABELS: Record<GarmentCategory, string> = {
  lehenga: 'Lehengas', gown: 'Wedding gowns', traditional_women: "Traditional women's outfits", kurta: 'Kurtas', sherwani: 'Sherwanis', traditional_men: "Traditional men's outfits",
};

export const SUPPORT_STATUSES = ['supported', 'experimental', 'future'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export interface CategoryInfo { status: SupportStatus; note: string }
export const CATEGORY_INFO: Record<GarmentCategory, CategoryInfo> = {
  lehenga: { status: 'supported', note: 'Single-piece lehenga-choli with a flared skirt: the engine has a dedicated flare path for this shape.' },
  gown: { status: 'supported', note: 'Fitted bodice with a flared skirt, through the engine\'s dress path.' },
  traditional_women: { status: 'supported', note: 'Anarkali-style long outfits, through the engine\'s dress path.' },
  kurta: { status: 'experimental', note: 'Uses the same top/dress warp, but it has not been checked on menswear photos. Results may look off.' },
  sherwani: { status: 'future', note: 'Not supported yet: the engine has no structured long-coat path. Shown as a future option only.' },
  traditional_men: { status: 'future', note: 'Not supported yet. Shown as a future option only.' },
};

export const isTryable = (status: SupportStatus) => status !== 'future';

const Point = z.tuple([z.number(), z.number()]);
export const GarmentAnchorsSchema = z.object({ shoulderL: Point, shoulderR: Point, waistL: Point, waistR: Point, hemL: Point, hemR: Point });
export type GarmentAnchorPoints = z.infer<typeof GarmentAnchorsSchema>;

export const ART_KINDS = ['lehenga', 'gown', 'anarkali', 'kurta', 'sherwani', 'coat'] as const;
const Hex = z.string().regex(/^#[0-9a-f]{6}$/);

export const GarmentSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  name: z.string().min(1).max(80),
  category: GarmentCategorySchema,
  status: z.enum(SUPPORT_STATUSES),
  /** True when a preview can be generated (status is not `future`). */
  supported: z.boolean(),
  /** What is and is not true about this garment's try-on. */
  statusNote: z.string().max(300),
  color: z.string().max(20),
  occasion: z.array(z.string().max(30)).max(8),
  /** Indicative price in rupees for the illustrated style. Demonstration data, not a retail price. */
  priceInr: z.number().int().min(0),
  /** Always true: the picture is our own drawing. */
  illustration: z.literal(true),
  art: z.object({ kind: z.enum(ART_KINDS), primary: Hex, secondary: Hex, trim: Hex }),
  /** Anchor points in the artwork's own 600x900 canvas. */
  anchors: GarmentAnchorsSchema,
  hemLength: z.enum(['hip', 'knee', 'ankle']),
  sleeves: z.enum(['full', 'half', 'sleeveless']),
  hemFlare: z.enum(['dress', 'skirt']),
});
export type Garment = z.infer<typeof GarmentSchema>;

export const ART_SIZE = { width: 600, height: 900 } as const;

const LEHENGA_ANCHORS: GarmentAnchorPoints = { shoulderL: [210, 70], shoulderR: [390, 70], waistL: [235, 300], waistR: [365, 300], hemL: [40, 880], hemR: [560, 880] };
const GOWN_ANCHORS: GarmentAnchorPoints = { shoulderL: [225, 70], shoulderR: [375, 70], waistL: [245, 290], waistR: [355, 290], hemL: [120, 880], hemR: [480, 880] };
const ANARKALI_ANCHORS: GarmentAnchorPoints = { shoulderL: [215, 70], shoulderR: [385, 70], waistL: [240, 300], waistR: [360, 300], hemL: [100, 860], hemR: [500, 860] };
const KURTA_ANCHORS: GarmentAnchorPoints = { shoulderL: [215, 70], shoulderR: [385, 70], waistL: [230, 330], waistR: [370, 330], hemL: [205, 640], hemR: [395, 640] };
const FUTURE_ANCHORS: GarmentAnchorPoints = { shoulderL: [200, 70], shoulderR: [400, 70], waistL: [225, 330], waistR: [375, 330], hemL: [195, 700], hemR: [405, 700] };

type Seed = Omit<Garment, 'status' | 'supported' | 'statusNote' | 'illustration'>;
const make = (s: Seed): Garment => {
  const info = CATEGORY_INFO[s.category];
  return { ...s, status: info.status, supported: isTryable(info.status), statusNote: info.note, illustration: true };
};

export const GARMENTS: readonly Garment[] = [
  make({ id: 'lehenga-blush', name: 'Blush Pink Lehenga (illustration)', category: 'lehenga', color: 'pink', occasion: ['wedding', 'sangeet', 'reception'], priceInr: 45_000, art: { kind: 'lehenga', primary: '#e8a0b4', secondary: '#f6d6de', trim: '#c9a24a' }, anchors: LEHENGA_ANCHORS, hemLength: 'ankle', sleeves: 'half', hemFlare: 'skirt' }),
  make({ id: 'lehenga-ruby', name: 'Ruby Red Lehenga (illustration)', category: 'lehenga', color: 'red', occasion: ['wedding', 'reception'], priceInr: 62_000, art: { kind: 'lehenga', primary: '#a8142c', secondary: '#7a0c1f', trim: '#e0b84f' }, anchors: LEHENGA_ANCHORS, hemLength: 'ankle', sleeves: 'half', hemFlare: 'skirt' }),
  make({ id: 'lehenga-ivory', name: 'Ivory and Gold Lehenga (illustration)', category: 'lehenga', color: 'ivory', occasion: ['wedding', 'engagement'], priceInr: 78_000, art: { kind: 'lehenga', primary: '#f1e8d2', secondary: '#e3d3ac', trim: '#b8893a' }, anchors: LEHENGA_ANCHORS, hemLength: 'ankle', sleeves: 'half', hemFlare: 'skirt' }),
  make({ id: 'gown-champagne', name: 'Champagne Gown (illustration)', category: 'gown', color: 'champagne', occasion: ['reception', 'engagement'], priceInr: 55_000, art: { kind: 'gown', primary: '#e9d5b5', secondary: '#f6ecd9', trim: '#b8a07a' }, anchors: GOWN_ANCHORS, hemLength: 'ankle', sleeves: 'sleeveless', hemFlare: 'dress' }),
  make({ id: 'gown-midnight', name: 'Midnight Blue Gown (illustration)', category: 'gown', color: 'navy', occasion: ['reception'], priceInr: 48_000, art: { kind: 'gown', primary: '#1d2b5c', secondary: '#2f428a', trim: '#cfd6ee' }, anchors: GOWN_ANCHORS, hemLength: 'ankle', sleeves: 'sleeveless', hemFlare: 'dress' }),
  make({ id: 'anarkali-emerald', name: 'Emerald Anarkali (illustration)', category: 'traditional_women', color: 'green', occasion: ['sangeet', 'mehendi', 'wedding'], priceInr: 32_000, art: { kind: 'anarkali', primary: '#0f6b4a', secondary: '#1f8f66', trim: '#d9b44a' }, anchors: ANARKALI_ANCHORS, hemLength: 'ankle', sleeves: 'half', hemFlare: 'dress' }),
  make({ id: 'anarkali-saffron', name: 'Saffron Anarkali (illustration)', category: 'traditional_women', color: 'orange', occasion: ['haldi', 'mehendi'], priceInr: 28_000, art: { kind: 'anarkali', primary: '#e8890c', secondary: '#f6b43c', trim: '#7a4a08' }, anchors: ANARKALI_ANCHORS, hemLength: 'ankle', sleeves: 'half', hemFlare: 'dress' }),
  make({ id: 'kurta-ivory', name: 'Ivory Kurta (illustration)', category: 'kurta', color: 'ivory', occasion: ['haldi', 'mehendi', 'sangeet'], priceInr: 9_000, art: { kind: 'kurta', primary: '#efe6d0', secondary: '#d8c9a3', trim: '#b8893a' }, anchors: KURTA_ANCHORS, hemLength: 'knee', sleeves: 'half', hemFlare: 'dress' }),
  make({ id: 'kurta-indigo', name: 'Indigo Kurta (illustration)', category: 'kurta', color: 'blue', occasion: ['sangeet', 'reception'], priceInr: 11_000, art: { kind: 'kurta', primary: '#2b3a7a', secondary: '#1a2556', trim: '#d9b44a' }, anchors: KURTA_ANCHORS, hemLength: 'knee', sleeves: 'half', hemFlare: 'dress' }),
  make({ id: 'sherwani-gold', name: 'Gold Sherwani (illustration, future option)', category: 'sherwani', color: 'gold', occasion: ['wedding'], priceInr: 85_000, art: { kind: 'sherwani', primary: '#c8a24a', secondary: '#a8802c', trim: '#6d4f12' }, anchors: FUTURE_ANCHORS, hemLength: 'knee', sleeves: 'full', hemFlare: 'dress' }),
  make({ id: 'menswear-bandhgala', name: 'Bandhgala Set (illustration, future option)', category: 'traditional_men', color: 'black', occasion: ['reception'], priceInr: 40_000, art: { kind: 'coat', primary: '#22222a', secondary: '#34343f', trim: '#c8a24a' }, anchors: FUTURE_ANCHORS, hemLength: 'knee', sleeves: 'full', hemFlare: 'dress' }),
];

export const findGarment = (id: string): Garment | undefined => GARMENTS.find((g) => g.id === id);

export interface GarmentQuery { category?: GarmentCategory; occasion?: string; color?: string; maxPriceInr?: number; text?: string; tryableOnly?: boolean }

export function searchGarments(q: GarmentQuery, list: readonly Garment[] = GARMENTS): Garment[] {
  const words = (q.text ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  return list.filter((g) =>
    (!q.category || g.category === q.category) && (!q.tryableOnly || g.supported) &&
    (!q.occasion || g.occasion.includes(q.occasion.toLowerCase())) && (!q.color || g.color === q.color.toLowerCase()) &&
    (q.maxPriceInr === undefined || g.priceInr <= q.maxPriceInr) &&
    (words.length === 0 || words.every((w) => `${g.name} ${g.color} ${g.category} ${CATEGORY_LABELS[g.category]}`.toLowerCase().includes(w))));
}

export const TRYON_DISCLAIMER = 'Previews are visual approximations made by warping a flat illustration onto your photo. They do not show how a real garment fits, drapes or looks, and are not a guarantee of fit or final appearance.';
