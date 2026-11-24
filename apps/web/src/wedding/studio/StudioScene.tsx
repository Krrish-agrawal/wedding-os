import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace } from 'three';
import { OrbitControls } from '@react-three/drei';
import { BoxGeometry, EdgesGeometry, Plane, Vector3 } from 'three';
import { DECOR_CATALOG, bounds, findEntry, moveObject, sceneContext, studioRoom, type DecorObject, type WeddingState } from '@ave/shared';
import { buildModel } from './models';
import { useStudio } from './useStudio';
import { THEME_SKY, VenueModel } from './VenueModel';
import { Atmosphere, Effects, type Warmth } from './render';
import { useWedding } from '../useWedding';

/** The 3D studio: the venue and the decorations, both redrawn from WeddingState. Nothing here owns scene data. */

function Outline({ w, h, d, color }: { w: number; h: number; d: number; color: string }) {
  const geo = useMemo(() => new EdgesGeometry(new BoxGeometry(w, h, d)), [w, h, d]);
  return (
    <lineSegments geometry={geo} position={[0, h / 2, 0]}>
      <lineBasicMaterial color={color} />
    </lineSegments>
  );
}

interface DragRef {
  id: string;
  pointerId: number;
  grab: { x: number; z: number };
  moved: boolean;
  last: { x: number; z: number };
}

function DecorMesh({ obj, objects, state, readOnly }: { obj: DecorObject; objects: DecorObject[]; state: WeddingState , readOnly?: boolean }) {
  const entry = findEntry(DECOR_CATALOG, obj.catalogId);
  const { selectedId, drag, select, setDrag, setNote } = useStudio();
  const act = useWedding((s) => s.act);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const ref = useRef<DragRef | null>(null);
  const hit = useMemo(() => new Vector3(), []);

  const model = useMemo(() => (entry ? buildModel(entry, obj.colors) : null), [entry, obj.colors]);
  if (!entry || !model) return null;

  const selected = selectedId === obj.id;
  const invalid = drag?.id === obj.id && !drag.ok;
  const w = entry.size.width;
  const d = entry.size.depth;
  const h = entry.size.height;

  const planeHit = (e: ThreeEvent<PointerEvent>, y: number) => (e.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -y), hit) ? { x: hit.x, z: hit.z } : null);

  function down(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    select(obj.id);
    setNote(null);
    const p = planeHit(e, obj.position.y);
    if (!p) return;
    (e.target as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture(e.pointerId);
    ref.current = { id: obj.id, pointerId: e.pointerId, grab: { x: obj.position.x - p.x, z: obj.position.z - p.z }, moved: false, last: { x: obj.position.x, z: obj.position.z } };
    if (controls) controls.enabled = false;
  }

  function move(e: ThreeEvent<PointerEvent>) {
    const r = ref.current;
    if (!r || r.pointerId !== e.pointerId) return;
    const p = planeHit(e, obj.position.y);
    if (!p) return;
    const target = { x: p.x + r.grab.x, z: p.z + r.grab.z };
    if (!r.moved && Math.hypot(target.x - obj.position.x, target.z - obj.position.z) < 0.08) return; // a tap, not a drag
    r.moved = true;
    r.last = target;
    const res = moveObject(sceneContext(state), state.scene.objects, obj.id, target);
    if (res.ok) setDrag({ id: obj.id, objects: res.value, ok: true });
    else setDrag({ id: obj.id, ok: false, objects: state.scene.objects.map((o) => (o.id === obj.id ? { ...o, position: { x: target.x, y: o.position.y, z: target.z } } : o)) });
  }

  async function up(e: ThreeEvent<PointerEvent>) {
    const r = ref.current;
    if (!r || r.pointerId !== e.pointerId) return;
    ref.current = null;
    (e.target as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture(e.pointerId);
    if (controls) controls.enabled = true;
    if (!r.moved) return;
    // Keep showing the preview until the server answers, so the object does not jump back first.
    const err = await act({ type: 'move_decor', id: r.id, x: r.last.x, z: r.last.z });
    setDrag(null);
    setNote(err ? { tone: 'error', text: err } : null);
  }

  const cancel = () => {
    ref.current = null;
    if (controls) controls.enabled = true;
    setDrag(null);
  };
  void objects;

  return (
    <group position={[obj.position.x, obj.position.y, obj.position.z]} rotation={[0, obj.rotationY, 0]} scale={obj.scale} onPointerDown={readOnly ? undefined : down} onPointerMove={readOnly ? undefined : move} onPointerUp={readOnly ? undefined : up} onPointerCancel={readOnly ? undefined : cancel}>
      {model}
      {selected || invalid ? <Outline w={w} h={h} d={d} color={invalid ? '#e5392a' : '#0b6fd6'} /> : null}
      {invalid ? (
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[w, h, d]} />
          <meshBasicMaterial color="#e5392a" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

function DecorLayer({ state, readOnly }: { state: WeddingState; readOnly?: boolean }) {
  const drag = useStudio((s) => s.drag);
  const objects = drag ? drag.objects : state.scene.objects;
  return (
    <group name="decorations">
      {objects.map((o) => (
        <DecorMesh key={o.id} obj={o} objects={objects} state={state} readOnly={readOnly} />
      ))}
    </group>
  );
}

/** Moves the camera when a preset is chosen. Pure view state: it never touches the wedding. */
function CameraRig({ state }: { state: WeddingState }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target: Vector3; update: () => void } | null;
  const { preset, nonce } = useStudio((s) => s.camera);
  useEffect(() => {
    if (!controls || nonce === 0) return;
    const room = studioRoom(state);
    const b = bounds(room);
    const span = Math.max(b.width, b.depth);
    const stage = state.scene.objects.find((o) => o.catalogId === 'stage-wedding');
    const focus = stage ? { x: stage.position.x, z: stage.position.z } : { x: b.centre.x, z: b.min.z + b.depth * 0.2 };
    // Unit vector from the stage toward the far end of the room, so "aisle" looks the way a guest walks in.
    const away = { x: b.centre.x - focus.x, z: b.centre.z - focus.z };
    const len = Math.hypot(away.x, away.z) || 1;
    const dir = Math.abs(away.x) + Math.abs(away.z) < 0.5 ? { x: 0, z: 1 } : { x: away.x / len, z: away.z / len };
    let pos: [number, number, number];
    let target: [number, number, number];
    if (preset === 'top') { pos = [b.centre.x, span * 1.7, b.centre.z + 0.01]; target = [b.centre.x, 0, b.centre.z]; }
    else if (preset === 'entrance') { pos = [b.centre.x + (dir.x === 0 ? 0 : dir.x * span * 0.46), 2.1, Math.min(b.max.z - 0.6, focus.z + dir.z * (span * 0.5))]; target = [focus.x, 1.7, focus.z]; }
    else if (preset === 'guest') { pos = [focus.x + 3.2, 1.2, focus.z + dir.z * Math.min(span * 0.32, 9)]; target = [focus.x, 1.5, focus.z]; }
    else if (preset === 'stage') { pos = [focus.x + dir.x * 7, 2.4, focus.z + dir.z * 7]; target = [focus.x, 1.4, focus.z]; }
    else if (preset === 'aisle') {
      const back = { x: Math.min(b.max.x - 0.8, Math.max(b.min.x + 0.8, focus.x + dir.x * span * 0.45)), z: Math.min(b.max.z - 0.8, Math.max(b.min.z + 0.8, focus.z + dir.z * span * 0.45)) };
      pos = [back.x, 1.65, back.z]; target = [focus.x, 1.5, focus.z];
    } else { pos = [b.centre.x, span * 1.3, b.centre.z + span * 0.98]; target = [b.centre.x, 0, b.centre.z]; }
    camera.position.set(...pos);
    controls.target.set(...target);
    controls.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, preset, controls]);
  return null;
}

/** `readOnly` is the presentation mode used by the AI design result: objects cannot be selected or dragged, the camera still orbits. */
export function StudioScene({ state, readOnly = false }: { state: WeddingState; readOnly?: boolean }) {
  const room = studioRoom(state);
  const b = bounds(room);
  const select = useStudio((s) => s.select);
  const quality = useStudio((s) => s.quality);
  const autoRotate = useStudio((s) => s.autoRotate && readOnly);
  const setAutoRotate = useStudio((s) => s.setAutoRotate);
  const span = Math.max(b.width, b.depth);
  const warmth = (state.design.brief?.lighting.warmth ?? 'warm') as Warmth;
  const fast = quality === 'fast';
  return (
    <Canvas
      key={`${room.name}-${quality}`}
      shadows={fast ? false : { type: PCFSoftShadowMap }}
      gl={{ toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace, antialias: true, preserveDrawingBuffer: true }}
      camera={{ position: [b.centre.x, span * 1.3, b.centre.z + span * 0.98], fov: 45, near: 0.1, far: 400 }}
      dpr={fast ? 1 : [1, 2]}
      onPointerMissed={() => select(null)}
      aria-label="3D wedding venue"
    >
      <color attach="background" args={[THEME_SKY[room.theme ?? 'ballroom']]} />
      <Atmosphere room={room} warmth={warmth} quality={quality} span={span} centre={b.centre} />
      <Suspense fallback={null}>
        <VenueModel room={room} />
        <DecorLayer state={state} readOnly={readOnly} />
      </Suspense>
      <CameraRig state={state} />
      <OrbitControls makeDefault target={[b.centre.x, 0, b.centre.z]} maxPolarAngle={Math.PI / 2 - 0.04} minDistance={1.5} maxDistance={span * 2.4} enableDamping autoRotate={autoRotate} autoRotateSpeed={0.5} onStart={() => { if (autoRotate) setAutoRotate(false); }} />
      <Effects quality={quality} />
    </Canvas>
  );
}
