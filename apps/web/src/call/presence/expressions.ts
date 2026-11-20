import type { Expression } from '@ave/shared';
import type { MascotState } from '@/ui';
import type { PresenceState } from './types';

/**
 * How each conversational moment looks (BUILD_PLAN.md section 5). Pure data, shared by both
 * presence modes. Every entry is one-shot: nothing here loops, and every face returns to the
 * resting face on its own.
 */

/** A facial animation added on top of the resting face: ramp in, hold, ramp out. Values 0–1. */
export interface FaceCue {
  name: string;
  rampInMs: number;
  holdMs: number;
  rampOutMs: number;
  targets: Record<string, number>;
}

export interface GestureCue {
  /** TalkingHead hand gesture, or one of its animated templates ("yes" is a nod). */
  name: string;
  seconds: number;
  /** Right hand instead of left. The stage is on the avatar's right, so pointing mirrors. */
  mirror: boolean;
  transitionMs: number;
}

export interface Human3dCue {
  face?: FaceCue;
  gesture?: GestureCue;
  look?: { kind: 'camera' | 'ahead'; ms: number };
  /** A slight head tilt, for attentive listening. */
  tilt?: boolean;
  /** Clear any gesture and face still playing before this one. */
  settle?: boolean;
}

/** Prefix for every animation presence adds, so it can find and finish them. */
export const PRESENCE_ANIM_PREFIX = 'presence-';

const face = (name: string, holdMs: number, targets: Record<string, number>, rampInMs = 350, rampOutMs = 600): FaceCue => ({
  name: `${PRESENCE_ANIM_PREFIX}${name}`,
  rampInMs,
  holdMs,
  rampOutMs,
  targets,
});

/** Head tilt for attentive listening, in radians, and how long it is held. */
export const ATTENTIVE_TILT = { radians: 0.05, rampInMs: 500, holdMs: 2200, rampOutMs: 900 };

export const HUMAN3D_EXPRESSIONS: Record<Expression, Human3dCue> = {
  // Call connects, greeting: warm smile, small wave.
  warm: {
    face: face('warm', 2600, { mouthSmile: 0.45, eyeSquintLeft: 0.25, eyeSquintRight: 0.25, browInnerUp: 0.15 }),
    gesture: { name: 'handup', seconds: 1.6, mirror: true, transitionMs: 600 },
    look: { kind: 'camera', ms: 2000 },
  },
  // Buyer is speaking: eye contact, slight tilt, brows a touch raised.
  attentive: {
    face: face('attentive', 2000, { browInnerUp: 0.2 }),
    look: { kind: 'camera', ms: 2500 },
    tilt: true,
  },
  // Tool running: glance away and up, a small frown of concentration. No hand to chin: it repeats every turn.
  thinking: {
    face: face('thinking', 1400, { browDownLeft: 0.3, browOuterUpRight: 0.35, mouthPressLeft: 0.2, mouthPressRight: 0.2 }),
    look: { kind: 'ahead', ms: 1600 },
  },
  // Showing a highlight: a raised index finger on the stage side of the frame. ("side", the open
  // arm, points the right way but the hand falls outside a head-and-shoulders crop.)
  pointing: {
    gesture: { name: 'index', seconds: 1.8, mirror: true, transitionMs: 600 },
    look: { kind: 'camera', ms: 1500 },
  },
  // Offer applied, visit booked: delighted, thumbs up.
  delighted: {
    face: face('delighted', 2400, { mouthSmile: 0.7, eyeSquintLeft: 0.45, eyeSquintRight: 0.45, cheekSquintLeft: 0.3, cheekSquintRight: 0.3, browInnerUp: 0.25 }),
    gesture: { name: 'thumbup', seconds: 2, mirror: false, transitionMs: 500 },
    look: { kind: 'camera', ms: 2000 },
  },
  // Something unavailable: apologetic, small shrug.
  apologetic: {
    face: face('apologetic', 2000, { browInnerUp: 0.55, mouthPressLeft: 0.3, mouthPressRight: 0.3, mouthFrownLeft: 0.15, mouthFrownRight: 0.15 }),
    gesture: { name: 'shrug', seconds: 1.6, mirror: false, transitionMs: 500 },
    look: { kind: 'camera', ms: 1500 },
  },
  // Legal and money explanations: calm, composed. Clears anything playing.
  composed: { settle: true, look: { kind: 'camera', ms: 1500 } },
  // Human advisor takes over: friendly nod, then standby.
  nod: {
    face: face('nod', 1500, { mouthSmile: 0.4 }),
    gesture: { name: 'yes', seconds: 1.4, mirror: false, transitionMs: 300 },
  },
};

/** Transition when the buyer cuts in: gestures drop almost at once, not over TalkingHead's default second. */
export const INTERRUPT_TRANSITION_MS = 250;

/** Mascot: which pose a moment shows, and for how long before the live state returns. */
export const MASCOT_EXPRESSIONS: Record<Expression, { state: MascotState; holdMs: number } | null> = {
  warm: { state: 'wave', holdMs: 2600 },
  attentive: { state: 'listening', holdMs: 1500 },
  thinking: { state: 'thinking', holdMs: 1500 },
  pointing: null,
  delighted: { state: 'happy', holdMs: 2600 },
  apologetic: { state: 'apologetic', holdMs: 2600 },
  composed: null,
  nod: { state: 'happy', holdMs: 1800 },
};

export const MASCOT_BASE: Record<PresenceState, MascotState> = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  standby: 'idle',
};

/**
 * The mascot pose to show. A moment wins; otherwise audio activity shows the speaking mouth even
 * before the engine's state arrives, except on standby (the human advisor has the floor).
 */
export function mascotDisplayState(base: PresenceState, moment: MascotState | null, audioActive: boolean): MascotState {
  if (moment) return moment;
  if (base !== 'standby' && audioActive) return 'speaking';
  return MASCOT_BASE[base];
}
