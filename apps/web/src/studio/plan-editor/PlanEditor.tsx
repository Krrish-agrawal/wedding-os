import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Copy, MousePointer2, Redo2, Save, Undo2, WandSparkles } from 'lucide-react';
import {
  ELECTRICAL_KINDS,
  ELECTRICAL_KIND_LABELS,
  PLUMBING_KINDS,
  PLUMBING_KIND_LABELS,
  PLUMBING_LINE_LABELS,
  type PropertyBundle,
  type Vec2,
} from '@ave/shared';
import { content } from '@/content';
import { Button, EmptyState, Notice, cn } from '@/ui';
import { PlanCanvas } from '@/plan/PlanCanvas';
import { RoomLabels } from '@/plan/furniture';
import type { PlanProjection } from '@/plan/geometry';
import { draftPlan } from '@/plan/draft';
import { LevelSwitch, usePlanLevel } from '@/plan/levels';
import { ElectricalGlyph, PlumbingGlyph, RunSwatch, SWATCH_GLYPH, Swatch, type RunKind } from '@/plan/symbols';
import { EditorDrawing } from './EditorDrawing';
import { Inspector } from './Inspector';
import {
  cleanPath,
  cloneLayers,
  layersOnLevel,
  magnet,
  moveAttached,
  nextId,
  nextVertex,
  pick,
  pickHandle,
  roomIdAt,
  sameLayers,
  snapPoint,
  validate,
  type Layers,
  type Selection,
  type Tool,
  type Visible,
} from './model';

/**
 * Studio plan editor: the plan render with tools to drop and move electrical and plumbing symbols,
 * draw circuit runs and pipes, assign rooms, and save plan.json (electrical and plumbing only;
 * `bounds` belongs to the 3D workstream and is kept as it is on disk).
 */
export default function PlanEditor() {
  const [propertyId, setPropertyId] = useState(content.properties[0]?.property.id ?? '');
  const bundle = content.byId[propertyId];
  if (!bundle) return <EmptyState title="No properties to edit" body="Add a property under data/properties first." />;
  return <Editor key={propertyId} bundle={bundle} onProperty={setPropertyId} />;
}

interface History {
  past: Layers[];
  present: Layers;
  future: Layers[];
}

const HISTORY_LIMIT = 200;
/** Saves only plan layers; the dev server keeps `bounds` from the file on disk. */
const planLayersUrl = (id: string) => `/api/dev/properties/${encodeURIComponent(id)}/plan-layers`;
/** Server answers that mean the endpoint does not exist or refuses this file. */
const NOT_SUPPORTED = new Set([403, 404, 405]);

const RUN_KINDS: readonly RunKind[] = ['circuit', 'cold', 'hot', 'drain'];
const RUN_LABELS: Record<RunKind, string> = { circuit: 'Circuit run', ...PLUMBING_LINE_LABELS };

type Status = { tone: 'success' | 'error' | 'info'; text: string } | null;

function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
}

function Editor({ bundle, onProperty }: { bundle: PropertyBundle; onProperty: (id: string) => void }) {
  const { property, rooms } = bundle;
  const [h, setH] = useState<History>(() => ({ past: [], present: cloneLayers(bundle.plan), future: [] }));
  const [saved, setSaved] = useState<Layers>(() => cloneLayers(bundle.plan));
  const doc = h.present;
  const [tool, setTool] = useState<Tool>({ t: 'select' });
  const [sel, setSel] = useState<Selection>(null);
  const [visible, setVisible] = useState<Visible>({ electrical: true, plumbing: true });
  const [runPath, setRunPath] = useState<Vec2[]>([]);
  const [cursor, setCursor] = useState<{ m: Vec2; free: boolean } | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [exportText, setExportText] = useState<string | null>(null);
  const [confirmDraft, setConfirmDraft] = useState(false);
  const [busy, setBusy] = useState(false);

  const { level, setLevel, levels } = usePlanLevel(bundle, null);
  const onLevel = useMemo(() => layersOnLevel(doc, level, rooms), [doc, level, rooms]);
  /** Runs and points drawn on other levels carry their level; level 0 is the default and stays implicit. */
  const levelField = level === 0 ? {} : { level };
  const projRef = useRef<PlanProjection | null>(null);
  const symbolRef = useRef(16);
  const drag = useRef<{ sel: NonNullable<Selection>; index: number | null; last: Vec2 | null } | null>(null);
  const live = useRef({ doc, sel, tool, runPath, levelField });
  live.current = { doc, sel, tool, runPath, levelField };

  const mutate = (fn: (l: Layers) => void, mode: 'commit' | 'replace' = 'commit') =>
    setH((s) => {
      const next = cloneLayers(s.present);
      fn(next);
      return mode === 'commit' ? { past: [...s.past, s.present].slice(-HISTORY_LIMIT), present: next, future: [] } : { ...s, present: next };
    });
  const checkpoint = () => setH((s) => ({ past: [...s.past, s.present].slice(-HISTORY_LIMIT), present: s.present, future: [] }));
  const undo = () => setH((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1]!, future: [s.present, ...s.future] } : s));
  const redo = () => setH((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0]!, future: s.future.slice(1) } : s));

  const issues = useMemo(() => validate(doc, bundle.plan.bounds, rooms), [doc, bundle.plan.bounds, rooms]);
  const errors = issues.filter((i) => i.level === 'error');
  const dirty = !sameLayers(doc, saved);

  const finishRun = (path: Vec2[]) => {
    const t = live.current.tool;
    const clean = cleanPath(path);
    setRunPath([]);
    if (t.t !== 'run' || clean.length < 2) return;
    const id = nextId(live.current.doc, t.kind);
    const lf = live.current.levelField;
    mutate((l) => {
      if (t.kind === 'circuit') l.electrical.circuits.push({ id, name: `Circuit ${l.electrical.circuits.length + 1}`, path: clean, ...lf });
      else l.plumbing.lines.push({ id, kind: t.kind, path: clean, ...lf });
    });
    setSel(t.kind === 'circuit' ? { type: 'circuit', id } : { type: 'line', id });
  };

  const removeSelection = () => {
    const s = live.current.sel;
    if (!s) return;
    mutate((l) => {
      if (s.type === 'point') l.electrical.points = l.electrical.points.filter((p) => p.id !== s.id);
      if (s.type === 'fixture') l.plumbing.fixtures = l.plumbing.fixtures.filter((p) => p.id !== s.id);
      if (s.type === 'circuit') l.electrical.circuits = l.electrical.circuits.filter((p) => p.id !== s.id);
      if (s.type === 'line') l.plumbing.lines = l.plumbing.lines.filter((p) => p.id !== s.id);
    });
    setSel(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod) return;
      const { runPath: path, tool: t } = live.current;
      if (e.key === 'Escape') {
        if (path.length) setRunPath([]);
        else if (t.t !== 'select') setTool({ t: 'select' });
        else setSel(null);
      } else if (e.key === 'Enter' && path.length) {
        finishRun(path);
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && path.length) {
        e.preventDefault();
        setRunPath(path.slice(0, -1));
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        removeSelection();
      } else if (e.key === 'v' || e.key === 'V') {
        setRunPath([]);
        setTool({ t: 'select' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Handlers read the latest state through `live`, so binding once is enough.
  }, []);

  const local = (e: ReactPointerEvent<SVGSVGElement> | ReactMouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const proj = projRef.current;
    if (!proj || e.button !== 0) return;
    const { sx, sy } = local(e);
    const m = proj.toModel(sx, sy);
    if (tool.t === 'select') {
      if (sel && (sel.type === 'circuit' || sel.type === 'line')) {
        const path = sel.type === 'circuit' ? doc.electrical.circuits.find((c) => c.id === sel.id)?.path : doc.plumbing.lines.find((c) => c.id === sel.id)?.path;
        const i = path ? pickHandle(path, proj, sx, sy) : -1;
        if (i >= 0) {
          checkpoint();
          drag.current = { sel, index: i, last: null };
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }
      const hit = pick(onLevel, proj, sx, sy, symbolRef.current, visible);
      setSel(hit);
      if (hit && (hit.type === 'point' || hit.type === 'fixture')) {
        checkpoint();
        const item = (hit.type === 'point' ? doc.electrical.points : doc.plumbing.fixtures).find((x) => x.id === hit.id);
        drag.current = { sel: hit, index: null, last: item ? [item.x, item.z] : null };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (tool.t === 'electrical' || tool.t === 'plumbing') {
      const p = snapPoint(m);
      const id = nextId(doc, tool.kind);
      const roomId = roomIdAt(rooms, p, level);
      // A point inside a room takes the room's level; one outside every room records its own.
      const own = roomId ? {} : levelField;
      if (tool.t === 'electrical') {
        const kind = tool.kind;
        mutate((l) => void l.electrical.points.push({ id, kind, x: p[0], z: p[1], roomId, ...own }));
        setSel({ type: 'point', id });
      } else {
        const kind = tool.kind;
        mutate((l) => void l.plumbing.fixtures.push({ id, kind, x: p[0], z: p[1], roomId, ...own }));
        setSel({ type: 'fixture', id });
      }
      return;
    }
    // Drawing a run: each click adds a vertex, straight from the last unless Alt is held.
    const last = runPath[runPath.length - 1] ?? null;
    const pts = [...runPath];
    const target = magnet(onLevel, proj, sx, sy);
    if (target) {
      if (last && !e.altKey && last[0] !== target[0] && last[1] !== target[1]) pts.push([target[0], last[1]]);
      pts.push(target);
    } else {
      pts.push(nextVertex(last, m, e.altKey));
    }
    setRunPath(cleanPath(pts));
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const proj = projRef.current;
    if (!proj) return;
    const { sx, sy } = local(e);
    const m = proj.toModel(sx, sy);
    setCursor({ m, free: e.altKey });
    const d = drag.current;
    if (!d) return;
    const p = snapPoint(m);
    const from = d.last;
    if (from && from[0] === p[0] && from[1] === p[1]) return;
    if (d.index === null) d.last = p;
    mutate((l) => {
      if (d.sel.type === 'point' || d.sel.type === 'fixture') {
        const list = d.sel.type === 'point' ? l.electrical.points : l.plumbing.fixtures;
        const item = list.find((x) => x.id === d.sel.id);
        if (from) moveAttached(l, from, p, level);
        if (item) {
          item.x = p[0];
          item.z = p[1];
          item.roomId = roomIdAt(rooms, p, level);
          if (item.roomId || level === 0) delete item.level;
          else item.level = level;
        }
      } else if (d.index !== null) {
        const run = d.sel.type === 'circuit' ? l.electrical.circuits.find((x) => x.id === d.sel.id) : l.plumbing.lines.find((x) => x.id === d.sel.id);
        if (run) run.path[d.index] = p;
      }
    }, 'replace');
  };

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  const runDraft = () => {
    const next = draftPlan(property, rooms);
    mutate((l) => {
      l.electrical = next.electrical;
      l.plumbing = next.plumbing;
    });
    setSel(null);
    setConfirmDraft(false);
    setStatus({ tone: 'info', text: 'Drafted from rooms.json. Check every symbol against the render before saving.' });
  };

  const fullJson = () => {
    // Bounds come from the current content, so a save never changes what the 3D workstream wrote.
    const bounds = content.byId[property.id]?.plan.bounds ?? bundle.plan.bounds;
    return `${JSON.stringify({ bounds, electrical: doc.electrical, plumbing: doc.plumbing }, null, 2)}\n`;
  };

  const copyJson = async (reason?: string) => {
    const text = fullJson();
    setExportText(text);
    try {
      await navigator.clipboard.writeText(text);
      setStatus({ tone: 'info', text: reason ?? `Copied plan.json for ${property.id}.` });
    } catch {
      setStatus({ tone: 'info', text: reason ?? 'Select the JSON below and copy it.' });
    }
  };

  const save = async () => {
    if (errors.length) {
      setStatus({ tone: 'error', text: `Fix ${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} before saving.` });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(planLayersUrl(property.id), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ electrical: doc.electrical, plumbing: doc.plumbing }),
      });
      if (res.ok) {
        setSaved(cloneLayers(doc));
        setExportText(null);
        setStatus({ tone: 'success', text: `Saved data/properties/${property.id}/plan.json.` });
      } else if (NOT_SUPPORTED.has(res.status)) {
        await copyJson(`The dev server does not write plan layers yet. The JSON is below (and on the clipboard if allowed): paste it into data/properties/${property.id}/plan.json.`);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus({ tone: 'error', text: body.error ?? `Save failed (${res.status}).` });
      }
    } catch {
      await copyJson('Could not reach the dev server. The JSON is below to paste into the file by hand.');
    } finally {
      setBusy(false);
    }
  };

  const toolHint =
    tool.t === 'select'
      ? 'Click to select, drag to move. Delete removes. Drag a run’s square handles to reshape it.'
      : tool.t === 'run'
        ? 'Click to add corners (straight lines; hold Alt for any angle). Ends snap onto symbols. Enter or double-click finishes, Esc cancels.'
        : 'Click to place. Esc returns to select.';

  const cursorRoom = cursor ? rooms.find((r) => r.id === roomIdAt(rooms, cursor.m, level))?.name ?? 'outside the rooms' : null;

  return (
    <div className="flex h-full min-h-[620px] flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 font-display text-xl font-bold">Plan editor</h2>
        <select className="h-9 rounded-[12px] border-2 border-ink bg-canvas px-2 font-semibold" value={property.id} onChange={(e) => onProperty(e.target.value)} aria-label="Property">
          {content.properties.map((b) => (
            <option key={b.property.id} value={b.property.id}>
              {b.property.name}
            </option>
          ))}
        </select>
        <LevelSwitch
          levels={levels}
          level={level}
          onLevel={(n) => {
            setRunPath([]);
            setSel(null);
            setLevel(n);
          }}
          accent="grape"
        />
        {(['electrical', 'plumbing'] as const).map((k) => (
          <label key={k} className="flex h-9 items-center gap-1.5 rounded-[12px] border-2 border-line px-2.5 font-semibold">
            <input type="checkbox" checked={visible[k]} onChange={(e) => setVisible({ ...visible, [k]: e.target.checked })} />
            {k === 'electrical' ? 'Electrical' : 'Plumbing'}
          </label>
        ))}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" icon={Undo2} iconOnly label="Undo (Cmd+Z)" onClick={undo} disabled={!h.past.length} />
        <Button size="sm" variant="ghost" icon={Redo2} iconOnly label="Redo (Shift+Cmd+Z)" onClick={redo} disabled={!h.future.length} />
        {confirmDraft ? (
          <>
            <span className="font-semibold">Replace both layers with a fresh draft?</span>
            <Button size="sm" variant="danger" onClick={runDraft}>
              Replace
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmDraft(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" icon={WandSparkles} onClick={() => setConfirmDraft(true)}>
            Draft from rooms
          </Button>
        )}
        <Button size="sm" variant="secondary" icon={Copy} onClick={() => void copyJson()}>
          Copy JSON
        </Button>
        <Button size="sm" icon={Save} busy={busy} onClick={() => void save()} disabled={!dirty && !exportText}>
          {dirty ? 'Save plan.json' : 'Saved'}
        </Button>
      </div>

      {status && <Notice tone={status.tone === 'error' ? 'error' : status.tone === 'success' ? 'success' : 'info'} title={status.text} live="polite" />}

      <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)_290px] gap-3">
        <Palette
          tool={tool}
          onTool={(t) => {
            setRunPath([]);
            setTool(t);
          }}
        />

        <div className="relative flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-canvas">
          <div className="relative min-h-0 flex-1">
            <PlanCanvas
              bundle={bundle}
              tint="grape"
              ariaLabel={`Plan editor for ${property.name}`}
              imageOpacity={0.7}
              interactiveRooms={false}
              level={level}
              svgProps={{
                onPointerDown,
                onPointerMove,
                onPointerUp: endDrag,
                onPointerCancel: endDrag,
                onPointerLeave: () => setCursor(null),
                onDoubleClick: () => live.current.runPath.length && finishRun(live.current.runPath),
                className: cn('absolute inset-0 block select-none touch-none', tool.t === 'select' ? 'cursor-default' : 'cursor-crosshair'),
              }}
              labels={(ctx) => <RoomLabels ctx={ctx} mode="corner" />}
            >
              {(ctx) => {
                projRef.current = ctx.proj;
                symbolRef.current = ctx.symbol;
                return <EditorDrawing ctx={ctx} doc={onLevel} sel={sel} visible={visible} tool={tool} runPath={runPath} cursor={cursor} />;
              }}
            </PlanCanvas>
          </div>
          <div className="flex items-center gap-3 border-t-2 border-line px-3 py-2 text-[12px] text-ink-soft">
            <span className="min-w-0 flex-1 truncate">{toolHint}</span>
            {cursor && (
              <span className="shrink-0 font-semibold tabular text-ink">
                x {cursor.m[0].toFixed(2)} · z {cursor.m[1].toFixed(2)} · {cursorRoom}
              </span>
            )}
          </div>
        </div>

        <Inspector bundle={bundle} doc={doc} sel={sel} issues={issues} mutate={mutate} checkpoint={checkpoint} onSelect={setSel} onDelete={removeSelection} />
      </div>

      {exportText && (
        <div className="rounded-[var(--radius-card)] border-2 border-ink bg-canvas p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-semibold">data/properties/{property.id}/plan.json</p>
            <Button size="sm" variant="ghost" onClick={() => setExportText(null)}>
              Close
            </Button>
          </div>
          <textarea readOnly value={exportText} className="h-48 w-full rounded-[10px] border-2 border-line p-2 font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} aria-label="plan.json contents" />
        </div>
      )}
    </div>
  );
}

function PaletteButton({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center gap-2 rounded-[10px] border-2 px-2 py-1 text-left text-[13px] font-semibold transition-colors duration-100',
        active ? 'border-ink bg-grape-tint' : 'border-transparent hover:bg-paper',
      )}
    >
      {children}
      <span className="truncate">{label}</span>
    </button>
  );
}

function Palette({ tool, onTool }: { tool: Tool; onTool: (t: Tool) => void }) {
  const is = (t: Tool) => JSON.stringify(t) === JSON.stringify(tool);
  return (
    <div className="scroll-quiet flex min-h-0 flex-col gap-3 overflow-y-auto rounded-[var(--radius-card)] border-2 border-ink bg-canvas p-2">
      <PaletteButton active={tool.t === 'select'} onClick={() => onTool({ t: 'select' })} label="Select and move (V)">
        <span className="grid h-6 w-6 place-items-center">
          <MousePointer2 size={16} strokeWidth={2.25} aria-hidden />
        </span>
      </PaletteButton>
      <section>
        <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Electrical</p>
        {ELECTRICAL_KINDS.map((k) => (
          <PaletteButton key={k} active={is({ t: 'electrical', kind: k })} onClick={() => onTool({ t: 'electrical', kind: k })} label={ELECTRICAL_KIND_LABELS[k].legend}>
            <Swatch>
              <ElectricalGlyph kind={k} s={SWATCH_GLYPH} />
            </Swatch>
          </PaletteButton>
        ))}
      </section>
      <section>
        <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Plumbing</p>
        {PLUMBING_KINDS.map((k) => (
          <PaletteButton key={k} active={is({ t: 'plumbing', kind: k })} onClick={() => onTool({ t: 'plumbing', kind: k })} label={PLUMBING_KIND_LABELS[k].legend}>
            <Swatch>
              <PlumbingGlyph kind={k} s={SWATCH_GLYPH} />
            </Swatch>
          </PaletteButton>
        ))}
      </section>
      <section>
        <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Runs</p>
        {RUN_KINDS.map((k) => (
          <PaletteButton key={k} active={is({ t: 'run', kind: k })} onClick={() => onTool({ t: 'run', kind: k })} label={RUN_LABELS[k]}>
            <RunSwatch kind={k} />
          </PaletteButton>
        ))}
      </section>
    </div>
  );
}
