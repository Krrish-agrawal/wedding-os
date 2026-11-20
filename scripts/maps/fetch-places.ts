/**
 * Fetches named places around each property from OpenStreetMap (Overpass API) and writes them
 * into data/localities/<localityId>.json, keeping the hand-written profile and sources.
 *
 *   npx --no-install tsx scripts/maps/fetch-places.ts            # uses cached responses when present
 *   npx --no-install tsx scripts/maps/fetch-places.ts --refresh  # asks Overpass again
 *
 * Overpass etiquette: one query per locality, run one after another with a pause, identifying
 * User-Agent, responses cached under scripts/maps/.cache.
 */
import path from 'node:path';
import { LocalityFileSchema, PLACE_CATEGORIES, haversineKm, type LocalityFile, type Place, type PlaceCategory, type Property } from '@ave/shared';
import { DATA_DIR, hasFlag, loadProperties, politeFetchJson, readCache, readJson, slugify, sleep, writeCache, writeJson } from './lib.js';
import {
  EXCLUDED_OSM_IDS,
  MAX_BUS_STOPS,
  MAX_SCHOOLS,
  MAX_SUPERMARKETS,
  MAX_METRO_STATIONS,
  MAX_PER_CATEGORY,
  MAX_RAIL_STATIONS,
  MIN_SPACING_M,
  OVERPASS_PAUSE_MS,
  OVERPASS_URL,
  SAME_NAME_RADIUS_M,
  buildQuery,
  isUnusableName,
  radiusFor,
  classify,
  displayName,
  type Classified,
} from './places-config.js';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
const M_PER_KM = 1000;

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
export interface OverpassResponse {
  elements: OverpassElement[];
  /** Set by Overpass when the query failed on the server (often with HTTP 200 and no elements). */
  remark?: string;
}

/** Overpass reports timeouts and memory limits in `remark`, sometimes with an HTTP 200. */
function isUsable(res: OverpassResponse | null): res is OverpassResponse {
  return Boolean(res && Array.isArray(res.elements) && !/error/i.test(res.remark ?? ''));
}

interface Candidate extends Classified {
  name: string;
  osmId: string;
  lat: number;
  lng: number;
  distanceM: number;
}

export function overpassCacheName(localityId: string): string {
  return `overpass-${localityId}.json`;
}

/** Turns raw Overpass elements into classified, named candidates sorted by distance. */
export function toCandidates(elements: OverpassElement[], origin: { lat: number; lng: number }): Candidate[] {
  const out: Candidate[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat === undefined || lng === undefined) continue;
    const osmId = `${el.type}/${el.id}`;
    if (EXCLUDED_OSM_IDS[osmId]) continue;
    const cls = classify(tags);
    const name = displayName(tags);
    if (!cls || !name || isUnusableName(cls.category, name)) continue;
    const distanceM = haversineKm(origin, { lat, lng }) * M_PER_KM;
    if (distanceM > radiusFor(cls)) continue;
    out.push({ ...cls, name, osmId, lat, lng, distanceM });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(metro station|metro|station|bus stop|bus stand|stop)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const metresBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => haversineKm(a, b) * M_PER_KM;

/** Greedy pick by distance: skips same-name duplicates and places crowding an earlier pick. */
function pick(cands: Candidate[], max: number, chosen: Candidate[] = []): Candidate[] {
  const picked: Candidate[] = [];
  for (const c of cands) {
    if (picked.length >= max) break;
    const others = [...chosen, ...picked];
    const dupe = others.some((o) => normaliseName(o.name) === normaliseName(c.name) && metresBetween(o, c) < SAME_NAME_RADIUS_M);
    const crowded = others.some((o) => metresBetween(o, c) < MIN_SPACING_M);
    if (dupe || crowded) continue;
    picked.push(c);
  }
  return picked;
}

/** Transit is a mix: nearest metro and railway stations, bus stations, then the nearest bus stops. */
function pickTransit(cands: Candidate[]): Candidate[] {
  const byGroup = (g: Classified['group']) => cands.filter((c) => c.group === g);
  const chosen: Candidate[] = [];
  chosen.push(...pick(byGroup('metro'), MAX_METRO_STATIONS, chosen));
  chosen.push(...pick(byGroup('rail'), MAX_RAIL_STATIONS, chosen));
  chosen.push(...pick(byGroup('bus_station'), MAX_PER_CATEGORY - chosen.length, chosen));
  chosen.push(...pick(byGroup('bus_stop'), Math.min(MAX_BUS_STOPS, MAX_PER_CATEGORY - chosen.length), chosen));
  return chosen.sort((a, b) => a.distanceM - b.distanceM);
}

/** Metro stations are often named only after their area ("Indiranagar"); say what they are. */
function displayPlaceName(c: Candidate): string {
  return c.group === 'metro' && !/metro/i.test(c.name) ? `${c.name} metro station` : c.name;
}

/** Groceries: the nearest supermarkets first, then greengrocers and corner stores by distance. */
function pickGroceries(cands: Candidate[]): Candidate[] {
  const chosen = pick(cands.filter((c) => c.kind === 'Supermarket'), MAX_SUPERMARKETS);
  chosen.push(...pick(cands.filter((c) => c.kind !== 'Supermarket'), MAX_PER_CATEGORY - chosen.length, chosen));
  return chosen.sort((a, b) => a.distanceM - b.distanceM);
}

function pickFor(category: PlaceCategory, inCat: Candidate[]): Candidate[] {
  if (category === 'transit') return pickTransit(inCat);
  if (category === 'groceries') return pickGroceries(inCat);
  return pick(inCat, category === 'schools' ? MAX_SCHOOLS : MAX_PER_CATEGORY);
}

export function selectPlaces(cands: Candidate[]): Place[] {
  const places: Place[] = [];
  const usedIds = new Set<string>();
  for (const category of PLACE_CATEGORIES) {
    const inCat = cands.filter((c) => c.category === category);
    const chosen = pickFor(category, inCat);
    for (const c of chosen) {
      let id = `${category}-${slugify(c.name)}`;
      for (let n = 2; usedIds.has(id); n++) id = `${category}-${slugify(c.name)}-${n}`;
      usedIds.add(id);
      places.push({ id, name: displayPlaceName(c), category, kind: c.kind, lat: round6(c.lat), lng: round6(c.lng), osmId: c.osmId });
    }
  }
  return places;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

let queriedBefore = false;

async function fetchOverpass(localityId: string, property: Property, refresh: boolean): Promise<OverpassResponse> {
  const cacheName = overpassCacheName(localityId);
  if (!refresh) {
    const cached = await readCache<OverpassResponse>(cacheName);
    if (isUsable(cached)) {
      console.log(`  using cached ${cacheName}`);
      return cached;
    }
  }
  // Never hold more than one Overpass slot: pause between live queries.
  if (queriedBefore) await sleep(OVERPASS_PAUSE_MS);
  queriedBefore = true;
  const query = buildQuery(property.location.lat, property.location.lng);
  console.log(`  querying ${OVERPASS_URL} for ${localityId}`);
  const res = await politeFetchJson<OverpassResponse>(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }).toString(),
  });
  if (!isUsable(res)) throw new Error(`Overpass could not answer for ${localityId}: ${(res as OverpassResponse).remark ?? 'no elements'}`);
  await writeCache(cacheName, res);
  return res;
}

function summarise(places: Place[], origin: { lat: number; lng: number }): void {
  for (const category of PLACE_CATEGORIES) {
    const list = places.filter((p) => p.category === category);
    console.log(`  ${category} (${list.length})`);
    for (const p of list) console.log(`    ${Math.round(metresBetween(origin, p)).toString().padStart(5)} m  ${p.name}  [${p.kind}, ${p.osmId}]`);
  }
}

async function main() {
  const refresh = hasFlag('--refresh');
  const properties = await loadProperties();
  const seen = new Set<string>();
  for (const property of properties) {
    const localityId = property.localityId;
    if (seen.has(localityId)) continue;
    seen.add(localityId);
    console.log(`${localityId} (around ${property.id})`);
    const file = path.join(DATA_DIR, 'localities', `${localityId}.json`);
    const existing = LocalityFileSchema.parse(await readJson(file));

    const res = await fetchOverpass(localityId, property, refresh);
    const places = selectPlaces(toCandidates(res.elements, property.location));
    summarise(places, property.location);

    const missing = PLACE_CATEGORIES.filter((c: PlaceCategory) => !places.some((p) => p.category === c));
    if (missing.length) console.warn(`  no places for: ${missing.join(', ')}`);

    const next: LocalityFile = LocalityFileSchema.parse({ ...existing, places, attribution: OSM_ATTRIBUTION });
    await writeJson(file, next);
    console.log(`  wrote ${path.relative(process.cwd(), file)} (${places.length} places)`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
