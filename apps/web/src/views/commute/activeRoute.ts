import type { CommuteFile, CommuteRoute, CustomRoute, LngLatPair, ViewParams } from '@ave/shared';

/** The route the Commute view is showing, whether precomputed or looked up live. */
export interface ActiveRoute {
  key: string;
  kind: 'preset' | 'custom';
  category: CommuteRoute['category'] | null;
  label: string;
  destinationName: string;
  destination: { lat: number; lng: number };
  distanceKm: number;
  durationMin: number;
  geometry: LngLatPair[];
  source: string | null;
  propertyId: string | null;
}

export type CommuteSelection =
  | { status: 'none' }
  /** The advisor or a click named a preset id this property does not have. */
  | { status: 'missing'; destinationId: string }
  | { status: 'route'; route: ActiveRoute };

/**
 * Resolves the view params to a route. A preset id wins over a custom route; the advisor's tool
 * clears one when it sets the other.
 */
export function selectRoute(commute: CommuteFile, params: ViewParams['commute']): CommuteSelection {
  if (params.destinationId) {
    const preset = commute.routes.find((r) => r.id === params.destinationId);
    if (!preset) return { status: 'missing', destinationId: params.destinationId };
    return {
      status: 'route',
      route: {
        key: `preset:${preset.id}`,
        kind: 'preset',
        category: preset.category,
        label: preset.label,
        destinationName: preset.destination.name,
        destination: { lat: preset.destination.lat, lng: preset.destination.lng },
        distanceKm: preset.distanceKm,
        durationMin: preset.durationMin,
        geometry: preset.geometry,
        source: preset.source,
        propertyId: preset.propertyId ?? null,
      },
    };
  }
  if (params.custom) return { status: 'route', route: fromCustom(params.custom) };
  return { status: 'none' };
}

function fromCustom(c: CustomRoute): ActiveRoute {
  return {
    key: `custom:${c.name}:${c.destination.lat},${c.destination.lng}`,
    kind: 'custom',
    category: null,
    label: c.name,
    destinationName: c.name,
    destination: c.destination,
    distanceKm: c.distanceKm,
    durationMin: c.durationMin,
    geometry: c.geometry,
    source: null,
    propertyId: null,
  };
}
