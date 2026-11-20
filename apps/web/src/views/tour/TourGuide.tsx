import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Raycaster, Vector3, type Object3D } from 'three';
import type { TourStop } from '@ave/shared';
import { GuideAvatar } from '@/call/presence/human3d/GuideAvatar';
import { PATH } from '@/three/cameraPath';
import { GUIDE, TOUR_MODEL_NAME } from './config';

interface TourGuideProps {
  /** The stop the camera is heading to, or null in the overview (the guide then steps out of view). */
  stop: TourStop | null;
  /** Changes when the property changes: the guide starts afresh in the new home. */
  sceneKey: string;
  /** The advisor's voice for lip-sync. */
  track: MediaStreamTrack | null;
  /** Whether the guide should be loaded at all (the AI advisor is on the call). */
  enabled: boolean;
  /** The tour is on screen; when it is not, the guide waits out of view (still loaded, so it is back at once). */
  visible: boolean;
  /** Stops whose camera is above this height (upper floors) are left to the call tile; the guide steps out. */
  maxEyeY: number;
  /** Reports whether the guide is standing in the home, so the call tile can step aside. */
  onPresence: (inTour: boolean) => void;
}

const DOWN = new Vector3(0, -1, 0);

/**
 * Whether anything lies between two points. Checked both ways: many walls are single-sided and a
 * ray only meets them from the front.
 */
function blocked(model: Object3D, ray: Raycaster, a: Vector3, b: Vector3): boolean {
  const gap = b.clone().sub(a);
  const length = gap.length();
  const dir = gap.normalize();
  ray.far = length;
  ray.set(a, dir);
  let hit = ray.intersectObject(model, true).length > 0;
  if (!hit) {
    ray.set(b, dir.clone().negate());
    hit = ray.intersectObject(model, true).length > 0;
  }
  ray.far = Infinity;
  return hit;
}

/** Horizontal unit vector from `from` towards `to`. */
function flatDir(from: Vector3, to: Vector3): Vector3 {
  const d = new Vector3(to.x - from.x, 0, to.z - from.z);
  return d.lengthSq() < 1e-6 ? new Vector3(0, 0, -1) : d.normalize();
}

/**
 * Finds where the guide should stand for a stop: in front of the camera, slightly to one side,
 * on the same floor as the camera, with nothing between them and room to stand. Candidates are
 * tried nearest-to-ideal first; null if none fits (the guide then waits out of view).
 */
function findSpot(model: Object3D, stop: TourStop, aspect: number): Vector3 | null {
  // The stop's own view, to check the whole guide is in frame from where the buyer will stand.
  const view = new PerspectiveCamera(stop.fov, aspect, 0.05, 100);
  view.position.set(...stop.position);
  view.lookAt(new Vector3(...stop.target));
  view.updateMatrixWorld(true);
  // Small rooms (a study with a desk and chair) rarely pass the roomy check; try a tighter one next.
  return trySpots(model, stop, view, GUIDE.roomy) ?? trySpots(model, stop, view, GUIDE.tight);
}

/** Feet and head both inside the frame, with a margin. */
function inFrame(view: PerspectiveCamera, spot: Vector3): boolean {
  for (const h of [0, GUIDE.sightHeights[GUIDE.sightHeights.length - 1]! + GUIDE.headroom]) {
    const p = new Vector3(spot.x, spot.y + h, spot.z).project(view);
    if (p.z > 1 || Math.abs(p.x) > GUIDE.frameMargin || Math.abs(p.y) > GUIDE.frameMargin) return false;
  }
  return true;
}

interface SpotRules {
  distances: readonly number[];
  lateral: readonly number[];
  bodyRadius: number;
  heights: readonly number[];
}

function trySpots(model: Object3D, stop: TourStop, view: PerspectiveCamera, rules: SpotRules): Vector3 | null {
  const ray = new Raycaster();
  const eye = new Vector3(...stop.position);
  const forward = flatDir(eye, new Vector3(...stop.target));
  const right = new Vector3(-forward.z, 0, forward.x);

  const floorY = floorNear(model, eye);

  for (const d of rules.distances) {
    for (const l of rules.lateral) {
      const spot = eye.clone().addScaledVector(forward, d).addScaledVector(right, l);
      spot.y = floorY;
      if (!inFrame(view, spot)) continue;

      // Same floor, and nothing (a table, a bed) under the spot.
      ray.set(new Vector3(spot.x, eye.y, spot.z), DOWN);
      const ground = ray.intersectObject(model, true)[0];
      if (!ground || Math.abs(eye.y - ground.distance - floorY) > GUIDE.floorTolerance) continue;

      // In plain view: nothing between the camera and the guide's head, chest or hips.
      if (GUIDE.sightHeights.some((h) => blocked(model, ray, eye, new Vector3(spot.x, floorY + h, spot.z)))) continue;

      // Room to stand: nothing within a body's width at knee and chest height.
      let clear = true;
      for (const h of rules.heights) {
        for (let i = 0; i < GUIDE.clearanceRays && clear; i += 1) {
          const a = (i / GUIDE.clearanceRays) * Math.PI * 2;
          ray.set(new Vector3(spot.x, floorY + h, spot.z), new Vector3(Math.cos(a), 0, Math.sin(a)));
          ray.far = rules.bodyRadius;
          if (ray.intersectObject(model, true).length) clear = false;
          ray.far = Infinity;
        }
      }
      if (clear) return spot;
    }
  }
  return null;
}

/**
 * The floor around the camera: of the surfaces found a little way around it, the one closest to a
 * standing person's height below the eye. A single ray straight down can land on a worktop or a
 * bed, and a probe can catch a step or a recess; neither is the floor the buyer stands on.
 */
function floorNear(model: Object3D, eye: Vector3): number {
  const ray = new Raycaster();
  const expected = eye.y - GUIDE.eyeHeight;
  let best: number | null = null;
  for (let i = 0; i <= GUIDE.floorProbes; i += 1) {
    const a = (i / GUIDE.floorProbes) * Math.PI * 2;
    const r = i === 0 ? 0 : GUIDE.floorProbeRadius;
    ray.set(new Vector3(eye.x + Math.cos(a) * r, eye.y, eye.z + Math.sin(a) * r), DOWN);
    const hit = ray.intersectObject(model, true)[0];
    if (!hit) continue;
    const y = eye.y - hit.distance;
    if (best === null || Math.abs(y - expected) < Math.abs(best - expected)) best = y;
  }
  return best ?? expected;
}

interface Walk {
  points: Vector3[];
  /** Cumulative distance at each point. */
  marks: number[];
  length: number;
  speed: number;
  travelled: number;
}

function planWalk(points: Vector3[]): Walk {
  const marks = [0];
  for (let i = 1; i < points.length; i += 1) marks.push(marks[i - 1]! + points[i - 1]!.distanceTo(points[i]!));
  const length = marks[marks.length - 1]!;
  // A little ahead of the camera's own pace, so the guide is in place when the buyer arrives.
  const duration = Math.min(PATH.maxDuration * GUIDE.paceShare, Math.max(PATH.minDuration * GUIDE.paceShare, length / PATH.speed) * GUIDE.paceShare);
  return { points, marks, length, speed: length / duration, travelled: 0 };
}

function pointAlong(walk: Walk, distance: number, out: Vector3): Vector3 {
  const { points, marks } = walk;
  for (let i = 1; i < points.length; i += 1) {
    if (distance <= marks[i]! || i === points.length - 1) {
      const span = marks[i]! - marks[i - 1]!;
      const t = span > 0 ? Math.min(1, Math.max(0, (distance - marks[i - 1]!) / span)) : 1;
      return out.copy(points[i - 1]!).lerp(points[i]!, t);
    }
  }
  return out.copy(points[points.length - 1]!);
}

/**
 * The AI advisor walking through the home with the buyer. Stands a couple of metres ahead of the
 * camera at each stop, facing the buyer and lip-synced to the call; walks to the next stop along
 * the camera's own route (through doorways, not walls). Steps out of view in the overview.
 */
export function TourGuide({ stop, sceneKey, track, enabled, visible, maxEyeY, onPresence }: TourGuideProps) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const [guide, setGuide] = useState<GuideAvatar | null>(null);
  const walk = useRef<Walk | null>(null);
  const phase = useRef(0);
  const facing = useRef(0);
  const shown = useRef(false);
  /** Where the guide stands or walks; the drawn position adds the walking bob on top. */
  const base = useMemo(() => new Vector3(), []);

  // Load once while enabled; release when the tour no longer needs a guide.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let loaded: GuideAvatar | null = null;
    GuideAvatar.create(camera).then(
      (g) => {
        if (cancelled) return g.dispose();
        loaded = g;
        g.root.visible = false;
        scene.add(g.root);
        setGuide(g);
      },
      () => {
        // No guide (no WebGL 2 or no avatar file): the tour works as before.
      },
    );
    return () => {
      cancelled = true;
      loaded?.dispose();
      setGuide(null);
      onPresence(false);
    };
  }, [enabled, camera, scene, onPresence]);

  useEffect(() => {
    guide?.attachAudio(track);
  }, [guide, track]);

  // A new home: start from nowhere, so the guide does not walk through the street.
  useEffect(() => {
    if (!guide) return;
    guide.root.visible = false;
    shown.current = false;
    walk.current = null;
    onPresence(false);
  }, [guide, sceneKey, onPresence]);

  // Each new stop: find a spot and walk there along the camera's route.
  useEffect(() => {
    if (!guide) return;
    const model = scene.getObjectByName(TOUR_MODEL_NAME);
    const aspect = camera instanceof PerspectiveCamera ? camera.aspect : 16 / 9;
    const spot = visible && stop && model && stop.position[1] <= maxEyeY ? findSpot(model, stop, aspect) : null;
    if (!stop || !model || !spot) {
      guide.root.visible = false;
      shown.current = false;
      walk.current = null;
      onPresence(false);
      return;
    }
    if (!shown.current) {
      // First appearance at this home: already standing there when the camera arrives.
      base.copy(spot);
      guide.root.position.copy(spot);
      facing.current = Math.atan2(stop.position[0] - spot.x, stop.position[2] - spot.z);
      guide.root.rotation.set(0, facing.current, 0);
      guide.root.visible = true;
      shown.current = true;
      walk.current = null;
      onPresence(true);
      invalidate();
      return;
    }
    const from = base.clone();
    const via = stop.via.map(([x, y, z]) => new Vector3(x, floorNear(model, new Vector3(x, y, z)), z));
    walk.current = planWalk([from, ...via, spot]);
    invalidate();
  }, [guide, stop, visible, maxEyeY, camera, scene, invalidate, onPresence, base]);

  // Keep frames coming while the guide is in view (the tour canvas otherwise renders on demand).
  useEffect(() => {
    if (!guide) return;
    const id = window.setInterval(() => {
      if (guide.root.visible) invalidate();
    }, 1000 / GUIDE.fps);
    return () => window.clearInterval(id);
  }, [guide, invalidate]);

  // Dev builds expose the guide for diagnosing placement from the browser console.
  useEffect(() => {
    if (!import.meta.env.DEV || !guide) return;
    (window as unknown as { __aveGuide?: unknown }).__aveGuide = { guide, base, walk, facing, camera, stop };
  }, [guide, base, camera, stop]);

  useFrame((_, delta) => {
    if (!guide || !guide.root.visible) return;
    const dt = Math.min(delta, GUIDE.maxFrameS);
    const w = walk.current;
    let walking = false;
    if (w) {
      w.travelled = Math.min(w.length, w.travelled + w.speed * dt);
      const before = base.clone();
      pointAlong(w, w.travelled, base);
      const moved = before.distanceTo(base);
      phase.current += (moved / GUIDE.strideLength) * Math.PI;
      if (moved > 1e-4) facing.current = turnTowards(facing.current, Math.atan2(base.x - before.x, base.z - before.z), GUIDE.turnRate * dt);
      walking = w.travelled < w.length;
      if (!walking) {
        walk.current = null;
        guide.lookAtBuyer(GUIDE.arrivalLookMs);
      }
    } else {
      // Standing: turn to face the buyer.
      facing.current = turnTowards(facing.current, Math.atan2(camera.position.x - base.x, camera.position.z - base.z), GUIDE.turnRate * dt);
    }
    guide.root.rotation.set(0, facing.current, 0);
    guide.update(dt * 1000, walking, phase.current);
    guide.root.position.set(base.x, base.y + guide.bob(phase.current), base.z);
  });

  return null;
}

/** Turns `current` towards `target` (radians, shortest way) by at most `maxStep`. */
function turnTowards(current: number, target: number, maxStep: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + Math.max(-maxStep, Math.min(maxStep, diff));
}
