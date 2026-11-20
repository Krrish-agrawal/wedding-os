import type { StyleSpecification } from 'maplibre-gl';

/**
 * Base map sources, best first. The map starts on the first available tier and steps down when
 * its tiles fail. Terms and attribution were checked on each provider's own pages; see docs/maps-notes.md.
 *
 * 1. MapTiler Satellite: needs VITE_MAP_TILES_KEY (free plan, no card). Free accounts must show the
 *    MapTiler logo as well as the text credit.
 * 2. OpenFreeMap "liberty": a street map, no key, attribution comes from the style's own TileJSON.
 * 3. OpenStreetMap standard tiles: last resort, light interactive use only, never prefetched.
 */
export type TileTierId = 'maptiler-satellite' | 'openfreemap' | 'osm-standard';

export interface TileTier {
  id: TileTierId;
  /** Shown to the buyer when this tier is in use and is not the first choice. */
  label: string;
  satellite: boolean;
  /** MapTiler's free plan requires its logo on the map. */
  requiresMapTilerLogo: boolean;
  /** Whether tiles may be loaded ahead of the buyer looking (OSM's tile policy forbids it). */
  allowsPrefetch: boolean;
  style: () => StyleSpecification | string;
}

/** Layers every base style draws first, so a failed tile shows a calm surface instead of black. */
const PAPER = '#f6f8fb';
const BASE_SOURCE_ID = 'ave-base';
const MAPTILER_TILESET = 'satellite-v2';
const RASTER_TILE_SIZE_MAPTILER = 512;
const RASTER_TILE_SIZE_OSM = 256;
const OSM_MAX_ZOOM = 19;

const MAPTILER_ATTRIBUTION =
  '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">&copy; MapTiler</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>';
const OSM_ATTRIBUTION = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>';

export const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
/**
 * Layers dropped from the OpenFreeMap style: shop and cafe icons compete with our own pins, and the
 * road-shield layers use a filter MapLibre warns about (they draw US and route shields we do not need).
 */
export const OPENFREEMAP_HIDDEN_LAYERS = /^(poi_r\d+|road_one_way_arrow.*|highway-shield.*|road_shield_us)$/;

function rasterStyle(tiles: { url?: string; tiles?: string[] }, tileSize: number, attribution: string, maxzoom?: number): StyleSpecification {
  return {
    version: 8,
    sources: {
      [BASE_SOURCE_ID]: {
        type: 'raster',
        ...tiles,
        tileSize,
        attribution,
        ...(maxzoom ? { maxzoom } : {}),
      },
    },
    layers: [
      { id: 'ave-paper', type: 'background', paint: { 'background-color': PAPER } },
      { id: 'ave-base', type: 'raster', source: BASE_SOURCE_ID },
    ],
  };
}

const mapTilerKey = (import.meta.env.VITE_MAP_TILES_KEY ?? '').trim();

const ALL_TIERS: TileTier[] = [
  {
    id: 'maptiler-satellite',
    label: 'Satellite',
    satellite: true,
    requiresMapTilerLogo: true,
    allowsPrefetch: true,
    style: () =>
      rasterStyle(
        { url: `https://api.maptiler.com/tiles/${MAPTILER_TILESET}/tiles.json?key=${encodeURIComponent(mapTilerKey)}` },
        RASTER_TILE_SIZE_MAPTILER,
        MAPTILER_ATTRIBUTION,
      ),
  },
  {
    id: 'openfreemap',
    label: 'Street map',
    satellite: false,
    requiresMapTilerLogo: false,
    allowsPrefetch: true,
    style: () => OPENFREEMAP_STYLE_URL,
  },
  {
    id: 'osm-standard',
    label: 'Street map',
    satellite: false,
    requiresMapTilerLogo: false,
    allowsPrefetch: false,
    style: () => rasterStyle({ tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] }, RASTER_TILE_SIZE_OSM, OSM_ATTRIBUTION, OSM_MAX_ZOOM),
  },
];

/** The tiers this build can use, best first. */
export const TILE_TIERS: TileTier[] = ALL_TIERS.filter((t) => t.id !== 'maptiler-satellite' || mapTilerKey.length > 0);

/** Source ids whose tile errors count against the active tier. */
export const BASE_SOURCE_IDS = new Set([BASE_SOURCE_ID, 'openmaptiles', 'ne2_shaded']);
