import { useId } from 'react';
import { DIRECTIONS, type Direction, type SunPosition, type SunSample } from '@ave/shared';
import { cn } from '@/ui/cn';
import { pathData, polar, ringPoint, ringSectorPath, round, screenAngle } from '@/plan/geometry';
import type { PlanContext } from '@/plan/PlanCanvas';

/**
 * Compass furniture drawn around the plan: the sun's arc, the ring with directions, the entrance,
 * Vastu zones and the sun's rays. The ring is an ellipse around the plan (`ctx.proj.ring`); offsets
 * here are px outward from it.
 */
export const RING = {
  /** Total px the ring needs beyond the plan; passed to PlanCanvas as ringPx. */
  total: 66,
  /** Gap between the plan's corners and the ring, px. */
  gap: 8,
  /** The sun arc: offset at the horizon and at the zenith (a higher sun sits closer to the plan). */
  arcHorizon: 32,
  arcZenith: 4,
  /** The compass line and its ticks. */
  circle: 38,
  tickMinor: 4,
  tickMajor: 8,
  /** Direction labels. */
  label: 54,
} as const;

const HALO = 'stroke-canvas [paint-order:stroke]';
const DEG_PER_DIRECTION = 360 / DIRECTIONS.length;
const MINOR_TICK_DEG = 15;
const RIGHT_ANGLE_DEG = 90;
const RING_STEP_DEG = 2;

const DIRECTION_BEARING: Record<Direction, number> = Object.fromEntries(DIRECTIONS.map((d, i) => [d, i * DEG_PER_DIRECTION])) as Record<Direction, number>;

/** Offset of the sun on its arc for an altitude. */
function arcOffset(altitudeDeg: number): number {
  const t = Math.max(0, Math.min(1, altitudeDeg / RIGHT_ANGLE_DEG));
  return RING.arcHorizon - (RING.arcHorizon - RING.arcZenith) * t;
}

function sunPoint(ctx: PlanContext, northOffsetDeg: number, bearingDeg: number, altitudeDeg: number): [number, number] {
  return ringPoint(ctx.proj, arcOffset(altitudeDeg), screenAngle(bearingDeg, northOffsetDeg));
}

function polyline(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)} ${round(y)}`).join('');
}

/** The ring line itself, as a closed path through ring points. */
function ringPath(ctx: PlanContext, offset: number): string {
  const pts: [number, number][] = [];
  for (let a = 0; a < 360; a += RING_STEP_DEG) pts.push(ringPoint(ctx.proj, offset, a));
  return `${polyline(pts)}Z`;
}

/** The compass ring: line, ticks every 15 degrees and the eight direction labels. */
export function CompassRing({ ctx, northOffsetDeg, entrance, highlight }: { ctx: PlanContext; northOffsetDeg: number; entrance: Direction; highlight?: Direction | null }) {
  const ticks: string[] = [];
  for (let b = 0; b < 360; b += MINOR_TICK_DEG) {
    const major = b % DEG_PER_DIRECTION === 0;
    const a = screenAngle(b, northOffsetDeg);
    const [x0, y0] = ringPoint(ctx.proj, RING.circle, a);
    const [x1, y1] = ringPoint(ctx.proj, RING.circle + (major ? RING.tickMajor : RING.tickMinor), a);
    ticks.push(`M${round(x0)} ${round(y0)}L${round(x1)} ${round(y1)}`);
  }
  return (
    <g aria-hidden>
      <path d={ringPath(ctx, RING.circle)} className="fill-none stroke-ink" strokeWidth={1.5} />
      <path d={ticks.join('')} className="stroke-ink" strokeWidth={1.25} />
      {DIRECTIONS.map((d) => {
        const [x, y] = ringPoint(ctx.proj, RING.label, screenAngle(DIRECTION_BEARING[d], northOffsetDeg));
        const isEntrance = d === entrance;
        const isNorth = d === 'N';
        const isHighlight = highlight === d;
        const pill = isEntrance || isNorth || isHighlight;
        const pillW = isEntrance ? 28 + d.length * 8 : d.length * 9 + 12;
        return (
          <g key={d}>
            {pill && (
              <rect
                x={round(x - pillW / 2)}
                y={round(y - 10)}
                width={pillW}
                height={20}
                rx={10}
                className={cn(isEntrance ? 'fill-ink' : isHighlight ? 'fill-sun' : 'fill-canvas', 'stroke-ink')}
                strokeWidth={1.5}
              />
            )}
            {isEntrance && <DoorGlyph x={x - pillW / 2 + 12} y={y} />}
            <text
              x={round(isEntrance ? x + 6 : x)}
              y={round(y + 4)}
              textAnchor="middle"
              className={cn('font-display font-bold', isEntrance ? 'fill-canvas' : 'fill-ink', !pill && HALO)}
              strokeWidth={3}
              style={{ fontSize: d.length > 1 ? 11 : 12.5 }}
            >
              {d}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** A small door: frame and a swung leaf, for the entrance pill. */
function DoorGlyph({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${round(x)} ${round(y)})`}>
      <path d="M-4 5V-5H3V5" className="fill-none stroke-canvas" strokeWidth={1.4} strokeLinejoin="round" />
      <path d="M-4 5L1 3V-6L-4 -5" className="fill-canvas" />
    </g>
  );
}

/** A dashed line from the plan out to the ring marking the way the main door faces. */
export function EntranceRay({ ctx, northOffsetDeg, entrance }: { ctx: PlanContext; northOffsetDeg: number; entrance: Direction }) {
  const a = screenAngle(DIRECTION_BEARING[entrance], northOffsetDeg);
  const [x0, y0] = ringPoint(ctx.proj, -RING.gap * 2, a);
  const [x1, y1] = ringPoint(ctx.proj, RING.circle, a);
  return <path d={`M${round(x0)} ${round(y0)}L${round(x1)} ${round(y1)}`} className="stroke-ink" strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" />;
}

const HOUR_MIN = 60;

/** The sun's track from sunrise to sunset; the part of the day already passed is drawn solid. */
export function SunArc({ ctx, path, northOffsetDeg, minutes }: { ctx: PlanContext; path: SunSample[]; northOffsetDeg: number; minutes: number }) {
  if (path.length < 2) return null;
  const pts = path.map((s) => sunPoint(ctx, northOffsetDeg, s.bearingDeg, s.altitudeDeg));
  const passed = pts.filter((_, i) => path[i]!.minutes <= minutes);
  const hours = path.filter((s, i) => i > 0 && i < path.length - 1 && s.minutes % HOUR_MIN === 0);
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  return (
    <g aria-hidden>
      <path d={polyline(pts)} className="fill-none stroke-sun-deep" strokeWidth={1.75} strokeDasharray="3 4" strokeLinecap="round" />
      {passed.length > 1 && <path d={polyline(passed)} className="fill-none stroke-sun" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />}
      {hours.map((s) => {
        const [x, y] = sunPoint(ctx, northOffsetDeg, s.bearingDeg, s.altitudeDeg);
        return <circle key={s.minutes} cx={round(x)} cy={round(y)} r={2.25} className="fill-ink" />;
      })}
      <HorizonMark x={first[0]} y={first[1]} />
      <HorizonMark x={last[0]} y={last[1]} />
    </g>
  );
}

function HorizonMark({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${round(x)} ${round(y)})`}>
      <path d="M-6 2A6 6 0 0 1 6 2Z" className="fill-sun stroke-ink" strokeWidth={1.25} strokeLinejoin="round" />
      <path d="M-8 2H8" className="stroke-ink" strokeWidth={1.25} strokeLinecap="round" />
    </g>
  );
}

const SUN_DISC_R = 10;
const SUN_SPOKES = 8;

/** The sun at the chosen time, on its arc. */
export function SunDisc({ ctx, sun, northOffsetDeg }: { ctx: PlanContext; sun: SunPosition; northOffsetDeg: number }) {
  if (sun.altitudeDeg <= 0) return null;
  const [x, y] = sunPoint(ctx, northOffsetDeg, sun.bearingDeg, sun.altitudeDeg);
  const spokes = Array.from({ length: SUN_SPOKES }, (_, i) => {
    const a = (i * 360) / SUN_SPOKES;
    const [x0, y0] = polar([x, y], SUN_DISC_R + 3, a);
    const [x1, y1] = polar([x, y], SUN_DISC_R + 7, a);
    return `M${round(x0)} ${round(y0)}L${round(x1)} ${round(y1)}`;
  }).join('');
  return (
    <g aria-hidden>
      <path d={spokes} className="stroke-ink" strokeWidth={1.75} strokeLinecap="round" />
      <circle cx={round(x)} cy={round(y)} r={SUN_DISC_R} className="fill-sun stroke-ink" strokeWidth={2} />
    </g>
  );
}

/** Spacing between parallel sun rays, px. */
const RAY_SPACING_PX = 30;
const RAY_CHEVRON_PX = 5;

/** Parallel rays of sunlight falling across the rooms that get direct sun, in the direction the light travels. */
export function SunRays({ ctx, sun, northOffsetDeg, litIds }: { ctx: PlanContext; sun: SunPosition; northOffsetDeg: number; litIds: ReadonlySet<string> }) {
  const clipId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-rays`;
  const lit = ctx.rooms.filter((r) => litIds.has(r.id));
  if (sun.altitudeDeg <= 0 || lit.length === 0) return null;
  const a = (screenAngle(sun.bearingDeg, northOffsetDeg) * Math.PI) / 180;
  // Unit vector toward the sun on screen, and its perpendicular.
  const ux = Math.sin(a);
  const uy = -Math.cos(a);
  const px = -uy;
  const py = ux;
  const [cx, cy] = ctx.proj.centre;
  const R = Math.max(...lit.flatMap((r) => r.polygon.map((p) => Math.hypot(ctx.proj.x(p[0]) - cx, ctx.proj.y(p[1]) - cy))));
  const n = Math.ceil(R / RAY_SPACING_PX);
  const rays: string[] = [];
  const chevrons: string[] = [];
  for (let k = -n; k <= n; k++) {
    const o = k * RAY_SPACING_PX;
    const h = Math.sqrt(Math.max(0, R * R - o * o));
    if (h <= 0) continue;
    const bx = cx + px * o;
    const by = cy + py * o;
    rays.push(`M${round(bx + ux * h)} ${round(by + uy * h)}L${round(bx - ux * h)} ${round(by - uy * h)}`);
    // Chevrons point the way the light travels, staggered so they do not line up.
    for (const share of k % 2 === 0 ? [0.45, -0.35] : [0.05]) {
      const mx = bx + ux * h * share;
      const my = by + uy * h * share;
      const c = RAY_CHEVRON_PX;
      chevrons.push(`M${round(mx + ux * c + px * c)} ${round(my + uy * c + py * c)}L${round(mx)} ${round(my)}L${round(mx + ux * c - px * c)} ${round(my + uy * c - py * c)}`);
    }
  }
  return (
    <g aria-hidden>
      <defs>
        <clipPath id={clipId}>
          {lit.map((r) => (
            <path key={r.id} d={pathData(ctx.proj, r.polygon, true)} />
          ))}
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <path d={rays.join('')} className="stroke-sun-deep" strokeWidth={1.25} opacity={0.35} strokeLinecap="round" />
        <path d={chevrons.join('')} className="fill-none stroke-sun-deep" strokeWidth={1.75} opacity={0.7} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  );
}

/** Eight Vastu zones as segments of the ring band, the focused room's zone filled. */
export function VastuZones({ ctx, northOffsetDeg, highlight }: { ctx: PlanContext; northOffsetDeg: number; highlight: Direction | null }) {
  const half = DEG_PER_DIRECTION / 2;
  return (
    <g aria-hidden>
      {DIRECTIONS.map((d, i) => {
        const mid = screenAngle(DIRECTION_BEARING[d], northOffsetDeg);
        return (
          <path
            key={d}
            d={ringSectorPath(ctx.proj, RING.arcZenith, RING.arcHorizon, mid - half, mid + half)}
            className={cn(highlight === d ? 'fill-sun' : i % 2 ? 'fill-paper' : 'fill-sun-tint', 'stroke-canvas transition-[fill] duration-150')}
            strokeWidth={2}
          />
        );
      })}
    </g>
  );
}

/** Dashed lines from the centre dividing the plan into the eight zones, drawn under the walls. */
export function VastuDividers({ ctx, northOffsetDeg }: { ctx: PlanContext; northOffsetDeg: number }) {
  const c = ctx.proj.centre;
  const half = DEG_PER_DIRECTION / 2;
  const d = DIRECTIONS.map((dir) => {
    const [x, y] = ringPoint(ctx.proj, RING.arcZenith, screenAngle(DIRECTION_BEARING[dir] + half, northOffsetDeg));
    return `M${round(c[0])} ${round(c[1])}L${round(x)} ${round(y)}`;
  }).join('');
  return (
    <g aria-hidden>
      <path d={d} className="stroke-ink" strokeWidth={1.25} strokeDasharray="5 5" opacity={0.4} />
      <circle cx={round(c[0])} cy={round(c[1])} r={3.5} className="fill-ink" opacity={0.6} />
    </g>
  );
}
