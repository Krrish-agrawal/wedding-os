import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ImagePlus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { NAMED_COLORS, SAMPLE_VENUES, WEDDING_STYLES, formatInr, type DesignForm } from '@ave/shared';
import { Button, Card, ICON_STROKE, Notice, Pill, TextField, cn } from '@/ui';
import { useWedding } from '../../useWedding';
import { designApi, type DesignStatus } from './designApi';
import { MAX_FILES, acceptFiles } from './validation';

interface Photo { key: string; file: File; url: string; state: 'ready' | 'uploading' | 'uploaded' | 'error'; imageId?: string; error?: string }

const PALETTE: { name: string; hex: string }[] = ['marigold', 'maroon', 'gold', 'white', 'ivory', 'pink', 'rose', 'red', 'green', 'purple', 'blue', 'silver', 'warm white'].map((name) => ({ name, hex: NAMED_COLORS[name]! }));
const ROLE = ['Main', 'Second', 'Accent'] as const;

/** The default Studio page: describe the wedding you dream of and upload photographs you love. No 3D controls here. */
export default function DesignStart({ onStart }: { onStart: (job: { form: DesignForm; venueId: string; imageIds: string[] }) => void }) {
  const { state, id } = useWedding();
  const [status, setStatus] = useState<DesignStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [style, setStyle] = useState('');
  const [description, setDescription] = useState('');
  const [guests, setGuests] = useState('');
  const [budget, setBudget] = useState('');
  const [colors, setColors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photosRef = useRef<Photo[]>([]);
  photosRef.current = photos;

  useEffect(() => { designApi.status(id).then(setStatus).catch((e: Error) => setStatusError(e.message)); }, [id]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);
  useEffect(() => {
    if (!state) return;
    setGuests((g) => g || String(state.profile.guestCount));
    setStyle((s) => s || state.profile.style);
    setVenueId((v) => v ?? state.venueId ?? SAMPLE_VENUES[0]!.id);
    const limit = state.budget.limits.decoration;
    if (limit !== undefined) setBudget((b) => b || String(limit));
  }, [state]);

  const guestN = Number(guests);
  const budgetN = budget.trim() === '' ? null : Number(budget);
  const vision = status?.visionConfigured === true;
  const demo = status !== null && !vision;
  const retention = status?.limits.retentionHours ?? 24;
  const formError = useMemo(() => {
    if (!venueId) return 'Choose a venue.';
    if (!Number.isInteger(guestN) || guestN < 1 || guestN > 5000) return 'Enter a guest count from 1 to 5000.';
    if (budgetN !== null && (!Number.isInteger(budgetN) || budgetN < 0)) return 'The decoration budget must be a whole number of rupees.';
    const v = SAMPLE_VENUES.find((x) => x.id === venueId);
    if (v && v.capacity < guestN) return `${v.name} holds ${v.capacity} guests.`;
    return null;
  }, [venueId, guestN, budgetN]);

  function addFiles(list: FileList | File[], replaceKey?: string) {
    const free = MAX_FILES - photos.length + (replaceKey ? 1 : 0);
    const { accepted, rejected } = acceptFiles([...list], free);
    setProblems(rejected);
    if (accepted.length === 0) return;
    const fresh: Photo[] = accepted.map((file) => ({ key: crypto.randomUUID(), file, url: URL.createObjectURL(file), state: 'ready' }));
    setPhotos((cur) => {
      if (replaceKey) { const old = cur.find((p) => p.key === replaceKey); if (old) URL.revokeObjectURL(old.url); if (old?.imageId) void designApi.deleteImage(id, old.imageId).catch(() => undefined); return cur.flatMap((p) => (p.key === replaceKey ? fresh.slice(0, 1) : [p])); }
      return [...cur, ...fresh];
    });
  }

  function removePhoto(p: Photo) {
    URL.revokeObjectURL(p.url);
    setPhotos((cur) => cur.filter((x) => x.key !== p.key));
    if (p.imageId) void designApi.deleteImage(id, p.imageId).catch(() => undefined);
  }

  async function submit() {
    if (formError || busy || !venueId) return;
    setBusy(true);
    setError(null);
    const imageIds: string[] = [];
    // In sample mode photos are never uploaded: nothing would read them, and we must not imply otherwise.
    if (vision) {
      let failed = false;
      for (const p of photosRef.current) {
        if (p.imageId) { imageIds.push(p.imageId); continue; }
        setPhotos((c) => c.map((x) => (x.key === p.key ? { ...x, state: 'uploading', error: undefined } : x)));
        try {
          const r = await designApi.upload(id, p.file);
          imageIds.push(r.image.id);
          setPhotos((c) => c.map((x) => (x.key === p.key ? { ...x, state: 'uploaded', imageId: r.image.id } : x)));
        } catch (e) {
          failed = true;
          setPhotos((c) => c.map((x) => (x.key === p.key ? { ...x, state: 'error', error: (e as Error).message } : x)));
        }
      }
      if (failed) { setBusy(false); setError('Some photos could not be uploaded. Remove or replace them, or continue without them.'); return; }
      if (imageIds.length === 0) { setBusy(false); setError('Add at least one inspiration photograph so the AI has something to look at.'); return; }
    }
    onStart({ form: { description: description.trim(), style: style.trim(), guestCount: guestN, decorationBudgetInr: budgetN, palette: colors }, venueId, imageIds });
    setBusy(false);
  }

  const togglePalette = (name: string) => setColors((c) => (c.includes(name) ? c.filter((x) => x !== name) : c.length >= 3 ? c : [...c, name]));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <h1 className="font-display text-4xl font-extrabold">Create your dream wedding</h1>
        <p className="mt-1 text-lg text-ink-soft">Upload the wedding photographs you love. Our AI will create a wedding design inspired by them.</p>
      </header>

      {statusError ? <Notice tone="error" title="The design service is not reachable" body={statusError} live="assertive" />
        : demo ? <Notice tone="warn" title="Sample design mode" body="Sample design mode: your photographs will NOT be analysed (no vision model configured). The studio will build a sample design from the choices below, and your photos are not uploaded." live="off" />
        : vision ? <Notice tone="success" title="AI photo analysis is on" body={`Photos are sent to a vision model (${status?.visionModel ?? 'configured on the server'}) to describe the style. The studio then places the decorations itself. It never rebuilds your real venue.`} live="off" /> : null}

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-display text-xl font-extrabold">1. Inspiration photographs</h2>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          className="flex flex-col items-center gap-2 rounded-[16px] border-2 border-dashed border-ink/40 bg-paper p-6 text-center"
        >
          <ImagePlus size={28} strokeWidth={ICON_STROKE} aria-hidden />
          <p className="font-semibold">Drop up to {MAX_FILES} photos here</p>
          <p className="text-sm text-ink-soft">JPEG, PNG or WebP, up to 6 MB each.</p>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="Choose inspiration photographs" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
          <Button variant="secondary" disabled={photos.length >= MAX_FILES} onClick={() => fileInput.current?.click()}>Choose photos</Button>
        </div>
        {problems.length > 0 ? <Notice tone="error" title="Some files were not added" body={problems.join(' ')} live="assertive" actions={<Button size="sm" variant="ghost" icon={X} onClick={() => setProblems([])}>Dismiss</Button>} /> : null}
        {photos.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Selected photographs">
            {photos.map((p, i) => (
              <li key={p.key} className="flex flex-col gap-1.5 rounded-[14px] border-2 border-line p-2">
                <img src={p.url} alt={`Inspiration photo ${i + 1}`} className="h-32 w-full rounded-[10px] object-cover" />
                <div className="flex items-center justify-between gap-1 text-[12px]">
                  <span className="truncate text-ink-soft">{p.file.name}</span>
                  {p.state === 'uploading' ? <Pill size="sm" tone="waiting">Uploading…</Pill> : p.state === 'uploaded' ? <Pill size="sm" tone="live" icon={Check}>Uploaded</Pill> : p.state === 'error' ? <Pill size="sm" tone="error">Failed</Pill> : demo ? <Pill size="sm" tone="muted">Not uploaded</Pill> : null}
                </div>
                {p.error ? <p className="text-[12px] text-coral-deep">{p.error}</p> : null}
                <div className="flex gap-1">
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-[10px] border-2 border-line px-2 py-1 text-[12px] font-semibold hover:border-ink">
                    <RefreshCw size={12} aria-hidden />Replace
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={`Replace photo ${i + 1}`} onChange={(e) => { if (e.target.files) addFiles(e.target.files, p.key); e.target.value = ''; }} />
                  </label>
                  <Button size="sm" variant="ghost" icon={Trash2} label={`Remove photo ${i + 1}`} onClick={() => removePhoto(p)}>Remove</Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {vision ? <p className="text-[13px] text-ink-soft">Photos are stored privately for {retention} hours and deleted when you ask (Remove deletes them from the server).</p> : null}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-display text-xl font-extrabold">2. Venue</h2>
        <ul className="grid gap-3 sm:grid-cols-3" aria-label="Venues">
          {SAMPLE_VENUES.map((v) => {
            const small = Number.isInteger(guestN) && v.capacity < guestN;
            const selected = venueId === v.id;
            return (
              <li key={v.id}>
                <button type="button" disabled={small} aria-pressed={selected} onClick={() => setVenueId(v.id)} className={cn('flex h-full w-full flex-col gap-1 rounded-[14px] border-2 p-3 text-left transition-colors disabled:opacity-50', selected ? 'border-ink bg-blue-tint shadow-[var(--shadow-pop-sm)]' : 'border-line hover:border-ink')}>
                  <span className="font-semibold">{v.name}</span>
                  <span className="text-[13px] text-ink-soft">{v.indoor ? 'Indoor' : 'Outdoor'} · up to {v.capacity} guests · {v.city}</span>
                  <span className="text-[13px] text-ink-soft">{v.blurb}</span>
                  {small ? <span className="text-[13px] font-semibold text-coral-deep">Too small for {guestN} guests</span> : null}
                  <Pill size="sm" tone="warn">Sample venue</Pill>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-display text-xl font-extrabold">3. Your wedding</h2>
        <div>
          <p className="mb-1.5 text-sm font-semibold">Wedding style</p>
          <div className="flex flex-wrap gap-1.5">
            {WEDDING_STYLES.map((s) => <button key={s} type="button" aria-pressed={style === s} onClick={() => setStyle(s)} className={cn('rounded-[var(--radius-chip)] border-2 px-3 py-1.5 text-[13px] font-semibold', style === s ? 'border-ink bg-blue-tint' : 'border-line text-ink-soft hover:border-ink')}>{s}</button>)}
          </div>
          <TextField className="mt-2" label="Or describe your style" value={style} onChange={(e) => setStyle(e.target.value)} maxLength={60} />
        </div>
        <label className="flex flex-col gap-1 text-sm font-semibold">Describe your dream wedding (optional)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} placeholder="e.g. A temple-style South Indian wedding with jasmine garlands, brass lamps and warm lighting." className="rounded-[var(--radius-control)] border-2 border-ink/25 bg-canvas p-3 text-[15px] font-normal outline-none focus:border-ink" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Guest count" type="number" min={1} max={5000} value={guests} onChange={(e) => setGuests(e.target.value)} />
          <TextField label="Decoration budget (₹, optional)" type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} hint={budgetN !== null && Number.isInteger(budgetN) ? formatInr(budgetN) : 'Leave empty for no limit'} />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-semibold">Preferred colours (pick up to 3: {ROLE.join(', ').toLowerCase()} in the order you tap)</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Colour palette">
            {PALETTE.map((c) => {
              const n = colors.indexOf(c.name);
              return (
                <button key={c.name} type="button" onClick={() => togglePalette(c.name)} aria-pressed={n >= 0} aria-label={`${c.name}${n >= 0 ? `, ${ROLE[n]!.toLowerCase()} colour` : ''}`} className={cn('relative h-10 w-10 rounded-full border-2', n >= 0 ? 'border-ink ring-2 ring-ink/30' : 'border-line')} style={{ background: c.hex }}>
                  {n >= 0 ? <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-ink text-[11px] font-bold text-canvas">{n + 1}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {formError ? <p role="alert" className="text-sm font-semibold text-coral-deep">{formError}</p> : null}
      {error ? <Notice tone="error" title="Couldn't start" body={error} live="assertive" /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" icon={Sparkles} busy={busy} disabled={Boolean(formError) || !status || Boolean(statusError)} onClick={() => void submit()}>Generate My Wedding Design</Button>
        {demo ? <span className="text-sm text-ink-soft">Builds a labelled sample design.</span> : null}
      </div>
    </div>
  );
}
