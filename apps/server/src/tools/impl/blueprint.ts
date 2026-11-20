import {
  BLUEPRINT_LAYER_LABELS,
  planTotals,
  resolveRoomId,
  roomFacts,
  roomFactsSentence,
  wetRoomIds,
  type PropertyBundle,
  type ToolInput,
  type ToolResult,
} from '@ave/shared';
import type { ToolContext } from '../context.js';
import { dispatch, fail, findRoom, listNames, ok, resolveProperty } from '../kit.js';

const PLAN_NOTE = 'Indicative layout';

function roomNameOf(bundle: PropertyBundle, roomId: string | null): string | null {
  return roomId ? bundle.rooms.find((r) => r.id === roomId)?.name ?? null : null;
}

export function showBlueprint(tc: ToolContext, input: ToolInput<'showBlueprint'>): ToolResult {
  const roomQuery = input.room;
  const r = resolveProperty(tc, roomQuery ? (b) => Boolean(findRoom(b, roomQuery)) : undefined);
  if (!r.bundle) return r.result;
  const bundle = r.bundle;
  const { plan, rooms } = bundle;
  const room = input.room ? findRoom(bundle, input.room) : null;

  dispatch(tc, { type: 'set_view', view: 'blueprint', params: { layer: input.layer, roomId: room?.id ?? null } });
  if (input.room && !room) {
    return fail(
      tc,
      `There is no "${input.room}" on this plan; the whole ${BLUEPRINT_LAYER_LABELS[input.layer].toLowerCase()} layer is showing.`,
      `Offer one of: ${listNames(rooms)}.`,
    );
  }

  const expression = input.tone ?? 'pointing';
  const base = { layer: BLUEPRINT_LAYER_LABELS[input.layer], note: PLAN_NOTE };

  if (input.layer === 'layout') {
    return ok(
      tc,
      room
        ? { ...base, room: room.name, areaSqft: room.areaSqft, features: room.features }
        : { ...base, carpetSqft: bundle.property.areas.carpetSqft, rooms: rooms.map((x) => ({ name: x.name, areaSqft: x.areaSqft })) },
      expression,
    );
  }

  if (room) {
    const facts = roomFacts(plan, room, rooms);
    const counted = input.layer === 'electrical' ? facts.electrical : facts.plumbing;
    return ok(tc, { ...base, room: room.name, summary: roomFactsSentence(facts, input.layer), counts: counted.map((c) => c.text) }, expression);
  }

  const totals = planTotals(plan);
  if (input.layer === 'electrical') {
    const db = plan.electrical.points.find((p) => p.kind === 'db');
    return ok(
      tc,
      {
        ...base,
        counts: totals.electrical.map((c) => c.text),
        circuits: plan.electrical.circuits.length,
        distributionBoardIn: db ? roomNameOf(bundle, resolveRoomId(db, rooms)) : null,
      },
      expression,
    );
  }

  const shaft = plan.plumbing.fixtures.find((f) => f.kind === 'shaft');
  const lines = plan.plumbing.lines;
  return ok(
    tc,
    {
      ...base,
      counts: totals.plumbing.map((c) => c.text),
      wetRooms: wetRoomIds(plan, rooms).map((id) => roomNameOf(bundle, id)),
      shaftIn: shaft ? roomNameOf(bundle, resolveRoomId(shaft, rooms)) : null,
      lines: { cold: lines.filter((l) => l.kind === 'cold').length, hot: lines.filter((l) => l.kind === 'hot').length, drain: lines.filter((l) => l.kind === 'drain').length },
    },
    expression,
  );
}
