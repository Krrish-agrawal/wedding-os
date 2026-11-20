import { haversineKm, type CommuteRoute, type CustomRoute, type PropertyBundle, type ToolInput, type ToolResult } from '@ave/shared';
import type { ToolContext } from '../context.js';
import { distanceText, durationText } from '../format.js';
import { dispatch, fail, isLease, isSale, ok, resolveProperty } from '../kit.js';

type CommuteCategory = CommuteRoute['category'];

/** Upper bound on a live geocode + route lookup. The MCP `timeout_ms` must sit above this. */
export const LIVE_ROUTE_TIMEOUT_MS = 6000;
/** A preset ending this close to the other property is the home-to-office route. */
const OTHER_PROPERTY_RADIUS_KM = 0.5;
const MAX_OTHER_ROUTES = 6;

/** Phrases that name a preset category, in priority order for ties ("Kempegowda bus station" is a bus). */
const CATEGORY_PHRASES: [CommuteCategory, string[]][] = [
  ['bus', ['bus stand', 'bus station', 'bus depot', 'bus terminal', 'majestic', 'bus']],
  ['rail', ['railway station', 'train station', 'railway', 'train', 'rail', 'ksr']],
  ['metro', ['metro station', 'metro']],
  ['airport', ['airport', 'kempegowda', 'kia', 'bial', 'devanahalli', 'flight', 'flights']],
  ['cbd', ['central business district', 'city centre', 'city center', 'mg road', 'cbd', 'downtown', 'brigade road', 'ub city']],
  ['techpark', ['tech park', 'techpark', 'it park', 'tech village', 'technology park']],
  ['office', ['office', 'workplace', 'work', 'team']],
  ['home', ['home', 'apartment', 'flat', 'house']],
];

/** Words that carry no place identity in a commute question. */
const FILLER_WORDS = new Set(
  (
    'a an the to my our your from how far long is it its nearest closest near please route drive driving distance time take takes get go ' +
    'what about and of in at for me show way there here till upto up by car this that place you showed shown saw seen earlier other one which we us ' +
    'station road park city international terminal junction stand stop bengaluru bangalore central main area district centre center building campus'
  ).split(' '),
);
const CATEGORY_WORDS = new Set(CATEGORY_PHRASES.flatMap(([, phrases]) => phrases.flatMap((p) => p.split(' '))));

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasPhrase(q: string, phrase: string): boolean {
  return ` ${q} `.includes(` ${phrase} `);
}

function detectCategory(q: string): CommuteCategory | null {
  let best: { cat: CommuteCategory; hits: number } | null = null;
  for (const [cat, phrases] of CATEGORY_PHRASES) {
    const hits = phrases.filter((p) => hasPhrase(q, p)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { cat, hits };
  }
  return best?.cat ?? null;
}

/** Tokens that identify a specific place, e.g. "manyata" in "Manyata Tech Park". */
function distinctiveTokens(q: string): string[] {
  return q.split(' ').filter((t) => t.length > 1 && !FILLER_WORDS.has(t) && !CATEGORY_WORDS.has(t));
}

function routeHay(route: CommuteRoute): string {
  return normalise(`${route.id} ${route.label} ${route.destination.name}`);
}

/** A preset only counts if it names every specific place word the buyer used. */
function coversPlace(route: CommuteRoute, tokens: string[]): boolean {
  const hay = ` ${routeHay(route)} `;
  return tokens.every((t) => hay.includes(` ${t} `) || hay.includes(t));
}

function otherPropertyRoute(bundle: PropertyBundle, others: PropertyBundle[]): CommuteRoute | null {
  const routes = bundle.commute.routes;
  const tagged = routes.find((r) => r.propertyId && others.some((o) => o.property.id === r.propertyId));
  if (tagged) return tagged;
  for (const o of others) {
    const near = routes.find((r) => haversineKm(r.destination, o.property.location) <= OTHER_PROPERTY_RADIUS_KM);
    if (near) return near;
  }
  const category: CommuteCategory = bundle.property.kind === 'sale' ? 'office' : 'home';
  return routes.find((r) => r.category === category) ?? null;
}

export type PresetMatch = { route: CommuteRoute; toOtherProperty: boolean } | { wantsOtherProperty: true; route: null } | null;

/** Resolves a spoken destination to a precomputed route, or null when it needs a live lookup. */
export function matchPreset(bundle: PropertyBundle, others: PropertyBundle[], destination: string): PresetMatch {
  const q = normalise(destination);
  if (!q) return null;
  const routes = bundle.commute.routes;

  const byId = routes.find((r) => normalise(r.id) === q);
  if (byId) return { route: byId, toOtherProperty: false };

  const category = detectCategory(q);
  const tokens = distinctiveTokens(q);
  const namesOther = others.some((o) =>
    [o.property.id, o.property.name, o.property.localityName].some((n) => {
      const nn = normalise(n);
      return nn.length > 2 && (hasPhrase(q, nn) || nn.split(' ').some((w) => w.length > 3 && !FILLER_WORDS.has(w) && hasPhrase(q, w)));
    }),
  );
  const wantsOther = namesOther || (bundle.property.kind === 'sale' && category === 'office') || (bundle.property.kind === 'lease' && category === 'home');
  if (wantsOther) {
    const route = otherPropertyRoute(bundle, others);
    return route ? { route, toOtherProperty: true } : { wantsOtherProperty: true, route: null };
  }

  const byName = routes.find((r) =>
    [r.label, r.destination.name].some((n) => {
      const nn = normalise(n);
      return nn === q || (q.length >= 4 && nn.includes(q)) || (nn.length >= 4 && hasPhrase(q, nn));
    }),
  );
  if (byName && coversPlace(byName, tokens)) return { route: byName, toOtherProperty: false };

  if (category) {
    const inCategory = routes.filter((r) => r.category === category && coversPlace(r, tokens));
    if (inCategory[0]) return { route: inCategory[0], toOtherProperty: false };
  }
  return null;
}

function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, ms);
  });
  return Promise.race([work(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

export async function showCommute(tc: ToolContext, input: ToolInput<'showCommute'>): Promise<ToolResult> {
  // With nothing open, "my office" is asked from the home and "home" from the office.
  const asked = detectCategory(normalise(input.destination));
  const r = resolveProperty(tc, asked === 'office' ? isSale : asked === 'home' ? isLease : undefined);
  if (!r.bundle) return r.result;
  const bundle = r.bundle;
  const others = tc.app.content.properties.filter((b) => b !== bundle);
  const presetLabels = (except?: string) => bundle.commute.routes.filter((x) => x.id !== except).slice(0, MAX_OTHER_ROUTES).map((x) => x.label);
  const expression = input.tone ?? 'pointing';

  const match = matchPreset(bundle, others, input.destination);
  if (match?.route) {
    const route = match.route;
    dispatch(tc, { type: 'set_view', view: 'commute', params: { destinationId: route.id, custom: null } });
    return ok(
      tc,
      {
        destination: route.label,
        place: route.destination.name,
        distance: distanceText(route.distanceKm),
        time: durationText(route.durationMin),
        ...(match.toOtherProperty ? { between: 'the two shortlisted properties' } : {}),
        note: bundle.commute.note,
        otherRoutes: presetLabels(route.id),
      },
      expression,
    );
  }

  // Show the presets while the live lookup runs, so the screen changes as the advisor starts talking.
  dispatch(tc, { type: 'set_view', view: 'commute', params: { destinationId: null, custom: null } });
  if (match?.wantsOtherProperty) {
    return fail(tc, 'The route between the two properties is not in our data yet.', `Say so and offer a preset instead: ${presetLabels().join(', ')}.`);
  }

  const couldNot = `I couldn't work out a route to ${input.destination}.`;
  const hint = `Say so, and offer one of the routes on screen: ${presetLabels().join(', ')}.`;
  const findRoute = tc.deps.findRoute;
  if (!findRoute) return fail(tc, couldNot, hint);

  let route: CustomRoute | null = null;
  try {
    route = await withTimeout((signal) => findRoute(bundle.commute.origin, input.destination, { signal }), LIVE_ROUTE_TIMEOUT_MS);
  } catch (err) {
    tc.log.warn({ sessionId: tc.sessionId, destination: input.destination, err: (err as Error).message }, 'live route failed');
  }
  if (!route) return fail(tc, couldNot, hint);

  dispatch(tc, { type: 'set_view', view: 'commute', params: { destinationId: null, custom: route } });
  return ok(
    tc,
    {
      destination: route.name,
      distance: distanceText(route.distanceKm),
      time: durationText(route.durationMin),
      note: bundle.commute.note,
      liveEstimate: true,
    },
    expression,
  );
}
