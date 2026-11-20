import { z } from 'zod';
import { LatLngSchema, PlaceCategorySchema } from './views.js';

/**
 * Schemas for every content file under /data.
 * Coordinates inside a property (polygons, points, camera positions) are in the
 * optimised model's space: metres, Y up, origin at floor centre. 2D plans use (x, z).
 */

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const Vec2 = z.tuple([z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;
export type Vec2 = z.infer<typeof Vec2>;

export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export const DirectionSchema = z.enum(DIRECTIONS);
export type Direction = z.infer<typeof DirectionSchema>;

export const CreditSchema = z.object({
  title: z.string(),
  author: z.string(),
  url: z.string().url(),
  license: z.string(),
});

export const PropertySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(['sale', 'lease']),
  name: z.string(),
  tagline: z.string(),
  builder: z.string(),
  /** e.g. "2 BHK apartment", "18-seat office suite" */
  configuration: z.string(),
  localityId: z.string(),
  localityName: z.string(),
  city: z.string(),
  address: z.string(),
  location: LatLngSchema,
  /** Degrees clockwise from the model's -Z axis to true north. */
  northOffsetDeg: z.number(),
  entranceFacing: DirectionSchema,
  areas: z.object({
    carpetSqft: z.number().positive(),
    builtUpSqft: z.number().positive(),
    superBuiltUpSqft: z.number().positive(),
  }),
  floor: z.object({
    level: z.number().int(),
    of: z.number().int().positive(),
    /** How to say the floor when "Floor 2 of 8" does not fit, e.g. "Ground floor with mezzanine". Use formatFloor. */
    label: z.string().optional(),
  }),
  possession: z.string(),
  highlights: z.array(z.string()).min(3).max(3),
  /** Public URL path of the hero image, e.g. /media/<id>/hero.webp */
  heroImage: z.string(),
  model: z.object({
    /** Public URL path of the optimised GLB, e.g. /models/<id>.glb */
    url: z.string(),
    scale: z.number().positive().default(1),
    position: Vec3.default([0, 0, 0]),
    rotationY: z.number().default(0),
  }),
  /** Public URL path of the top-down plan base image. */
  planImage: z.string(),
  /**
   * Floors of a multi-level property (for example an office with a mezzanine), lowest first.
   * Omitted for single-level homes, which have one level: index 0 at y = 0 with `planImage`.
   * Rooms say which level they are on with `Room.level`; `planImage` is the plan of level 0.
   */
  levels: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        name: z.string(),
        /** Height of this level's floor in model space, metres. */
        floorY: z.number(),
        /** Public URL path of this level's top-down plan image. */
        planImage: z.string(),
      }),
    )
    .min(1)
    .optional(),
  credits: z.array(CreditSchema),
  sampleData: z.literal(true),
});
export type Property = z.infer<typeof PropertySchema>;

export const ROOM_KINDS = [
  'entrance', 'living', 'dining', 'kitchen', 'bedroom', 'bathroom', 'balcony', 'study', 'utility',
  'workspace', 'meeting', 'reception', 'pantry', 'cabin', 'lounge', 'other',
] as const;
export const RoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(ROOM_KINDS),
  /** Closed polygon in model (x, z). */
  polygon: z.array(Vec2).min(3),
  areaSqft: z.number().positive(),
  /** Short factual features visible in the model, e.g. "Floor-to-ceiling window". */
  features: z.array(z.string()),
  /** For offices: desk seats this room holds. */
  seats: z.number().int().nonnegative().optional(),
  /** Index into `Property.levels` for multi-level properties; omitted means level 0. */
  level: z.number().int().nonnegative().optional(),
});
export type Room = z.infer<typeof RoomSchema>;
export const RoomsFileSchema = z.object({ rooms: z.array(RoomSchema).min(1) });

export const CameraShotSchema = z.object({ position: Vec3, target: Vec3, fov: z.number().min(20).max(100) });
export type CameraShot = z.infer<typeof CameraShotSchema>;

export const TourStopSchema = CameraShotSchema.extend({
  id: z.string(),
  roomId: z.string(),
  label: z.string(),
  /** Two or three short facts shown as chips and available to the advisor. */
  facts: z.array(z.string()).min(1).max(3),
  /** Intermediate camera positions so the move passes through doorways instead of walls. */
  via: z.array(Vec3).default([]),
});
export type TourStop = z.infer<typeof TourStopSchema>;
export const TourFileSchema = z.object({
  overview: CameraShotSchema,
  stops: z.array(TourStopSchema).min(1),
});
export type TourFile = z.infer<typeof TourFileSchema>;

export const ELECTRICAL_KINDS = ['db', 'switchboard', 'socket', 'power_socket', 'light', 'ac', 'fan', 'data', 'ev'] as const;
export const PLUMBING_KINDS = ['wc', 'basin', 'shower', 'sink', 'washing_machine', 'water_heater', 'shaft', 'floor_trap', 'tap'] as const;
/**
 * Index into `Property.levels` an item is drawn on, for multi-level properties. Omitted means the
 * level of the item's room (points) or level 0 (runs, and points outside any room).
 */
const PlanLevel = z.number().int().nonnegative().optional();
const PlanPoint = z.object({ id: z.string(), x: z.number(), z: z.number(), roomId: z.string().nullable(), label: z.string().optional(), level: PlanLevel });
export const PlanFileSchema = z.object({
  /** Model-space rectangle the plan image covers. */
  bounds: z.object({ minX: z.number(), maxX: z.number(), minZ: z.number(), maxZ: z.number() }),
  electrical: z.object({
    points: z.array(PlanPoint.extend({ kind: z.enum(ELECTRICAL_KINDS) })),
    circuits: z.array(z.object({ id: z.string(), name: z.string(), rating: z.string().optional(), path: z.array(Vec2).min(2), level: PlanLevel })),
  }),
  plumbing: z.object({
    fixtures: z.array(PlanPoint.extend({ kind: z.enum(PLUMBING_KINDS) })),
    lines: z.array(z.object({ id: z.string(), kind: z.enum(['cold', 'hot', 'drain']), path: z.array(Vec2).min(2), level: PlanLevel })),
  }),
});
export type PlanFile = z.infer<typeof PlanFileSchema>;

export const PAYABLE_AT = ['instalments', 'handover'] as const;
export type PayableAt = (typeof PAYABLE_AT)[number];

const LineItemCalc = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixed'), amount: z.number().nonnegative() }),
  z.object({ type: z.literal('per_sqft'), rate: z.number().nonnegative(), area: z.enum(['carpet', 'builtUp', 'superBuiltUp']) }),
  /** Percentage of the sum of other line items (by id). */
  z.object({ type: z.literal('percent'), ratePct: z.number().nonnegative(), of: z.array(z.string()).min(1) }),
]);
export const SaleMoneySchema = z.object({
  kind: z.literal('sale'),
  lineItems: z.array(z.object({
    id: z.string(),
    label: z.string(),
    group: z.enum(['base', 'charges', 'government', 'deposits']),
    calc: LineItemCalc,
    note: z.string().optional(),
    /** Source for statutory rates (stamp duty, registration, GST). */
    source: z.string().url().optional(),
    /**
     * When the buyer pays this item: spread over the payment schedule, or in one go at registration
     * and handover. Defaults by group: base and charges are paid in instalments, government and
     * deposits at handover.
     */
    payableAt: z.enum(PAYABLE_AT).optional(),
  })).min(1),
  /** Payment schedule. Percentages apply to the items paid in instalments and sum to 100. */
  schedule: z.array(z.object({
    id: z.string(),
    stage: z.string(),
    percent: z.number().positive(),
    /** When the stage falls due, in plain words, e.g. "Within 30 days of booking". */
    due: z.string().optional(),
  })),
  emiDefaults: z.object({
    downPaymentPct: z.number().min(0).max(100),
    ratePct: z.number().positive(),
    tenureYears: z.number().int().positive(),
    /** Where the typical rate comes from. */
    rateSource: z.string().url().optional(),
    rateNote: z.string().optional(),
  }),
  /**
   * Loan-to-value ceilings by loan size (RBI). The cap of the first slab whose `upToLoan` covers the
   * loan applies; `null` means no upper bound. Value is the cost of the home without stamp duty,
   * registration and deposits.
   */
  ltv: z.object({
    slabs: z.array(z.object({ upToLoan: z.number().positive().nullable(), maxPct: z.number().positive().max(100) })).min(1),
    source: z.string().url(),
  }).optional(),
  estimateNote: z.string(),
});
export const LeaseMoneySchema = z.object({
  kind: z.literal('lease'),
  rentMonthly: z.number().positive(),
  maintenanceMonthly: z.number().nonnegative(),
  gstPct: z.number().nonnegative(),
  depositMonths: z.number().nonnegative(),
  seats: z.number().int().positive(),
  fitOut: z.string(),
  lockInMonths: z.number().int().nonnegative(),
  termMonths: z.number().int().positive(),
  escalationPct: z.number().nonnegative(),
  escalationEveryMonths: z.number().int().positive(),
  inclusions: z.array(z.string()),
  /** Source for the GST rate on commercial rent. */
  gstSource: z.string().url().optional(),
  estimateNote: z.string(),
});
export const MoneyFileSchema = z.discriminatedUnion('kind', [SaleMoneySchema, LeaseMoneySchema]);
export type SaleMoney = z.infer<typeof SaleMoneySchema>;
export type LeaseMoney = z.infer<typeof LeaseMoneySchema>;
export type MoneyFile = z.infer<typeof MoneyFileSchema>;

export const LegalFileSchema = z.object({
  documents: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['verified', 'pending', 'not_applicable']),
    reference: z.string(),
    issuedBy: z.string(),
    date: z.string().optional(),
    /** One line shown on the card. */
    summary: z.string(),
    /** Plain-language explanation for a first-time buyer. */
    explanation: z.string(),
  })).min(1),
});
export type LegalFile = z.infer<typeof LegalFileSchema>;
export type LegalDoc = LegalFile['documents'][number];

export const VisitsFileSchema = z.object({
  slots: z.array(z.object({
    id: z.string(),
    /** ISO 8601 with offset, e.g. 2026-11-22T10:00:00+05:30 */
    start: z.string(),
    end: z.string(),
    available: z.boolean(),
  })).min(1),
});
export type VisitSlot = z.infer<typeof VisitsFileSchema>['slots'][number];

export const PlaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: PlaceCategorySchema,
  lat: z.number(),
  lng: z.number(),
  osmId: z.string().optional(),
  /** Short type label shown under the name, e.g. "Metro station", "Supermarket", "Cafe". */
  kind: z.string().optional(),
});
export type Place = z.infer<typeof PlaceSchema>;
export const LocalityFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  center: LatLngSchema,
  profile: z.object({
    summary: z.string(),
    character: z.string(),
    connectivity: z.string(),
    goodToKnow: z.array(z.string()),
  }),
  places: z.array(PlaceSchema),
  sources: z.array(z.object({ title: z.string(), url: z.string().url() })),
  attribution: z.string(),
});
export type LocalityFile = z.infer<typeof LocalityFileSchema>;

export const COMMUTE_CATEGORIES = ['airport', 'bus', 'rail', 'metro', 'cbd', 'techpark', 'office', 'home'] as const;
export const CommuteRouteSchema = z.object({
  id: z.string(),
  label: z.string(),
  category: z.enum(COMMUTE_CATEGORIES),
  destination: z.object({ name: z.string(), lat: z.number(), lng: z.number() }),
  distanceKm: z.number().nonnegative(),
  durationMin: z.number().nonnegative(),
  geometry: z.array(z.tuple([z.number(), z.number()])).min(2),
  source: z.string(),
  /** Set when the destination is another property on the shortlist (home to office). */
  propertyId: z.string().optional(),
});
export type CommuteRoute = z.infer<typeof CommuteRouteSchema>;
export const CommuteFileSchema = z.object({
  propertyId: z.string(),
  origin: LatLngSchema,
  routes: z.array(CommuteRouteSchema).min(1),
  note: z.string(),
});
export type CommuteFile = z.infer<typeof CommuteFileSchema>;

export const OfferSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  type: z.enum(['flat', 'percent', 'waiver']),
  /** INR for flat, percent for percent, ignored for waiver. */
  value: z.number().nonnegative(),
  /**
   * Line item the offer applies to (waiver or percent of a specific item).
   * For a lease the items are "rent" and "maintenance", each over the whole term.
   */
  lineItemId: z.string().optional(),
  /** Lease only: a waiver covers this many months from the start instead of the whole term. */
  months: z.number().int().positive().optional(),
  stackable: z.boolean(),
});
export type Offer = z.infer<typeof OfferSchema>;
export const OffersPolicySchema = z.object({
  properties: z.record(z.string(), z.object({
    offers: z.array(OfferSchema),
    /** Maximum total discount the AI advisor may give, as % of the pre-offer total. */
    maxDiscountPct: z.number().nonnegative(),
    /** Requests above this % go to a human advisor. */
    handoffAbovePct: z.number().nonnegative(),
  })),
});
export type OffersPolicy = z.infer<typeof OffersPolicySchema>;

export const ScoringSchema = z.object({
  rules: z.array(z.object({
    id: z.string(),
    label: z.string(),
    points: z.number(),
    when: z.discriminatedUnion('type', [
      z.object({ type: z.literal('view_seen'), view: z.string() }),
      z.object({ type: z.literal('time_on_view'), view: z.string(), seconds: z.number().positive() }),
      z.object({ type: z.literal('offer_applied') }),
      z.object({ type: z.literal('visit_booked') }),
      z.object({ type: z.literal('lead_field'), field: z.enum(['budget', 'timeline', 'purpose', 'needs']) }),
      z.object({ type: z.literal('handoff_requested') }),
      /** The buyer opened at least `count` different properties. */
      z.object({ type: z.literal('properties_viewed'), count: z.number().int().positive() }),
    ]),
  })),
  tiers: z.array(z.object({ min: z.number(), label: z.string() })).min(1),
});
export type Scoring = z.infer<typeof ScoringSchema>;

/** Everything about one property, assembled from its files. */
export interface PropertyBundle {
  property: Property;
  rooms: z.infer<typeof RoomsFileSchema>['rooms'];
  tour: TourFile;
  plan: PlanFile;
  money: MoneyFile;
  legal: LegalFile;
  visits: VisitSlot[];
  locality: LocalityFile;
  commute: CommuteFile;
}
