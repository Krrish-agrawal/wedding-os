import { useEffect, useRef, useState } from 'react';
import { Camera, CircleHelp, Copy, Redo2, RotateCcw, RotateCw, Save, Trash2, Undo2, ZoomIn, ZoomOut, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { DECOR_CATALOG, MAX_SCALE, MIN_SCALE, findEntry, formatInr, sceneCost, studioRoom, type CatalogEntry, type DecorCategory } from '@ave/shared';
import { Button, Card, Notice, Pill, TextField, cn } from '@/ui';
import ChatPanel from '../ChatPanel';
import { useWedding } from '../useWedding';
import { StudioScene } from './StudioScene';
import { CAMERA_PRESETS, useStudio } from './useStudio';
import { CreditsNote, QualityToggle } from './StudioChrome';

const GROUPS: { id: DecorCategory; label: string }[] = [
  { id: 'stage', label: 'Stage' }, { id: 'mandap', label: 'Mandaps' }, { id: 'arch', label: 'Arches' }, { id: 'floral', label: 'Flowers' }, { id: 'seating', label: 'Seating' }, { id: 'table', label: 'Tables' }, { id: 'ritual', label: 'Ritual & floor art' }, { id: 'lighting', label: 'Lighting' },
];
const SWATCHES: { name: string; hex: string }[] = [
  { name: 'Crimson', hex: '#b3123f' }, { name: 'Saffron', hex: '#e8590c' }, { name: 'Marigold', hex: '#f5a623' }, { name: 'Yellow', hex: '#f6c453' }, { name: 'Pink', hex: '#ec7aa3' }, { name: 'Ivory', hex: '#f5efe6' },
  { name: 'White', hex: '#fffdf2' }, { name: 'Green', hex: '#3f7d4e' }, { name: 'Purple', hex: '#7b61ff' }, { name: 'Gold', hex: '#c9a227' }, { name: 'Maroon', hex: '#7a1230' }, { name: 'Silver', hex: '#c0c0c8' },
];
const STEP = Math.PI / 12; // 15 degrees
const newId = () => crypto.randomUUID().slice(0, 8);

/** A colour input that commits once when the picker closes, not on every drag inside it (one undo step per change). */
function ColorInput({ value, label, onCommit }: { value: string; label: string; onCommit: (hex: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = () => onCommit(el.value);
    el.addEventListener('change', h);
    return () => el.removeEventListener('change', h);
  }, [onCommit]);
  return <input ref={ref} type="color" defaultValue={value} key={value} aria-label={label} className="h-11 w-11 shrink-0 cursor-pointer rounded-[12px] border-2 border-ink bg-canvas p-0.5" />;
}

export default function StudioPage() {
  const { state, act, meta } = useWedding();
  const { selectedId, select, note, setNote, setCamera, helpDismissed, dismissHelp } = useStudio();
  const [designName, setDesignName] = useState('');
  const [tab, setTab] = useState<'edit' | 'planner'>('edit');

  const selected = state?.scene.objects.find((o) => o.id === selectedId) ?? null;
  const entry = selected ? findEntry(DECOR_CATALOG, selected.catalogId) : undefined;

  useEffect(() => {
    if (selectedId && state && !selected) select(null);
  }, [selectedId, selected, state, select]);

  async function run(a: Parameters<typeof act>[0], after?: () => void) {
    const err = await act(a);
    setNote(err ? { tone: 'error', text: err } : null);
    if (!err) after?.();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void run({ type: e.shiftKey ? 'redo_scene' : 'undo_scene' });
      } else if (e.key.startsWith('Arrow') && useStudio.getState().selectedId) {
        // Arrow keys nudge the selection by 10 cm (the grid), Shift for 50 cm. Each press is one validated move.
        const id = useStudio.getState().selectedId!;
        const o = useWedding.getState().state?.scene.objects.find((x) => x.id === id);
        if (!o) return;
        e.preventDefault();
        const step = e.shiftKey ? 0.5 : 0.1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dz = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        void run({ type: 'move_decor', id, x: o.position.x + dx, z: o.position.z + dz });
      } else if ((e.key === '[' || e.key === ']') && useStudio.getState().selectedId) {
        const id = useStudio.getState().selectedId!;
        const o = useWedding.getState().state?.scene.objects.find((x) => x.id === id);
        if (!o || o.mount === 'wall') return;
        void run({ type: 'rotate_decor', id, rotationY: o.rotationY + (e.key === '[' ? STEP : -STEP) });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && useStudio.getState().selectedId) {
        e.preventDefault();
        void run({ type: 'remove_decor', id: useStudio.getState().selectedId! });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state) return <p className="text-ink-soft">Loading the studio…</p>;
  const room = studioRoom(state);
  const canUndo = state.sceneHistory.past.length > 0;
  const canRedo = state.sceneHistory.future.length > 0;
  const estimate = sceneCost(state.scene.objects);
  const limit = state.budget.limits.decoration;

  function add(e: CatalogEntry, mount?: 'floor' | 'stage' | 'wall' | 'ceiling') {
    const id = newId();
    void run({ type: 'add_decor', id, catalogId: e.id, ...(mount ? { mount } : {}) }, () => select(id));
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-[1400px] flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl font-extrabold">3D Wedding Studio</h1>
          <p className="text-sm text-ink-soft">{room.name} · {state.scene.objects.length} {state.scene.objects.length === 1 ? 'decoration' : 'decorations'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={limit !== undefined && estimate > limit ? 'error' : 'neutral'} size="sm">Decoration ≈ {formatInr(estimate)}{limit !== undefined ? ` / limit ${formatInr(limit)}` : ''} · sample prices</Pill>
          <Pill tone="waiting" size="sm">Sample venue{room.outdoor ? ' · open-air (no ceiling pieces)' : ''}</Pill>
          <Button size="md" variant="secondary" icon={Undo2} disabled={!canUndo} onClick={() => void run({ type: 'undo_scene' })}>Undo</Button>
          <Button size="md" variant="secondary" icon={Redo2} disabled={!canRedo} onClick={() => void run({ type: 'redo_scene' })}>Redo</Button>
          <Button size="md" variant="ghost" icon={Trash2} disabled={state.scene.objects.length === 0} onClick={() => void run({ type: 'clear_scene' })}>Clear</Button>
        </div>
      </header>
      {note ? <Notice tone={note.tone === 'error' ? 'warn' : 'info'} title={note.tone === 'error' ? "That didn't work" : 'Note'} body={note.text} live="polite" /> : null}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_21rem]">
        <Card className="relative min-h-[320px] overflow-hidden p-0" aria-label="Studio viewport">
          <StudioScene state={state} />
          <div role="group" aria-label="Camera views" className="absolute left-3 top-3 flex flex-wrap items-center gap-1 rounded-[14px] border-2 border-ink bg-canvas/95 p-1">
            <Camera size={16} aria-hidden className="mx-1.5" />
            {CAMERA_PRESETS.filter((c) => c.id !== 'entrance' && c.id !== 'guest').map((c) => <Button key={c.id} size="sm" variant="ghost" onClick={() => setCamera(c.id)}>{c.label}</Button>)}
          </div>
          <div className="absolute right-3 top-3 rounded-[14px] border-2 border-ink bg-canvas/95 p-1.5"><QualityToggle /></div>
          {helpDismissed ? (
            <Button size="sm" variant="secondary" className="absolute bottom-3 right-3" icon={CircleHelp} onClick={() => useStudio.setState({ helpDismissed: false })}>Help</Button>
          ) : (
            <div role="note" aria-label="How to use the studio" className="absolute bottom-3 left-3 right-3 max-w-md rounded-[14px] border-2 border-ink bg-canvas/95 p-3 text-[13px] shadow-[var(--shadow-pop-sm)]">
              <p className="font-bold">Quick guide</p>
              <ul className="mt-1 list-disc pl-4 text-ink-soft">
                <li><strong className="text-ink">Move:</strong> drag an object, or select it and use the arrow keys (Shift = bigger steps).</li>
                <li><strong className="text-ink">Rotate:</strong> select it, then “Rotate” buttons or [ and ].</li>
                <li><strong className="text-ink">Look around:</strong> drag empty space; scroll to zoom; the camera buttons jump to useful views.</li>
                <li><strong className="text-ink">Undo:</strong> Ctrl/Cmd+Z. Delete key removes the selection.</li>
              </ul>
              <Button size="sm" variant="ghost" className="mt-1" onClick={dismissHelp}>Got it</Button>
            </div>
          )}
        </Card>

        <div className="flex min-h-0 flex-col gap-2">
          <div role="tablist" aria-label="Studio panel" className="grid shrink-0 grid-cols-2 gap-1 rounded-[var(--radius-control)] border-2 border-ink bg-paper p-1">
            {([['edit', 'Edit'], ['planner', 'Ask the planner']] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)} className={cn('h-9 rounded-[10px] text-sm font-bold', tab === id ? 'bg-canvas shadow-[var(--shadow-pop-sm)] border-2 border-ink' : 'text-ink-soft')}>{label}</button>
            ))}
          </div>
          {tab === 'planner' ? <ChatPanel compact /> : null}
        <aside hidden={tab !== 'edit'} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 scroll-quiet">
          {selected && entry ? (
            <Card className="flex flex-col gap-3 p-4" aria-label="Selected decoration">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-extrabold">{entry.name}</h2>
                <Pill size="sm" tone="blue">{selected.mount}</Pill>
              </div>
              <p className="text-[12px] font-bold uppercase tracking-wide text-ink-soft">Turn (15° per press)</p>
              <div className="grid grid-cols-2 gap-2">
                {selected.mount !== 'wall' ? (
                  <>
                    <Button variant="secondary" icon={RotateCcw} onClick={() => void run({ type: 'rotate_decor', id: selected.id, rotationY: selected.rotationY + STEP })}>Turn left</Button>
                    <Button variant="secondary" icon={RotateCw} onClick={() => void run({ type: 'rotate_decor', id: selected.id, rotationY: selected.rotationY - STEP })}>Turn right</Button>
                  </>
                ) : <p className="col-span-2 text-[13px] text-ink-soft">Wall pieces face into the room and cannot be turned. Drag along the wall to move them.</p>}
              </div>
              <p className="text-[12px] font-bold uppercase tracking-wide text-ink-soft">Size</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" icon={ZoomOut} disabled={selected.scale <= MIN_SCALE + 1e-6} onClick={() => void run({ type: 'scale_decor', id: selected.id, scale: Math.max(MIN_SCALE, +(selected.scale - 0.1).toFixed(2)) })}>Smaller</Button>
                <Button variant="secondary" icon={ZoomIn} disabled={selected.scale >= MAX_SCALE - 1e-6} onClick={() => void run({ type: 'scale_decor', id: selected.id, scale: Math.min(MAX_SCALE, +(selected.scale + 0.1).toFixed(2)) })}>Bigger</Button>
              </div>
              <p className="text-[13px] text-ink-soft">Size ×{selected.scale.toFixed(2)} · at {selected.position.x.toFixed(1)}, {selected.position.z.toFixed(1)} m{selected.position.y > 0 ? ` · ${selected.position.y.toFixed(1)} m up` : ''}</p>
              <p className="-mb-1 text-[12px] font-bold uppercase tracking-wide text-ink-soft">Move 0.5 m</p>
              <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Move by half a metre (arrow keys move 10 cm)">
                {([['Left', ArrowLeft, -0.5, 0], ['Forward', ArrowUp, 0, -0.5], ['Back', ArrowDown, 0, 0.5], ['Right', ArrowRight, 0.5, 0]] as const).map(([label, Icon, dx, dz]) => (
                  <Button key={label} iconOnly variant="secondary" icon={Icon} label={`Nudge ${label}`} onClick={() => void run({ type: 'move_decor', id: selected.id, x: selected.position.x + dx, z: selected.position.z + dz })} />
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-bold">Colours</p>
                {entry.parts.map((part) => {
                  const current = selected.colors[part.id] ?? part.color;
                  return (
                    <div key={part.id} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <ColorInput value={current} label={`${part.label} colour`} onCommit={(hex) => void run({ type: 'set_decor_color', id: selected.id, part: part.id, color: hex })} />
                        <span className="text-sm font-semibold">{part.label}<span className="ml-1 font-normal text-ink-soft">{SWATCHES.find((x) => x.hex === current.toLowerCase())?.name ?? current}</span></span>
                        {selected.colors[part.id] ? <button type="button" className="ml-auto text-xs font-semibold text-ink-soft underline" onClick={() => void run({ type: 'set_decor_color', id: selected.id, part: part.id, color: null })}>Reset</button> : null}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {SWATCHES.map((sw) => (
                          <button key={sw.hex} type="button" title={sw.name} aria-label={`Set ${part.label} to ${sw.name}`} aria-pressed={current.toLowerCase() === sw.hex} onClick={() => void run({ type: 'set_decor_color', id: selected.id, part: part.id, color: sw.hex })} className={cn('h-7 w-7 rounded-full border-2', current.toLowerCase() === sw.hex ? 'border-ink ring-2 ring-blue' : 'border-ink/30')} style={{ background: sw.hex }} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" icon={Copy} onClick={() => { const id = newId(); void run({ type: 'duplicate_decor', id: selected.id, newId: id }, () => select(id)); }}>Duplicate</Button>
                <Button variant="danger" icon={Trash2} onClick={() => void run({ type: 'remove_decor', id: selected.id })}>Delete</Button>
              </div>
            </Card>
          ) : (
            <Notice tone="info" title="Select a decoration" body="Click one in the venue to rotate, resize, recolour, duplicate or delete it." live="off" />
          )}

          <Card className="flex flex-col gap-3 p-4" aria-label="Catalogue">
            <h2 className="font-display text-lg font-extrabold">Add decorations</h2>
            {GROUPS.map((g) => {
              const items = DECOR_CATALOG.filter((e) => e.category === g.id);
              return (
                <div key={g.id} className="flex flex-col gap-1.5">
                  <p className="text-[13px] font-bold text-ink-soft">{g.label}</p>
                  {items.map((e) => (
                    <div key={e.id} className="flex items-center gap-2">
                      <Button className="min-w-0 flex-1 justify-start" variant="secondary" onClick={() => add(e)}><span className="truncate">{e.name}</span></Button>
                      {e.mounts.includes('stage') ? <Button size="md" variant="ghost" onClick={() => add(e, 'stage')} title="Place on a wedding stage">On stage</Button> : null}
                    </div>
                  ))}
                </div>
              );
            })}
          </Card>

          <Card className="flex flex-col gap-3 p-4" aria-label="Saved designs">
            <h2 className="font-display text-lg font-extrabold">Designs</h2>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const name = designName.trim(); if (name) void run({ type: 'save_design', id: newId(), name }, () => setDesignName('')); }}>
              <TextField className="min-w-0 flex-1" label="Save this layout as" value={designName} onChange={(e) => setDesignName(e.target.value)} maxLength={60} placeholder="e.g. Reception plan A" />
              <Button type="submit" icon={Save} disabled={!designName.trim()}>Save</Button>
            </form>
            {state.designs.length === 0 ? <p className="text-sm text-ink-soft">No saved designs yet.</p> : (
              <ul className="flex flex-col gap-1.5">
                {state.designs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 rounded-[12px] border-2 border-line p-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{d.name}<span className="ml-1 font-normal text-ink-soft">({d.objects.length})</span></span>
                    <Button size="sm" variant="secondary" onClick={() => void run({ type: 'load_design', id: d.id })}>Load</Button>
                    <Button size="sm" iconOnly variant="ghost" icon={Trash2} label={`Delete ${d.name}`} onClick={() => void run({ type: 'delete_design', id: d.id })} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {meta ? <p className="px-1 text-xs text-ink-soft">{meta.notice}</p> : null}
        </aside>
        </div>
      </div>
      <CreditsNote />
    </div>
  );
}
