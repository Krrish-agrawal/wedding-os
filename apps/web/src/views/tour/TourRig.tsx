import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import CameraControls from 'camera-controls';
import { Box3, MathUtils, Matrix4, PerspectiveCamera, Plane, Quaternion, Raycaster, Sphere, Spherical, Vector2, Vector3, Vector4 } from 'three';
import type { CameraShot, Vec3 } from '@ave/shared';
import { CameraPath, makePose, poseFromShot } from '@/three/cameraPath';
import type { Level } from '@/three/levels';
import type { PreparedModel } from '@/three/prepareModel';
import { CollisionMap, cutawayFor, planRoute } from '@/three/route';
import { TOUR } from './config';

CameraControls.install({ THREE: { Box3, MathUtils, Matrix4, Quaternion, Raycaster, Sphere, Spherical, Vector2, Vector3, Vector4 } });

/** Where the camera should be: a tour stop or the overview, identified by `key`. */
export interface RigTarget {
  key: string;
  shot: CameraShot;
  via: Vec3[];
}

export interface RigPose {
  x: number;
  y: number;
  z: number;
  /** Heading in plan space (x right, z down), radians. */
  heading: number;
}

interface TourRigProps {
  target: RigTarget;
  model: PreparedModel | null;
  levels: Level[];
  /** Changing this (a different property) snaps the camera instead of gliding. */
  sceneKey: string;
  ready: boolean;
  active: boolean;
  onArrive: (key: string) => void;
  onInteract: (interacting: boolean) => void;
  onPose: (pose: RigPose) => void;
}

/**
 * The tour camera. Moves between stops along authored paths (eased, never cut), then hands over to
 * camera-controls for a limited look-around from the stop's position. When the next stop is
 * requested the glide starts from wherever the buyer is looking, so the view eases back on its own.
 * While the view is hidden nothing is rendered; requested moves snap and play nothing.
 */
export function TourRig({ target, model, levels, sceneKey, ready, active, onArrive, onInteract, onPose }: TourRigProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  const controls = useMemo(() => {
    const c = new CameraControls(camera, gl.domElement);
    const A = CameraControls.ACTION;
    c.mouseButtons.left = A.ROTATE;
    c.mouseButtons.middle = A.NONE;
    c.mouseButtons.right = A.NONE;
    c.mouseButtons.wheel = A.NONE;
    c.touches.one = A.TOUCH_ROTATE;
    c.touches.two = A.NONE;
    c.touches.three = A.NONE;
    c.azimuthRotateSpeed = TOUR.look.rotateSpeed;
    c.polarRotateSpeed = TOUR.look.rotateSpeed;
    c.smoothTime = TOUR.look.smoothTime;
    c.draggingSmoothTime = TOUR.look.draggingSmoothTime;
    c.minDistance = c.maxDistance = TOUR.look.pivotDistance;
    c.enabled = false;
    return c;
  }, [camera, gl]);

  const collision = useMemo(() => (model ? new CollisionMap(model.structure, levels) : null), [model, levels]);
  const cutaway = useMemo(() => cutawayFor(levels), [levels]);
  const cutPlane = useMemo(() => new Plane(new Vector3(0, -1, 0), cutaway.cutY), [cutaway]);
  const cutOn = useRef(false);
  /** Via chain of the stop the camera is at or heading to, used to route the next move. */
  const chain = useRef<Vec3[]>([]);
  const move = useRef<{ path: CameraPath; started: number; key: string; via: Vec3[] } | null>(null);
  const arrived = useRef<string | null>(null);
  const stopDistance = useRef<number>(TOUR.look.pivotDistance);
  const pose = useRef(makePose());
  const dir = useRef(new Vector3());
  const live = useRef({ active, onArrive, onInteract, onPose, target });
  live.current = { active, onArrive, onInteract, onPose, target };

  const report = () => {
    const above = camera.position.y > cutaway.triggerY;
    if (above !== cutOn.current) {
      cutOn.current = above;
      gl.clippingPlanes = above ? [cutPlane] : [];
    }
    camera.getWorldDirection(dir.current);
    live.current.onPose({ x: camera.position.x, y: camera.position.y, z: camera.position.z, heading: Math.atan2(dir.current.z, dir.current.x) });
  };

  /** Hands the view to camera-controls for a limited look-around at a resting shot. */
  const rest = (key: string, shot: CameraShot, via: Vec3[]) => {
    move.current = null;
    chain.current = via;
    const p = new Vector3(...shot.position);
    const d = new Vector3(...shot.target).sub(p);
    stopDistance.current = Math.max(d.length(), TOUR.look.pivotDistance);
    d.normalize();
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    const pivot = p.clone().addScaledVector(d, TOUR.look.pivotDistance);
    void controls.setLookAt(p.x, p.y, p.z, pivot.x, pivot.y, pivot.z, false);
    controls.update(0);
    const az = controls.azimuthAngle;
    const polar = controls.polarAngle;
    const azLimit = MathUtils.degToRad(TOUR.look.azimuthLimitDeg);
    const polarLimit = MathUtils.degToRad(TOUR.look.polarLimitDeg);
    controls.minAzimuthAngle = az - azLimit;
    controls.maxAzimuthAngle = az + azLimit;
    controls.minPolarAngle = Math.max(0.05, polar - polarLimit);
    controls.maxPolarAngle = Math.min(Math.PI - 0.05, polar + polarLimit);
    camera.fov = shot.fov;
    camera.updateProjectionMatrix();
    controls.enabled = live.current.active;
    arrived.current = key;
    report();
    live.current.onArrive(key);
    invalidate();
  };

  const startMove = (t: RigTarget) => {
    camera.getWorldDirection(dir.current);
    const from = {
      position: camera.position.clone(),
      target: camera.position.clone().addScaledVector(dir.current, stopDistance.current),
      fov: camera.fov,
    };
    const to = poseFromShot(t.shot);
    const route = planRoute({ from: from.position, fromChain: chain.current, to: to.position, toChain: t.via, cutaway, collision });
    controls.enabled = false;
    arrived.current = null;
    chain.current = t.via;
    move.current = { path: new CameraPath(from, route, to), started: performance.now(), key: t.key, via: t.via };
    if (import.meta.env.DEV) (window as unknown as { __tourDebug?: unknown }).__tourDebug = { camera, route, key: t.key, duration: move.current.path.duration };
    invalidate();
  };

  // Snap into place when a model first appears or the property changes.
  useEffect(() => {
    if (!ready) return;
    rest(live.current.target.key, live.current.target.shot, live.current.target.via);
    // Deps: snap only on scene changes
  }, [sceneKey, ready]);

  // Glide to a newly requested stop (or snap if nobody is watching).
  useEffect(() => {
    if (!ready) return;
    const t = live.current.target;
    if (move.current?.key === t.key || (!move.current && arrived.current === t.key)) return;
    if (live.current.active) startMove(t);
    else rest(t.key, t.shot, t.via);
    // Deps: keyed on the stop, not the object
  }, [target.key, ready]);

  // Hidden: finish any glide at once so returning shows the right view. Shown: draw a frame.
  useEffect(() => {
    if (!active && move.current) rest(live.current.target.key, live.current.target.shot, live.current.target.via);
    controls.enabled = active && !move.current && arrived.current !== null;
    if (active) invalidate();
    // Deps: reacts to visibility only
  }, [active]);

  useEffect(() => {
    const onStart = () => {
      live.current.onInteract(true);
      invalidate();
    };
    const onControl = () => invalidate();
    const onEnd = () => live.current.onInteract(false);
    controls.addEventListener('controlstart', onStart);
    controls.addEventListener('control', onControl);
    controls.addEventListener('controlend', onEnd);
    return () => {
      controls.removeEventListener('controlstart', onStart);
      controls.removeEventListener('control', onControl);
      controls.removeEventListener('controlend', onEnd);
      controls.dispose();
      gl.clippingPlanes = [];
    };
  }, [controls, invalidate, gl]);

  useFrame((_, delta) => {
    const m = move.current;
    if (m) {
      const t = (performance.now() - m.started) / 1000 / m.path.duration;
      m.path.sample(t, pose.current);
      camera.position.copy(pose.current.position);
      camera.lookAt(pose.current.target);
      camera.fov = pose.current.fov;
      camera.updateProjectionMatrix();
      report();
      if (t >= 1) rest(m.key, { position: m.path.to.position.toArray(), target: m.path.to.target.toArray(), fov: m.path.to.fov }, m.via);
      else invalidate();
      return;
    }
    if (controls.update(delta)) {
      report();
      invalidate();
    }
  });

  return null;
}
