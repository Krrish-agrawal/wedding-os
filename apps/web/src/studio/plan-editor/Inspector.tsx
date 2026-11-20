import { useEffect, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import {
  ELECTRICAL_KINDS,
  ELECTRICAL_KIND_LABELS,
  PLUMBING_KINDS,
  PLUMBING_KIND_LABELS,
  PLUMBING_LINE_LABELS,
  roomFacts,
  roomFactsSentence,
  type ElectricalKind,
  type PlumbingKind,
  type PlumbingLineKind,
  type PropertyBundle,
} from '@ave/shared';
import { Button, cn } from '@/ui';
import { ElectricalGlyph, PlumbingGlyph, RunSwatch, SWATCH_GLYPH, Swatch } from '@/plan/symbols';
import { LINE_KINDS, allIds, snapTo, type Issue, type Layers, type Selection } from './model';

interface Props {
  bundle: PropertyBundle;
  doc: Layers;
  sel: Selection;
  issues: Issue[];
  mutate: (fn: (l: Layers) => void, mode?: 'commit' | 'replace') => void;
  /** Saves an undo step before a field edit starts; edits then update in place. */
  checkpoint: () => void;
  onSelect: (s: Selection) => void;
  onDelete: () => void;
}

const FIELD = 'h-9 w-full rounded-[10px] border-2 border-line bg-canvas px-2 text-sm focus:border-ink outline-none';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

/** An id field that only applies a new id when it is non-empty and unused. */
function IdField({ id, doc, onRename }: { id: string; doc: Layers; onRename: (next: string) => void }) {
  const [draft, setDraft] = useState(id);
  useEffect(() => setDraft(id), [id]);
  const clash = draft !== id && allIds(doc).includes(draft);
  const valid = /^[a-z0-9][a-z0-9-]*$/.test(draft) && !clash;
  const apply = () => {
    if (draft !== id && valid) onRename(draft);
    else setDraft(id);
  };
  return (
    <Field label="Id">
      <input className={cn(FIELD, !valid && 'border-coral')} value={draft} onChange={(e) => setDraft(e.target.value.trim())} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} />
      {!valid && <span className="mt-1 block text-xs text-coral-deep">{clash ? 'Another item already uses this id.' : 'Lower-case letters, digits and dashes.'}</span>}
    </Field>
  );
}

export function Inspector({ bundle, doc, sel, issues, mutate, checkpoint, onSelect, onDelete }: Props) {
  const { rooms } = bundle;
  const point = sel?.type === 'point' ? doc.electrical.points.find((p) => p.id === sel.id) : undefined;
  const fixture = sel?.type === 'fixture' ? doc.plumbing.fixtures.find((p) => p.id === sel.id) : undefined;
  const circuit = sel?.type === 'circuit' ? doc.electrical.circuits.find((p) => p.id === sel.id) : undefined;
  const line = sel?.type === 'line' ? doc.plumbing.lines.find((p) => p.id === sel.id) : undefined;
  const item = point ?? fixture;

  const updateItem = (fn: (x: NonNullable<typeof item>) => void, mode: 'commit' | 'replace' = 'commit') =>
    mutate((l) => {
      const list: NonNullable<typeof item>[] = sel?.type === 'point' ? l.electrical.points : l.plumbing.fixtures;
      const x = list.find((p) => p.id === sel?.id);
      if (x) fn(x);
    }, mode);

  const rename = (next: string) => {
    if (!sel) return;
    mutate((l) => {
      const lists = { point: l.electrical.points, fixture: l.plumbing.fixtures, circuit: l.electrical.circuits, line: l.plumbing.lines } as const;
      const x = (lists[sel.type] as { id: string }[]).find((p) => p.id === sel.id);
      if (x) x.id = next;
    });
    onSelect({ type: sel.type, id: next });
  };

  return (
    <div className="scroll-quiet flex min-h-0 flex-col gap-3 overflow-y-auto rounded-[var(--radius-card)] border-2 border-ink bg-canvas p-3">
      {item && (
        <>
          <div className="flex items-center gap-2">
            <Swatch size={28}>{point ? <ElectricalGlyph kind={point.kind} s={SWATCH_GLYPH + 3} /> : fixture ? <PlumbingGlyph kind={fixture.kind} s={SWATCH_GLYPH + 3} /> : null}</Swatch>
            <h3 className="min-w-0 flex-1 truncate font-display text-lg font-bold">{point ? ELECTRICAL_KIND_LABELS[point.kind].legend : fixture ? PLUMBING_KIND_LABELS[fixture.kind].legend : ''}</h3>
            <Button size="sm" variant="ghost" icon={Trash2} iconOnly label="Delete (Backspace)" onClick={onDelete} />
          </div>
          <Field label="Kind">
            <select
              className={FIELD}
              value={item.kind}
              onChange={(e) =>
                updateItem((x) => {
                  (x as { kind: string }).kind = e.target.value;
                })
              }
            >
              {(point ? ELECTRICAL_KINDS : PLUMBING_KINDS).map((k) => (
                <option key={k} value={k}>
                  {point ? ELECTRICAL_KIND_LABELS[k as ElectricalKind].legend : PLUMBING_KIND_LABELS[k as PlumbingKind].legend}
                </option>
              ))}
            </select>
          </Field>
          <IdField id={item.id} doc={doc} onRename={rename} />
          <Field label="Room">
            <select className={FIELD} value={item.roomId ?? ''} onChange={(e) => updateItem((x) => void (x.roomId = e.target.value || null))}>
              <option value="">Not in a room</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.id})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Label (optional)">
            <input
              className={FIELD}
              value={item.label ?? ''}
              placeholder="e.g. TV unit, Geyser"
              onFocus={checkpoint}
              onChange={(e) =>
                updateItem((x) => {
                  if (e.target.value) x.label = e.target.value;
                  else delete x.label;
                }, 'replace')
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {(['x', 'z'] as const).map((axis) => (
              <Field key={axis} label={`${axis} (m)`}>
                <input
                  type="number"
                  step={0.05}
                  className={cn(FIELD, 'tabular')}
                  value={item[axis]}
                  onFocus={checkpoint}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) updateItem((x) => void (x[axis] = snapTo(v)), 'replace');
                  }}
                />
              </Field>
            ))}
          </div>
        </>
      )}

      {circuit && (
        <>
          <div className="flex items-center gap-2">
            <RunSwatch kind="circuit" size={28} />
            <h3 className="min-w-0 flex-1 truncate font-display text-lg font-bold">Circuit run</h3>
            <Button size="sm" variant="ghost" icon={Trash2} iconOnly label="Delete (Backspace)" onClick={onDelete} />
          </div>
          <Field label="Name">
            <input
              className={FIELD}
              value={circuit.name}
              onFocus={checkpoint}
              onChange={(e) =>
                mutate((l) => {
                  const c = l.electrical.circuits.find((x) => x.id === circuit.id);
                  if (c) c.name = e.target.value;
                }, 'replace')
              }
            />
          </Field>
          <Field label="Breaker rating (optional)">
            <input
              className={FIELD}
              value={circuit.rating ?? ''}
              placeholder="e.g. 16 A"
              onFocus={checkpoint}
              onChange={(e) =>
                mutate((l) => {
                  const c = l.electrical.circuits.find((x) => x.id === circuit.id);
                  if (!c) return;
                  if (e.target.value) c.rating = e.target.value;
                  else delete c.rating;
                }, 'replace')
              }
            />
          </Field>
          <IdField id={circuit.id} doc={doc} onRename={rename} />
          <p className="text-ink-soft">{circuit.path.length} corners. Drag the square handles on the plan to reshape.</p>
        </>
      )}

      {line && (
        <>
          <div className="flex items-center gap-2">
            <RunSwatch kind={line.kind} size={28} />
            <h3 className="min-w-0 flex-1 truncate font-display text-lg font-bold">{PLUMBING_LINE_LABELS[line.kind]}</h3>
            <Button size="sm" variant="ghost" icon={Trash2} iconOnly label="Delete (Backspace)" onClick={onDelete} />
          </div>
          <Field label="Kind">
            <select
              className={FIELD}
              value={line.kind}
              onChange={(e) =>
                mutate((l) => {
                  const x = l.plumbing.lines.find((y) => y.id === line.id);
                  if (x) x.kind = e.target.value as PlumbingLineKind;
                })
              }
            >
              {LINE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PLUMBING_LINE_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <IdField id={line.id} doc={doc} onRename={rename} />
          <p className="text-ink-soft">{line.path.length} corners. Drag the square handles on the plan to reshape.</p>
        </>
      )}

      {!sel && (
        <>
          <h3 className="font-display text-lg font-bold">What each room has</h3>
          <ul className="space-y-2">
            {rooms.map((r) => {
              const f = roomFacts(doc, r, rooms);
              return (
                <li key={r.id} className="rounded-[12px] bg-paper p-2 text-[12.5px] leading-snug">
                  <p>{roomFactsSentence(f, 'electrical')}</p>
                  <p className="text-ink-soft">{roomFactsSentence(f, 'plumbing')}</p>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {issues.length > 0 && (
        <div className="mt-auto border-t-2 border-line pt-2">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Checks</p>
          <ul className="space-y-1">
            {issues.map((i) => (
              <li key={i.text} className={cn('rounded-[8px] px-2 py-1 text-[12px]', i.level === 'error' ? 'bg-coral-tint text-coral-deep' : 'bg-sun-tint text-ink')}>
                {i.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
