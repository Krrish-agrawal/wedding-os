import 'maplibre-gl/dist/maplibre-gl.css';
import './maps.css';
import type { GeoJSONSource, GeoJSONSourceSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { create } from 'zustand';
import type { LatLng, LngLatPair } from '@ave/shared';
import { BASE_SOURCE_IDS, OPENFREEMAP_HIDDEN_LAYERS, TILE_TIERS, type TileTier } from './tiles';

/**
 * One MapLibre map for the whole call. Creating a map costs far more than the 150 ms view-switch
 * budget, so the Locality and Commute views borrow this instance: on mount the map's container
 * element moves into the view, on unmount it moves to an off-screen parking spot where it keeps its
 * WebGL context, style and tile cache. Each view adds its own markers and sets the route overlay.
 */

export type MapLib = typeof import('maplibre-gl');
export interface MapHandle {
  lib: MapLib;
  map: MapLibreMap;
}

export type MapPhase = 'idle' | 'loading' | 'ready' | 'failed';
interface MapStatus {
  phase: MapPhase;
  tier: TileTier | null;
  /** True when the active tier is not the first choice (e.g. satellite failed, street map shown). */
  degraded: boolean;
  /** Every tile source failed; only pins and routes are drawn. */
  tilesUnavailable: boolean;
}

export const useMapStatus = create<MapStatus>(() => ({ phase: 'idle', tier: null, degraded: false, tilesUnavailable: false }));

/** The locality close-up on the property's street. */
export const PROPERTY_ZOOM = 15.4;
/** The city around the property, where the Locality fly-in starts. */
export const CITY_CONTEXT_ZOOM = 12.4;
const CITY_ZOOM = 11;
/** Size of the parked map before any view has measured a real one; close to the stage's map area. */
const DEFAULT_PARK_SIZE = { width: 1000, height: 760 };
/** A tier is abandoned after this many failed tiles with none loaded, or this many failures overall. */
const FAILURES_BEFORE_ANY_TILE = 3;
const FAILURES_TOTAL = 12;

/** Style JSON fetches give up after this long and the next tier is tried. */
const STYLE_FETCH_TIMEOUT_MS = 6000;
const PAPER = '#f6f8fb';
const ROUTE_SOURCE_ID = 'ave-route';
const ROUTE_CASING_LAYER_ID = 'ave-route-casing';
const ROUTE_LINE_LAYER_ID = 'ave-route-line';
const INK = '#0e1726';
const TANGERINE = '#ff8a1f';
const ROUTE_CASING_WIDTH = 9;
const ROUTE_LINE_WIDTH = 5.5;

let handle: MapHandle | null = null;
let creating: Promise<MapHandle | null> | null = null;
let container: HTMLDivElement | null = null;
let parking: HTMLDivElement | null = null;
let parkSize = { ...DEFAULT_PARK_SIZE };
let routeCoords: LngLatPair[] = [];
let tierIndex = 0;
let tierFailures = 0;
let tierLoads = 0;
/** True once a style has been handed to MapLibre, so its sources can be addressed. */
let styleReady = false;
/** The route changed while the style could not take it yet; pushed again once the style loads. */
let routeDirty = false;

/** Sends the current route to the map; false when the style is not ready to take it. */
function pushRoute(): boolean {
  if (!handle || !styleReady) return false;
  const source = handle.map.getSource<GeoJSONSource>(ROUTE_SOURCE_ID);
  if (!source) return false;
  void source.setData(routeData() as Parameters<GeoJSONSource['setData']>[0]);
  return true;
}

/** GeoJSON for the route source, typed loosely to MapLibre's own GeoJSON input. */
function routeData(): GeoJSONSourceSpecification['data'] {
  return {
    type: 'FeatureCollection',
    features:
      routeCoords.length >= 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeCoords } }] : [],
  };
}

/** Adds our route overlay to a base style and trims base layers that compete with our pins. */
function withOverlays(base: StyleSpecification): StyleSpecification {
  return {
    ...base,
    sources: { ...base.sources, [ROUTE_SOURCE_ID]: { type: 'geojson', data: routeData() } },
    layers: [
      ...base.layers.filter((l) => !OPENFREEMAP_HIDDEN_LAYERS.test(l.id)),
      {
        id: ROUTE_CASING_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': INK, 'line-width': ROUTE_CASING_WIDTH },
      },
      {
        id: ROUTE_LINE_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': TANGERINE, 'line-width': ROUTE_LINE_WIDTH },
      },
    ],
  };
}

/** Drawn when no tile source works at all: pins and routes still show on a calm surface. */
const BARE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'ave-paper', type: 'background', paint: { 'background-color': PAPER } }],
};

/**
 * Style JSON for a tier. URL styles are fetched here rather than by MapLibre, so a dead style URL
 * is just a failed fetch: MapLibre never holds a half-loaded style that would block the next one.
 */
async function resolveStyle(tier: TileTier): Promise<StyleSpecification> {
  const style = tier.style();
  if (typeof style !== 'string') return style;
  const res = await fetch(style, { signal: AbortSignal.timeout(STYLE_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Style ${style}: HTTP ${res.status}`);
  return (await res.json()) as StyleSpecification;
}

function parkingLot(): HTMLDivElement {
  if (parking && parking.isConnected) return parking;
  parking = document.createElement('div');
  parking.setAttribute('aria-hidden', 'true');
  parking.dataset.mapParking = '';
  Object.assign(parking.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    contain: 'strict',
  });
  document.body.appendChild(parking);
  return parking;
}

function park(): void {
  if (!container) return;
  const lot = parkingLot();
  // OSM's tile policy forbids loading tiles nobody is looking at, so a parked OSM map has no area.
  const tier = TILE_TIERS[tierIndex];
  const size = tier?.allowsPrefetch ? parkSize : { width: 0, height: 0 };
  lot.style.width = `${size.width}px`;
  lot.style.height = `${size.height}px`;
  if (container.parentElement !== lot) lot.appendChild(container);
  handle?.map.resize();
}

function publishTier(): void {
  const tier = TILE_TIERS[tierIndex] ?? null;
  useMapStatus.setState({ tier, degraded: tierIndex > 0 });
}

let styleRequest = 0;

/** Applies the first tier from `from` onwards whose style loads; falls back to a bare surface. */
async function applyTierFrom(map: MapLibreMap, from: number): Promise<void> {
  const request = ++styleRequest;
  for (let i = from; i < TILE_TIERS.length; i++) {
    let style: StyleSpecification;
    try {
      style = await resolveStyle(TILE_TIERS[i]!);
    } catch {
      continue;
    }
    if (request !== styleRequest) return;
    tierIndex = i;
    tierFailures = 0;
    tierLoads = 0;
    styleReady = true;
    map.setStyle(withOverlays(style), { diff: false });
    publishTier();
    if (container?.parentElement === parking) park();
    return;
  }
  if (request !== styleRequest) return;
  tierIndex = TILE_TIERS.length;
  styleReady = true;
  map.setStyle(withOverlays(BARE_STYLE), { diff: false });
  useMapStatus.setState({ tilesUnavailable: true });
}

function watchTiles(map: MapLibreMap): void {
  map.on('error', (e) => {
    // A listener here also keeps MapLibre from printing tile failures to the console.
    const sourceId = (e as { sourceId?: string }).sourceId;
    if (!sourceId || !BASE_SOURCE_IDS.has(sourceId) || tierIndex >= TILE_TIERS.length) return;
    const tileFailed = 'tile' in e && Boolean((e as { tile?: unknown }).tile);
    tierFailures += 1;
    // A source that fails without a tile (its TileJSON, e.g. a rejected key) cannot recover.
    if (!tileFailed || (tierLoads === 0 && tierFailures >= FAILURES_BEFORE_ANY_TILE) || tierFailures >= FAILURES_TOTAL) {
      void applyTierFrom(map, tierIndex + 1);
    }
  });
  map.on('data', (e) => {
    if (e.dataType === 'source' && 'tile' in e && e.tile && BASE_SOURCE_IDS.has(e.sourceId)) tierLoads += 1;
  });
  // A route set while a style was loading is pushed as soon as the style can take it.
  const retryRoute = () => {
    if (routeDirty) routeDirty = !pushRoute();
  };
  map.on('styledata', retryRoute);
  map.on('idle', retryRoute);
}

async function createMap(center: LatLng | undefined): Promise<MapHandle | null> {
  useMapStatus.setState({ phase: 'loading' });
  try {
    const [lib, worker] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?url')]);
    lib.setWorkerUrl(worker.default);
    container = document.createElement('div');
    container.className = 'ave-map';
    park();
    const map = new lib.Map({
      container,
      center: center ? [center.lng, center.lat] : undefined,
      zoom: center ? PROPERTY_ZOOM : CITY_ZOOM,
      attributionControl: false,
      maplibreLogo: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      renderWorldCopies: false,
      cooperativeGestures: false,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new lib.AttributionControl({ compact: false }), 'bottom-right');
    watchTiles(map);
    handle = { lib, map };
    void applyTierFrom(map, 0);
    useMapStatus.setState({ phase: 'ready' });
    return handle;
  } catch {
    // No WebGL, or the library failed to load. The views show a calm fallback.
    container?.remove();
    container = null;
    useMapStatus.setState({ phase: 'failed' });
    return null;
  }
}

/** The map, creating it on first use. Resolves to null when the browser cannot draw maps. */
export function ensureMap(center?: LatLng): Promise<MapHandle | null> {
  if (handle) return Promise.resolve(handle);
  creating ??= createMap(center);
  return creating;
}

export function currentMap(): MapHandle | null {
  return handle;
}

/** Moves the shared map into a view's host element. Synchronous, so it lands before the next paint. */
export function attachMap(host: HTMLElement): void {
  if (!container || !handle) return;
  if (container.parentElement !== host) host.appendChild(container);
  handle.map.resize();
}

/** Returns the map to its parking spot if this host still holds it. */
export function detachMap(host: HTMLElement): void {
  if (!container || container.parentElement !== host) return;
  if (host.clientWidth > 0 && host.clientHeight > 0) parkSize = { width: host.clientWidth, height: host.clientHeight };
  handle?.map.stop();
  park();
}

export function isAttachedTo(host: HTMLElement | null): boolean {
  return Boolean(host && container && container.parentElement === host);
}

/** Draws (or clears, with null) the bold route line. */
export function setRoute(coords: LngLatPair[] | null): void {
  routeCoords = coords && coords.length >= 2 ? coords : [];
  routeDirty = !pushRoute();
}

/**
 * Warms the map for a property: loads the library, creates the map if needed, and, while no view
 * shows it, points the parked map at the property so its tiles are cached before the buyer asks.
 */
export function preloadMapFor(location: LatLng): void {
  if (typeof document === 'undefined') return;
  void ensureMap(location).then((h) => {
    const parked = () => Boolean(h && container && container.parentElement === parking);
    if (!h || !parked()) return;
    // Both ends of the fly-in: the city view first, then the street, so the flight lands on cached tiles.
    h.map.jumpTo({ center: [location.lng, location.lat], zoom: CITY_CONTEXT_ZOOM });
    h.map.once('idle', () => {
      if (parked()) h.map.jumpTo({ center: [location.lng, location.lat], zoom: PROPERTY_ZOOM });
    });
  });
}
