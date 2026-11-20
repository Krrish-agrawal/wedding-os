import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { PropertyBundle, Room } from '@ave/shared';
import { cn } from '@/ui';
import { levelAtHeight, propertyLevels, roomLevel } from '@/three/levels';
import type { RigPose } from './TourRig';

/** Size of the plan drawing; height follows the plan's aspect up to `maxHeight`. */
const PLAN_WIDTH_PX = 244;
const PLAN_MAX_HEIGHT_PX = 150;
/** "You are here" marker, in pixels on screen whatever the plan's scale. */
const DOT_RADIUS_PX = 5;
const CONE_LENGTH_PX = 18;
const CONE_HALF_ANGLE = Math.PI / 5;
const NORTH_SIZE_PX = 18;

export interface MiniPlanHandle {
  update(pose: RigPose): void;
}

interface MiniPlanProps {
  bundle: PropertyBundle;
  /** Room of the stop the camera is at or heading to. */
  currentRoomId: string | null;
  /** Rooms that have a tour stop, with that stop's id. */
  stopByRoom: Map<string, string>;
  onPickRoom: (stopId: string) => void;
}

/**
 * A corner floor plan drawn from rooms.json, with a live "you are here" dot and view cone. Rooms
 * that have a tour stop are buttons that send the camera there. Multi-level properties follow the
 * camera's level and offer a level switch.
 */
export const MiniPlan = forwardRef<MiniPlanHandle, MiniPlanProps>(function MiniPlan({ bundle, currentRoomId, stopByRoom, onPickRoom }, ref) {
  const { property, rooms, plan } = bundle;
  const levels = useMemo(() => propertyLevels(property), [property]);
  const [cameraLevel, setCameraLevel] = useState(levels[0]!.index);
  const [pickedLevel, setPickedLevel] = useState<number | null>(null);
  const [hover, setHover] = useState<Room | null>(null);
  const marker = useRef<SVGGElement>(null);
  const lastCameraLevel = useRef(cameraLevel);

  const b = plan.bounds;
  const w = b.maxX - b.minX;
  const h = b.maxZ - b.minZ;
  const scale = Math.min(PLAN_WIDTH_PX / w, PLAN_MAX_HEIGHT_PX / h);
  const widthPx = w * scale;
  const heightPx = h * scale;
  const level = pickedLevel ?? cameraLevel;
  const shown = rooms.filter((r) => roomLevel(r) === level);

  useImperativeHandle(
    ref,
    () => ({
      update({ x, y, z, heading }) {
        const l = levelAtHeight(levels, y).index;
        if (l !== lastCameraLevel.current) {
          lastCameraLevel.current = l;
          setCameraLevel(l);
          setPickedLevel(null);
        }
        const g = marker.current;
        if (!g) return;
        g.setAttribute('transform', `translate(${((x - b.minX) * scale).toFixed(1)} ${((z - b.minZ) * scale).toFixed(1)}) rotate(${((heading * 180) / Math.PI).toFixed(1)})`);
        g.style.opacity = l === (pickedLevel ?? l) ? '1' : '0.35';
      },
    }),
    [levels, b.minX, b.minZ, scale, pickedLevel],
  );

  const toPx = (p: [number, number]) => `${((p[0] - b.minX) * scale).toFixed(1)},${((p[1] - b.minZ) * scale).toFixed(1)}`;
  const coneX = Math.cos(CONE_HALF_ANGLE) * CONE_LENGTH_PX;
  const coneY = Math.sin(CONE_HALF_ANGLE) * CONE_LENGTH_PX;
  const label = hover?.name ?? rooms.find((r) => r.id === currentRoomId)?.name ?? '';

  return (
    <div className="pointer-events-auto rounded-[16px] border-2 border-ink bg-canvas p-2.5 shadow-[var(--shadow-pop-sm)]">
      <div className="mb-1.5 flex h-6 items-center justify-between gap-2">
        <p className="truncate text-[13px] font-semibold text-ink" aria-live="polite">
          {label}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {levels.length > 1 &&
            levels.map((l) => (
              <button
                key={l.index}
                type="button"
                onClick={() => setPickedLevel(l.index === cameraLevel ? null : l.index)}
                aria-pressed={level === l.index}
                className={cn(
                  'h-6 rounded-[var(--radius-chip)] border-2 px-2 text-[11px] font-semibold transition-colors',
                  level === l.index ? 'border-ink bg-blue text-ink' : 'border-line bg-canvas text-ink-soft hover:border-ink',
                )}
              >
                {l.name}
              </button>
            ))}
          <NorthMark deg={property.northOffsetDeg} />
        </div>
      </div>
      <svg width={widthPx} height={heightPx} viewBox={`0 0 ${widthPx} ${heightPx}`} role="group" aria-label="Floor plan" className="block overflow-visible">
        {shown.map((r) => {
          const stopId = stopByRoom.get(r.id);
          const current = r.id === currentRoomId;
          const points = r.polygon.map((p) => toPx(p)).join(' ');
          const shape = (
            <polygon
              points={points}
              className={cn(
                'stroke-ink transition-[fill] duration-150',
                current ? 'fill-blue-tint' : hover?.id === r.id && stopId ? 'fill-paper' : 'fill-canvas',
              )}
              strokeWidth={current ? 2 : 1.25}
              strokeLinejoin="round"
            />
          );
          if (!stopId) return <g key={r.id}>{shape}</g>;
          return (
            <g
              key={r.id}
              role="button"
              tabIndex={0}
              aria-label={`Go to ${r.name}`}
              aria-current={current ? 'location' : undefined}
              className="cursor-pointer outline-none focus-visible:[&>polygon]:stroke-blue"
              onPointerEnter={() => setHover(r)}
              onPointerLeave={() => setHover((x) => (x?.id === r.id ? null : x))}
              onFocus={() => setHover(r)}
              onBlur={() => setHover((x) => (x?.id === r.id ? null : x))}
              onClick={() => onPickRoom(stopId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPickRoom(stopId);
                }
              }}
            >
              {shape}
            </g>
          );
        })}
        <g ref={marker} className="pointer-events-none" style={{ transition: 'opacity 150ms' }}>
          <path d={`M0 0 L${coneX.toFixed(1)} ${(-coneY).toFixed(1)} A${CONE_LENGTH_PX} ${CONE_LENGTH_PX} 0 0 1 ${coneX.toFixed(1)} ${coneY.toFixed(1)} Z`} className="fill-blue/30" />
          <circle r={DOT_RADIUS_PX} className="fill-blue stroke-ink" strokeWidth={2} />
        </g>
      </svg>
    </div>
  );
});

/** A small north arrow; `deg` is clockwise from the plan's up direction (model −Z) to true north. */
function NorthMark({ deg }: { deg: number }) {
  const r = NORTH_SIZE_PX / 2;
  return (
    <svg width={NORTH_SIZE_PX} height={NORTH_SIZE_PX} viewBox={`${-r} ${-r} ${NORTH_SIZE_PX} ${NORTH_SIZE_PX}`} role="img" aria-label="North arrow">
      <circle r={r - 1} className="fill-canvas stroke-line" strokeWidth={1.5} />
      <g transform={`rotate(${deg})`}>
        <path d={`M0 ${-(r - 2.5)} L${r * 0.38} ${r * 0.35} L0 ${r * 0.1} L${-r * 0.38} ${r * 0.35} Z`} className="fill-ink" />
      </g>
    </svg>
  );
}
