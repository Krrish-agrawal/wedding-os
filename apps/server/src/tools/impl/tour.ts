import type { PropertyBundle, ToolInput, ToolResult } from '@ave/shared';
import type { ToolContext } from '../context.js';
import { dispatch, fail, findStop, listNames, ok, resolveProperty, stateOf } from '../kit.js';

const OVERVIEW_WORDS = /\b(overview|whole|entire|everything|all of it|full|top view|bird)\b/i;
const MAX_ROOM_FEATURES = 3;

/** With no property open, open the one whose rooms match the query, if exactly one does. */
function propertyForStop(tc: ToolContext, query: string): { bundle: PropertyBundle } | { result: ToolResult } {
  const state = stateOf(tc);
  if (!state.propertyId) {
    const matches = tc.app.content.properties.filter((b) => findStop(b, query));
    if (matches.length === 1) {
      dispatch(tc, { type: 'set_property', propertyId: matches[0]!.property.id });
      return { bundle: matches[0]! };
    }
  }
  const r = resolveProperty(tc);
  return r.bundle ? { bundle: r.bundle } : { result: r.result };
}

export function tourGoTo(tc: ToolContext, input: ToolInput<'tourGoTo'>): ToolResult {
  const resolved = propertyForStop(tc, input.stop);
  if ('result' in resolved) return resolved.result;
  const { bundle } = resolved;
  const stops = bundle.tour.stops;

  if (OVERVIEW_WORDS.test(input.stop)) {
    dispatch(tc, { type: 'set_view', view: 'tour', params: { stopId: null, mode: 'step' } });
    return ok(
      tc,
      { stop: 'Overview', rooms: bundle.rooms.map((r) => r.name), carpetSqft: bundle.property.areas.carpetSqft, firstStop: stops[0]?.label ?? null },
      input.tone ?? 'pointing',
    );
  }

  const stop = findStop(bundle, input.stop);
  if (!stop) {
    const elsewhere = tc.app.content.properties.filter((b) => b !== bundle).map((b) => ({ b, s: findStop(b, input.stop) })).find((x) => x.s);
    const also = elsewhere?.s ? ` ${elsewhere.b.property.name} has a ${elsewhere.s.label}; offer to open it.` : '';
    return fail(
      tc,
      `There is no "${input.stop}" in ${bundle.property.name}.`,
      `Say so plainly and offer one of these instead: ${listNames(stops)}.${also}`,
    );
  }

  dispatch(tc, { type: 'set_view', view: 'tour', params: { stopId: stop.id, mode: 'step' } });
  const room = bundle.rooms.find((r) => r.id === stop.roomId);
  const index = stops.indexOf(stop);
  return ok(
    tc,
    {
      stop: stop.label,
      room: room ? { name: room.name, areaSqft: room.areaSqft, features: room.features.slice(0, MAX_ROOM_FEATURES), ...(room.seats !== undefined ? { seats: room.seats } : {}) } : null,
      facts: stop.facts,
      nextStop: stops[index + 1]?.label ?? null,
    },
    input.tone ?? 'pointing',
  );
}

export function tourWalkthrough(tc: ToolContext, input: ToolInput<'tourWalkthrough'>): ToolResult {
  const r = resolveProperty(tc);
  if (!r.bundle) return r.result;
  if (input.action === 'start') {
    dispatch(tc, { type: 'set_view', view: 'tour', params: { stopId: null, mode: 'walkthrough' } });
    return ok(tc, { mode: 'walkthrough', stops: r.bundle.tour.stops.map((s) => s.label) }, input.tone ?? 'warm');
  }
  dispatch(tc, { type: 'set_view', view: 'tour', params: { mode: 'step' } });
  return ok(tc, { mode: 'step' }, input.tone ?? 'attentive');
}
