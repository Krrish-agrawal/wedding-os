import type { Vec2 } from '@ave/shared';
import { cn } from '@/ui/cn';
import { pathData, round } from '@/plan/geometry';
import type { PlanContext } from '@/plan/PlanCanvas';
import { ElectricalGlyph, PlumbingGlyph, RUN_STYLE, type RunKind } from '@/plan/symbols';
import { nextVertex, snapPoint, type Layers, type Selection, type Tool, type Visible } from './model';

const HANDLE_PX = 8;
const SELECT_RING = 0.85;
const GHOST_OPACITY = 0.5;

function Run({ ctx, path, kind, selected }: { ctx: PlanContext; path: Vec2[]; kind: RunKind; selected: boolean }) {
  const st = RUN_STYLE[kind];
  return (
    <>
      {selected && <path d={pathData(ctx.proj, path)} className="fill-none stroke-blue/35" strokeWidth={st.width + 7} strokeLinejoin="round" strokeLinecap="round" />}
      <path d={pathData(ctx.proj, path)} className={cn('fill-none', st.className)} strokeWidth={st.width} strokeDasharray={st.dash} strokeLinejoin="round" strokeLinecap="round" />
    </>
  );
}

function Handles({ ctx, path }: { ctx: PlanContext; path: Vec2[] }) {
  return (
    <>
      {path.map((p, i) => (
        <rect
          key={i}
          x={round(ctx.proj.x(p[0]) - HANDLE_PX / 2)}
          y={round(ctx.proj.y(p[1]) - HANDLE_PX / 2)}
          width={HANDLE_PX}
          height={HANDLE_PX}
          className="fill-canvas stroke-ink"
          strokeWidth={1.5}
        />
      ))}
    </>
  );
}

interface Props {
  ctx: PlanContext;
  doc: Layers;
  sel: Selection;
  visible: Visible;
  tool: Tool;
  runPath: Vec2[];
  cursor: { m: Vec2; free: boolean } | null;
}

/** Everything the editor draws over the plan: runs, symbols, selection, the run in progress and a placement ghost. */
export function EditorDrawing({ ctx, doc, sel, visible, tool, runPath, cursor }: Props) {
  const { proj, symbol: s } = ctx;
  const isSel = (type: NonNullable<Selection>['type'], id: string) => sel?.type === type && sel.id === id;
  const selectedRun = sel?.type === 'circuit' ? doc.electrical.circuits.find((c) => c.id === sel.id)?.path : sel?.type === 'line' ? doc.plumbing.lines.find((c) => c.id === sel.id)?.path : undefined;
  const ring = (x: number, z: number) => (
    <circle cx={round(proj.x(x))} cy={round(proj.y(z))} r={s * SELECT_RING} className="fill-blue/10 stroke-blue" strokeWidth={2} strokeDasharray="4 3" />
  );

  const preview = tool.t === 'run' && runPath.length > 0 && cursor ? [...runPath, nextVertex(runPath[runPath.length - 1]!, cursor.m, cursor.free)] : null;
  const ghostAt = cursor && (tool.t === 'electrical' || tool.t === 'plumbing') ? snapPoint(cursor.m) : null;

  return (
    <g>
      {visible.electrical && doc.electrical.circuits.map((c) => <Run key={c.id} ctx={ctx} path={c.path} kind="circuit" selected={isSel('circuit', c.id)} />)}
      {visible.plumbing && doc.plumbing.lines.map((l) => <Run key={l.id} ctx={ctx} path={l.path} kind={l.kind} selected={isSel('line', l.id)} />)}

      {visible.electrical &&
        doc.electrical.points.map((p) => (
          <g key={p.id}>
            {isSel('point', p.id) && ring(p.x, p.z)}
            <g transform={`translate(${round(proj.x(p.x))} ${round(proj.y(p.z))})`} opacity={p.roomId ? 1 : 0.55}>
              <ElectricalGlyph kind={p.kind} s={s} />
            </g>
          </g>
        ))}
      {visible.plumbing &&
        doc.plumbing.fixtures.map((f) => (
          <g key={f.id}>
            {isSel('fixture', f.id) && ring(f.x, f.z)}
            <g transform={`translate(${round(proj.x(f.x))} ${round(proj.y(f.z))})`} opacity={f.roomId ? 1 : 0.55}>
              <PlumbingGlyph kind={f.kind} s={s} />
            </g>
          </g>
        ))}

      {selectedRun && <Handles ctx={ctx} path={selectedRun} />}

      {tool.t === 'run' && runPath.length > 0 && (
        <>
          <path d={pathData(proj, preview ?? runPath)} className={cn('fill-none', RUN_STYLE[tool.kind].className)} strokeWidth={RUN_STYLE[tool.kind].width} strokeDasharray="6 4" strokeLinejoin="round" />
          <Handles ctx={ctx} path={runPath} />
        </>
      )}

      {ghostAt && (
        <g transform={`translate(${round(proj.x(ghostAt[0]))} ${round(proj.y(ghostAt[1]))})`} opacity={GHOST_OPACITY}>
          {tool.t === 'electrical' ? <ElectricalGlyph kind={tool.kind} s={s} /> : tool.t === 'plumbing' ? <PlumbingGlyph kind={tool.kind} s={s} /> : null}
        </g>
      )}
    </g>
  );
}
