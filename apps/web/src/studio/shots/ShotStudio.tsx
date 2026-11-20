import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { NeutralToneMapping, Plane, Vector3, type Group, type Object3D } from 'three';
import { TourFileSchema, type CameraShot, type TourFile, type TourStop, type Vec3 } from '@ave/shared';
import { content } from '@/content';
import { Button, cn } from '@/ui';
import { RoomLight } from '@/three/RoomLight';
import { LIGHT, SKY_COLOUR } from '@/three/lighting';
import { propertyLevels } from '@/three/levels';
import { useModelState } from '@/three/modelStore';
import { FlyControls } from './FlyControls';
import { StudioCamera, type StudioCameraHandle } from './StudioCamera';
import { RAW_SOURCES, rawModelUrl } from './sources';
import { saveTour } from './devApi';

type Source = 'optimised' | 'raw';

const DEFAULT_SPEED = 2;
const DEFAULT_CUT = 1.3;
const FOV_RANGE = { min: 30, max: 90 } as const;
const HASH_WRITE_MS = 600;
const DRAFT_KEY = (id: string) => `studio3d:tour:${id}`;

/* --------------------------- persistence helpers --------------------------- */

function readHash(): { property?: string; cam?: CameraShot } {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const property = params.get('property') ?? undefined;
  const nums = params.get('cam')?.split(',').map(Number);
  const cam = nums && nums.length === 7 && nums.every(Number.isFinite) ? { position: nums.slice(0, 3) as Vec3, target: nums.slice(3, 6) as Vec3, fov: nums[6]! } : undefined;
  return { property, cam };
}

function writeHash(property: string, cam: CameraShot) {
  const params = new URLSearchParams({ property, cam: [...cam.position, ...cam.target, cam.fov].join(',') });
  history.replaceState(null, '', `#${params.toString()}`);
}

function loadDraft(id: string, fallback: TourFile): TourFile {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY(id));
    if (raw) {
      const parsed = TourFileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Storage unavailable: start from the saved file.
  }
  return structuredClone(fallback);
}

function storeDraft(id: string, tour: TourFile) {
  try {
    sessionStorage.setItem(DRAFT_KEY(id), JSON.stringify(tour));
  } catch {
    // Drafts are a convenience; the export is what counts.
  }
}

/* ------------------------------- scene parts ------------------------------- */

function Model({ url, scale = 1, offset = [0, 0, 0], onReady }: { url: string; scale?: number; offset?: Vec3; onReady: (o: Object3D | null) => void }) {
  const state = useModelState(url);
  const object = useMemo(() => (state.status === 'ready' ? state.model.scene.clone(true) : null), [state]);
  const group = useRef<Group>(null);
  useEffect(() => {
    onReady(object ? group.current : null);
  }, [object, onReady]);
  if (!object) return null;
  return (
    <group ref={group} scale={scale} position={offset}>
      <primitive object={object} />
    </group>
  );
}

function SectionCut({ height }: { height: number | null }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.clippingPlanes = height === null ? [] : [new Plane(new Vector3(0, -1, 0), height)];
    return () => {
      gl.clippingPlanes = [];
    };
  }, [gl, height]);
  return null;
}

function DebugHandle() {
  const three = useThree();
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__studio3d = three;
  }, [three]);
  return null;
}

/* --------------------------------- studio --------------------------------- */

/**
 * Shot capture: fly through a property, save views as tour stops (position, target, FOV, room),
 * add via points for doorways, reorder, preview the glide exactly as the tour plays it, and export
 * to data/properties/<id>/tour.json through the dev API. Unsaved work is kept per tab.
 */
export default function ShotStudio() {
  const initial = useMemo(readHash, []);
  const [propertyId, setPropertyId] = useState(initial.property && content.byId[initial.property] ? initial.property : content.properties[0]!.property.id);
  const bundle = content.byId[propertyId]!;
  const property = bundle.property;
  const levels = useMemo(() => propertyLevels(property), [property]);
  const [source, setSource] = useState<Source>('optimised');
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [cut, setCut] = useState<number | null>(null);
  const [grid, setGrid] = useState(false);
  const [fov, setFov] = useState(initial.cam?.fov ?? bundle.tour.overview.fov);
  const [draft, setDraft] = useState<TourFile>(() => loadDraft(propertyId, bundle.tour));
  const [selected, setSelected] = useState<number | null>(null);
  const [gliding, setGliding] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modelRoot, setModelRoot] = useState<Object3D | null>(null);
  const rig = useRef<StudioCameraHandle>(null);
  const readout = useRef<HTMLPreElement>(null);

  const raw = RAW_SOURCES[propertyId];
  const url = source === 'raw' && raw ? rawModelUrl(raw) : property.model.url;
  const state = useModelState(url);
  const startShot = initial.property === propertyId && initial.cam ? initial.cam : draft.overview;

  useEffect(() => {
    setDraft(loadDraft(propertyId, bundle.tour));
    setSelected(null);
  }, [propertyId, bundle.tour]);
  useEffect(() => storeDraft(propertyId, draft), [propertyId, draft]);

  // Keep the URL hash on the current view so a reload returns to the same place.
  useEffect(() => {
    const id = window.setInterval(() => {
      const c = rig.current?.current(false);
      if (c) writeHash(propertyId, c);
    }, HASH_WRITE_MS);
    return () => window.clearInterval(id);
  }, [propertyId]);

  const updateStop = (i: number, patch: Partial<TourStop>) => setDraft((d) => ({ ...d, stops: d.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const moveStop = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= draft.stops.length) return;
    setDraft((d) => {
      const stops = [...d.stops];
      [stops[i], stops[j]] = [stops[j]!, stops[i]!];
      return { ...d, stops };
    });
    setSelected(j);
  };
  const removeStop = (i: number) => {
    setDraft((d) => ({ ...d, stops: d.stops.filter((_, j) => j !== i) }));
    setSelected(null);
  };
  const addStop = () => {
    const shot = rig.current?.current();
    if (!shot) return;
    const room = bundle.rooms.find((r) => r.id === roomId) ?? bundle.rooms[0]!;
    const existing = new Set(draft.stops.map((s) => s.id));
    let id = room.id;
    for (let n = 2; existing.has(id); n++) id = `${room.id}-${n}`;
    const stop: TourStop = { id, roomId: room.id, label: room.name, facts: [room.features[0] ?? room.name], via: [], ...shot };
    setDraft((d) => ({ ...d, stops: [...d.stops, stop] }));
    setSelected(draft.stops.length);
  };
  const previewAll = () => {
    if (!rig.current) return;
    rig.current.jump(draft.overview);
    void rig.current.glideAll(draft.stops.map((s) => ({ via: s.via, shot: s })));
  };
  const exportTour = async () => {
    setMessage(null);
    const parsed = TourFileSchema.safeParse(draft);
    if (!parsed.success) {
      setMessage(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    try {
      const saved = await saveTour(propertyId, parsed.data);
      setMessage(`Saved ${saved.path}`);
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const sel = selected !== null ? draft.stops[selected] : undefined;

  return (
    <div className="grid h-full grid-cols-[360px_1fr]">
      <aside className="flex flex-col gap-3 overflow-auto border-r-2 border-line p-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Property" className="rounded-[12px] border-2 border-line px-2 py-2" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            {content.properties.map((b) => (
              <option key={b.property.id} value={b.property.id}>
                {b.property.id}
              </option>
            ))}
          </select>
          <select aria-label="Model source" className="rounded-[12px] border-2 border-line px-2 py-2" value={source} onChange={(e) => setSource(e.target.value as Source)}>
            <option value="optimised">Optimised GLB</option>
            <option value="raw">Raw source</option>
          </select>
        </div>
        <p className="text-ink-soft">
          {state.status === 'ready' ? `${state.model.triangles.toLocaleString('en-IN')} triangles. ` : ''}Drag to look, W A S D to move, E and Q to rise and sink, Shift for speed.
        </p>
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
          <span>Speed</span>
          <input aria-label="Speed" type="range" min={0.5} max={8} step={0.5} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          <span className="tabular w-14 text-right">{speed} m/s</span>
          <span>FOV</span>
          <input
            aria-label="Field of view"
            type="range"
            min={FOV_RANGE.min}
            max={FOV_RANGE.max}
            value={fov}
            onChange={(e) => {
              setFov(Number(e.target.value));
              rig.current?.setFov(Number(e.target.value));
            }}
          />
          <span className="tabular w-14 text-right">{fov}°</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={cut !== null} onChange={(e) => setCut(e.target.checked ? levels[0]!.floorY + DEFAULT_CUT : null)} />
            Section cut
          </label>
          {cut !== null && <input aria-label="Cut height" type="number" step={0.1} className="w-20 rounded-[8px] border-2 border-line px-1" value={cut} onChange={(e) => setCut(Number(e.target.value))} />}
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />1 m grid
          </label>
        </div>
        <pre ref={readout} className="rounded-[10px] bg-paper p-2 font-mono text-xs leading-5" />

        <section className="flex items-center justify-between rounded-[14px] border-2 border-line p-3">
          <h2 className="font-display text-base font-bold">Overview</h2>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => rig.current?.glide([], draft.overview)} disabled={gliding}>
              Go
            </Button>
            <Button size="sm" variant="secondary" onClick={() => rig.current && setDraft((d) => ({ ...d, overview: rig.current!.current() }))}>
              Set from view
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-2 rounded-[14px] border-2 border-line p-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold">Stops ({draft.stops.length})</h2>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={previewAll} disabled={gliding || !draft.stops.length}>
                Preview all
              </Button>
              <Button size="sm" onClick={addStop}>
                Add from view
              </Button>
            </div>
          </div>
          <ol className="flex flex-col gap-1">
            {draft.stops.map((s, i) => (
              <li key={`${s.id}-${i}`}>
                <button
                  type="button"
                  onClick={() => setSelected(i)}
                  className={cn('w-full rounded-[10px] border-2 px-2 py-1 text-left', selected === i ? 'border-ink bg-blue-tint' : 'border-line hover:border-ink')}
                >
                  {i + 1}. {s.label}{' '}
                  <span className="text-ink-soft">
                    ({s.roomId}
                    {s.via.length ? `, ${s.via.length} via` : ''})
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        {sel && selected !== null && (
          <section className="flex flex-col gap-2 rounded-[14px] border-2 border-ink p-3">
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => rig.current?.jump(sel, sel.via)}>
                Jump
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void rig.current?.glide(sel.via, sel)} disabled={gliding}>
                Glide here
              </Button>
              <Button size="sm" variant="ghost" onClick={() => moveStop(selected, -1)}>
                Up
              </Button>
              <Button size="sm" variant="ghost" onClick={() => moveStop(selected, 1)}>
                Down
              </Button>
              <Button size="sm" variant="secondary" onClick={() => rig.current && updateStop(selected, rig.current.current())}>
                Update from view
              </Button>
              <Button size="sm" variant="danger" onClick={() => removeStop(selected)}>
                Delete
              </Button>
            </div>
            <label className="flex flex-col gap-1">
              Id
              <input className="rounded-[8px] border-2 border-line px-2 py-1 font-mono" value={sel.id} onChange={(e) => updateStop(selected, { id: e.target.value.trim() })} />
            </label>
            <label className="flex flex-col gap-1">
              Label
              <input className="rounded-[8px] border-2 border-line px-2 py-1" value={sel.label} onChange={(e) => updateStop(selected, { label: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              Room
              <select className="rounded-[8px] border-2 border-line px-2 py-1" value={sel.roomId} onChange={(e) => updateStop(selected, { roomId: e.target.value })}>
                {bundle.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Facts (one per line, up to 3)
              <textarea
                className="h-20 rounded-[8px] border-2 border-line px-2 py-1"
                value={sel.facts.join('\n')}
                onChange={(e) => updateStop(selected, { facts: e.target.value.split('\n').slice(0, 3) })}
                onBlur={(e) => updateStop(selected, { facts: e.target.value.split('\n').map((f) => f.trim()).filter(Boolean).slice(0, 3) })}
              />
            </label>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span>Via points ({sel.via.length})</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const c = rig.current?.current();
                    if (c) updateStop(selected, { via: [...sel.via, c.position] });
                  }}
                >
                  Add current position
                </Button>
              </div>
              {sel.via.map((v, k) => (
                <div key={k} className="flex items-center justify-between font-mono text-xs">
                  <span>{v.map((n) => n.toFixed(2)).join(', ')}</span>
                  <button type="button" className="text-coral-deep underline" onClick={() => updateStop(selected, { via: sel.via.filter((_, j) => j !== k) })}>
                    remove
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="flex gap-2">
          <Button size="sm" variant="confirm" onClick={exportTour}>
            Export to tour.json
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(structuredClone(bundle.tour));
              setSelected(null);
            }}
          >
            Discard draft
          </Button>
        </div>
        {message && <p className="rounded-[10px] bg-paper p-2">{message}</p>}
      </aside>

      <div className="relative min-h-0">
        <Canvas
          key={propertyId}
          camera={{ position: startShot.position, fov: startShot.fov, near: 0.05, far: 600 }}
          gl={{ antialias: true }}
          onCreated={({ gl, camera }) => {
            gl.toneMapping = NeutralToneMapping;
            gl.toneMappingExposure = LIGHT.exposure;
            camera.lookAt(...startShot.target);
          }}
        >
          <color attach="background" args={[SKY_COLOUR]} />
          <RoomLight intensity={LIGHT.environmentIntensity} />
          <hemisphereLight args={[LIGHT.hemisphere.sky, LIGHT.hemisphere.ground, LIGHT.hemisphere.intensity]} />
          <Model url={url} scale={source === 'raw' ? raw?.scale : 1} offset={source === 'raw' ? raw?.offset : undefined} onReady={setModelRoot} />
          <FlyControls speed={speed} enabled={!gliding} />
          <StudioCamera ref={rig} model={modelRoot} rooms={bundle.rooms} levels={levels} readout={readout} autoCutaway={cut === null && source === 'optimised'} onGlidingChange={setGliding} onRoomChange={setRoomId} />
          <SectionCut height={cut} />
          {grid && <gridHelper args={[40, 40, '#ff3b30', '#0b6fd6']} position={[0, (cut ?? DEFAULT_CUT) - 0.05, 0]} />}
          <DebugHandle />
        </Canvas>
        {state.status !== 'ready' && <div className="absolute inset-0 grid place-items-center text-ink-soft">{state.status === 'error' ? state.message : 'Loading model…'}</div>}
      </div>
    </div>
  );
}
