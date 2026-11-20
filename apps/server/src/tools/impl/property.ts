import { computeLeaseTotals, formatFloor, matchByName, type PropertyBundle, type SessionState, type ToolInput, type ToolResult } from '@ave/shared';
import type { ToolContext } from '../context.js';
import { amount, directionWord } from '../format.js';
import { dispatch, fail, offerTotals, ok, propertyChoices } from '../kit.js';

/** Headline price: total for a sale, monthly outgo for a lease. */
function priceSummary(tc: ToolContext, bundle: PropertyBundle, state: SessionState) {
  if (bundle.money.kind === 'sale') return { total: amount(offerTotals(tc, bundle, state).total) };
  const lease = computeLeaseTotals(bundle.money);
  return { monthlyTotal: amount(lease.monthlyTotal), perSeatMonthly: amount(lease.perSeatMonthly), seats: bundle.money.seats };
}

function kindText(bundle: PropertyBundle): string {
  return bundle.property.kind === 'sale' ? 'for sale' : 'for lease';
}

export function showShortlist(tc: ToolContext, input: ToolInput<'showShortlist'>): ToolResult {
  const state = dispatch(tc, { type: 'set_view', view: 'shortlist' });
  const properties = tc.app.content.properties.map((b) => ({
    id: b.property.id,
    name: b.property.name,
    type: `${b.property.configuration}, ${kindText(b)}`,
    locality: b.property.localityName,
    carpetSqft: b.property.areas.carpetSqft,
    ...priceSummary(tc, b, state),
    highlights: b.property.highlights,
  }));
  return ok(tc, { properties }, input.tone ?? 'pointing');
}

/** Matches "the apartment", "office", a name or an id to a property. */
export function findProperty(tc: ToolContext, query: string): PropertyBundle | null {
  const exact = tc.app.content.byId[query.trim()];
  if (exact) return exact;
  const candidates = tc.app.content.properties.map((b) => ({
    id: b.property.id,
    name: b.property.name,
    label: `${b.property.configuration} ${b.property.localityName} ${b.property.kind === 'sale' ? 'apartment home flat' : 'office workspace lease'}`,
    bundle: b,
  }));
  return matchByName(candidates, query)?.bundle ?? null;
}

export function openProperty(tc: ToolContext, input: ToolInput<'openProperty'>): ToolResult {
  const bundle = findProperty(tc, input.propertyId);
  if (!bundle) {
    return fail(tc, `There is no property called "${input.propertyId}".`, `Use one of: ${propertyChoices(tc)}.`);
  }
  const p = bundle.property;
  // Screen first: switch the property, then land on the tour overview.
  dispatch(tc, { type: 'set_property', propertyId: p.id });
  const state = dispatch(tc, { type: 'set_view', view: 'tour', params: { stopId: null, mode: 'step' } });

  return ok(
    tc,
    {
      id: p.id,
      name: p.name,
      type: `${p.configuration}, ${kindText(bundle)}`,
      builder: p.builder,
      locality: `${p.localityName}, ${p.city}`,
      areasSqft: { carpet: p.areas.carpetSqft, builtUp: p.areas.builtUpSqft, superBuiltUp: p.areas.superBuiltUpSqft },
      floor: formatFloor(p.floor),
      possession: p.possession,
      entranceFaces: directionWord(p.entranceFacing),
      rooms: bundle.rooms.map((r) => r.name),
      ...priceSummary(tc, bundle, state),
      highlights: p.highlights,
      sampleData: 'Sample listing for this demo',
    },
    input.tone ?? 'warm',
  );
}
