import type { TalkingHead } from '@met4citizen/talkinghead';
import { FRAMING } from '../config';

/**
 * Camera and motion staging that turns TalkingHead's demo look into a video-call look.
 */

const DEG_TO_HALF_RAD = Math.PI / 360;

/**
 * Head-and-shoulders framing from the avatar's eyes: camera a little above eye level, aimed so the
 * eyes sit FRAMING.eyesFromTop down the frame, at the distance that shows FRAMING.verticalExtentM.
 * Replaces TalkingHead's preset view (and any camera move it started). False if the model has no
 * eye bones, in which case TalkingHead's own view stays.
 */
export function frameHeadAndShoulders(head: TalkingHead): boolean {
  const left = head.objectLeftEye;
  const right = head.objectRightEye;
  if (!left || !right) return false;
  const eyes = head.camera.position.clone();
  const other = head.camera.position.clone();
  left.getWorldPosition(eyes);
  right.getWorldPosition(other);
  eyes.add(other).multiplyScalar(0.5);

  const distance = FRAMING.verticalExtentM / (2 * Math.tan(head.camera.fov * DEG_TO_HALF_RAD));
  const target = eyes.clone();
  target.y -= (0.5 - FRAMING.eyesFromTop) * FRAMING.verticalExtentM;
  const position = eyes.clone();
  position.y += FRAMING.cameraAboveEyesM;
  position.z += distance;

  head.camera.position.copy(position);
  head.controls.target.copy(target);
  head.cameraStart = position.clone();
  head.cameraEnd = position.clone();
  head.controlsStart = target.clone();
  head.controlsEnd = target.clone();
  head.cameraClock = null;
  head.controls.update();
  return true;
}

const BODY_ROTATION = /^bodyRotate[XYZ]$/;

/** A template value: a number, or a random range [min, max, skew?, samples?]. Only min and max scale. */
function scaleValue(value: unknown, factor: number): unknown {
  if (typeof value === 'number') return value * factor;
  if (Array.isArray(value)) return value.map((v, i) => (i < 2 && typeof v === 'number' ? v * factor : v));
  return value;
}

/**
 * Returns a copy of an animation template with every bodyRotateX/Y/Z value scaled. Walks the whole
 * template (idle / speaking / mood / pose variants and `alt` lists). Pure.
 */
export function scaleBodyRotation<T>(template: T, factor: number): T {
  if (Array.isArray(template)) return template.map((t) => scaleBodyRotation(t, factor)) as T;
  if (!template || typeof template !== 'object') return template;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template)) {
    out[key] = BODY_ROTATION.test(key) && Array.isArray(value) ? value.map((v) => scaleValue(v, factor)) : scaleBodyRotation(value, factor);
  }
  return out as T;
}

/**
 * Calms TalkingHead's idle body turns (the "head" loop of every mood) to seated-advisor size, and
 * restarts the current mood's loops so the change applies at once.
 */
export function calmIdleMotion(head: TalkingHead, factor: number): void {
  for (const mood of Object.values(head.animMoods)) {
    mood.anims = mood.anims.map((anim) => (anim.name === 'head' ? scaleBodyRotation(anim, factor) : anim));
  }
  head.setMood(head.getMood());
}
