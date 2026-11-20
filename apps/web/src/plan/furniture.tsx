import { formatFeetInches, formatSqft, pointInPolygon, polygonBounds, roomDimensions, roomsBounds, type Room, type Vec2 } from '@ave/shared';
import { cn } from '@/ui/cn';
import { labelAnchor, polar, round, screenAngle } from './geometry';
import type { PlanContext } from './PlanCanvas';

/** Text with a white halo so it reads over lines, symbols and the plan render. */
const HALO = 'stroke-canvas [paint-order:stroke]';
const HALO_PX = 3.5;

/** Average glyph width as a share of font size, for fitting labels without measuring. */
const CHAR_WIDTH_EM = 0.56;
const NAME_MAX_PX = 14;
const NAME_MIN_PX = 9.5;
const ROOM_LABEL_PAD_PX = 10;
/** Corner labels keep this many symbol sizes away from the walls. */
const CORNER_SYMBOL_CLEARANCE = 0.6;
/** Rooms must be at least this big on screen (px) to also show area, then dimensions. */
const SHOW_AREA_MIN = { w: 64, h: 52 };
const SHOW_DIMS_MIN = { w: 92, h: 70 };

function fitFont(text: string, maxWidth: number, maxPx = NAME_MAX_PX): number {
  const fit = maxWidth / (CHAR_WIDTH_EM * Math.max(1, text.length));
  return Math.max(NAME_MIN_PX, Math.min(maxPx, fit));
}

export type RoomLabelMode = 'full' | 'name' | 'corner';

/**
 * Room names, with area and dimensions in `full` mode (the layout layer), the name alone at the
 * centre in `name` mode, or tucked into the room's top-left corner in `corner` mode so symbols
 * near the middle stay clear.
 */
export function RoomLabels({ ctx, mode, mutedIds, note }: { ctx: PlanContext; mode: RoomLabelMode; mutedIds?: ReadonlySet<string>; note?: (room: Room) => string | null }) {
  const { proj, rooms } = ctx;
  return (
    <>
      {rooms.map((room) => {
        const b = polygonBounds(room.polygon);
        const w = (b.maxX - b.minX) * proj.scale;
        const h = (b.maxZ - b.minZ) * proj.scale;
        const muted = mutedIds?.has(room.id) ?? false;
        const extra = note?.(room) ?? null;

        if (mode === 'corner') {
          // Clear of wall-mounted symbols, which sit just inside the walls.
          const pad = ROOM_LABEL_PAD_PX + ctx.symbol * CORNER_SYMBOL_CLEARANCE;
          const size = fitFont(room.name, w - pad * 2, 12);
          const corner: Vec2 = proj.toModel(proj.x(b.minX) + pad, proj.y(b.minZ) + pad + size);
          const [ax, ay] = pointInPolygon(corner, room.polygon) ? [proj.x(b.minX) + pad, proj.y(b.minZ) + pad + size * 0.8] : proj.toScreen(labelAnchor(room.polygon));
          return (
            <text key={room.id} x={round(ax)} y={round(ay)} className={cn('font-semibold transition-opacity duration-200', muted ? 'fill-ink-soft opacity-60' : 'fill-ink-soft', HALO)} strokeWidth={HALO_PX} strokeLinejoin="round" style={{ fontSize: size }}>
              {room.name}
            </text>
          );
        }

        const [cx, cy] = proj.toScreen(labelAnchor(room.polygon));
        const nameSize = fitFont(room.name, w - ROOM_LABEL_PAD_PX);
        const showArea = mode === 'full' && w >= SHOW_AREA_MIN.w && h >= SHOW_AREA_MIN.h;
        const dims = mode === 'full' && w >= SHOW_DIMS_MIN.w && h >= SHOW_DIMS_MIN.h ? roomDimensions(room.polygon) : null;
        const lines: { text: string; cls: string; size: number }[] = [{ text: room.name, cls: 'fill-ink font-bold', size: nameSize }];
        if (showArea) lines.push({ text: formatSqft(room.areaSqft), cls: 'fill-ink-soft font-semibold tabular', size: Math.min(12, nameSize) });
        if (dims) lines.push({ text: dims, cls: 'fill-ink-soft tabular', size: Math.min(11, nameSize) });
        if (extra) lines.push({ text: extra, cls: 'fill-ink font-bold', size: Math.min(12, nameSize) });
        const lineGap = 3;
        const total = lines.reduce((s, l) => s + l.size, 0) + lineGap * (lines.length - 1);
        let y = cy - total / 2;
        return (
          <g key={room.id} className={cn('transition-opacity duration-200', muted && 'opacity-45')}>
            {lines.map((l) => {
              y += l.size;
              const ty = y - l.size * 0.18;
              y += lineGap;
              return (
                <text key={l.text} x={round(cx)} y={round(ty)} textAnchor="middle" className={cn(l.cls, HALO)} strokeWidth={HALO_PX} strokeLinejoin="round" style={{ fontSize: l.size }}>
                  {l.text}
                </text>
              );
            })}
          </g>
        );
      })}
    </>
  );
}

const NORTH_ARROW_R = 17;

/** A small north arrow, turned by the property's north offset. */
export function NorthArrow({ x, y, northOffsetDeg, r = NORTH_ARROW_R }: { x: number; y: number; northOffsetDeg: number; r?: number }) {
  const a = screenAngle(0, northOffsetDeg);
  const [lx, ly] = polar([x, y], r + 9, a);
  return (
    <g aria-hidden>
      <circle cx={x} cy={y} r={r} className="fill-canvas stroke-ink" strokeWidth={1.75} />
      <g transform={`rotate(${round(a)} ${x} ${y})`}>
        <path d={`M${x} ${y - r + 3}L${x + r * 0.38} ${y + r * 0.35}L${x} ${y + r * 0.12}Z`} className="fill-ink" />
        <path d={`M${x} ${y - r + 3}L${x - r * 0.38} ${y + r * 0.35}L${x} ${y + r * 0.12}Z`} className="fill-canvas stroke-ink" strokeWidth={1.2} strokeLinejoin="round" />
      </g>
      <text x={round(lx)} y={round(ly + 4)} textAnchor="middle" className={cn('fill-ink font-display font-bold', HALO)} strokeWidth={HALO_PX} style={{ fontSize: 12 }}>
        N
      </text>
    </g>
  );
}

/** Candidate scale-bar lengths, in metres. */
const SCALE_STEPS_M = [0.5, 1, 2, 5, 10];
const SCALE_BAR_MIN_PX = 48;

/** A metre scale bar anchored at its bottom-right corner. */
export function ScaleBar({ right, bottom, scale }: { right: number; bottom: number; scale: number }) {
  const metres = SCALE_STEPS_M.find((m) => m * scale >= SCALE_BAR_MIN_PX) ?? SCALE_STEPS_M[SCALE_STEPS_M.length - 1]!;
  const w = metres * scale;
  const x0 = right - w;
  const y = bottom - 6;
  return (
    <g aria-hidden>
      <path d={`M${round(x0)} ${y - 5}V${y}H${round(right)}V${y - 5}`} className="fill-none stroke-ink" strokeWidth={1.75} />
      <path d={`M${round(x0 + w / 2)} ${y - 3}V${y}`} className="stroke-ink" strokeWidth={1.25} />
      <text x={round(right)} y={y - 10} textAnchor="end" className={cn('fill-ink-soft font-semibold tabular', HALO)} strokeWidth={HALO_PX} style={{ fontSize: 11 }}>
        {metres} m
      </text>
    </g>
  );
}

/** Space between the footprint and its overall dimension lines, px. */
const DIM_OFFSET_PX = 16;
const DIM_TICK_PX = 5;

/** Overall width and depth of the footprint, drawn like a plan's outer dimension lines. */
export function OverallDimensions({ ctx }: { ctx: PlanContext }) {
  const { proj, bundle } = ctx;
  const b = roomsBounds(bundle.rooms);
  const x0 = proj.x(b.minX);
  const x1 = proj.x(b.maxX);
  const y0 = proj.y(b.minZ);
  const y1 = proj.y(b.maxZ);
  const ty = y0 - DIM_OFFSET_PX;
  const lx = x0 - DIM_OFFSET_PX;
  const width = `${formatFeetInches(b.maxX - b.minX)}`;
  const depth = `${formatFeetInches(b.maxZ - b.minZ)}`;
  return (
    <g aria-hidden className="text-ink-soft">
      <path d={`M${round(x0)} ${round(ty)}H${round(x1)}M${round(x0)} ${round(ty - DIM_TICK_PX)}V${round(ty + DIM_TICK_PX)}M${round(x1)} ${round(ty - DIM_TICK_PX)}V${round(ty + DIM_TICK_PX)}`} className="stroke-ink-soft" strokeWidth={1.25} />
      <text x={round((x0 + x1) / 2)} y={round(ty - 5)} textAnchor="middle" className={cn('fill-ink-soft font-semibold tabular', HALO)} strokeWidth={HALO_PX} style={{ fontSize: 11 }}>
        {width}
      </text>
      <path d={`M${round(lx)} ${round(y0)}V${round(y1)}M${round(lx - DIM_TICK_PX)} ${round(y0)}H${round(lx + DIM_TICK_PX)}M${round(lx - DIM_TICK_PX)} ${round(y1)}H${round(lx + DIM_TICK_PX)}`} className="stroke-ink-soft" strokeWidth={1.25} />
      <text
        x={round(lx - 5)}
        y={round((y0 + y1) / 2)}
        textAnchor="middle"
        transform={`rotate(-90 ${round(lx - 5)} ${round((y0 + y1) / 2)})`}
        className={cn('fill-ink-soft font-semibold tabular', HALO)}
        strokeWidth={HALO_PX}
        style={{ fontSize: 11 }}
      >
        {depth}
      </text>
    </g>
  );
}
