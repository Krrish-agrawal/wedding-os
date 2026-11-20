import {
  VASTU_NOTE,
  VASTU_VERDICT_LABELS,
  bearingToDirection,
  formatClock,
  istCalendarDay,
  resolveCompassOverlay,
  roomBearing,
  roomGetsSun,
  roomSunWindows,
  sunPeriods,
  sunPosition,
  sunTimes,
  totalSeats,
  vastuVerdict,
  type CompassOverlay,
  type PropertyBundle,
  type Room,
  type ToolInput,
  type ToolResult,
} from '@ave/shared';
import type { ToolContext } from '../context.js';
import { directionWord, parseClock } from '../format.js';
import { dispatch, fail, findRoom, isLease, isSale, listNames, ok, resolveProperty, stateOf } from '../kit.js';

const MAX_VASTU_ROOMS = 8;
const SUN_NOTE = 'Direct sun is an estimate from the sun path and the side of the home each room is on.';
const OVERLAY_NAMES: Record<CompassOverlay, string> = { sun: 'Sunlight', vastu: 'Vastu', seating: 'Seating' };

function vastuText(room: Room, bearing: number): string {
  const verdict = vastuVerdict(room.kind, bearingToDirection(bearing));
  return verdict ? VASTU_VERDICT_LABELS[verdict] : 'No traditional rule for this room type';
}

export function showCompass(tc: ToolContext, input: ToolInput<'showCompass'>): ToolResult {
  // With nothing open yet, an overlay or a room name can tell which property is meant.
  const byOverlay = input.overlay === 'seating' ? isLease : input.overlay === 'vastu' ? isSale : null;
  const roomQuery = input.room;
  const prefer = byOverlay || roomQuery ? (b: PropertyBundle) => (!byOverlay || byOverlay(b)) && (!roomQuery || Boolean(findRoom(b, roomQuery))) : undefined;
  const r = resolveProperty(tc, prefer);
  if (!r.bundle) return r.result;
  const bundle = r.bundle;
  const { property, plan } = bundle;
  const state = stateOf(tc);

  const wanted: CompassOverlay = input.overlay ?? (state.view === 'compass' ? state.params.compass.overlay : 'sun');
  const overlay = resolveCompassOverlay(property.kind, wanted);
  const swapped = overlay !== wanted ? `${OVERLAY_NAMES[wanted]} does not apply here, so the plan shows ${OVERLAY_NAMES[overlay].toLowerCase()} instead.` : null;

  const day = istCalendarDay(new Date(tc.deps.now()));
  const times = sunTimes(property, day);
  let minutes = state.params.compass.minutes;
  if (input.time) {
    const parsed = parseClock(input.time, { sunrise: times.sunriseMin, sunset: times.sunsetMin });
    if (parsed === null) return fail(tc, `I could not read "${input.time}" as a time.`, 'Ask for a time like 7:30 AM or 5 PM.', 'attentive');
    minutes = parsed;
  }
  const room = input.room ? findRoom(bundle, input.room) : null;
  dispatch(tc, { type: 'set_view', view: 'compass', params: { minutes, overlay, roomId: room?.id ?? null } });
  if (input.room && !room) {
    return fail(tc, `There is no "${input.room}" in ${property.name}; the whole plan is showing.`, `Offer one of: ${listNames(bundle.rooms)}.`);
  }

  const sun = sunPosition(property, day, minutes);
  const bearings = bundle.rooms.map((x) => ({ room: x, bearing: roomBearing(plan, x, property.northOffsetDeg) }));
  const base = {
    overlay: OVERLAY_NAMES[overlay],
    time: formatClock(minutes),
    sunrise: formatClock(times.sunriseMin),
    sunset: formatClock(times.sunsetMin),
    sun: sun.altitudeDeg > 0 ? `in the ${directionWord(bearingToDirection(sun.bearingDeg))}, ${Math.round(sun.altitudeDeg)} degrees up` : 'below the horizon',
    entranceFaces: directionWord(property.entranceFacing),
    roomsInDirectSun: bearings.filter((b) => roomGetsSun(b.bearing, sun)).map((b) => b.room.name),
    ...(swapped ? { swapped } : {}),
  };

  let roomData: Record<string, unknown> | undefined;
  if (room) {
    const bearing = bearings.find((b) => b.room.id === room.id)!.bearing;
    const windows = roomSunWindows(property, plan, room, day);
    roomData = {
      name: room.name,
      sideOfHome: directionWord(bearingToDirection(bearing)),
      directSunNow: roomGetsSun(bearing, sun),
      directSun: windows.length ? windows.map((w) => `${formatClock(w.startMin)} to ${formatClock(w.endMin)}`) : 'none during the day',
      sunPeriods: sunPeriods(windows),
      ...(overlay === 'vastu' ? { vastu: vastuText(room, bearing) } : {}),
      ...(room.seats !== undefined ? { seats: room.seats } : {}),
    };
  }

  const expression = input.tone ?? 'composed';
  switch (overlay) {
    case 'seating': {
      const seated = bundle.rooms.filter((x) => (x.seats ?? 0) > 0);
      return ok(
        tc,
        {
          ...base,
          totalSeats: seated.length ? totalSeats(bundle.rooms) : bundle.money.kind === 'lease' ? bundle.money.seats : null,
          seatsByRoom: seated.map((x) => ({ name: x.name, seats: x.seats })),
          ...(roomData ? { room: roomData } : {}),
          note: SUN_NOTE,
        },
        expression,
      );
    }
    case 'vastu':
      return ok(
        tc,
        {
          ...base,
          ...(roomData
            ? { room: roomData }
            : {
                rooms: bearings
                  .filter((b) => vastuVerdict(b.room.kind, bearingToDirection(b.bearing)))
                  .slice(0, MAX_VASTU_ROOMS)
                  .map((b) => ({ room: b.room.name, side: directionWord(bearingToDirection(b.bearing)), verdict: vastuText(b.room, b.bearing) })),
              }),
          note: VASTU_NOTE,
        },
        expression,
      );
    default:
      return ok(tc, { ...base, ...(roomData ? { room: roomData } : {}), note: SUN_NOTE }, expression);
  }
}
