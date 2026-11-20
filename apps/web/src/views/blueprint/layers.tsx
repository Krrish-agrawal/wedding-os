import { pointLevel, resolveRoomId, runLevel, type PlanFile, type Room } from '@ave/shared';
import { cn } from '@/ui/cn';
import { pathData, round } from '@/plan/geometry';
import type { PlanContext } from '@/plan/PlanCanvas';
import { ElectricalGlyph, PlumbingGlyph, RUN_STYLE } from '@/plan/symbols';

/** Opacity of symbols outside the focused room. */
const MUTED_OPACITY = 0.28;
const RUN_FOCUS_WIDTH_BONUS = 1.5;

/** Kinds drawn last so they sit on top of everything else. */
const TOP_KINDS = new Set(['db', 'shaft']);
const byDrawOrder = <T extends { kind: string }>(a: T, b: T) => Number(TOP_KINDS.has(a.kind)) - Number(TOP_KINDS.has(b.kind));

function muted(focusRoomId: string | null, point: { x: number; z: number; roomId: string | null }, rooms: Room[]): boolean {
  return focusRoomId !== null && resolveRoomId(point, rooms) !== focusRoomId;
}

function SymbolTag({ x, y, s, text }: { x: number; y: number; s: number; text: string }) {
  return (
    <text x={round(x + s * 0.75)} y={round(y - s * 0.55)} className="fill-ink font-bold stroke-canvas [paint-order:stroke]" strokeWidth={3} strokeLinejoin="round" style={{ fontSize: 10.5 }}>
      {text}
    </text>
  );
}

export function ElectricalLayer({ ctx, plan, highlightCircuitId }: { ctx: PlanContext; plan: PlanFile; highlightCircuitId: string | null }) {
  const { proj, symbol: s, focusRoomId, bundle, level } = ctx;
  const st = RUN_STYLE.circuit;
  const circuits = plan.electrical.circuits.filter((c) => runLevel(c) === level);
  const points = plan.electrical.points.filter((p) => pointLevel(p, bundle.rooms) === level);
  return (
    <g>
      <g>
        {circuits.map((c) => {
          const hot = highlightCircuitId === c.id;
          const dim = (highlightCircuitId !== null && !hot) || (focusRoomId !== null && !hot);
          return (
            <path
              key={c.id}
              d={pathData(proj, c.path)}
              className={cn('fill-none transition-opacity duration-150', st.className)}
              strokeWidth={hot ? st.width + RUN_FOCUS_WIDTH_BONUS : st.width}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={dim ? 0.35 : 0.85}
            />
          );
        })}
      </g>
      {[...points].sort(byDrawOrder).map((p) => {
        const x = proj.x(p.x);
        const y = proj.y(p.z);
        return (
          <g key={p.id} className="transition-opacity duration-150" opacity={muted(focusRoomId, p, bundle.rooms) ? MUTED_OPACITY : 1}>
            <g transform={`translate(${round(x)} ${round(y)})`}>
              <ElectricalGlyph kind={p.kind} s={p.kind === 'db' ? s * 1.25 : s} />
            </g>
            {p.kind === 'db' && <SymbolTag x={x} y={y} s={s * 1.25} text={p.label ?? 'DB'} />}
          </g>
        );
      })}
    </g>
  );
}

const LINE_ORDER = { drain: 0, cold: 1, hot: 2 } as const;

export function PlumbingLayer({ ctx, plan, highlightKind }: { ctx: PlanContext; plan: PlanFile; highlightKind: keyof typeof LINE_ORDER | null }) {
  const { proj, symbol: s, focusRoomId, bundle, level } = ctx;
  const fixtures = plan.plumbing.fixtures.filter((f) => pointLevel(f, bundle.rooms) === level);
  return (
    <g>
      <g>
        {plan.plumbing.lines
          .filter((l) => runLevel(l) === level)
          .sort((a, b) => LINE_ORDER[a.kind] - LINE_ORDER[b.kind])
          .map((l) => {
            const st = RUN_STYLE[l.kind];
            const dim = highlightKind !== null && highlightKind !== l.kind;
            return (
              <path
                key={l.id}
                d={pathData(proj, l.path)}
                className={cn('fill-none transition-opacity duration-150', st.className)}
                strokeWidth={st.width}
                strokeDasharray={st.dash}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={dim ? 0.25 : 0.9}
              />
            );
          })}
      </g>
      {[...fixtures].sort(byDrawOrder).map((f) => {
        const x = proj.x(f.x);
        const y = proj.y(f.z);
        return (
          <g key={f.id} className="transition-opacity duration-150" opacity={muted(focusRoomId, f, bundle.rooms) ? MUTED_OPACITY : 1}>
            <g transform={`translate(${round(x)} ${round(y)})`}>
              <PlumbingGlyph kind={f.kind} s={f.kind === 'shaft' ? s * 1.1 : s} />
            </g>
            {f.kind === 'shaft' && <SymbolTag x={x} y={y} s={s * 1.1} text={f.label ?? 'Shaft'} />}
          </g>
        );
      })}
    </g>
  );
}
