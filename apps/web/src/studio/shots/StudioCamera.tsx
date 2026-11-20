import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Plane, Raycaster, Vector3, type Object3D } from 'three';
import { roomAt, type CameraShot, type Room, type Vec3 } from '@ave/shared';
import { CameraPath, makePose, poseFromShot } from '@/three/cameraPath';
import { levelAtHeight, roomLevel, type Level } from '@/three/levels';
import { MODEL_GROUPS } from '@/three/prepareModel';
import { CollisionMap, cutawayFor, planRoute } from '@/three/route';

/** Targets closer than this (a wall in your face) or farther are replaced by a point at the default distance. */
const TARGET_MIN = 0.6;
const TARGET_MAX = 14;
const TARGET_DEFAULT = 3;
const ROUND = 1000;

export interface StudioCameraHandle {
  /**
   * The current view as a shot: position, a target on the first surface ahead (or at a fixed
   * distance when `precise` is false, which skips the raycast), and FOV.
   */
  current(precise?: boolean): CameraShot;
  jump(shot: CameraShot, via?: Vec3[]): void;
  /** Plays the same move the tour plays: from the current view, through `via`, to `shot`. */
  glide(via: Vec3[], shot: CameraShot): Promise<void>;
  /** Plays a list of moves one after another. */
  glideAll(moves: { via: Vec3[]; shot: CameraShot }[]): Promise<void>;
  setFov(fov: number): void;
  stop(): void;
}

interface Props {
  model: Object3D | null;
  rooms: Room[];
  levels: Level[];
  readout: React.RefObject<HTMLPreElement | null>;
  /** Cut ceilings away when the camera rises above the top floor, as the tour does. */
  autoCutaway: boolean;
  onGlidingChange: (gliding: boolean) => void;
  onRoomChange: (roomId: string | null) => void;
}

const round = (v: number) => Math.round(v * ROUND) / ROUND;

export const StudioCamera = forwardRef<StudioCameraHandle, Props>(function StudioCamera({ model, rooms, levels, readout, autoCutaway, onGlidingChange, onRoomChange }, ref) {
  const gl = useThree((s) => s.gl);
  const collision = useMemo(() => (model ? new CollisionMap(model.getObjectByName(MODEL_GROUPS.structure) ?? null, levels) : null), [model, levels]);
  const cutaway = useMemo(() => cutawayFor(levels), [levels]);
  const cutPlane = useMemo(() => new Plane(new Vector3(0, -1, 0), cutaway.cutY), [cutaway]);
  const cutOn = useRef<boolean | null>(null);
  const chain = useRef<Vec3[]>([]);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const raycaster = useMemo(() => new Raycaster(), []);
  const dir = useRef(new Vector3());
  const glide = useRef<{ path: CameraPath; started: number; resolve: () => void } | null>(null);
  const pose = useRef(makePose());
  const lastRoom = useRef<string | null | undefined>(undefined);

  const targetAhead = (precise = true): Vector3 => {
    camera.getWorldDirection(dir.current);
    if (!precise) return camera.position.clone().addScaledVector(dir.current, TARGET_DEFAULT);
    raycaster.set(camera.position, dir.current);
    raycaster.near = TARGET_MIN;
    raycaster.far = TARGET_MAX;
    const hit = model ? raycaster.intersectObject(model, true)[0] : undefined;
    return hit ? hit.point.clone() : camera.position.clone().addScaledVector(dir.current, TARGET_DEFAULT);
  };

  const runGlide = (via: Vec3[], shot: CameraShot) =>
    new Promise<void>((resolve) => {
      const from = { position: camera.position.clone(), target: targetAhead(), fov: camera.fov };
      const to = poseFromShot(shot);
      const route = planRoute({ from: from.position, fromChain: chain.current, to: to.position, toChain: via, cutaway, collision });
      chain.current = via;
      glide.current?.resolve();
      glide.current = { path: new CameraPath(from, route, to), started: performance.now(), resolve };
      onGlidingChange(true);
    });

  useImperativeHandle(ref, () => ({
    current(precise = true) {
      const t = targetAhead(precise);
      return {
        position: [round(camera.position.x), round(camera.position.y), round(camera.position.z)],
        target: [round(t.x), round(t.y), round(t.z)],
        fov: Math.round(camera.fov),
      };
    },
    jump(shot, via = []) {
      chain.current = via;
      glide.current?.resolve();
      glide.current = null;
      camera.position.set(...shot.position);
      camera.lookAt(...shot.target);
      camera.fov = shot.fov;
      camera.updateProjectionMatrix();
      onGlidingChange(false);
    },
    glide: runGlide,
    async glideAll(moves) {
      for (const m of moves) await runGlide(m.via, m.shot);
    },
    setFov(fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    },
    stop() {
      glide.current?.resolve();
      glide.current = null;
      onGlidingChange(false);
    },
  }));

  useFrame(() => {
    const g = glide.current;
    if (g) {
      const t = (performance.now() - g.started) / 1000 / g.path.duration;
      g.path.sample(t, pose.current);
      camera.position.copy(pose.current.position);
      camera.lookAt(pose.current.target);
      camera.fov = pose.current.fov;
      camera.updateProjectionMatrix();
      if (t >= 1) {
        glide.current = null;
        onGlidingChange(false);
        g.resolve();
      }
    }

    const wantCut = autoCutaway && camera.position.y > cutaway.triggerY;
    if (autoCutaway && wantCut !== cutOn.current) {
      cutOn.current = wantCut;
      gl.clippingPlanes = wantCut ? [cutPlane] : [];
    }
    if (!autoCutaway) cutOn.current = null;

    const level = levelAtHeight(levels, camera.position.y);
    const room = roomAt(rooms.filter((r) => roomLevel(r) === level.index), [camera.position.x, camera.position.z]);
    const roomId = room?.id ?? null;
    if (roomId !== lastRoom.current) {
      lastRoom.current = roomId;
      onRoomChange(roomId);
    }
    if (readout.current) {
      camera.getWorldDirection(dir.current);
      const p = camera.position;
      readout.current.textContent =
        `pos  ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}\n` +
        `dir  ${dir.current.x.toFixed(2)}, ${dir.current.y.toFixed(2)}, ${dir.current.z.toFixed(2)}\n` +
        `fov  ${camera.fov.toFixed(0)}   level ${level.name}\n` +
        `room ${room ? room.name : '—'}`;
    }
  });

  return null;
});
