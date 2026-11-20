import { z } from 'zod';

/** Every view the call stage can show. The summary is a separate route, not a stage view. */
export const VIEW_IDS = [
  'shortlist',
  'tour',
  'blueprint',
  'locality',
  'commute',
  'compass',
  'money',
  'legal',
  'booking',
] as const;
export const ViewIdSchema = z.enum(VIEW_IDS);
export type ViewId = z.infer<typeof ViewIdSchema>;

export const BLUEPRINT_LAYERS = ['layout', 'electrical', 'plumbing'] as const;
export const BlueprintLayerSchema = z.enum(BLUEPRINT_LAYERS);
export type BlueprintLayer = z.infer<typeof BlueprintLayerSchema>;

export const PLACE_CATEGORIES = ['schools', 'hospitals', 'transit', 'groceries', 'parks', 'dining'] as const;
export const PlaceCategorySchema = z.enum(PLACE_CATEGORIES);
export type PlaceCategory = z.infer<typeof PlaceCategorySchema>;

export const COMPASS_OVERLAYS = ['sun', 'vastu', 'seating'] as const;
export const CompassOverlaySchema = z.enum(COMPASS_OVERLAYS);
export type CompassOverlay = z.infer<typeof CompassOverlaySchema>;

export const MONEY_TABS = ['breakup', 'emi', 'offers', 'schedule', 'lease'] as const;
export const MoneyTabSchema = z.enum(MONEY_TABS);
export type MoneyTab = z.infer<typeof MoneyTabSchema>;

export const TOUR_MODES = ['step', 'walkthrough'] as const;
export const TourModeSchema = z.enum(TOUR_MODES);

export const LatLngSchema = z.object({ lat: z.number(), lng: z.number() });
export type LatLng = z.infer<typeof LatLngSchema>;

export const EmiInputsSchema = z.object({
  downPayment: z.number().nonnegative(),
  ratePct: z.number().positive().max(30),
  tenureYears: z.number().int().min(1).max(30),
});
export type EmiInputs = z.infer<typeof EmiInputsSchema>;

export const CustomRouteSchema = z.object({
  name: z.string(),
  destination: LatLngSchema,
  distanceKm: z.number().nonnegative(),
  durationMin: z.number().nonnegative(),
  /** [lng, lat] pairs, GeoJSON order. */
  geometry: z.array(z.tuple([z.number(), z.number()])),
});
export type CustomRoute = z.infer<typeof CustomRouteSchema>;

/** Parameters for each view. All views keep their params so returning to a view restores it. */
export const ViewParamsSchema = z.object({
  shortlist: z.object({}),
  tour: z.object({ stopId: z.string().nullable(), mode: TourModeSchema }),
  blueprint: z.object({ layer: BlueprintLayerSchema, roomId: z.string().nullable() }),
  locality: z.object({ category: PlaceCategorySchema.nullable(), placeId: z.string().nullable() }),
  commute: z.object({ destinationId: z.string().nullable(), custom: CustomRouteSchema.nullable() }),
  /** minutes: local clock time at the property, 0..1439. */
  compass: z.object({
    minutes: z.number().int().min(0).max(1439),
    overlay: CompassOverlaySchema,
    roomId: z.string().nullable(),
  }),
  money: z.object({ tab: MoneyTabSchema, emi: EmiInputsSchema.nullable() }),
  legal: z.object({ docId: z.string().nullable() }),
  booking: z.object({ slotId: z.string().nullable() }),
});
export type ViewParams = z.infer<typeof ViewParamsSchema>;

/** Partial params for one view, used when switching or updating a view. */
export type ViewParamsPatch<V extends ViewId> = Partial<ViewParams[V]>;

export const DEFAULT_VIEW_PARAMS: ViewParams = {
  shortlist: {},
  tour: { stopId: null, mode: 'step' },
  blueprint: { layer: 'layout', roomId: null },
  locality: { category: null, placeId: null },
  commute: { destinationId: null, custom: null },
  compass: { minutes: 9 * 60, overlay: 'sun', roomId: null },
  money: { tab: 'breakup', emi: null },
  legal: { docId: null },
  booking: { slotId: null },
};
