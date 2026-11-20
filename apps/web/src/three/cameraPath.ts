import { CatmullRomCurve3, MathUtils, Vector3, type Curve } from 'three';
import type { CameraShot, Vec3 } from '@ave/shared';

/**
 * Camera moves between tour shots. Positions follow a smooth curve through the stop's `via` points
 * (so the camera passes through doorways rather than walls) and the view turns to look along the
 * path while moving, then settles into the stop's framing. Shared by the tour and the studio's
 * preview so authored shots play back exactly as buyers will see them.
 */

export interface Pose {
  position: Vector3;
  target: Vector3;
  fov: number;
}

export const PATH = {
  /** Walking pace of the camera, metres per second. */
  speed: 1.7,
  minDuration: 1.1,
  maxDuration: 5.5,
  /** A pure turn (no travel) still takes this long, scaled by the angle turned. */
  turnDurationPerRadian: 0.55,
  /** Share of the move spent turning from the start view to the travel direction, and into the end view. */
  turnIn: 0.3,
  turnOut: 0.35,
  /** How much a path's vertical slope tilts the view while travelling (0 = level gaze). */
  slopeLook: 0.35,
} as const;

export function poseFromShot(shot: Pick<CameraShot, 'position' | 'target' | 'fov'>): Pose {
  return { position: new Vector3(...shot.position), target: new Vector3(...shot.target), fov: shot.fov };
}

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export class CameraPath {
  readonly duration: number;
  private readonly curve: Curve<Vector3> | null;
  private readonly startDir: Vector3;
  private readonly endDir: Vector3;
  private readonly startDist: number;
  private readonly endDist: number;
  private readonly tmpTangent = new Vector3();
  private readonly tmpDir = new Vector3();

  constructor(
    readonly from: Pose,
    via: Vec3[],
    readonly to: Pose,
  ) {
    const points = [from.position.clone(), ...via.map((v) => new Vector3(...v)), to.position.clone()];
    const travel = from.position.distanceTo(to.position);
    this.curve = via.length ? new CatmullRomCurve3(points, false, 'centripetal') : null;
    const length = this.curve ? this.curve.getLength() : travel;

    this.startDist = Math.max(0.01, from.position.distanceTo(from.target));
    this.endDist = Math.max(0.01, to.position.distanceTo(to.target));
    this.startDir = from.target.clone().sub(from.position).normalize();
    this.endDir = to.target.clone().sub(to.position).normalize();
    const turn = this.startDir.angleTo(this.endDir);

    this.duration = MathUtils.clamp(Math.max(length / PATH.speed, turn * PATH.turnDurationPerRadian), PATH.minDuration, PATH.maxDuration);
  }

  /** Pose at time `t` (0..1, unclamped input is clamped). Writes into `out`. */
  sample(t: number, out: Pose): Pose {
    const u = easeInOutSine(MathUtils.clamp(t, 0, 1));
    const { from, to } = this;
    if (!this.curve) {
      out.position.lerpVectors(from.position, to.position, u);
      out.target.lerpVectors(from.target, to.target, u);
      out.fov = MathUtils.lerp(from.fov, to.fov, u);
      return out;
    }
    this.curve.getPointAt(u, out.position);
    this.curve.getTangentAt(u, this.tmpTangent);
    this.tmpTangent.y *= PATH.slopeLook;
    this.tmpTangent.normalize();
    const wStart = 1 - MathUtils.smoothstep(u, 0, PATH.turnIn);
    const wEnd = MathUtils.smoothstep(u, 1 - PATH.turnOut, 1);
    const wTravel = Math.max(0, 1 - wStart - wEnd);
    this.tmpDir
      .set(0, 0, 0)
      .addScaledVector(this.startDir, wStart)
      .addScaledVector(this.tmpTangent, wTravel)
      .addScaledVector(this.endDir, wEnd);
    if (this.tmpDir.lengthSq() < 1e-6) this.tmpDir.copy(this.endDir);
    this.tmpDir.normalize();
    out.target.copy(out.position).addScaledVector(this.tmpDir, MathUtils.lerp(this.startDist, this.endDist, u));
    out.fov = MathUtils.lerp(from.fov, to.fov, u);
    return out;
  }
}

export function makePose(): Pose {
  return { position: new Vector3(), target: new Vector3(), fov: 50 };
}
