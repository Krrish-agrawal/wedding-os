import { useState } from 'react';
import { Link } from 'react-router';
import { Copy, GitCompareArrows, Pencil, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import { PRICE_NOTE, costLines, formatInr, studioRoom, type DesignVersion } from '@ave/shared';
import { Button, Card, Notice, Pill, TextField, cn } from '@/ui';
import ChatPanel from '../../ChatPanel';
import { useWedding } from '../../useWedding';
import { StudioScene } from '../StudioScene';
import { SHOWCASE_PRESETS, useStudio } from '../useStudio';
import { CreditsNote, QualityToggle } from '../StudioChrome';
import { compareVersions, describeSource } from './helpers';

const SUGGESTIONS = ['Make the flowers white', 'Make the mandap grander', 'Use more jasmine', 'Give me another version', 'Make the decoration more traditional', 'Reduce the decoration budget'] as const;
const NAMED = new Map([['gold', '#c9a227'], ['marigold', '#f5a623'], ['maroon', '#7a1230'], ['white', '#fffdf2'], ['ivory', '#f5efe6'], ['pink', '#ec7aa3'], ['rose', '#e85d75'], ['red', '#c8102e'], ['green', '#3f7d4e'], ['purple', '#7b61ff'], ['blue', '#2f6fdb'], ['silver', '#c0c0c8']]);
const hexFor = (c: string) => (c.startsWith('#') ? c : NAMED.get(c.toLowerCase()) ?? '#cccccc');
const newId = () => crypto.randomUUID().slice(0, 8);
const date = (iso: string) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** The generated design: a real 3D scene (presentation mode), what it contains and costs, versions, and chat refinement. */
export default function DesignResult({ onAnother, onNew }: { onAnother: () => void; onNew: () => void }) {
  const { state, act } = useWedding();
  const setCamera = useStudio((s) => s.setCamera);
  const [label, setLabel] = useState('');
  const [cmpA, setCmpA] = useState('');
  const [cmpB, setCmpB] = useState('');
  const [note, setNote] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  if (!state) return <p className="text-ink-soft">Loading your design…</p>;

  const d = state.design;
  const active = d.versions.find((v) => v.id === d.activeVersionId) ?? null;
  const src = describeSource(active?.source ?? d.source);
  const brief = active?.brief ?? d.brief;
  const lines = costLines(state.scene.objects);
  const cost = active?.costInr ?? lines.reduce((s, l) => s + l.subtotal, 0);
  const room = studioRoom(state);
  const run = async (a: Parameters<typeof act>[0], ok: string) => { const err = await act(a); setNote(err ? { tone: 'error', text: err } : { tone: 'success', text: ok }); };
  const comparison = (() => { const a = d.versions.find((v) => v.id === cmpA); const b = d.versions.find((v) => v.id === cmpB); return a && b && a.id !== b.id ? compareVersions(a, b) : null; })();
  const vision = (active?.source ?? d.source) === 'vision';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 flex flex-wrap gap-2"><Pill tone={vision ? 'live' : 'warn'}>{src.badge}</Pill><Pill tone="muted">{room.name}</Pill></div>
          <h1 className="font-display text-4xl font-extrabold">{brief?.title ?? (active?.label ?? 'Your wedding design')}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Sparkles} onClick={onAnother}>Create another version</Button>
          <Link to="/studio/edit" className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border-2 border-ink bg-canvas px-4 py-2.5 text-sm font-semibold hover:bg-paper"><Pencil size={16} aria-hidden />Advanced Edit</Link>
          <Button variant="ghost" onClick={onNew}>Start over with new photos</Button>
        </div>
      </header>

      {!vision ? <Notice tone="warn" title={src.badge} body={src.line} live="off" /> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="relative h-[52vh] min-h-[320px] overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-canvas" role="region" aria-label="3D wedding design">
            <StudioScene state={state} readOnly />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-1" role="group" aria-label="Camera views">{SHOWCASE_PRESETS.map((c) => <Button key={c.id} size="sm" variant="ghost" onClick={() => setCamera(c.id)}>{c.label}</Button>)}</div><QualityToggle /></div>
          <p className="text-[13px] text-ink-soft">Drag to look around, scroll to zoom. This is an AI-made layout in a sample venue; it is not a reconstruction of any real venue.</p>
          <CreditsNote />
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="font-display text-xl font-extrabold">About this design</h2>
            {brief ? <p className="text-[15px]">{brief.summary}</p> : <p className="text-ink-soft">{src.line}</p>}
            {brief ? <div><p className="mb-1 text-sm font-semibold">Colour palette</p><ul className="flex flex-wrap gap-2">{brief.palette.map((p) => <li key={p.role + p.color} className="flex items-center gap-1.5 rounded-full border-2 border-line px-2 py-1 text-[13px]"><span className="h-4 w-4 rounded-full border border-ink/30" style={{ background: hexFor(p.color) }} aria-hidden />{p.color} <span className="text-ink-soft">({p.role})</span></li>)}</ul></div> : null}
            <div>
              <p className="mb-1 text-sm font-semibold">Decoration summary</p>
              {lines.length ? <ul className="grid gap-1 text-[14px] sm:grid-cols-2">{lines.map((l) => <li key={l.catalogId} className="flex justify-between gap-2"><span>{l.quantity} × {l.name}</span><span className="tabular text-ink-soft">{formatInr(l.subtotal)}</span></li>)}</ul> : <p className="text-ink-soft">The scene is empty.</p>}
              <p className="tabular mt-2 text-lg font-extrabold">Estimated decoration cost: {formatInr(cost)}</p>
              <p className="text-[12px] text-ink-soft">{PRICE_NOTE}</p>
              {state.budget.limits.decoration !== undefined ? <p className="text-[13px] text-ink-soft">Your decoration limit: {formatInr(state.budget.limits.decoration)}.</p> : null}
            </div>
            {(active?.substitutions.length || brief?.limitations.length) ? (
              <div><p className="mb-1 text-sm font-semibold">What I could not reproduce</p><ul className="list-disc pl-5 text-[14px] text-ink-soft">{[...(active?.substitutions ?? []), ...(brief?.limitations ?? [])].filter((x, i, a) => a.indexOf(x) === i).map((x) => <li key={x}>{x}</li>)}</ul></div>
            ) : null}
            {vision && brief?.provenance.length ? (
              <div><p className="mb-1 text-sm font-semibold">Where the ideas came from</p><ul className="text-[14px] text-ink-soft">{brief.provenance.map((p, i) => <li key={i}>{p.element}: {p.imageIndex === null ? 'general impression' : `inspired by your image ${p.imageIndex + 1}`}</li>)}</ul></div>
            ) : null}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card className="flex min-h-[22rem] flex-col gap-2 p-4">
            <h2 className="font-display text-xl font-extrabold">Refine it by chatting</h2>
            <div className="flex min-h-0 flex-1 flex-col"><ChatPanel compact suggestions={SUGGESTIONS} /></div>
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <h2 className="font-display text-xl font-extrabold">Versions ({d.versions.length}/10)</h2>
            {note ? <Notice tone={note.tone} title={note.text} live="polite" /> : null}
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run({ type: 'snapshot_design_version', id: newId(), label: label.trim() || `Saved ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`, createdAt: new Date().toISOString() }, 'Saved as a new version.').then(() => setLabel('')); }}>
              <TextField className="flex-1" label="Save the current scene as" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="e.g. Plan A" />
              <Button type="submit" icon={Save}>Save</Button>
            </form>
            {d.versions.length === 0 ? <p className="text-sm text-ink-soft">No versions yet.</p> : (
              <ul className="flex flex-col gap-2">
                {[...d.versions].reverse().map((v: DesignVersion) => (
                  <li key={v.id} className={cn('flex flex-col gap-1.5 rounded-[14px] border-2 p-3', v.id === d.activeVersionId ? 'border-ink bg-blue-tint' : 'border-line')}>
                    <div className="flex flex-wrap items-center justify-between gap-1"><span className="font-semibold">{v.label}</span><Pill size="sm" tone={v.source === 'vision' ? 'live' : v.source === 'demo' ? 'warn' : 'muted'}>{describeSource(v.source).badge}</Pill></div>
                    <p className="tabular text-[13px] text-ink-soft">{v.objects.length} pieces · {formatInr(v.costInr)} · {date(v.createdAt)}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="secondary" icon={RotateCcw} disabled={v.id === d.activeVersionId} onClick={() => void run({ type: 'restore_design_version', id: v.id }, `Restored "${v.label}".`)}>{v.id === d.activeVersionId ? 'Showing' : 'Restore'}</Button>
                      <Button size="sm" variant="ghost" icon={Trash2} label={`Delete ${v.label}`} onClick={() => void run({ type: 'delete_design_version', id: v.id }, `Deleted "${v.label}".`)}>Delete</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {d.versions.length >= 2 ? (
              <div className="flex flex-col gap-2 border-t-2 border-line pt-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><GitCompareArrows size={16} aria-hidden />Compare two versions</p>
                <div className="grid grid-cols-2 gap-2">
                  {[['A', cmpA, setCmpA], ['B', cmpB, setCmpB]].map(([n, val, set]) => (
                    <label key={n as string} className="flex flex-col gap-1 text-[13px] font-semibold">Version {n as string}
                      <select value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} className="h-10 rounded-[var(--radius-control)] border-2 border-ink bg-canvas px-2 text-sm"><option value="">Choose…</option>{d.versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
                    </label>
                  ))}
                </div>
                {comparison ? (
                  <table className="w-full text-left text-[13px]"><caption className="sr-only">Comparison of {comparison.a.label} and {comparison.b.label}</caption>
                    <thead><tr><th className="py-1" /><th>{comparison.a.label}</th><th>{comparison.b.label}</th></tr></thead>
                    <tbody>
                      <tr className="border-t border-line"><th scope="row" className="py-1 font-semibold">Estimated cost</th><td className="tabular">{formatInr(comparison.a.costInr)}</td><td className="tabular">{formatInr(comparison.b.costInr)} <span className="text-ink-soft">({comparison.costDifferenceInr >= 0 ? '+' : '−'}{formatInr(Math.abs(comparison.costDifferenceInr))})</span></td></tr>
                      <tr className="border-t border-line"><th scope="row" className="py-1 font-semibold">Pieces</th><td>{comparison.a.pieces}</td><td>{comparison.b.pieces}</td></tr>
                      {comparison.categories.map((c) => <tr key={c.category} className="border-t border-line"><th scope="row" className="py-1 font-normal capitalize text-ink-soft">{c.category}</th><td>{c.a}</td><td>{c.b}</td></tr>)}
                      <tr className="border-t border-line"><th scope="row" className="py-1 font-semibold">Colours</th><td>{comparison.a.palette.join(', ') || '—'}</td><td>{comparison.b.palette.join(', ') || '—'}</td></tr>
                    </tbody>
                  </table>
                ) : <p className="text-[13px] text-ink-soft">Pick two different versions to see cost, pieces and colours side by side.</p>}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
