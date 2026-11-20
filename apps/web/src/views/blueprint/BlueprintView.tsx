import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Droplets, MousePointerClick, Ruler, Zap, type LucideIcon } from 'lucide-react';
import {
  BLUEPRINT_LAYERS,
  VIEW_LABELS,
  BLUEPRINT_LAYER_LABELS,
  ELECTRICAL_FACT_ORDER,
  ELECTRICAL_KIND_LABELS,
  PLUMBING_FACT_ORDER,
  PLUMBING_KIND_LABELS,
  PLUMBING_LINE_LABELS,
  formatSqft,
  listText,
  planTotals,
  roomDimensions,
  roomFacts,
  roomsBounds,
  roomLevelOf,
  wetRoomIds,
  type BlueprintLayer,
  type PlumbingLineKind,
  type PropertyBundle,
  type Room,
  type RoomFacts,
  type SessionAction,
} from '@ave/shared';
import { Button, Chip, EmptyState, HeaderMark, Sticker, cn } from '@/ui';
import { ICON_STROKE } from '@/ui/icons';
import { PlanCanvas, type PlanContext } from '@/plan/PlanCanvas';
import { NorthArrow, OverallDimensions, RoomLabels, ScaleBar } from '@/plan/furniture';
import { WIDE_PLAN_ASPECT, useDebounced } from '@/plan/hooks';
import { LevelSwitch, preloadAllPlanImages, usePlanLevel } from '@/plan/levels';
import { registerCallPreloader } from '@/call/preload';
import { ElectricalGlyph, PlumbingGlyph, RunSwatch, SWATCH_GLYPH, Swatch } from '@/plan/symbols';
import type { ViewProps } from '../types';
import { ElectricalLayer, PlumbingLayer } from './layers';

// The Blueprint and Compass views draw over the plan renders: fetch them while the call rings.
registerCallPreloader('plans', preloadAllPlanImages);

const LAYER_ICONS: Record<BlueprintLayer, LucideIcon> = { layout: Ruler, electrical: Zap, plumbing: Droplets };
/** How long the pointer rests on a room before the focus is shared with the call. */
const HOVER_DWELL_MS = 450;
const LAYER_FADE = 'transition-opacity duration-300 ease-[var(--ease-snap)]';
const RUN_KINDS: readonly PlumbingLineKind[] = ['cold', 'hot', 'drain'];

/** Blueprint view: the 2D plan with layout, electrical and plumbing layers and a room focus. */
export default function BlueprintView({ state, bundle, dispatch }: ViewProps) {
  if (!bundle) {
    return (
      <EmptyState
        title="Pick a property to see its plans"
        body="The layout, wiring and plumbing open for whichever property is on screen."
        actions={
          <Button variant="secondary" onClick={() => dispatch({ type: 'set_view', view: 'shortlist' })}>
            Show the shortlist
          </Button>
        }
      />
    );
  }
  return <Blueprint key={bundle.property.id} bundle={bundle} layer={state.params.blueprint.layer} roomId={state.params.blueprint.roomId} dispatch={dispatch} />;
}

function Blueprint({ bundle, layer, roomId, dispatch }: { bundle: PropertyBundle; layer: BlueprintLayer; roomId: string | null; dispatch: (a: SessionAction) => void }) {
  const { property, rooms, plan } = bundle;
  const [hoverRoom, setHoverRoom] = useState<string | null>(null);
  const [hoverCircuit, setHoverCircuit] = useState<string | null>(null);
  const [hoverRun, setHoverRun] = useState<PlumbingLineKind | null>(null);
  const selected = roomId && rooms.some((r) => r.id === roomId) ? roomId : null;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const setRoom = (id: string | null) => {
    if (id !== selectedRef.current) dispatch({ type: 'set_view', view: 'blueprint', params: { roomId: id } });
  };
  const dwell = useDebounced(setRoom, HOVER_DWELL_MS);

  const { level, setLevel, levels } = usePlanLevel(bundle, selected);
  const focusId = hoverRoom ?? selected;
  const focusCandidate = focusId ? rooms.find((r) => r.id === focusId) ?? null : null;
  // A room on another level stays selected but is not shown until its level is.
  const focusRoom = focusCandidate && roomLevelOf(focusCandidate) === level ? focusCandidate : null;
  const facts = useMemo(() => (focusRoom ? roomFacts(plan, focusRoom, rooms) : null), [plan, focusRoom, rooms]);
  const wetIds = useMemo(() => new Set(wetRoomIds(plan, rooms)), [plan, rooms]);
  const wide = useMemo(() => {
    const b = roomsBounds(rooms);
    return (b.maxX - b.minX) / Math.max(b.maxZ - b.minZ, 1e-6) >= WIDE_PLAN_ASPECT;
  }, [rooms]);
  const cell = wide ? 'scroll-quiet min-h-0 overflow-y-auto' : undefined;

  const roomFill = (room: Room, ctx: PlanContext) => {
    if (room.id === focusId) return 'fill-grape-tint/80';
    if (layer === 'plumbing' && wetIds.has(room.id)) return ctx.imageLoaded ? 'fill-blue-tint/50' : 'fill-blue-tint/70';
    return undefined;
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-5 pb-3 pt-4">
        <HeaderMark accent="grape" icon={Zap} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl font-bold leading-tight">{VIEW_LABELS.blueprint}</h2>
          <p className="truncate text-sm text-ink-soft">
            {property.name} · {property.configuration}
          </p>
        </div>
        <div role="group" aria-label="Plan layer" className="flex shrink-0 gap-2">
          {BLUEPRINT_LAYERS.map((l) => (
            <Chip
              key={l}
              label={BLUEPRINT_LAYER_LABELS[l]}
              icon={LAYER_ICONS[l]}
              accent="grape"
              selected={layer === l}
              onClick={() => layer !== l && dispatch({ type: 'set_view', view: 'blueprint', params: { layer: l } })}
            />
          ))}
        </div>
      </header>

      <div className={cn('flex min-h-0 flex-1 gap-4 px-5 pb-5', wide && 'flex-col')}>
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-canvas">
          <PlanCanvas
            bundle={bundle}
            tint="grape"
            ariaLabel={`${BLUEPRINT_LAYER_LABELS[layer]} plan of ${property.name}`}
            level={level}
            focusRoomId={focusRoom?.id ?? null}
            imageOpacity={layer === 'layout' ? 0.55 : 0.32}
            roomFill={roomFill}
            onRoomHover={(id) => {
              setHoverRoom(id);
              if (id) dwell.call(id);
              else dwell.cancel();
            }}
            onRoomSelect={(id) => {
              dwell.cancel();
              setRoom(id);
            }}
            labels={(ctx) => (
              <>
                <g className={cn(LAYER_FADE, layer === 'layout' ? 'opacity-100' : 'opacity-0')}>
                  <OverallDimensions ctx={ctx} />
                  <RoomLabels ctx={ctx} mode="full" />
                </g>
                <g className={cn(LAYER_FADE, layer === 'layout' ? 'opacity-0' : 'opacity-100')}>
                  <RoomLabels ctx={ctx} mode="corner" />
                </g>
              </>
            )}
            over={(ctx) => (
              <>
                <NorthArrow x={ctx.proj.width - 40} y={44} northOffsetDeg={property.northOffsetDeg} />
                <ScaleBar right={ctx.proj.width - 20} bottom={ctx.proj.height - 16} scale={ctx.proj.scale} />
              </>
            )}
          >
            {(ctx) => (
              <>
                <g className={cn(LAYER_FADE, layer === 'electrical' ? 'opacity-100' : 'opacity-0')}>
                  <ElectricalLayer ctx={ctx} plan={plan} highlightCircuitId={hoverCircuit} />
                </g>
                <g className={cn(LAYER_FADE, layer === 'plumbing' ? 'opacity-100' : 'opacity-0')}>
                  <PlumbingLayer ctx={ctx} plan={plan} highlightKind={hoverRun} />
                </g>
              </>
            )}
          </PlanCanvas>
          {levels.length > 1 && (
            <div className="absolute left-4 top-4">
              <LevelSwitch levels={levels} level={level} onLevel={setLevel} accent="grape" />
            </div>
          )}
          <div className="pointer-events-none absolute bottom-4 left-4">
            <Sticker tone="grape" size="sm">
              Indicative layout
            </Sticker>
          </div>
        </div>

        <aside className={wide ? 'grid h-[208px] shrink-0 grid-cols-2 gap-4' : 'scroll-quiet flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto pb-1 pr-1'}>
          <div className={cell}>
            {focusRoom && facts ? (
              <RoomCard room={focusRoom} facts={facts} layer={layer} bundle={bundle} wetIds={wetIds} pinned={focusRoom.id === selected} />
            ) : (
              <WholeHomeCard bundle={bundle} layer={layer} />
            )}
          </div>
          <div className={cell}>
          <LegendCard
            bundle={bundle}
            layer={layer}
            selectedRoomId={selected}
            onRoom={(id) => setRoom(id)}
            onCircuit={setHoverCircuit}
            onRun={setHoverRun}
            highlightCircuitId={hoverCircuit}
          />
          </div>
        </aside>
      </div>
    </div>
  );
}

function SideCard({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-[18px] border-2 border-ink bg-canvas p-4', className)}>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-ink-soft">{title}</h3>
      {children}
    </section>
  );
}

function CountRow({ glyph, text }: { glyph: ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-2.5 py-1">
      <Swatch>{glyph}</Swatch>
      <span className="text-sm font-semibold tabular">{text}</span>
    </li>
  );
}

function RoomCard({ room, facts, layer, bundle, wetIds, pinned }: { room: Room; facts: RoomFacts; layer: BlueprintLayer; bundle: PropertyBundle; wetIds: Set<string>; pinned: boolean }) {
  const dims = roomDimensions(room.polygon);
  const electrical = facts.electrical;
  const plumbing = facts.plumbing;
  const runs = RUN_KINDS.filter((k) => facts.lines[k]);
  const wetNames = bundle.rooms.filter((r) => wetIds.has(r.id)).map((r) => r.name.toLowerCase());

  return (
    <section className={cn('rounded-[18px] border-2 border-ink bg-canvas p-4', pinned && 'shadow-[var(--shadow-pop-sm)]')} aria-live="polite">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-grape-deep">{pinned ? 'Room in focus' : 'Pointing at'}</p>
      <h3 className="mt-1 font-display text-2xl font-bold leading-tight">{room.name}</h3>
      <p className="mt-0.5 text-sm text-ink-soft tabular">
        {formatSqft(room.areaSqft)}
        {dims ? ` · ${dims}` : ''}
      </p>

      <div className="mt-3 border-t-2 border-line pt-3">
        {layer === 'layout' &&
          (room.features.length ? (
            <ul className="space-y-1.5 text-sm">
              {room.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-grape" />
                  {f}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">No special features listed for this room.</p>
          ))}

        {layer === 'electrical' &&
          (electrical.length ? (
            <ul>
              {electrical.map((c) => (
                <CountRow key={c.kind} glyph={<ElectricalGlyph kind={c.kind} s={SWATCH_GLYPH} />} text={c.text} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">No electrical points are marked in this room.</p>
          ))}

        {layer === 'plumbing' &&
          (plumbing.length || runs.length ? (
            <>
              <ul>
                {plumbing.map((c) => (
                  <CountRow key={c.kind} glyph={<PlumbingGlyph kind={c.kind} s={SWATCH_GLYPH} />} text={c.text} />
                ))}
              </ul>
              {runs.length > 0 && (
                <ul className={cn(plumbing.length > 0 && 'mt-2 border-t-2 border-line pt-2')}>
                  {runs.map((k) => (
                    <li key={k} className="flex items-center gap-2.5 py-1">
                      <RunSwatch kind={k} />
                      <span className="text-sm font-semibold">{PLUMBING_LINE_LABELS[k]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-soft">
              No plumbing in this room.
              {wetNames.length ? ` Water points are in the ${listText(wetNames)}.` : ''}
            </p>
          ))}
      </div>
    </section>
  );
}

function WholeHomeCard({ bundle, layer }: { bundle: PropertyBundle; layer: BlueprintLayer }) {
  const { property, rooms, plan } = bundle;
  const totals = useMemo(() => planTotals(plan), [plan]);
  const homeWord = property.kind === 'lease' ? 'Whole office' : 'Whole home';
  return (
    <section className="rounded-[18px] border-2 border-ink bg-canvas p-4">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-grape-deep">{homeWord}</p>
      <h3 className="mt-1 font-display text-2xl font-bold leading-tight tabular">{formatSqft(property.areas.carpetSqft)}</h3>
      <p className="text-sm text-ink-soft">
        Carpet area · {rooms.length} {rooms.length === 1 ? 'space' : 'spaces'}
      </p>
      {layer !== 'layout' && (
        <ul className="mt-3 border-t-2 border-line pt-2">
          {layer === 'electrical' &&
            totals.electrical.map((c) => <CountRow key={c.kind} glyph={<ElectricalGlyph kind={c.kind} s={SWATCH_GLYPH} />} text={c.text} />)}
          {layer === 'plumbing' && totals.plumbing.map((c) => <CountRow key={c.kind} glyph={<PlumbingGlyph kind={c.kind} s={SWATCH_GLYPH} />} text={c.text} />)}
          {layer === 'electrical' && totals.electrical.length === 0 && <li className="py-1 text-sm text-ink-soft">No electrical points are marked on this plan.</li>}
          {layer === 'plumbing' && totals.plumbing.length === 0 && (
            <li className="py-1 text-sm font-semibold">There are no water points inside this {property.kind === 'lease' ? 'office' : 'home'}.</li>
          )}
        </ul>
      )}
      <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-soft">
        <MousePointerClick size={15} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-grape" />
        Point at a room to see what it has.
      </p>
    </section>
  );
}

interface LegendProps {
  bundle: PropertyBundle;
  layer: BlueprintLayer;
  selectedRoomId: string | null;
  highlightCircuitId: string | null;
  onRoom: (id: string) => void;
  onCircuit: (id: string | null) => void;
  onRun: (k: PlumbingLineKind | null) => void;
}

function LegendCard({ bundle, layer, selectedRoomId, highlightCircuitId, onRoom, onCircuit, onRun }: LegendProps) {
  const { rooms, plan } = bundle;

  if (layer === 'layout') {
    return (
      <SideCard title="Rooms">
        <ul className="-mx-2">
          {rooms.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onRoom(r.id)}
                aria-pressed={selectedRoomId === r.id}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-[10px] px-2 py-1.5 text-left text-sm transition-colors duration-100',
                  selectedRoomId === r.id ? 'bg-grape-tint font-bold' : 'hover:bg-paper',
                )}
              >
                <span className="truncate font-semibold">{r.name}</span>
                <span className="shrink-0 text-ink-soft tabular">{formatSqft(r.areaSqft)}</span>
              </button>
            </li>
          ))}
        </ul>
      </SideCard>
    );
  }

  if (layer === 'electrical') {
    const kinds = ELECTRICAL_FACT_ORDER.filter((k) => plan.electrical.points.some((p) => p.kind === k));
    return (
      <SideCard title="Legend">
        {kinds.length === 0 && plan.electrical.circuits.length === 0 ? (
          <p className="text-sm text-ink-soft">No electrical points are marked on this plan.</p>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-y-0.5">
              {kinds.map((k) => (
                <li key={k} className="flex items-center gap-2.5 py-0.5 text-sm">
                  <Swatch>
                    <ElectricalGlyph kind={k} s={SWATCH_GLYPH} />
                  </Swatch>
                  {ELECTRICAL_KIND_LABELS[k].legend}
                </li>
              ))}
              {plan.electrical.circuits.length > 0 && (
                <li className="flex items-center gap-2.5 py-0.5 text-sm">
                  <RunSwatch kind="circuit" />
                  Circuit run
                </li>
              )}
            </ul>
            {plan.electrical.circuits.length > 0 && (
              <div className="mt-3 border-t-2 border-line pt-2">
                <p className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-ink-soft">Circuits</p>
                <ul className="-mx-2" onPointerLeave={() => onCircuit(null)}>
                  {plan.electrical.circuits.map((c) => (
                    <li
                      key={c.id}
                      onPointerEnter={() => onCircuit(c.id)}
                      className={cn('flex items-center justify-between gap-2 rounded-[10px] px-2 py-1 text-sm', highlightCircuitId === c.id && 'bg-grape-tint')}
                    >
                      <span className="truncate font-semibold">{c.name}</span>
                      {c.rating && <span className="shrink-0 text-ink-soft tabular">{c.rating}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </SideCard>
    );
  }

  const kinds = PLUMBING_FACT_ORDER.filter((k) => plan.plumbing.fixtures.some((f) => f.kind === k));
  const runs = RUN_KINDS.filter((k) => plan.plumbing.lines.some((l) => l.kind === k));
  // Nothing plumbed: the summary card already says so, so no empty legend.
  if (kinds.length === 0 && runs.length === 0) return null;
  return (
    <SideCard title="Legend">
      <ul className="-mx-2" onPointerLeave={() => onRun(null)}>
          {runs.map((k) => (
            <li key={k} onPointerEnter={() => onRun(k)} className="flex items-center gap-2.5 rounded-[10px] px-2 py-0.5 text-sm hover:bg-blue-tint">
              <RunSwatch kind={k} />
              {PLUMBING_LINE_LABELS[k]}
            </li>
          ))}
          {kinds.map((k) => (
            <li key={k} className="flex items-center gap-2.5 px-2 py-0.5 text-sm">
              <Swatch>
                <PlumbingGlyph kind={k} s={SWATCH_GLYPH} />
              </Swatch>
              {PLUMBING_KIND_LABELS[k].legend}
            </li>
          ))}
      </ul>
    </SideCard>
  );
}
