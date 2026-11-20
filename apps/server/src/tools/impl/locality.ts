import { PLACE_CATEGORIES, PLACE_CATEGORY_LABELS, haversineKm, type ToolInput, type ToolResult } from '@ave/shared';
import type { ToolContext } from '../context.js';
import { distanceText, round1 } from '../format.js';
import { dispatch, fail, ok, resolveProperty } from '../kit.js';

const MAX_PLACES = 4;
const MAX_GOOD_TO_KNOW = 3;
const DISTANCE_NOTE = 'Straight-line distances from the property';

export function showLocality(tc: ToolContext, input: ToolInput<'showLocality'>): ToolResult {
  const r = resolveProperty(tc);
  if (!r.bundle) return r.result;
  const { property, locality } = r.bundle;
  const category = input.category ?? null;

  dispatch(tc, { type: 'set_view', view: 'locality', params: { category, placeId: null } });

  if (!category) {
    const counts = Object.fromEntries(
      PLACE_CATEGORIES.map((c) => [PLACE_CATEGORY_LABELS[c], locality.places.filter((p) => p.category === c).length] as const).filter(([, n]) => n > 0),
    );
    return ok(
      tc,
      {
        locality: `${locality.name}, ${locality.city}`,
        summary: locality.profile.summary,
        character: locality.profile.character,
        connectivity: locality.profile.connectivity,
        goodToKnow: locality.profile.goodToKnow.slice(0, MAX_GOOD_TO_KNOW),
        placesByCategory: counts,
      },
      input.tone ?? 'warm',
    );
  }

  const label = PLACE_CATEGORY_LABELS[category];
  const places = locality.places
    .filter((p) => p.category === category)
    .map((p) => ({ name: p.name, km: round1(haversineKm(property.location, p)) }))
    .sort((a, b) => a.km - b.km);

  if (places.length === 0) {
    return fail(
      tc,
      `No ${label.toLowerCase()} are listed near ${locality.name} in our area data.`,
      'Say you do not have that detail and offer to have a senior advisor confirm it.',
    );
  }

  return ok(
    tc,
    {
      category: label,
      nearest: places.slice(0, MAX_PLACES).map((p) => ({ name: p.name, distance: distanceText(p.km) })),
      totalListed: places.length,
      note: DISTANCE_NOTE,
    },
    input.tone ?? 'pointing',
  );
}
