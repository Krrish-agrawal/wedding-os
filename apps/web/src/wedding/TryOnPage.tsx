import { authHeaders } from './api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, GitCompareArrows, Heart, ShieldCheck, Trash2, Wand2 } from 'lucide-react';
import { CATEGORY_INFO, CATEGORY_LABELS, GARMENT_CATEGORIES, GARMENTS, TRYON_DISCLAIMER, findGarment, type Garment, type GarmentCategory } from '@ave/shared';
import { Button, Card, ICON_STROKE, Notice, Pill, cn } from '@/ui';
import { garmentThumb } from '@/tryon/garmentArt';
import { MAX_PHOTO_BYTES, TryOnEngine, TryOnError, preparePhoto, validatePhoto, type PreparedPhoto } from '@/tryon/runtime';
import { useWedding } from './useWedding';
import { removeAllThumbs, removeThumb, setThumb, thumbOf } from './tryon/thumbs';
import { SavedLooks } from './tryon/SavedLooks';

interface Result { garmentId: string; url: string; canvas: HTMLCanvasElement }
interface PlannerRequest { id: string; kind: 'preview' | 'compare'; garmentIds: string[] }

const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders(url) }, body: JSON.stringify(body) }).catch(() => undefined);

/** Virtual Outfit Try-On. The photo never leaves this browser: it is decoded, segmented and warped here. */
export default function TryOnPage() {
  const { id: weddingId, state, act } = useWedding();
  const engine = useRef<TryOnEngine | null>(null);
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState<(PreparedPhoto & { url: string }) | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(GARMENTS.find((g) => g.supported)!.id);
  const [filter, setFilter] = useState<GarmentCategory | 'all'>('all');
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [keepThumb, setKeepThumb] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [requests, setRequests] = useState<PlannerRequest[]>([]);

  const garment = findGarment(selected)!;
  const result = results[selected];

  useEffect(() => () => { engine.current?.dispose(); }, []);

  // Pick up try-on requests the planner recorded. They only ask; this page does the real work.
  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/wedding/${weddingId}/tryon-requests`, { headers: authHeaders(`/api/wedding/${weddingId}/tryon-requests`) });
        if (r.ok && live) setRequests(((await r.json()) as { requests: PlannerRequest[] }).requests);
      } catch { /* server unreachable: the manual flow still works */ }
    };
    void poll();
    const t = setInterval(poll, 3000);
    return () => { live = false; clearInterval(t); };
  }, [weddingId]);

  const clearResults = useCallback((keep?: Record<string, Result>) => {
    setResults((prev) => { for (const r of Object.values(prev)) URL.revokeObjectURL(r.url); return keep ?? {}; });
  }, []);

  async function onFile(file: File | undefined) {
    setPhotoError(null); setError(null);
    if (!file) return;
    const bad = validatePhoto(file);
    if (bad) return setPhotoError(bad);
    try {
      const p = await preparePhoto(file);
      setPhoto((old) => { if (old) { old.bitmap.close(); URL.revokeObjectURL(old.url); } return { ...p, url: URL.createObjectURL(file) }; });
      clearResults();
    } catch (e) { setPhotoError(e instanceof Error ? e.message : 'That photo could not be used.'); }
  }

  async function generate(g: Garment, request?: PlannerRequest) {
    if (!photo || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      engine.current ??= new TryOnEngine();
      const canvas = await engine.current.generate(photo, g);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new TryOnError('The preview could not be encoded.', 'engine_failed');
      const url = URL.createObjectURL(blob);
      setResults((prev) => { if (prev[g.id]) URL.revokeObjectURL(prev[g.id]!.url); return { ...prev, [g.id]: { garmentId: g.id, url, canvas } }; });
      if (request) await post(`/api/wedding/${weddingId}/tryon-requests/${request.id}/complete`, { status: 'generated' });
    } catch (e) {
      const msg = e instanceof TryOnError ? e.message : 'The try-on failed unexpectedly.';
      setError(msg);
      if (request) await post(`/api/wedding/${weddingId}/tryon-requests/${request.id}/complete`, { status: 'failed', message: msg });
    } finally { setBusy(false); }
  }

  async function save() {
    if (!result) return;
    const lookId = `look-${crypto.randomUUID().slice(0, 8)}`;
    const err = await act({ type: 'save_outfit', outfit: { id: lookId, label: garment.name.replace(/ \(.*\)$/, '') , garmentId: garment.id } });
    if (err) return setError(err);
    if (keepThumb && !setThumb(lookId, thumbOf(result.canvas))) setNotice('Saved the look, but this browser would not store the thumbnail.');
    else setNotice(keepThumb ? 'Look saved. A small thumbnail is kept on this device only.' : 'Look saved (no image is stored).');
  }

  function wipe() {
    clearResults();
    removeAllThumbs();
    engine.current?.dispose(); engine.current = null;
    setPhoto((old) => { if (old) { old.bitmap.close(); URL.revokeObjectURL(old.url); } return null; });
    setCompare([]); setConsent(false); setError(null);
    setNotice('Your photo and all generated images were deleted from this browser. Saved looks (just the outfit choices) remain; delete them from the list below if you want.');
  }

  const toggleCompare = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c.slice(-1), id]));
  const visible = useMemo(() => GARMENTS.filter((g) => filter === 'all' || g.category === filter), [filter]);
  const planner = requests.filter((r) => r.kind === 'preview' && !!findGarment(r.garmentIds[0]!));
  const compareReq = requests.find((r) => r.kind === 'compare');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <header>
        <h1 className="font-display text-4xl font-extrabold">Virtual Outfit Try-On</h1>
        <p className="mt-1 text-ink-soft">See an outfit on your own photo. It all happens in this browser.</p>
      </header>

      <Notice tone="warn" icon={ShieldCheck} title="Previews are approximations" body={TRYON_DISCLAIMER} live="off" />

      {planner.length > 0 ? (
        <Notice tone="info" title="Your planner asked for a preview" body={`${planner.map((r) => findGarment(r.garmentIds[0]!)!.name).join(', ')}. The planner cannot make images: upload a photo below and press Generate.`}
          actions={photo ? <Button size="sm" busy={busy} onClick={() => { const r = planner[0]!; const g = findGarment(r.garmentIds[0]!)!; setSelected(g.id); void generate(g, r); }}>Generate for planner</Button> : undefined} />
      ) : null}
      {compareReq ? <Notice tone="info" title="Your planner asked to compare looks" body="Generate each outfit below, then tick two in “Your previews” to compare them side by side." /> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 font-display text-xl font-extrabold"><Camera size={20} strokeWidth={ICON_STROKE} aria-hidden />1. Your photo</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I agree to use my photo for this preview. It is processed on this device only, is not uploaded or stored on any server, and I can delete it at any time.</span>
          </label>
          <input aria-label="Upload a photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={!consent} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} className="text-sm disabled:opacity-50" />
          <p className="text-[13px] text-ink-soft">JPEG, PNG or WebP, up to {MAX_PHOTO_BYTES / 1048576} MB. A full-length, front-facing photo works best.</p>
          {photoError ? <p role="alert" className="text-sm font-semibold text-coral">{photoError}</p> : null}
          {photo ? <img src={photo.url} alt="Your uploaded photo" className="max-h-80 w-full rounded-[var(--radius-control)] border-2 border-line object-contain bg-paper" /> : null}
          <Button variant="danger" size="sm" icon={Trash2} onClick={wipe} disabled={!photo && Object.keys(results).length === 0}>Delete my photo and generated images</Button>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 font-display text-xl font-extrabold"><Wand2 size={20} strokeWidth={ICON_STROKE} aria-hidden />2. Choose an outfit</h2>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Outfit categories">
            {(['all', ...GARMENT_CATEGORIES] as const).map((c) => (
              <button key={c} role="tab" aria-selected={filter === c} onClick={() => setFilter(c)} className={cn('rounded-full border-2 px-3 py-1 text-[13px] font-semibold', filter === c ? 'border-ink bg-blue-tint' : 'border-line')}>
                {c === 'all' ? 'All' : CATEGORY_LABELS[c]}{c !== 'all' && CATEGORY_INFO[c].status === 'future' ? ' (future)' : ''}
              </button>
            ))}
          </div>
          {filter !== 'all' ? <p className="text-[13px] text-ink-soft"><b>{CATEGORY_INFO[filter].status}:</b> {CATEGORY_INFO[filter].note}</p> : null}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {visible.map((g) => (
              <li key={g.id}>
                <button onClick={() => g.supported && setSelected(g.id)} disabled={!g.supported} aria-pressed={selected === g.id}
                  className={cn('flex w-full flex-col items-center gap-1 rounded-[var(--radius-control)] border-2 p-2 text-center', selected === g.id ? 'border-ink bg-blue-tint' : 'border-line', !g.supported && 'opacity-60')}>
                  <img src={garmentThumb(g)} alt={`Illustration of ${g.name}`} className="h-28 object-contain" />
                  <span className="text-[13px] font-semibold leading-tight">{g.name.replace(/ \(.*\)$/, '')}</span>
                  <Pill tone={g.status === 'supported' ? 'live' : g.status === 'experimental' ? 'warn' : 'muted'} size="sm">{g.status === 'future' ? 'Future option' : g.status}</Pill>
                </button>
              </li>
            ))}
          </ul>
          {garment.status === 'experimental' ? <Notice tone="warn" title="Experimental" body={garment.statusNote} live="off" /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={Wand2} busy={busy} disabled={!photo || !consent} onClick={() => void generate(garment)}>{busy ? 'Generating…' : 'Generate preview'}</Button>
            {!photo ? <span className="text-sm text-ink-soft">Upload a photo first.</span> : null}
          </div>
          {error ? <Notice tone="error" title="No preview was made" body={error} live="assertive" /> : null}
        </Card>
      </div>

      {Object.keys(results).length > 0 ? (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-display text-xl font-extrabold">Your previews</h2>
          <ul className="flex flex-wrap gap-3">
            {Object.values(results).map((r) => (
              <li key={r.garmentId} className="flex w-40 flex-col gap-1">
                <img src={r.url} alt={`Preview: ${findGarment(r.garmentId)?.name ?? r.garmentId}`} className="h-52 w-full rounded-[var(--radius-control)] border-2 border-line object-contain bg-paper" />
                <label className="flex items-center gap-1 text-[13px]"><input type="checkbox" checked={compare.includes(r.garmentId)} onChange={() => toggleCompare(r.garmentId)} />Compare</label>
              </li>
            ))}
          </ul>
          {result ? (
            <div className="flex flex-wrap items-center gap-3 border-t-2 border-line pt-3">
              <Button icon={Heart} variant="secondary" onClick={() => void save()}>Save look: {garment.name.replace(/ \(.*\)$/, '')}</Button>
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={keepThumb} onChange={(e) => setKeepThumb(e.target.checked)} />Keep a small thumbnail on this device</label>
            </div>
          ) : null}
          {notice ? <p role="status" className="text-sm font-semibold">{notice}</p> : null}
        </Card>
      ) : notice ? <p role="status" className="text-sm font-semibold">{notice}</p> : null}

      {compare.length === 2 && compare.every((id) => results[id]) ? (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 font-display text-xl font-extrabold"><GitCompareArrows size={20} strokeWidth={ICON_STROKE} aria-hidden />Side by side</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {compare.map((id) => (
              <figure key={id} className="flex flex-col gap-1">
                <img src={results[id]!.url} alt={`Preview: ${findGarment(id)?.name}`} className="max-h-[28rem] w-full rounded-[var(--radius-control)] border-2 border-line object-contain bg-paper" />
                <figcaption className="text-sm font-semibold">{findGarment(id)?.name}</figcaption>
              </figure>
            ))}
          </div>
        </Card>
      ) : null}

      <SavedLooks />
    </div>
  );
}

void removeThumb;
