/**
 * Live routes for places the buyer names that are not presets ("how long to Whitefield?").
 * Geocodes with Nominatim, bounded to Bengaluru, then routes with OSRM. Never throws: any failure,
 * timeout or empty result returns null so the advisor can say it could not work the route out.
 *
 * Usage policies this module follows (read them before changing it):
 * - Nominatim: https://operations.osmfoundation.org/policies/nominatim/ — at most 1 request per
 *   second across the whole app, an identifying User-Agent, results cached, no autocomplete,
 *   no personal data, and a switch to turn it off without a code change (MAPS_LIVE_ROUTES=off).
 * - OSRM demo server: https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server — at most
 *   1 request per second, reasonable non-commercial use.
 * Both return OpenStreetMap data (© OpenStreetMap contributors), credited on the map.
 */
import { simplifyToBudget, type CustomRoute, type LatLng, type LngLatPair } from '@ave/shared';

/** Whole lookup budget: geocode, rate-limit waits and routing together. */
export const LIVE_ROUTE_BUDGET_MS = 4000;
/** One request per second per service, across every session. */
const MIN_REQUEST_SPACING_MS = 1000;
/** Bengaluru metropolitan area as left,top,right,bottom (lng/lat). Covers the airport and Electronic City. */
const BENGALURU_VIEWBOX = '77.35,13.30,77.85,12.75';
const MAX_QUERY_LENGTH = 120;
/** Results asked for per geocode, so an exact name match can win over the top-ranked one. */
const GEOCODE_CANDIDATES = 5;
const CACHE_MAX_ENTRIES = 200;
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 10 * 60 * 1000;
/** Origins within about 10 m share cached routes. */
const ORIGIN_DECIMALS = 4;
const ROUTE_SIMPLIFY_TOLERANCE_M = 15;
const ROUTE_MAX_POINTS = 200;
const METRES_PER_KM = 1000;
const SECONDS_PER_MINUTE = 60;
const KM_DECIMALS = 1;

/** A query that looks like it carries personal data (an email or a phone-length number) is never sent out. */
const PERSONAL_DATA = /[^\s@]+@[^\s@]+\.[^\s@]+|\d[\d\s-]{6,}\d/;

export interface LiveRouterOptions {
  geocoderUrl?: string;
  routerUrl?: string;
  userAgent?: string;
  enabled?: boolean;
  budgetMs?: number;
  /** Injected for tests. */
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Called on every failure with a short reason, for server logs. */
  onFailure?: (reason: string, detail: { query: string; error?: string }) => void;
}

export type FindRoute = (origin: LatLng, query: string, opts?: { signal?: AbortSignal }) => Promise<CustomRoute | null>;

interface Place {
  name: string;
  lat: number;
  lng: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** Small insertion-ordered cache with per-entry expiry and a size cap. */
class TtlCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();
  constructor(private readonly now: () => number) {}
  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: T, ttlMs: number): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.map.size > CACHE_MAX_ENTRIES) this.map.delete(this.map.keys().next().value as string);
  }
}

/** Hands out request slots at most once per spacing interval. */
class RateLimiter {
  private next = 0;
  constructor(
    private readonly spacingMs: number,
    private readonly now: () => number,
  ) {}
  /** Milliseconds to wait for the next slot, reserving it. */
  reserve(): number {
    const t = this.now();
    const slot = Math.max(t, this.next);
    this.next = slot + this.spacingMs;
    return slot - t;
  }
}

class AbortedError extends Error {}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new AbortedError('aborted'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

function normaliseQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
}

interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
}

interface OsrmResponse {
  code: string;
  routes?: Array<{ distance: number; duration: number; geometry?: { coordinates: LngLatPair[] } }>;
}

/** Builds a findRoute bound to its own caches and rate limiters. */
export function createLiveRouter(options: LiveRouterOptions = {}): FindRoute {
  const geocoderUrl = (options.geocoderUrl ?? 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
  const routerUrl = (options.routerUrl ?? 'https://router.project-osrm.org').replace(/\/$/, '');
  const userAgent = options.userAgent ?? 'AgoraVirtualEstates/0.1 (AI property advisor demo)';
  const enabled = options.enabled ?? true;
  const budgetMs = options.budgetMs ?? LIVE_ROUTE_BUDGET_MS;
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const onFailure = options.onFailure ?? (() => {});

  const places = new TtlCache<Place | null>(now);
  const routes = new TtlCache<CustomRoute | null>(now);
  const inflight = new Map<string, Promise<CustomRoute | null>>();
  const geocodeSlots = new RateLimiter(MIN_REQUEST_SPACING_MS, now);
  const routeSlots = new RateLimiter(MIN_REQUEST_SPACING_MS, now);

  async function getJson<T>(url: string, limiter: RateLimiter, signal: AbortSignal, deadline: number): Promise<T> {
    const wait = limiter.reserve();
    if (now() + wait >= deadline) throw new Error('rate limit wait exceeds the time budget');
    if (wait > 0) await sleep(wait, signal);
    const res = await doFetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async function geocode(query: string, signal: AbortSignal, deadline: number): Promise<Place | null> {
    const key = query.toLowerCase();
    const cached = places.get(key);
    if (cached !== undefined) return cached;
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: String(GEOCODE_CANDIDATES),
      countrycodes: 'in',
      viewbox: BENGALURU_VIEWBOX,
      bounded: '1',
      'accept-language': 'en',
    });
    const results = await getJson<NominatimResult[]>(`${geocoderUrl}/search?${params}`, geocodeSlots, signal, deadline);
    const list = Array.isArray(results) ? results : [];
    // Prefer a result named exactly what was asked ("Whitefield" the area over "Whitefield (Kadugodi)" the station).
    const wanted = query.toLowerCase();
    const top = list.find((r) => r.name?.trim().toLowerCase() === wanted) ?? list[0];
    const lat = top ? Number(top.lat) : NaN;
    const lng = top ? Number(top.lon) : NaN;
    const place: Place | null =
      top && Number.isFinite(lat) && Number.isFinite(lng)
        ? { name: (top.name || top.display_name?.split(',')[0] || query).trim(), lat, lng }
        : null;
    places.set(key, place, place ? FOUND_TTL_MS : NOT_FOUND_TTL_MS);
    return place;
  }

  async function drive(origin: LatLng, place: Place, signal: AbortSignal, deadline: number): Promise<CustomRoute | null> {
    const url = `${routerUrl}/route/v1/driving/${origin.lng},${origin.lat};${place.lng},${place.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    const res = await getJson<OsrmResponse>(url, routeSlots, signal, deadline);
    const best = res.code === 'Ok' ? res.routes?.[0] : undefined;
    if (!best || !Number.isFinite(best.distance) || !Number.isFinite(best.duration)) return null;
    const coords = best.geometry?.coordinates ?? [];
    return {
      name: place.name,
      destination: { lat: place.lat, lng: place.lng },
      distanceKm: Number((best.distance / METRES_PER_KM).toFixed(KM_DECIMALS)),
      durationMin: Math.round(best.duration / SECONDS_PER_MINUTE),
      geometry: simplifyToBudget(coords, { toleranceM: ROUTE_SIMPLIFY_TOLERANCE_M, maxPoints: ROUTE_MAX_POINTS }),
    };
  }

  async function lookup(origin: LatLng, query: string, routeKey: string, signal: AbortSignal): Promise<CustomRoute | null> {
    const deadline = now() + budgetMs;
    try {
      const place = await geocode(query, signal, deadline);
      if (!place) {
        onFailure('no place found', { query });
        return null;
      }
      const route = await drive(origin, place, signal, deadline);
      routes.set(routeKey, route, route ? FOUND_TTL_MS : NOT_FOUND_TTL_MS);
      if (!route) onFailure('no drivable route', { query });
      return route;
    } catch (err) {
      const aborted = signal.aborted || err instanceof AbortedError || (err as Error).name === 'AbortError';
      onFailure(aborted ? 'timed out or cancelled' : 'lookup failed', { query, error: (err as Error).message });
      return null;
    }
  }

  return async function findRoute(origin, rawQuery, opts = {}) {
    try {
      const query = normaliseQuery(rawQuery ?? '');
      if (!enabled || !query || PERSONAL_DATA.test(query)) return null;
      if (!Number.isFinite(origin?.lat) || !Number.isFinite(origin?.lng)) return null;
      const routeKey = `${origin.lat.toFixed(ORIGIN_DECIMALS)},${origin.lng.toFixed(ORIGIN_DECIMALS)}|${query.toLowerCase()}`;
      const cached = routes.get(routeKey);
      if (cached !== undefined) return cached;

      const signals = [AbortSignal.timeout(budgetMs), ...(opts.signal ? [opts.signal] : [])];
      const signal = AbortSignal.any(signals);
      if (signal.aborted) return null;

      // Identical lookups already running share one request; each caller still gets its own budget.
      let pending = inflight.get(routeKey);
      if (!pending) {
        pending = lookup(origin, query, routeKey, signal).finally(() => inflight.delete(routeKey));
        inflight.set(routeKey, pending);
      }
      return await raceAbort(pending, signal);
    } catch {
      return null;
    }
  };
}

/** Resolves to null as soon as the signal aborts, even if the work is still running. */
function raceAbort<T>(work: Promise<T | null>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve(null);
      },
    );
  });
}

/**
 * The app-wide live router. Configuration (all optional):
 * MAPS_LIVE_ROUTES=off turns live lookups off; MAPS_GEOCODER_URL and MAPS_ROUTER_URL point at other
 * Nominatim / OSRM instances; MAPS_USER_AGENT replaces the identifying User-Agent (no personal data).
 */
export const findRoute: FindRoute = createLiveRouter({
  enabled: process.env.MAPS_LIVE_ROUTES !== 'off',
  geocoderUrl: process.env.MAPS_GEOCODER_URL || undefined,
  routerUrl: process.env.MAPS_ROUTER_URL || undefined,
  userAgent: process.env.MAPS_USER_AGENT || undefined,
});
