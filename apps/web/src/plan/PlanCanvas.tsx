import { useId, useMemo, useRef, type KeyboardEvent, type ReactNode, type SVGProps } from 'react';
import { motion } from 'motion/react';
import { roomLevelOf, roomsBounds, type PropertyBundle, type Room } from '@ave/shared';
import { propertyLevels } from '@/three/levels';
import { cn } from '@/ui/cn';
import { expandBox, fitProjection, pathData, round, type PlanProjection } from './geometry';
import { useElementSize, usePlanImage } from './hooks';
import { symbolSize } from './symbols';

export type PlanTint = 'grape' | 'sun';

export interface PlanContext {
  proj: PlanProjection;
  bundle: PropertyBundle;
  /** Index of the level being drawn (0 for single-level properties). */
  level: number;
  /** Rooms on the level being drawn. */
  rooms: Room[];
  /** Symbol size in px at this scale. */
  symbol: number;
  /** The room drawn as focused (hovered or selected), if any. */
  focusRoomId: string | null;
  imageLoaded: boolean;
}

/** Wash over the desaturated render: grape for the technical plan, a cool blue under the warm sunlight. */
const TINT_OVERLAY: Record<PlanTint, string> = { grape: 'fill-grape-tint', sun: 'fill-blue-tint' };
const GRID_STROKE: Record<PlanTint, string> = { grape: 'stroke-grape/15', sun: 'stroke-sun-deep/10' };
const FOCUS_STROKE: Record<PlanTint, string> = { grape: 'stroke-grape', sun: 'stroke-sun-deep' };

/** Default margin around the plan, in px. */
export const PLAN_MARGIN_PX = 28;
/** How far beyond the rooms the top-down render is shown, in metres: enough for outer walls and windows. */
const IMAGE_PAD_M = 0.45;
/** Opacity the render fades in to under the vector layers. */
const DEFAULT_IMAGE_OPACITY = 0.5;
const IMAGE_FADE_S = 0.35;
const WALL_STROKE_PX = 1.75;
const FOCUS_STROKE_PX = 3;

export interface PlanCanvasProps {
  bundle: PropertyBundle;
  tint: PlanTint;
  /** Accessible description of the drawing. */
  ariaLabel: string;
  /** Level to draw, by `Property.levels` index; rooms on other levels show as faint outlines. */
  level?: number;
  margin?: number;
  /** Fit a compass ring of this many px around the plan. */
  ringPx?: number;
  ringGapPx?: number;
  imageOpacity?: number;
  focusRoomId?: string | null;
  /** Fill classes for a room (static Tailwind classes); return undefined for the default. */
  roomFill?: (room: Room, ctx: PlanContext) => string | undefined;
  onRoomHover?: (roomId: string | null) => void;
  /** Clicking a room selects it; clicking empty space selects null. */
  onRoomSelect?: (roomId: string | null) => void;
  /** Drawn over the room fills, under the walls: zones, rays. */
  under?: (ctx: PlanContext) => ReactNode;
  /** Drawn over the walls: symbols, runs. */
  children?: (ctx: PlanContext) => ReactNode;
  /** Room names and other labels, above the layers. */
  labels?: (ctx: PlanContext) => ReactNode;
  /** Topmost: compass furniture, scale bar. */
  over?: (ctx: PlanContext) => ReactNode;
  /** Extra props for the svg element, e.g. pointer handlers in the plan editor. */
  svgProps?: Omit<SVGProps<SVGSVGElement>, 'ref' | 'children' | 'width' | 'height' | 'viewBox'>;
  /** Whether rooms respond to hover, click and keyboard (default true). */
  interactiveRooms?: boolean;
  className?: string;
}

/**
 * The plan drawing shared by the Blueprint and Compass views and the plan editor. Rooms from
 * rooms.json are always drawn, so the plan renders even before the top-down image exists; when the
 * image is available it fades in underneath, desaturated under a tinted wash, so the vector layers
 * stay crisp on top of it. It fits its container with margins; no pan or zoom.
 */
export function PlanCanvas(props: PlanCanvasProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  return (
    <div ref={ref} className={cn('relative h-full w-full min-h-0 min-w-0', props.className)}>
      {size && size.width > 0 && size.height > 0 ? <PlanSvg {...props} width={size.width} height={size.height} /> : null}
    </div>
  );
}

function PlanSvg({
  bundle,
  tint,
  ariaLabel,
  level = 0,
  margin = PLAN_MARGIN_PX,
  ringPx,
  ringGapPx,
  imageOpacity = DEFAULT_IMAGE_OPACITY,
  focusRoomId = null,
  roomFill,
  onRoomHover,
  onRoomSelect,
  under,
  children,
  labels,
  over,
  svgProps,
  interactiveRooms = true,
  width,
  height,
}: PlanCanvasProps & { width: number; height: number }) {
  const { property, plan } = bundle;
  const allRooms = bundle.rooms;
  const levelInfo = useMemo(() => {
    const levels = propertyLevels(property);
    return levels.find((l) => l.index === level) ?? levels[0]!;
  }, [property, level]);
  const rooms = useMemo(() => allRooms.filter((r) => roomLevelOf(r) === levelInfo.index), [allRooms, levelInfo.index]);
  const otherRooms = useMemo(() => allRooms.filter((r) => roomLevelOf(r) !== levelInfo.index), [allRooms, levelInfo.index]);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const imageSrc = levelInfo.planImage;
  const imageStatus = usePlanImage(imageSrc);
  const imageLoaded = imageStatus === 'loaded';
  const imageWasReady = useRef(imageLoaded);

  // Fit every level's rooms so switching levels keeps the drawing still.
  const footprint = useMemo(() => roomsBounds(allRooms), [allRooms]);
  const proj = useMemo(
    () => fitProjection(footprint, plan.bounds, width, height, { margin, ringPx, ringGapPx }),
    [footprint, plan.bounds, width, height, margin, ringPx, ringGapPx],
  );
  const ctx: PlanContext = { proj, bundle, level: levelInfo.index, rooms, symbol: symbolSize(proj.scale), focusRoomId, imageLoaded };

  const img = plan.bounds;
  const clip = expandBox(footprint, IMAGE_PAD_M);
  const gridStep = proj.scale;
  const focusRoom = focusRoomId ? rooms.find((r) => r.id === focusRoomId) ?? null : null;

  const select = (id: string | null) => onRoomSelect?.(id);
  const onKey = (e: KeyboardEvent<SVGPathElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(id);
    }
  };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className="absolute inset-0 block select-none"
      onClick={interactiveRooms ? () => select(null) : undefined}
      onPointerLeave={interactiveRooms ? () => onRoomHover?.(null) : undefined}
      {...svgProps}
    >
      <defs>
        <pattern
          id={`${uid}-grid`}
          width={gridStep}
          height={gridStep}
          patternUnits="userSpaceOnUse"
          x={round(proj.x(0) % gridStep)}
          y={round(proj.y(0) % gridStep)}
        >
          <path d={`M${gridStep} 0H0V${gridStep}`} className={cn('fill-none', GRID_STROKE[tint])} strokeWidth={1} />
        </pattern>
        <clipPath id={`${uid}-clip`}>
          <rect x={proj.x(clip.minX)} y={proj.y(clip.minZ)} width={(clip.maxX - clip.minX) * proj.scale} height={(clip.maxZ - clip.minZ) * proj.scale} rx={6} />
        </clipPath>
      </defs>

      <rect width={width} height={height} fill={`url(#${uid}-grid)`} />

      {imageLoaded && (
        <motion.g
          key={imageSrc}
          clipPath={`url(#${uid}-clip)`}
          initial={imageWasReady.current ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: IMAGE_FADE_S }}
          pointerEvents="none"
        >
          <rect x={proj.x(clip.minX)} y={proj.y(clip.minZ)} width={(clip.maxX - clip.minX) * proj.scale} height={(clip.maxZ - clip.minZ) * proj.scale} className="fill-canvas" />
          <image
            href={imageSrc}
            x={proj.x(img.minX)}
            y={proj.y(img.minZ)}
            width={(img.maxX - img.minX) * proj.scale}
            height={(img.maxZ - img.minZ) * proj.scale}
            preserveAspectRatio="none"
            opacity={imageOpacity}
            className="[filter:grayscale(1)_contrast(1.15)]"
          />
          <rect
            x={proj.x(clip.minX)}
            y={proj.y(clip.minZ)}
            width={(clip.maxX - clip.minX) * proj.scale}
            height={(clip.maxZ - clip.minZ) * proj.scale}
            className={TINT_OVERLAY[tint]}
            style={{ mixBlendMode: 'multiply' }}
          />
        </motion.g>
      )}

      <g>
        {rooms.map((room) => (
          <path
            key={room.id}
            d={pathData(proj, room.polygon, true)}
            className={cn(
              'outline-none transition-[fill] duration-150',
              roomFill?.(room, ctx) ?? (imageLoaded ? 'fill-transparent' : 'fill-canvas'),
              interactiveRooms && 'cursor-pointer focus-visible:stroke-blue',
            )}
            strokeWidth={interactiveRooms ? FOCUS_STROKE_PX : undefined}
            tabIndex={interactiveRooms ? 0 : undefined}
            role={interactiveRooms ? 'button' : undefined}
            aria-label={interactiveRooms ? room.name : undefined}
            aria-pressed={interactiveRooms ? focusRoomId === room.id : undefined}
            onPointerEnter={interactiveRooms ? () => onRoomHover?.(room.id) : undefined}
            onClick={
              interactiveRooms
                ? (e) => {
                    e.stopPropagation();
                    select(room.id);
                  }
                : undefined
            }
            onKeyDown={interactiveRooms ? (e) => onKey(e, room.id) : undefined}
          />
        ))}
      </g>

      <g pointerEvents="none">{under?.(ctx)}</g>

      <g pointerEvents="none">
        {otherRooms.map((room) => (
          <path key={room.id} d={pathData(proj, room.polygon, true)} className="fill-none stroke-ink-soft" strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
        ))}
        {rooms.map((room) => (
          <path key={room.id} d={pathData(proj, room.polygon, true)} className="fill-none stroke-ink" strokeWidth={WALL_STROKE_PX} strokeLinejoin="round" />
        ))}
        {focusRoom && (
          <path d={pathData(proj, focusRoom.polygon, true)} className={cn('fill-none', FOCUS_STROKE[tint])} strokeWidth={FOCUS_STROKE_PX} strokeLinejoin="round" />
        )}
      </g>

      <g pointerEvents="none">{children?.(ctx)}</g>
      <g pointerEvents="none">{labels?.(ctx)}</g>
      <g pointerEvents="none">{over?.(ctx)}</g>
    </svg>
  );
}
