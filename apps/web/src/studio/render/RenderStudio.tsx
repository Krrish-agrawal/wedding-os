import { useEffect, useMemo, useRef, useState } from 'react';
import type { CameraShot } from '@ave/shared';
import { content } from '@/content';
import { Button, cn } from '@/ui';
import { useModelState } from '@/three/modelStore';
import { mediaFileName, saveMedia, savePlanBounds } from '../shots/devApi';
import { renderHero, renderPlan, type Bounds } from './offscreen';
import { propertyLevels } from '@/three/levels';

/** Default plan resolution; 120 px per metre keeps a 25 m apartment under 3,200 px wide. */
const DEFAULT_PX_PER_METRE = 120;
/** Chest height above each level's floor for the section cut, metres. */
const CUT_ABOVE_FLOOR = 1.3;
/** Margin added around the model when proposing bounds, metres. */
const BOUNDS_MARGIN = 0.4;
const BOUNDS_STEP = 0.1;
const HERO_SIZE = { width: 1600, height: 1000 } as const;

type Preview = { url: string; blob: Blob; kind: 'plan' | 'hero'; width: number; height: number; fileName: string; bounds?: Bounds };

function roundBounds(b: Bounds): Bounds {
  const down = (v: number) => Math.floor(v / BOUNDS_STEP) * BOUNDS_STEP;
  const up = (v: number) => Math.ceil(v / BOUNDS_STEP) * BOUNDS_STEP;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { minX: r(down(b.minX - BOUNDS_MARGIN)), maxX: r(up(b.maxX + BOUNDS_MARGIN)), minZ: r(down(b.minZ - BOUNDS_MARGIN)), maxZ: r(up(b.maxZ + BOUNDS_MARGIN)) };
}

/**
 * Renders each property's top-down plan base image (orthographic, cut at chest height) and its
 * hero image, previews them over the room polygons, and saves them through the dev API.
 */
export default function RenderStudio() {
  const [propertyId, setPropertyId] = useState(content.properties[0]?.property.id ?? '');
  const bundle = content.byId[propertyId];
  const property = bundle?.property;
  const levels = useMemo(() => (property ? propertyLevels(property) : []), [property]);
  const [levelIndex, setLevelIndex] = useState(0);
  const level = levels[Math.min(levelIndex, levels.length - 1)];
  const state = useModelState(property?.model.url ?? null);
  const model = state.status === 'ready' ? state.model : null;

  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [cutY, setCutY] = useState(CUT_ABOVE_FLOOR);
  const [pxPerMetre, setPxPerMetre] = useState(DEFAULT_PX_PER_METRE);
  const [shotId, setShotId] = useState('overview');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showRooms, setShowRooms] = useState(true);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Proposed bounds: saved ones if they cover the model, otherwise the model's interior plus a margin.
  useEffect(() => {
    if (!model || !bundle) return;
    const m = model.bounds;
    const proposed = roundBounds({ minX: m.min.x, maxX: m.max.x, minZ: m.min.z, maxZ: m.max.z });
    const saved = bundle.plan.bounds;
    const covers = saved.minX <= m.min.x && saved.maxX >= m.max.x && saved.minZ <= m.min.z && saved.maxZ >= m.max.z;
    setBounds(covers ? saved : proposed);
  }, [model, bundle]);

  useEffect(() => {
    if (level) setCutY(Math.round((level.floorY + CUT_ABOVE_FLOOR) * 100) / 100);
  }, [level]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  if (!bundle || !property) return null;
  const shots: { id: string; label: string; shot: CameraShot }[] = [
    { id: 'overview', label: 'Overview', shot: bundle.tour.overview },
    ...bundle.tour.stops.map((s) => ({ id: s.id, label: s.label, shot: s })),
  ];

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doPlan = () =>
    run(async () => {
      if (!model || !bounds || !level) return;
      const { blob, width, height } = await renderPlan({ model, bounds, cutY, pxPerMetre });
      setPreview({ url: URL.createObjectURL(blob), blob, kind: 'plan', width, height, fileName: mediaFileName(level.planImage), bounds });
    });

  const doHero = () =>
    run(async () => {
      const s = shots.find((x) => x.id === shotId);
      if (!model || !s) return;
      const blob = await renderHero({ model, property, shot: s.shot, ...HERO_SIZE });
      setPreview({ url: URL.createObjectURL(blob), blob, kind: 'hero', ...HERO_SIZE, fileName: mediaFileName(property.heroImage) });
    });

  const save = () =>
    run(async () => {
      if (!preview) return;
      const saved = await saveMedia(property.id, preview.fileName, preview.blob);
      let note = `Saved ${saved.path} (${Math.round(preview.blob.size / 1024)} KB)`;
      if (preview.kind === 'plan' && preview.bounds) {
        await savePlanBounds(property.id, preview.bounds);
        note += ' and plan.json bounds';
      }
      setMessage(note);
    });

  const setBound = (key: keyof Bounds, v: number) => bounds && setBounds({ ...bounds, [key]: v });
  const levelRooms = bundle.rooms.filter((r) => (r.level ?? 0) === (level?.index ?? 0));
  const pb = preview?.bounds;

  return (
    <div className="grid h-full grid-cols-[320px_1fr]">
      <aside className="flex flex-col gap-3 overflow-auto border-r-2 border-line p-3 text-sm">
        <label className="flex flex-col gap-1 font-semibold">
          Property
          <select className="rounded-[12px] border-2 border-line px-2 py-2 font-normal" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            {content.properties.map((b) => (
              <option key={b.property.id} value={b.property.id}>
                {b.property.name} ({b.property.id})
              </option>
            ))}
          </select>
        </label>
        <p className="text-ink-soft">Model: {state.status === 'ready' ? `${state.model.triangles.toLocaleString('en-IN')} triangles` : state.status}</p>

        <section className="flex flex-col gap-2 rounded-[14px] border-2 border-line p-3">
          <h2 className="font-display text-base font-bold">Plan image</h2>
          {levels.length > 1 && (
            <label className="flex items-center justify-between gap-2">
              Level
              <select className="rounded-[10px] border-2 border-line px-2 py-1" value={levelIndex} onChange={(e) => setLevelIndex(Number(e.target.value))}>
                {levels.map((l, i) => (
                  <option key={l.index} value={i}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {bounds && (
            <div className="grid grid-cols-2 gap-2">
              {(['minX', 'maxX', 'minZ', 'maxZ'] as const).map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <span className="w-10 font-mono text-xs">{k}</span>
                  <input type="number" step={BOUNDS_STEP} className="w-full rounded-[8px] border-2 border-line px-2 py-1 font-mono" value={bounds[k]} onChange={(e) => setBound(k, Number(e.target.value))} />
                </label>
              ))}
            </div>
          )}
          <label className="flex items-center justify-between gap-2">
            Cut height (m)
            <input type="number" step={0.05} className="w-24 rounded-[8px] border-2 border-line px-2 py-1 font-mono" value={cutY} onChange={(e) => setCutY(Number(e.target.value))} />
          </label>
          <label className="flex items-center justify-between gap-2">
            Pixels per metre
            <input type="number" step={10} min={20} max={200} className="w-24 rounded-[8px] border-2 border-line px-2 py-1 font-mono" value={pxPerMetre} onChange={(e) => setPxPerMetre(Number(e.target.value))} />
          </label>
          <Button size="sm" onClick={doPlan} disabled={!model || !bounds || busy}>
            Render plan
          </Button>
        </section>

        <section className="flex flex-col gap-2 rounded-[14px] border-2 border-line p-3">
          <h2 className="font-display text-base font-bold">Hero image</h2>
          <select className="rounded-[10px] border-2 border-line px-2 py-1" value={shotId} onChange={(e) => setShotId(e.target.value)}>
            {shots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" onClick={doHero} disabled={!model || busy}>
            Render hero ({HERO_SIZE.width}×{HERO_SIZE.height})
          </Button>
        </section>

        {preview && (
          <Button size="sm" variant="confirm" onClick={save} disabled={busy}>
            Save {preview.fileName}
            {preview.kind === 'plan' ? ' and bounds' : ''}
          </Button>
        )}
        {message && <p className="rounded-[10px] bg-paper p-2">{message}</p>}
        {preview?.kind === 'plan' && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showRooms} onChange={(e) => setShowRooms(e.target.checked)} />
            Show room polygons
          </label>
        )}
        {hover && <p className="font-mono text-xs">x {hover[0].toFixed(2)}, z {hover[1].toFixed(2)}</p>}
      </aside>

      <div className="min-h-0 overflow-auto bg-paper p-4">
        {preview ? (
          <div className="relative inline-block border-2 border-ink bg-canvas">
            <img
              ref={imgRef}
              src={preview.url}
              alt={preview.kind === 'plan' ? 'Plan render preview' : 'Hero render preview'}
              className="block max-w-none"
              style={{ width: Math.min(preview.width, 1600) }}
              onMouseMove={(e) => {
                if (!pb || !imgRef.current) return;
                const r = imgRef.current.getBoundingClientRect();
                const u = (e.clientX - r.left) / r.width;
                const v = (e.clientY - r.top) / r.height;
                setHover([pb.minX + u * (pb.maxX - pb.minX), pb.minZ + v * (pb.maxZ - pb.minZ)]);
              }}
              onMouseLeave={() => setHover(null)}
            />
            {pb && showRooms && (
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`${pb.minX} ${pb.minZ} ${pb.maxX - pb.minX} ${pb.maxZ - pb.minZ}`} preserveAspectRatio="none">
                {levelRooms.map((r) => (
                  <g key={r.id}>
                    <polygon points={r.polygon.map((p) => p.join(',')).join(' ')} fill="rgba(9,157,253,0.12)" stroke="#0b6fd6" strokeWidth={0.04} />
                  </g>
                ))}
              </svg>
            )}
            {pb && showRooms && (
              <div className="pointer-events-none absolute inset-0">
                {levelRooms.map((r) => {
                  const cx = r.polygon.reduce((s, p) => s + p[0], 0) / r.polygon.length;
                  const cz = r.polygon.reduce((s, p) => s + p[1], 0) / r.polygon.length;
                  return (
                    <span
                      key={r.id}
                      className={cn('absolute -translate-x-1/2 -translate-y-1/2 rounded bg-canvas/90 px-1 text-xs font-semibold text-blue-deep')}
                      style={{ left: `${((cx - pb.minX) / (pb.maxX - pb.minX)) * 100}%`, top: `${((cz - pb.minZ) / (pb.maxZ - pb.minZ)) * 100}%` }}
                    >
                      {r.name} · {r.areaSqft} sq ft
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <p className="text-ink-soft">Render a plan or hero image to preview it here.</p>
        )}
      </div>
    </div>
  );
}
