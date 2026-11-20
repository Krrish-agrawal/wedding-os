import { PRESENCE_MODES, type PresenceMode } from './types';

/**
 * Presence configuration. Every tunable number lives here with its reason.
 */

/** `VITE_AVATAR_MODE`: `human3d` (default) or `mascot`. Anything else falls back to the default. */
export function configuredPresenceMode(): PresenceMode {
  const raw = (import.meta.env.VITE_AVATAR_MODE as string | undefined)?.trim().toLowerCase();
  return (PRESENCE_MODES as readonly string[]).includes(raw ?? '') ? (raw as PresenceMode) : 'human3d';
}

/** Whole 3D mount (probe, model download and parse, lip-sync worklet) must finish within this. */
export const AVATAR_MOUNT_TIMEOUT_MS = 15_000;
/** Probe for the avatar file before creating a WebGL context for it. */
export const AVATAR_PROBE_TIMEOUT_MS = 4_000;

/**
 * Frame cap for the avatar. Visemes change at most every ~90 ms, so 30 fps renders every mouth
 * shape at least twice while keeping the second WebGL context (the tour has the first) cheap.
 */
export const AVATAR_FPS = 30;
/** While a human advisor has the floor the AI tile is dimmed and silent; half rate is plenty. */
export const AVATAR_STANDBY_FPS = 15;
/** Device pixel ratio cap for the avatar canvas: sharp on a 2x screen, no 3x cost. */
export const AVATAR_MAX_PIXEL_RATIO = 2;
/** Dampens TalkingHead's idle body sway; a seated advisor barely shifts weight. */
export const AVATAR_MOVEMENT_FACTOR = 0.5;

/** TalkingHead's starting view, replaced by the head-and-shoulders framing below once the avatar loads. */
export const AVATAR_VIEW = 'upper' as const;

/**
 * Video-call framing, measured from the avatar's own eyes so any model frames the same way.
 * The camera sits a touch above eye level and tilts down slightly (the flattering webcam angle);
 * the eyes land about a third of the way down the tile, with the upper chest at the bottom edge
 * under the name plate.
 */
export const FRAMING = {
  /** Height of the visible slice at the avatar, in metres: just above the head to upper chest. */
  verticalExtentM: 0.5,
  /** Where the eyes sit, as a fraction of the frame height from the top. */
  eyesFromTop: 0.38,
  /** Camera height above the eyes, in metres. */
  cameraAboveEyesM: 0.04,
  /** Let the first animation frames settle the pose (bind pose to idle pose) before measuring. */
  settleMs: 150,
};

/**
 * Three-point lighting with TalkingHead's own lights, on top of its soft room environment map:
 * - key: the directional light, warm, high and to the camera's left;
 * - fill: low neutral ambient, so shadows stay soft but the face keeps its shape;
 * - rim: the spot light (TalkingHead aims it at the head) from behind and above, to lift the hair
 *   and shoulders off the backdrop.
 * Angles are three.js spherical coordinates: phi from straight up, theta around from the camera.
 * TalkingHead's defaults (ambient 2, a bluish key at 30, blue spot) wash skin out on a white UI.
 */
export const AVATAR_LIGHTING = {
  lightAmbientColor: 0xfff8f2,
  lightAmbientIntensity: 0.25,
  lightDirectColor: 0xffe2c4,
  lightDirectIntensity: 4.5,
  lightDirectPhi: 0.95,
  lightDirectTheta: -0.65,
  lightSpotColor: 0xfff1e0,
  lightSpotIntensity: 25,
  lightSpotPhi: 0.75,
  lightSpotTheta: Math.PI - 0.55,
  lightSpotDispersion: 0.6,
};
/**
 * Strength of TalkingHead's room environment map. At full strength it lights the face evenly from
 * every side and flattens it; at about half the key light gives the face its shape.
 */
export const AVATAR_ENVIRONMENT_INTENSITY = 0.5;

/**
 * TalkingHead's idle loops turn the whole body up to ±0.3 rad, which reads as swaying in a
 * close-up. Scaled down, they become the small head and shoulder movement of someone seated.
 * Breathing, blinks and glances are kept as they are: they are random and never repeat visibly.
 */
export const IDLE_BODY_MOTION_SCALE = 0.4;

/**
 * Eye contact and head movement proportions (0–1). An advisor on a video call mostly looks at the
 * buyer; TalkingHead's defaults (0.2 idle) read as distracted in a close-up tile.
 */
export const AVATAR_GAZE = {
  avatarIdleEyeContact: 0.6,
  avatarIdleHeadMove: 0.35,
  avatarSpeakingEyeContact: 0.75,
  avatarSpeakingHeadMove: 0.45,
};

/**
 * HeadAudio. Detection runs 50–100 ms behind the audio and Agora plays the sound without delay,
 * so the mouth is tuned to catch up fast: a shorter hold and ramp than the library defaults
 * (120 / 100 ms) without going so short that the lips flutter.
 */
export const LIPSYNC = {
  visemeMinMs: 90,
  visemeRampMs: 70,
  /** Remote TTS audio has a clean noise floor; gate a little lower than the default -40 dB so soft syllables still move the lips. */
  vadGateActiveDb: -44,
  vadGateInactiveDb: -54,
};
/** A pause longer than this before speech starts counts as a new sentence (TalkingHead's example uses 150 ms). */
export const SENTENCE_PAUSE_MS = 150;
/** Chance of a talking-hands movement at a new sentence, and the minimum gap between two. */
export const TALKING_HANDS_PROBABILITY = 0.35;
export const TALKING_HANDS_MIN_GAP_MS = 6_000;
/** Look at the buyer at the start of each sentence for this long. */
export const SENTENCE_EYE_CONTACT_MS = 600;

/** Mascot voice level (bounce and arm gestures): RMS of the advisor's audio, smoothed (fast attack, slower release), scaled to 0–1. */
export const MASCOT_LEVEL = {
  fftSize: 512,
  /** RMS is small for speech; this brings normal speech to roughly 0.6–1. */
  gain: 4.5,
  /** Below this the level counts as silence (line noise, breaths). */
  noiseFloor: 0.04,
  attackMs: 40,
  releaseMs: 140,
  /** Re-render the mascot only when the level moved by at least this much. */
  minChange: 0.03,
  frameIntervalMs: 33,
  /** Audio above the noise floor for this long shows the speaking mouth even before agent state says so. */
  speechOnsetMs: 90,
  /** …and stays speaking until silent for this long, so short pauses between words do not close the mouth. */
  speechHangMs: 350,
};
