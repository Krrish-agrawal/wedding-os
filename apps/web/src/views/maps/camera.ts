import type { Map as MapLibreMap } from 'maplibre-gl';
import { boundsOf, type LatLng, type LngLatPair } from '@ave/shared';
import { CITY_CONTEXT_ZOOM, PROPERTY_ZOOM } from './engine';
import { prefersReducedMotion } from './useMapHost';

const FLY_IN_MS = 1800;
const FIT_MS = 900;
/** Never zoom closer than this when fitting a few nearby points. */
const FIT_MAX_ZOOM = 16.2;
/** Points closer than this to the current centre at a similar zoom skip the fly-in. */
const ALREADY_THERE_ZOOM_DELTA = 0.6;
const ALREADY_THERE_PX = 40;

/**
 * Room around fitted points: the property pin stands about 80 px above its point, name tags run
 * up to about 150 px to the right of a pin, and the zoom buttons sit top right.
 */
/** Pixels kept clear on each side when fitting. */
export interface MapPadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const MAP_PADDING: MapPadding = { top: 96, bottom: 44, left: 48, right: 150 };

const toLngLat = (p: LatLng): [number, number] => [p.lng, p.lat];

/**
 * Brings the property into the centre. `fromAfar` is the arrival: the map starts on the city around
 * the property and flies down to its street. Otherwise it eases back from wherever the buyer was.
 */
export function flyInTo(map: MapLibreMap, location: LatLng, opts: { fromAfar: boolean }): void {
  const target = toLngLat(location);
  const zoom = PROPERTY_ZOOM;
  if (prefersReducedMotion()) {
    map.jumpTo({ center: target, zoom });
    return;
  }
  if (opts.fromAfar) {
    map.jumpTo({ center: target, zoom: CITY_CONTEXT_ZOOM });
    map.flyTo({ center: target, zoom, duration: FLY_IN_MS, essential: false });
    return;
  }
  // Already on its way (the arrival flight, or the buyer dragging): leave it alone.
  if (map.isMoving()) return;
  const here = map.project(target);
  const c = map.getContainer();
  const centred = Math.hypot(here.x - c.clientWidth / 2, here.y - c.clientHeight / 2) < ALREADY_THERE_PX;
  if (centred && Math.abs(map.getZoom() - zoom) < ALREADY_THERE_ZOOM_DELTA) return;
  map.easeTo({ center: target, zoom, duration: FIT_MS, essential: false });
}

/** Smallest map area, beyond the padding, worth fitting into; below it the map just centres. */
const MIN_FIT_AREA_PX = 40;

/** Frames every point (the property included) with room for pins and labels. */
export function fitPoints(map: MapLibreMap, points: LngLatPair[], opts: { maxZoom?: number; padding?: MapPadding } = {}): void {
  const bounds = boundsOf(points);
  if (!bounds) return;
  const padding = opts.padding ?? MAP_PADDING;
  const maxZoom = opts.maxZoom ?? FIT_MAX_ZOOM;
  const c = map.getContainer();
  // MapLibre warns when the padding leaves no room (a parked or tiny map); just centre instead.
  if (c.clientWidth - padding.left - padding.right < MIN_FIT_AREA_PX || c.clientHeight - padding.top - padding.bottom < MIN_FIT_AREA_PX) {
    map.jumpTo({ center: [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2] });
    return;
  }
  const camera = map.cameraForBounds(bounds, { padding, maxZoom });
  if (!camera) return;
  if (prefersReducedMotion()) map.jumpTo(camera);
  else map.easeTo({ ...camera, duration: FIT_MS, essential: false });
}
