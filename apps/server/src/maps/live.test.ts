import { describe, expect, it, vi } from 'vitest';
import { createLiveRouter, type LiveRouterOptions } from './live.js';

const ORIGIN = { lat: 12.97446, lng: 77.6427 };
const PLACE = { lat: '13.04829', lon: '77.6211', name: 'Manyata Tech Park', display_name: 'Manyata Tech Park, Nagavara, Bengaluru' };
/** A straight-ish line with many redundant points, as OSRM returns. */
const LINE: [number, number][] = Array.from({ length: 500 }, (_, i) => [77.6427 - i * 0.00004, 12.97446 + i * 0.00015]);
const OSRM_OK = { code: 'Ok', routes: [{ distance: 12_345, duration: 1_530, geometry: { coordinates: LINE } }] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Fetch mock that answers Nominatim and OSRM by URL. */
function services(overrides: { geocode?: () => Response | Promise<Response>; route?: () => Response | Promise<Response> } = {}) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/search?')) return overrides.geocode ? overrides.geocode() : json([PLACE]);
    if (url.includes('/route/v1/driving/')) return overrides.route ? overrides.route() : json(OSRM_OK);
    throw new Error(`unexpected ${url}`);
  });
}

/** A virtual clock: sleeping advances time instantly. */
function clock(start = 1_000_000) {
  let t = start;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    slept,
  };
}

function router(fetchMock: ReturnType<typeof services>, extra: Partial<LiveRouterOptions> = {}) {
  const c = clock();
  const findRoute = createLiveRouter({
    fetch: fetchMock as unknown as typeof fetch,
    now: c.now,
    sleep: c.sleep,
    geocoderUrl: 'https://geo.test',
    routerUrl: 'https://route.test',
    userAgent: 'TestAgent/1.0',
    ...extra,
  });
  return { findRoute, clock: c };
}

describe('findRoute', () => {
  it('geocodes within Bengaluru, routes, and returns a compact custom route', async () => {
    const fetchMock = services();
    const { findRoute } = router(fetchMock);
    const route = await findRoute(ORIGIN, '  Manyata   Tech Park ');

    expect(route).not.toBeNull();
    expect(route!.name).toBe('Manyata Tech Park');
    expect(route!.destination).toEqual({ lat: 13.04829, lng: 77.6211 });
    expect(route!.distanceKm).toBe(12.3);
    expect(route!.durationMin).toBe(26);
    expect(route!.geometry.length).toBeGreaterThanOrEqual(2);
    expect(route!.geometry.length).toBeLessThan(LINE.length);

    const [geoUrl, geoInit] = fetchMock.mock.calls[0]!;
    const params = new URL(String(geoUrl)).searchParams;
    expect(params.get('q')).toBe('Manyata Tech Park');
    expect(params.get('bounded')).toBe('1');
    expect(params.get('viewbox')).toBeTruthy();
    expect(params.get('countrycodes')).toBe('in');
    expect((geoInit?.headers as Record<string, string>)['User-Agent']).toBe('TestAgent/1.0');

    const routeUrl = String(fetchMock.mock.calls[1]![0]);
    expect(routeUrl).toContain(`/route/v1/driving/${ORIGIN.lng},${ORIGIN.lat};77.6211,13.04829`);
  });

  it('answers repeat questions from the cache', async () => {
    const fetchMock = services();
    const { findRoute } = router(fetchMock);
    const a = await findRoute(ORIGIN, 'Manyata Tech Park');
    const b = await findRoute(ORIGIN, 'manyata tech park');
    expect(b).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps Nominatim to one request per second across lookups', async () => {
    const fetchMock = services();
    const { findRoute, clock: c } = router(fetchMock);
    await findRoute(ORIGIN, 'Manyata Tech Park');
    await findRoute(ORIGIN, 'Whitefield');
    // The second geocode waited for its slot rather than firing immediately.
    expect(c.slept.some((ms) => ms > 0)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('returns null when no place matches', async () => {
    const { findRoute } = router(services({ geocode: () => json([]) }));
    expect(await findRoute(ORIGIN, 'Atlantis')).toBeNull();
  });

  it('returns null when there is no drivable route', async () => {
    const { findRoute } = router(services({ route: () => json({ code: 'NoRoute', routes: [] }) }));
    expect(await findRoute(ORIGIN, 'Manyata Tech Park')).toBeNull();
  });

  it('returns null on HTTP errors and network failures instead of throwing', async () => {
    const failures: string[] = [];
    const { findRoute: a } = router(services({ geocode: () => json({ error: 'busy' }, 503) }), { onFailure: (r) => failures.push(r) });
    expect(await a(ORIGIN, 'Manyata Tech Park')).toBeNull();
    const { findRoute: b } = router(services({ route: () => Promise.reject(new TypeError('fetch failed')) }));
    expect(await b(ORIGIN, 'Manyata Tech Park')).toBeNull();
    expect(failures).toEqual(['lookup failed']);
  });

  it('gives up within its time budget when a service hangs', async () => {
    const BUDGET_MS = 60;
    const hang = () => new Promise<Response>(() => {});
    const findRoute = createLiveRouter({ fetch: services({ geocode: hang }) as unknown as typeof fetch, budgetMs: BUDGET_MS });
    const started = Date.now();
    expect(await findRoute(ORIGIN, 'Manyata Tech Park')).toBeNull();
    expect(Date.now() - started).toBeLessThan(BUDGET_MS * 20);
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    const hang = () => new Promise<Response>(() => {});
    const { findRoute } = router(services({ geocode: hang }));
    const pending = findRoute(ORIGIN, 'Manyata Tech Park', { signal: controller.signal });
    controller.abort();
    expect(await pending).toBeNull();
  });

  it('never sends queries that look like personal data, or anything when switched off', async () => {
    const fetchMock = services();
    const { findRoute } = router(fetchMock);
    expect(await findRoute(ORIGIN, 'call me on 98765 43210')).toBeNull();
    expect(await findRoute(ORIGIN, 'priya@example.com office')).toBeNull();
    expect(await findRoute(ORIGIN, '   ')).toBeNull();
    const off = router(fetchMock, { enabled: false }).findRoute;
    expect(await off(ORIGIN, 'Manyata Tech Park')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
