/**
 * Precomputes the preset commute routes for every property with the public OSRM demo server
 * and writes data/commute/<propertyId>.json.
 *
 *   npx --no-install tsx scripts/maps/precompute-routes.ts            # uses cached responses when present
 *   npx --no-install tsx scripts/maps/precompute-routes.ts --refresh  # asks OSRM again
 *
 * Run fetch-places.ts first: the nearest metro station is read from its cached Overpass response.
 * OSRM demo etiquette: at most one request per second, identifying User-Agent, cached to disk.
 * OSRM times are free-flow (no traffic); the file note says so.
 */
import path from 'node:path';
import { CommuteFileSchema, simplifyToBudget, type CommuteFile, type CommuteRoute, type LngLatPair, type Property } from '@ave/shared';
import { DATA_DIR, hasFlag, loadProperties, politeFetchJson, readCache, sleep, writeCache, writeJson } from './lib.js';
import { FIXED_DESTINATIONS, METRO_ROUTE_ID, type PresetDestination } from './destinations.js';
import { overpassCacheName, toCandidates, type OverpassResponse } from './fetch-places.js';

const OSRM_URL = process.env.OSRM_URL ?? 'https://router.project-osrm.org';
/** Comfortably under the demo server's one request per second. */
const REQUEST_SPACING_MS = 1500;
/** Simplification: keep shape within this many metres, and never more than this many points. */
const SIMPLIFY_TOLERANCE_M = 12;
const MAX_ROUTE_POINTS = 220;
const KM_DECIMALS = 1;
const SECONDS_PER_MINUTE = 60;
const METRES_PER_KM = 1000;

export const COMMUTE_NOTE =
  'Drive times are estimates without heavy traffic, worked out from OpenStreetMap road data. Peak-hour trips in Bengaluru usually take longer.';
const routeSource = (fetchedOn: string) => `OSRM demo server (router.project-osrm.org), driving profile, OpenStreetMap data, fetched ${fetchedOn}`;

interface OsrmResponse {
  /** Added by this script when caching: the request coordinates and the fetch date. */
  request?: string;
  fetchedOn?: string;
  code: string;
  message?: string;
  routes?: Array<{ distance: number; duration: number; geometry: { type: 'LineString'; coordinates: LngLatPair[] } }>;
}

let lastRequestAt = 0;

async function route(property: Property, dest: PresetDestination, refresh: boolean): Promise<OsrmResponse> {
  const cacheName = `osrm-${property.id}-${dest.id}.json`;
  const origin = property.location;
  if (!refresh) {
    const cached = await readCache<OsrmResponse>(cacheName);
    const request = coordsKey(origin, dest);
    if (cached && cached.request === request) return cached;
  }
  const wait = lastRequestAt + REQUEST_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  const url = `${OSRM_URL}/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  const res: OsrmResponse = {
    ...(await politeFetchJson<OsrmResponse>(url)),
    request: coordsKey(origin, dest),
    fetchedOn: new Date().toISOString().slice(0, 10),
  };
  await writeCache(cacheName, res);
  return res;
}

const coordsKey = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => `${a.lng},${a.lat};${b.lng},${b.lat}`;

/** Nearest operating metro station to the property, from the cached Overpass response. */
async function nearestMetro(property: Property): Promise<PresetDestination | null> {
  const cached = await readCache<OverpassResponse>(overpassCacheName(property.localityId));
  if (!cached) {
    console.warn(`  no Overpass cache for ${property.localityId}: run fetch-places.ts first; skipping the metro route`);
    return null;
  }
  const metro = toCandidates(cached.elements, property.location).find((c) => c.group === 'metro');
  if (!metro) {
    console.warn(`  no metro station found near ${property.id}; skipping the metro route`);
    return null;
  }
  const name = /metro/i.test(metro.name) ? metro.name : `${metro.name} metro station`;
  return { id: METRO_ROUTE_ID, label: 'Nearest metro', category: 'metro', name, lat: metro.lat, lng: metro.lng, osm: metro.osmId };
}

/** The other shortlisted property: the office from the home, the home from the office. */
function otherPropertyDestination(property: Property, all: Property[]): (PresetDestination & { propertyId: string }) | null {
  const other = all.find((p) => p.id !== property.id);
  if (!other) return null;
  const toOffice = other.kind === 'lease';
  return {
    id: toOffice ? 'office' : 'home',
    label: toOffice ? `Office in ${other.localityName}` : `Home in ${other.localityName}`,
    category: toOffice ? 'office' : 'home',
    name: other.address,
    lat: other.location.lat,
    lng: other.location.lng,
    osm: 'property data',
    propertyId: other.id,
  };
}

async function main() {
  const refresh = hasFlag('--refresh');
  const properties = await loadProperties();
  for (const property of properties) {
    console.log(property.id);
    const other = otherPropertyDestination(property, properties);
    const metro = await nearestMetro(property);
    const destinations: Array<PresetDestination & { propertyId?: string }> = [
      ...(other ? [other] : []),
      ...(metro ? [metro] : []),
      ...FIXED_DESTINATIONS,
    ];
    const routes: CommuteRoute[] = [];
    for (const dest of destinations) {
      const res = await route(property, dest, refresh);
      const best = res.routes?.[0];
      if (res.code !== 'Ok' || !best) {
        console.warn(`  ${dest.id}: no route (${res.code}${res.message ? `: ${res.message}` : ''})`);
        continue;
      }
      const geometry = simplifyToBudget(best.geometry.coordinates, { toleranceM: SIMPLIFY_TOLERANCE_M, maxPoints: MAX_ROUTE_POINTS });
      const r: CommuteRoute = {
        id: dest.id,
        label: dest.label,
        category: dest.category,
        destination: { name: dest.name, lat: dest.lat, lng: dest.lng },
        distanceKm: Number((best.distance / METRES_PER_KM).toFixed(KM_DECIMALS)),
        durationMin: Math.round(best.duration / SECONDS_PER_MINUTE),
        geometry,
        source: routeSource(res.fetchedOn ?? 'unknown date'),
        ...(dest.propertyId ? { propertyId: dest.propertyId } : {}),
      };
      routes.push(r);
      console.log(`  ${dest.id.padEnd(22)} ${String(r.distanceKm).padStart(5)} km  ${String(r.durationMin).padStart(3)} min  ${geometry.length} pts (from ${best.geometry.coordinates.length})`);
    }
    const file: CommuteFile = CommuteFileSchema.parse({ propertyId: property.id, origin: property.location, routes, note: COMMUTE_NOTE });
    const out = path.join(DATA_DIR, 'commute', `${property.id}.json`);
    await writeJson(out, file);
    console.log(`  wrote ${path.relative(process.cwd(), out)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
