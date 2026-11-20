import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Armchair, Compass as CompassIcon, DoorOpen, Info, MousePointerClick, Sun, type LucideIcon } from 'lucide-react';
import {
  COMPASS_OVERLAYS_BY_KIND,
  COMPASS_OVERLAY_LABELS,
  DIRECTION_LABELS,
  SUN_PERIOD_LABELS,
  VASTU_NOTE,
  VASTU_RULES,
  VASTU_VERDICT_LABELS,
  bearingToDirection,
  formatClock,
  istCalendarDay,
  listText,
  resolveCompassOverlay,
  roomBearing,
  roomGetsSun,
  roomLevelOf,
  roomSunWindows,
  sunPath,
  sunPeriods,
  sunPosition,
  sunTimes,
  totalSeats,
  vastuVerdict,
  type CompassOverlay,
  type Direction,
  type PropertyBundle,
  type Room,
  type SessionAction,
  type SunPeriod,
  type SunWindow,
  type VastuVerdict,
  type ViewParams,
} from '@ave/shared';
import { Button, Chip, EmptyState, HeaderMark, cn } from '@/ui';
import { ICON_STROKE } from '@/ui/icons';
import { PlanCanvas, type PlanContext } from '@/plan/PlanCanvas';
import { RoomLabels } from '@/plan/furniture';
import { useDebounced } from '@/plan/hooks';
import { LevelSwitch, usePlanLevel } from '@/plan/levels';
import type { ViewProps } from '../types';
import { CompassRing, EntranceRay, RING, SunArc, SunDisc, SunRays, VastuDividers, VastuZones } from './drawing';
import { TimeSlider } from './TimeSlider';

const OVERLAY_ICONS: Record<CompassOverlay, LucideIcon> = { sun: Sun, vastu: CompassIcon, seating: Armchair };

/** Slider: 5-minute steps, from an hour before sunrise to an hour after sunset, ends on the half hour. */
const SLIDER_STEP_MIN = 5;
const SLIDER_PAD_MIN = 60;
const SLIDER_SNAP_MIN = 30;
/** Slider moves are shared with the call after this much quiet. */
const SLIDER_DISPATCH_MS = 120;
/** Stop waiting for the server to echo a slider value after this long. */
const ECHO_TIMEOUT_MS = 1500;

const VERDICT_FILL: Record<VastuVerdict, string> = { ideal: 'fill-mint/35', acceptable: 'fill-sun/35', avoid: 'fill-coral/30' };
const VERDICT_TAG: Record<VastuVerdict, string> = {
  ideal: 'bg-mint-tint text-mint-deep',
  acceptable: 'bg-sun-tint text-sun-deep',
  avoid: 'bg-coral-tint text-coral-deep',
};

const dayFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

interface RoomSun {
  room: Room;
  bearing: number;
  direction: Direction;
  windows: SunWindow[];
  periods: SunPeriod[];
  vastu: VastuVerdict | null;
}

/** Compass view: sunlight through the day, Vastu zones for homes and seating for offices. */
export default function CompassView({ state, bundle, dispatch }: ViewProps) {
  if (!bundle) {
    return (
      <EmptyState
        title="Pick a property to see its sunlight"
        body="Sunlight, directions and seating open for whichever property is on screen."
        actions={
          <Button variant="secondary" onClick={() => dispatch({ type: 'set_view', view: 'shortlist' })}>
            Show the shortlist
          </Button>
        }
      />
    );
  }
  return <Compass key={bundle.property.id} bundle={bundle} params={state.params.compass} dispatch={dispatch} />;
}

/**
 * The slider's value: the local value while the buyer drags (so the plan follows the thumb at once),
 * otherwise the session's. Local moves are shared after a short pause; echoes of older values are
 * ignored until the latest one comes back, so the thumb never jumps backwards.
 */
function useSyncedMinutes(remote: number, send: (m: number) => void) {
  const [local, setLocal] = useState<number | null>(null);
  const dragging = useRef(false);
  const awaiting = useRef<number | null>(null);
  const echoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteRef = useRef(remote);
  remoteRef.current = remote;

  const share = useDebounced((m: number) => {
    if (m === remoteRef.current) {
      if (!dragging.current) setLocal(null);
      return;
    }
    awaiting.current = m;
    if (echoTimer.current) clearTimeout(echoTimer.current);
    echoTimer.current = setTimeout(() => {
      awaiting.current = null;
      if (!dragging.current) setLocal(null);
    }, ECHO_TIMEOUT_MS);
    send(m);
  }, SLIDER_DISPATCH_MS);

  useEffect(() => {
    if (awaiting.current !== null && remote !== awaiting.current) return;
    awaiting.current = null;
    if (!dragging.current) setLocal(null);
  }, [remote]);

  useEffect(
    () => () => {
      if (echoTimer.current) clearTimeout(echoTimer.current);
    },
    [],
  );

  return {
    value: local ?? remote,
    change: (m: number) => {
      setLocal(m);
      share.call(m);
    },
    setDragging: (d: boolean) => {
      dragging.current = d;
      if (!d) share.flush();
    },
  };
}

function Compass({ bundle, params, dispatch }: { bundle: PropertyBundle; params: ViewParams['compass']; dispatch: (a: SessionAction) => void }) {
  const { property, rooms, plan } = bundle;
  const north = property.northOffsetDeg;
  const day = useMemo(() => istCalendarDay(new Date()), []);
  const times = useMemo(() => sunTimes(property, day), [property, day]);
  const path = useMemo(() => sunPath(property, day), [property, day]);
  const overlays = COMPASS_OVERLAYS_BY_KIND[property.kind];
  const overlay = resolveCompassOverlay(property.kind, params.overlay);

  const time = useSyncedMinutes(params.minutes, (minutes) => dispatch({ type: 'set_view', view: 'compass', params: { minutes } }));
  const minutes = time.value;
  const sun = useMemo(() => sunPosition(property, day, minutes), [property, day, minutes]);

  const info: RoomSun[] = useMemo(
    () =>
      rooms.map((room) => {
        const bearing = roomBearing(plan, room, north);
        const direction = bearingToDirection(bearing);
        const windows = roomSunWindows(property, plan, room, day);
        return { room, bearing, direction, windows, periods: sunPeriods(windows), vastu: vastuVerdict(room.kind, direction) };
      }),
    [rooms, plan, property, north, day],
  );
  const byId = useMemo(() => new Map(info.map((i) => [i.room.id, i])), [info]);
  const lit = new Set(info.filter((i) => roomGetsSun(i.bearing, sun)).map((i) => i.room.id));

  const [hover, setHover] = useState<string | null>(null);
  const selected = params.roomId && byId.has(params.roomId) ? params.roomId : null;
  const { level, setLevel, levels } = usePlanLevel(bundle, selected);
  const focusId = hover ?? selected;
  const focus = focusId ? byId.get(focusId) ?? null : null;
  const focusOnPlan = focus && roomLevelOf(focus.room) === level ? focus.room.id : null;
  const selectRoom = (id: string | null) => {
    if (id !== selected) dispatch({ type: 'set_view', view: 'compass', params: { roomId: id } });
  };

  const sliderMin = Math.max(0, Math.floor((times.sunriseMin - SLIDER_PAD_MIN) / SLIDER_SNAP_MIN) * SLIDER_SNAP_MIN);
  const sliderMax = Math.min(24 * 60 - SLIDER_STEP_MIN, Math.ceil((times.sunsetMin + SLIDER_PAD_MIN) / SLIDER_SNAP_MIN) * SLIDER_SNAP_MIN);

  const roomFill = (room: Room, ctx: PlanContext) => {
    const i = byId.get(room.id);
    if (!i) return undefined;
    if (overlay === 'sun') return lit.has(room.id) ? 'fill-sun/45' : undefined;
    if (overlay === 'vastu') return i.vastu ? VERDICT_FILL[i.vastu] : undefined;
    return (room.seats ?? 0) > 0 ? (ctx.imageLoaded ? 'fill-sun-tint/70' : 'fill-sun-tint') : undefined;
  };

  const note = (room: Room): string | null => {
    const i = byId.get(room.id);
    if (!i) return null;
    if (overlay === 'sun') return lit.has(room.id) ? 'In sun' : null;
    if (overlay === 'vastu') return i.vastu ? `${i.direction} · ${VASTU_VERDICT_LABELS[i.vastu]}` : i.direction;
    return room.seats ? `${room.seats} ${room.seats === 1 ? 'seat' : 'seats'}` : null;
  };

  const title = overlays.map((o) => COMPASS_OVERLAY_LABELS[o]).join(' & ');

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-5 pb-3 pt-4">
        <HeaderMark accent="sun" icon={Sun} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl font-bold leading-tight">{title}</h2>
          <p className="truncate text-sm text-ink-soft tabular">
            {dayFormat.format(day)} · Sunrise {formatClock(times.sunriseMin)} · Sunset {formatClock(times.sunsetMin)}
          </p>
        </div>
        <div role="group" aria-label="Overlay" className="flex shrink-0 gap-2">
          {overlays.map((o) => (
            <Chip
              key={o}
              label={COMPASS_OVERLAY_LABELS[o]}
              icon={OVERLAY_ICONS[o]}
              accent="sun"
              selected={overlay === o}
              onClick={() => overlay !== o && dispatch({ type: 'set_view', view: 'compass', params: { overlay: o } })}
            />
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 px-5 pb-5">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-canvas">
          <div className="relative min-h-0 flex-1">
            <PlanCanvas
              bundle={bundle}
              tint="sun"
              margin={14}
              ringPx={RING.total}
              ringGapPx={RING.gap}
              imageOpacity={0.4}
              ariaLabel={`${COMPASS_OVERLAY_LABELS[overlay]} plan of ${property.name}`}
              level={level}
              focusRoomId={focusOnPlan}
              roomFill={roomFill}
              onRoomHover={setHover}
              onRoomSelect={selectRoom}
              under={(ctx) => (
                <>
                  {overlay === 'sun' && <SunRays ctx={ctx} sun={sun} northOffsetDeg={north} litIds={lit} />}
                  {overlay === 'vastu' && <VastuDividers ctx={ctx} northOffsetDeg={north} />}
                  <EntranceRay ctx={ctx} northOffsetDeg={north} entrance={property.entranceFacing} />
                </>
              )}
              labels={(ctx) => <RoomLabels ctx={ctx} mode="name" note={note} />}
              over={(ctx) => (
                <>
                  {overlay === 'sun' && <SunArc ctx={ctx} path={path} northOffsetDeg={north} minutes={minutes} />}
                  {overlay === 'vastu' && <VastuZones ctx={ctx} northOffsetDeg={north} highlight={focus?.direction ?? null} />}
                  <CompassRing ctx={ctx} northOffsetDeg={north} entrance={property.entranceFacing} highlight={overlay === 'vastu' ? focus?.direction ?? null : null} />
                  {overlay === 'sun' && <SunDisc ctx={ctx} sun={sun} northOffsetDeg={north} />}
                </>
              )}
            />
            {levels.length > 1 && (
              <div className="absolute left-4 top-4">
                <LevelSwitch levels={levels} level={level} onLevel={setLevel} accent="sun" />
              </div>
            )}
          </div>
          {overlay === 'sun' && (
            <TimeSlider
              value={minutes}
              min={sliderMin}
              max={sliderMax}
              step={SLIDER_STEP_MIN}
              sunriseMin={times.sunriseMin}
              sunsetMin={times.sunsetMin}
              onChange={time.change}
              onDragChange={time.setDragging}
            />
          )}
        </div>

        <aside className="scroll-quiet flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto pb-1 pr-1">
          {overlay === 'sun' && <SunPanel bundle={bundle} info={info} lit={lit} sunAltitude={sun.altitudeDeg} sunBearing={sun.bearingDeg} minutes={minutes} times={times} focus={focus} pinned={focusId === selected} onRoom={selectRoom} />}
          {overlay === 'vastu' && <VastuPanel bundle={bundle} info={info} focus={focus} selected={selected} onRoom={selectRoom} />}
          {overlay === 'seating' && <SeatingPanel bundle={bundle} selected={selected} onRoom={selectRoom} />}
        </aside>
      </div>
    </div>
  );
}

function Card({ eyebrow, children, raised }: { eyebrow: ReactNode; children: ReactNode; raised?: boolean }) {
  return (
    <section className={cn('rounded-[18px] border-2 border-ink bg-canvas p-4', raised && 'shadow-[var(--shadow-pop-sm)]')}>
      <p className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-sun-deep">{eyebrow}</p>
      {children}
    </section>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[13px] text-ink-soft">
      <MousePointerClick size={15} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-sun-deep" />
      {children}
    </p>
  );
}

function sideOf(d: Direction): string {
  return DIRECTION_LABELS[d].toLowerCase();
}

function windowText(w: SunWindow): string {
  return `${formatClock(w.startMin)} – ${formatClock(w.endMin)}`;
}

interface SunPanelProps {
  bundle: PropertyBundle;
  info: RoomSun[];
  lit: Set<string>;
  sunAltitude: number;
  sunBearing: number;
  minutes: number;
  times: { sunriseMin: number; sunsetMin: number };
  focus: RoomSun | null;
  pinned: boolean;
  onRoom: (id: string) => void;
}

function SunPanel({ info, lit, sunAltitude, sunBearing, minutes, times, focus, pinned, onRoom }: SunPanelProps) {
  const up = sunAltitude > 0;
  const litRooms = info.filter((i) => lit.has(i.room.id));
  return (
    <>
      <Card eyebrow={`At ${formatClock(minutes)}`}>
        {up ? (
          <p className="text-[15px] font-semibold leading-snug">
            The sun is in the {sideOf(bearingToDirection(sunBearing))}, {Math.round(sunAltitude)}° above the horizon.
          </p>
        ) : (
          <p className="text-[15px] font-semibold leading-snug">
            The sun is down. Today it rises at {formatClock(times.sunriseMin)} and sets at {formatClock(times.sunsetMin)}.
          </p>
        )}
        {up && (
          <div className="mt-3 border-t-2 border-line pt-3">
            <p className="mb-2 text-sm text-ink-soft">{litRooms.length ? 'Direct sun reaches' : 'No room catches direct sun at this hour.'}</p>
            {litRooms.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {litRooms.map((i) => (
                  <button
                    key={i.room.id}
                    type="button"
                    onClick={() => onRoom(i.room.id)}
                    className="rounded-[10px] border-2 border-ink bg-sun px-2.5 py-0.5 text-[13px] font-bold transition-transform duration-100 active:translate-y-px"
                  >
                    {i.room.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {focus ? (
        <Card eyebrow={pinned ? 'Room in focus' : 'Pointing at'} raised={pinned}>
          <h3 className="font-display text-2xl font-bold leading-tight">{focus.room.name}</h3>
          <p className="text-sm text-ink-soft">On the {sideOf(focus.direction)} side of the home</p>
          <div className="mt-3 border-t-2 border-line pt-3">
            {focus.windows.length ? (
              <>
                <p className="text-sm text-ink-soft">Direct sun today</p>
                <ul className="mt-1 space-y-0.5">
                  {focus.windows.map((w) => (
                    <li key={w.startMin} className="font-semibold tabular">
                      {windowText(w)}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {focus.periods.map((p) => (
                    <span key={p} className="rounded-[8px] bg-sun-tint px-2 py-0.5 text-xs font-bold text-ink">
                      {SUN_PERIOD_LABELS[p]}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm font-semibold">No direct sun on this side today.</p>
            )}
          </div>
        </Card>
      ) : (
        <section className="rounded-[18px] border-2 border-line bg-canvas p-4">
          <Hint>Tap a room to see when it gets direct sun.</Hint>
        </section>
      )}

      <section className="rounded-[18px] border-2 border-line bg-paper p-4 text-[13px] leading-snug text-ink-soft">
        <p className="flex gap-2">
          <Info size={15} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0" />
          Worked out from today&rsquo;s sun path over this address and the side of the home each room is on. Trees and nearby buildings are not counted.
        </p>
      </section>
    </>
  );
}

function VerdictTag({ verdict }: { verdict: VastuVerdict | null }) {
  if (!verdict) return <span className="rounded-[8px] bg-paper px-2 py-0.5 text-xs font-bold text-ink-soft">No rule</span>;
  return <span className={cn('rounded-[8px] px-2 py-0.5 text-xs font-bold', VERDICT_TAG[verdict])}>{VASTU_VERDICT_LABELS[verdict]}</span>;
}

function guidance(room: Room): string {
  const rule = VASTU_RULES[room.kind];
  const kind = room.name.toLowerCase();
  if (!rule) return `Traditional Vastu does not place a room like the ${kind}.`;
  const ideal = listText(rule.ideal.map(sideOf));
  const ok = listText(rule.acceptable.map(sideOf));
  return `Traditional guidance prefers the ${kind} in the ${ideal}${rule.acceptable.length ? `; the ${ok} are also considered fine` : ''}.`;
}

function VastuPanel({ bundle, info, focus, selected, onRoom }: { bundle: PropertyBundle; info: RoomSun[]; focus: RoomSun | null; selected: string | null; onRoom: (id: string) => void }) {
  const { property } = bundle;
  const door = vastuVerdict('entrance', property.entranceFacing);
  return (
    <>
      <Card eyebrow="Main door">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <DoorOpen size={18} strokeWidth={ICON_STROKE} aria-hidden className="text-sun-deep" />
            Faces {sideOf(property.entranceFacing)}
          </p>
          <VerdictTag verdict={door} />
        </div>
      </Card>

      <Card eyebrow="Rooms by direction">
        <ul className="-mx-2">
          {info.map((i) => (
            <li key={i.room.id}>
              <button
                type="button"
                onClick={() => onRoom(i.room.id)}
                aria-pressed={selected === i.room.id}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-sm transition-colors duration-100',
                  focus?.room.id === i.room.id ? 'bg-sun-tint' : 'hover:bg-paper',
                )}
              >
                <span className="min-w-0 flex-1 truncate font-semibold">{i.room.name}</span>
                <span className="w-7 shrink-0 text-center text-xs font-bold text-ink-soft">{i.direction}</span>
                <VerdictTag verdict={i.vastu} />
              </button>
            </li>
          ))}
        </ul>
        {focus && <p className="mt-2 border-t-2 border-line pt-2 text-[13px] leading-snug">{guidance(focus.room)}</p>}
      </Card>

      <section className="rounded-[18px] border-2 border-line bg-paper p-4 text-[13px] leading-snug text-ink-soft">
        <p className="flex gap-2">
          <Info size={15} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0" />
          {VASTU_NOTE}
        </p>
      </section>
    </>
  );
}

function SeatingPanel({ bundle, selected, onRoom }: { bundle: PropertyBundle; selected: string | null; onRoom: (id: string) => void }) {
  const seated = bundle.rooms.filter((r) => (r.seats ?? 0) > 0);
  const total = totalSeats(bundle.rooms);
  return (
    <>
      <Card eyebrow="Seating">
        {total > 0 ? (
          <>
            <p className="font-display text-4xl font-bold leading-none tabular">{total}</p>
            <p className="mt-1 text-sm text-ink-soft">
              desk {total === 1 ? 'seat' : 'seats'} across {seated.length} {seated.length === 1 ? 'room' : 'rooms'}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-soft">Seat counts have not been set for this office yet.</p>
        )}
      </Card>
      {seated.length > 0 && (
        <Card eyebrow="By room">
          <ul className="-mx-2">
            {seated.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onRoom(r.id)}
                  aria-pressed={selected === r.id}
                  className={cn('flex w-full items-center justify-between gap-3 rounded-[10px] px-2 py-1.5 text-left text-sm', selected === r.id ? 'bg-sun-tint font-bold' : 'hover:bg-paper')}
                >
                  <span className="truncate font-semibold">{r.name}</span>
                  <span className="shrink-0 font-bold tabular">{r.seats}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <section className="rounded-[18px] border-2 border-line bg-canvas p-4">
        <Hint>Tap a room to see its seats on the plan.</Hint>
      </section>
    </>
  );
}

