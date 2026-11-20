import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useCallControls } from '@/call/controls';
import { useCallUi } from '@/call/callUi';
import { configuredPresenceMode } from '@/call/presence/config';
import { Button } from '@/ui';
import type { PropertyBundle, TourStop } from '@ave/shared';
import { SKY_COLOUR } from '@/three/lighting';
import { propertyLevels } from '@/three/levels';
import { retryModel, useModelState } from '@/three/modelStore';
import type { ViewProps } from '../types';
import { GUIDE, TOUR } from './config';
import { MiniPlan, type MiniPlanHandle } from './MiniPlan';
import { DragHint, ModelCredit, ModelStatus, StopCard, type StopCaption } from './TourOverlay';
import { TourRig, type RigPose, type RigTarget } from './TourRig';
import { TourScene } from './TourScene';
import { TourGuide } from './TourGuide';
import './preload';


const OVERVIEW = 'overview';
/** Shown once per page load, until the first drag or this long after the first arrival. */
const DRAG_HINT_MS = 6000;
let dragHintSeen = false;

function targetKey(propertyId: string, stopId: string) {
  return `${propertyId}::${stopId}`;
}

function stopTarget(propertyId: string, s: TourStop): RigTarget {
  return { key: targetKey(propertyId, s.id), shot: s, via: s.via };
}

function captionFor(bundle: PropertyBundle, stop: TourStop | null, key: string): StopCaption {
  if (!stop) return { key, label: bundle.property.name, areaSqft: bundle.property.areas.carpetSqft, facts: [bundle.property.configuration] };
  const room = bundle.rooms.find((r) => r.id === stop.roomId);
  return { key, label: stop.label, areaSqft: room?.areaSqft ?? null, facts: stop.facts };
}

/**
 * The 3D tour. One persistent canvas that stays mounted under the other views; while hidden it
 * renders nothing. The camera glides to `params.tour.stopId` (or the overview), drifts through all
 * stops in walkthrough mode, and lets the buyer look around at each stop.
 */
export default function TourView({ state, bundle, dispatch, active }: ViewProps) {
  if (!bundle) return null;
  return <Tour state={state} bundle={bundle} dispatch={dispatch} active={active} />;
}

function Tour({ state, bundle, dispatch, active }: Pick<ViewProps, 'state' | 'dispatch' | 'active'> & { bundle: PropertyBundle }) {
  const { property, tour } = bundle;
  const modelState = useModelState(property.model.url);
  const model = modelState.status === 'ready' ? modelState.model : null;
  const { stopId, mode } = state.params.tour;
  const stops = tour.stops;
  const levels = useMemo(() => propertyLevels(property), [property]);
  // The guide walks the ground floor only (see GUIDE.upperFloorMargin).
  const guideMaxEyeY = useMemo(() => Math.min(...levels.map((l) => l.floorY)) + GUIDE.eyeHeight + GUIDE.upperFloorMargin, [levels]);

  // Walkthrough: a local index into the stops; past the end means "back to the overview".
  const [walkIndex, setWalkIndex] = useState<number | null>(null);
  useEffect(() => {
    if (mode !== 'walkthrough') {
      setWalkIndex(null);
      return;
    }
    setWalkIndex(Math.max(0, stops.findIndex((s) => s.id === stopId)));
  }, [mode, stopId, stops, property.id]);

  const requestedStop = stops.find((s) => s.id === stopId) ?? null;
  const target: RigTarget = useMemo(() => {
    if (walkIndex !== null) {
      const s = stops[walkIndex];
      return s ? stopTarget(property.id, s) : { key: targetKey(property.id, OVERVIEW), shot: tour.overview, via: [] };
    }
    return requestedStop ? stopTarget(property.id, requestedStop) : { key: targetKey(property.id, OVERVIEW), shot: tour.overview, via: [] };
  }, [walkIndex, stops, requestedStop, property.id, tour.overview]);

  const [arrivedKey, setArrivedKey] = useState<string | null>(null);
  const [interacting, setInteracting] = useState(false);
  const arrived = arrivedKey === target.key;

  // Dwell at each walkthrough stop, then drift on. A drag restarts the dwell.
  useEffect(() => {
    if (walkIndex === null || walkIndex >= stops.length || !active || interacting || !arrived) return;
    const id = window.setTimeout(() => setWalkIndex((i) => (i === null ? null : i + 1)), TOUR.walkthrough.dwellMs);
    return () => window.clearTimeout(id);
  }, [walkIndex, stops.length, active, interacting, arrived]);

  // First-visit hint that the view can be dragged.
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (dragHintSeen || !arrived || !active) return;
    setHint(true);
    const id = window.setTimeout(() => {
      dragHintSeen = true;
      setHint(false);
    }, DRAG_HINT_MS);
    return () => window.clearTimeout(id);
  }, [arrived, active]);
  const onInteract = useCallback((on: boolean) => {
    setInteracting(on);
    if (on) {
      dragHintSeen = true;
      setHint(false);
    }
  }, []);

  const plan = useRef<MiniPlanHandle>(null);
  const onPose = useCallback((p: RigPose) => plan.current?.update(p), []);
  const stopByRoom = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stops) if (!m.has(s.roomId)) m.set(s.roomId, s.id);
    return m;
  }, [stops]);
  const pickRoom = useCallback((id: string) => dispatch({ type: 'set_view', view: 'tour', params: { stopId: id, mode: 'step' } }), [dispatch]);

  const targetStop = target.key.endsWith(`::${OVERVIEW}`) ? null : (stops.find((s) => target.key === targetKey(property.id, s.id)) ?? null);

  // The AI advisor walks the home with the buyer while it is on the call (3D avatar mode only).
  const agentTrack = useCallControls((s) => s.agentAudioTrack);
  const setGuideInTour = useCallUi((s) => s.setGuideInTour);
  const guideEnabled = agentTrack !== null && state.agent.status === 'live' && state.handoff.status !== 'joined' && configuredPresenceMode() === 'human3d';

  // Immersive: the call screen gives the tour the whole window, and the browser goes full screen
  // when it allows. Esc, the button, or leaving the tour returns to the call layout.
  const immersive = useCallUi((s) => s.immersive);
  const setImmersive = useCallUi((s) => s.setImmersive);
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setImmersive(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImmersive(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
    };
  }, [setImmersive]);
  useEffect(() => {
    if (active) return;
    setImmersive(false);
  }, [active, setImmersive]);
  useEffect(() => {
    if (!immersive && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, [immersive]);
  const toggleImmersive = useCallback(() => {
    if (immersive) {
      setImmersive(false);
      return;
    }
    setImmersive(true);
    // Browser full screen is a bonus: some embedded browsers refuse it, and the window layout still works.
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }, [immersive, setImmersive]);

  const caption = useMemo(() => captionFor(bundle, targetStop, target.key), [bundle, targetStop, target.key]);
  const walkLabel = walkIndex !== null && walkIndex < stops.length ? `${walkIndex + 1} of ${stops.length}` : null;

  return (
    <div className="relative h-full w-full" style={{ background: SKY_COLOUR }}>
      <Canvas
        frameloop="demand"
        dpr={[1, TOUR.maxDpr]}
        camera={{ near: TOUR.camera.near, far: TOUR.camera.far, fov: tour.overview.fov, position: tour.overview.position }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = NeutralToneMapping;
        }}
        aria-label={`3D tour of ${property.name}`}
      >
        <color attach="background" args={[SKY_COLOUR]} />
        <TourScene property={property} model={model} minutes={state.params.compass.minutes} />
        <TourRig target={target} model={model} levels={levels} sceneKey={property.id} ready={model !== null} active={active} onArrive={setArrivedKey} onInteract={onInteract} onPose={onPose} />
        {model && (
          <TourGuide stop={targetStop} sceneKey={property.id} track={agentTrack} enabled={guideEnabled} visible={active} maxEyeY={guideMaxEyeY} onPresence={setGuideInTour} />
        )}
      </Canvas>

      {model && (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
          <div className="flex items-start justify-between gap-3">
            <StopCard caption={caption} visible={arrived} />
            <div className="flex shrink-0 items-center gap-2">
              {walkLabel && (
                <p className="tabular rounded-[var(--radius-chip)] border-2 border-ink bg-sun px-3 py-1 text-[13px] font-semibold" aria-live="polite">
                  Walkthrough · {walkLabel}
                </p>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={immersive ? Minimize2 : Maximize2}
                className="pointer-events-auto"
                onClick={toggleImmersive}
                aria-pressed={immersive}
              >
                {immersive ? 'Exit full screen' : 'Full screen'}
              </Button>
            </div>
          </div>
          <div className="flex items-end justify-between gap-3">
            <MiniPlan ref={plan} bundle={bundle} currentRoomId={targetStop?.roomId ?? null} stopByRoom={stopByRoom} onPickRoom={pickRoom} />
            <DragHint visible={hint} />
            <ModelCredit credits={property.credits} />
          </div>
        </div>
      )}
      {immersive && active ? <Subtitle state={state} /> : null}
      <ModelStatus state={modelState} onRetry={() => retryModel(property.model.url)} />
    </div>
  );
}

/** Full screen hides the captions panel, so the latest spoken line shows over the tour. */
function Subtitle({ state }: Pick<ViewProps, 'state'>) {
  const line = [...state.transcript].reverse().find((l) => l.text.trim());
  if (!line) return null;
  return (
    <p
      aria-live="polite"
      className="pointer-events-none absolute bottom-24 left-1/2 max-w-[min(860px,80%)] -translate-x-1/2 rounded-[14px] bg-ink/80 px-5 py-2.5 text-center text-[17px] font-semibold leading-snug text-canvas"
    >
      {line.text}
    </p>
  );
}
