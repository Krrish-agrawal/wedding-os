import type { CSSProperties } from 'react';
import { random, useCurrentFrame } from 'remotion';
import { VIDEO } from '../timeline';
import { settle, wobble } from '../lib/anim';
import {
  ANCHORS,
  Arm,
  Brows,
  EyesHappy,
  EyesHeart,
  EyesOpen,
  EyesSleepy,
  EyesWink,
  Leg,
  MASCOT_VIEWBOX,
  MascotBody,
  MascotShadow,
  Shades,
  Snooze,
  type BrowShape,
} from './art';

/**
 * A frame-driven version of the app's mascot (apps/web/src/ui/mascot/Mascot.tsx). The app animates
 * with springs in real time; a render has to be a pure function of the frame, so the same poses are
 * computed here from the frame number instead.
 */
export type MascotState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'apologetic'
  | 'wave'
  | 'surprised'
  | 'wink'
  | 'love'
  | 'sleepy'
  | 'cool';

type Eyes = 'open' | 'happy' | 'wink' | 'heart' | 'sleepy' | 'shades';

interface Pose {
  eyes: Eyes;
  brows: BrowShape;
  rotate: number;
  y: number;
  armL: number;
  armR: number;
  lookX: number;
  lookY: number;
  eyeScale: number;
}

/** The settled poses from the app's POSES table. */
const POSES: Record<MascotState, Pose> = {
  idle: { eyes: 'open', brows: 'none', rotate: 0, y: 0, armL: 0, armR: 0, lookX: 0, lookY: 0, eyeScale: 1 },
  listening: { eyes: 'open', brows: 'raised', rotate: -5, y: 0, armL: 10, armR: -10, lookX: -0.8, lookY: -0.6, eyeScale: 1.1 },
  thinking: { eyes: 'open', brows: 'quizzical', rotate: 3, y: 0, armL: -12, armR: -125, lookX: 1.8, lookY: -2, eyeScale: 1 },
  speaking: { eyes: 'open', brows: 'none', rotate: 0, y: 0, armL: 0, armR: 0, lookX: 0, lookY: 0, eyeScale: 1 },
  happy: { eyes: 'happy', brows: 'none', rotate: 0, y: 0, armL: 120, armR: -120, lookX: 0, lookY: 0, eyeScale: 1 },
  apologetic: { eyes: 'open', brows: 'worried', rotate: -3, y: 2, armL: -18, armR: 18, lookX: 0, lookY: 1, eyeScale: 0.9 },
  wave: { eyes: 'open', brows: 'raised', rotate: 0, y: 0, armL: 116, armR: 0, lookX: 0, lookY: 0, eyeScale: 1 },
  surprised: { eyes: 'open', brows: 'raised', rotate: 0, y: 0, armL: 48, armR: -48, lookX: 0, lookY: -0.6, eyeScale: 1.3 },
  wink: { eyes: 'wink', brows: 'none', rotate: 4, y: 0, armL: 0, armR: -100, lookX: 0, lookY: 0, eyeScale: 1 },
  love: { eyes: 'heart', brows: 'none', rotate: 0, y: 0, armL: -26, armR: 26, lookX: 0, lookY: 0, eyeScale: 1 },
  sleepy: { eyes: 'sleepy', brows: 'none', rotate: -4, y: 1.5, armL: -6, armR: 6, lookX: 0, lookY: 0, eyeScale: 1 },
  cool: { eyes: 'shades', brows: 'none', rotate: 3, y: 0, armL: -18, armR: -72, lookX: 0, lookY: 0, eyeScale: 1 },
};

const NUMERIC = ['rotate', 'y', 'armL', 'armR', 'lookX', 'lookY', 'eyeScale'] as const;

/** A change of expression at a frame (relative to the enclosing Sequence). */
export interface Cue {
  at: number;
  state: MascotState;
}

const BLINK_FRAMES = 4;
const BLINK_GAP_S: [number, number] = [2.6, 5.2];
const HOP_S = 0.7;
const WAVE_RISE_S = 0.25;
const WAVE_PERIOD_S = 0.46;
const SPEAK_STEP_FRAMES = 4;
const SNOOZE_S = 2.4;

/** Deterministic talking level, 0–1: syllable-length pulses with the odd quiet beat. */
function voiceLevel(frame: number, seed: number): number {
  const step = Math.floor(frame / SPEAK_STEP_FRAMES);
  const sample = (i: number) => {
    const quiet = random(`q${seed}-${i}`) < 0.18;
    return quiet ? 0 : 0.25 + random(`v${seed}-${i}`) * 0.75;
  };
  const t = (frame % SPEAK_STEP_FRAMES) / SPEAK_STEP_FRAMES;
  return sample(step) * (1 - t) + sample(step + 1) * t;
}

/** True while a blink is under way. Blinks fall at seeded, irregular gaps. */
function blinking(frame: number, seed: number): boolean {
  let t = Math.round(BLINK_GAP_S[0] * VIDEO.fps * random(`b0-${seed}`));
  for (let i = 0; t <= frame; i++) {
    if (frame < t + BLINK_FRAMES) return true;
    const [min, max] = BLINK_GAP_S;
    t += Math.round((min + random(`b${i}-${seed}`) * (max - min)) * VIDEO.fps);
  }
  return false;
}

function activeCues(cues: Cue[], frame: number): { prev: Cue | null; cur: Cue } {
  const sorted = [...cues].sort((a, b) => a.at - b.at);
  let i = 0;
  while (i + 1 < sorted.length && sorted[i + 1]!.at <= frame) i++;
  return { prev: i > 0 ? sorted[i - 1]! : null, cur: sorted[i]! };
}

/** The app's hop keyframes for happy and surprised, played once over HOP_S. */
const HOPS: Partial<Record<MascotState, number[]>> = { happy: [0, -9, 0, -3, 0], surprised: [0, -6, 0] };

function hopAt(state: MascotState, since: number): number {
  const keys = HOPS[state];
  if (!keys) return 0;
  const t = since / (HOP_S * VIDEO.fps);
  if (t <= 0 || t >= 1) return 0;
  const pos = t * (keys.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  const ease = f * f * (3 - 2 * f);
  return keys[i]! + (keys[i + 1]! - keys[i]!) * ease;
}

export interface MascotProps {
  /** One state for the whole shot, or a list of cues. */
  state?: MascotState;
  cues?: Cue[];
  size: number;
  shadow?: boolean;
  /** Mirror left to right. */
  flip?: boolean;
  /** Legs dangle and swing, for sitting on a ledge. */
  seated?: boolean;
  /** Varies blinks and talking rhythm between mascots on screen. */
  seed?: number;
  /** Offset the internal clock, e.g. to keep a long shot in step with an earlier one. */
  frameOffset?: number;
  style?: CSSProperties;
}

export function Mascot({ state = 'idle', cues, size, shadow = true, flip = false, seated = false, seed = 1, frameOffset = 0, style }: MascotProps) {
  const frame = useCurrentFrame() + frameOffset;
  const list = cues && cues.length > 0 ? cues : [{ at: 0, state }];
  const { prev, cur } = activeCues(list, frame);
  const since = frame - cur.at;
  const target = POSES[cur.state];
  const from = prev ? POSES[prev.state] : target;
  const blend = prev ? settle(frame, cur.at) : 1;
  const pose: Pose = { ...target };
  for (const key of NUMERIC) pose[key] = from[key] + (target[key] - from[key]) * blend;

  // Per-state motion layered on the settled pose.
  let armLExtra = 0;
  let armRExtra = 0;
  let hop = hopAt(cur.state, since);
  if (cur.state === 'wave') {
    const rise = Math.min(1, since / (WAVE_RISE_S * VIDEO.fps));
    pose.armL = from.armL + (128 - from.armL) * rise;
    if (rise >= 1) pose.armL = 113 + 15 * Math.cos((since / VIDEO.fps / WAVE_PERIOD_S) * Math.PI * 2);
    pose.rotate += 2 * wobble(since, 0.9);
  }
  if (cur.state === 'love') pose.rotate += 3 * wobble(since, 1.2);
  if (cur.state === 'speaking') {
    const level = voiceLevel(frame, seed);
    hop = -3.5 * level;
    armRExtra = -34 * level;
    armLExtra = 14 * level;
  }
  // A slow breath keeps still shots alive.
  const breathe = 1 + 0.012 * wobble(frame, 3.2, seed);
  const blink = pose.eyes === 'open' && target.eyes === 'open' && blinking(frame, seed) ? 0.12 : 1;
  const pivot = seated ? ANCHORS.seat : ANCHORS.base;
  const legSwing = seated ? 13 * wobble(frame, 1.8) : 0;
  const snoozePhase = (frame / VIDEO.fps / SNOOZE_S) * Math.PI * 2;

  return (
    <svg
      viewBox={MASCOT_VIEWBOX}
      width={size}
      height={size}
      style={{ display: 'block', overflow: 'visible', transform: flip ? 'scaleX(-1)' : undefined, ...style }}
    >
      <g transform={`rotate(${pose.rotate} ${pivot.x} ${pivot.y})`}>
        <g transform={`translate(0 ${pose.y + hop}) translate(${pivot.x} ${pivot.y}) scale(1 ${breathe}) translate(${-pivot.x} ${-pivot.y})`}>
          {shadow && <MascotShadow />}
          <g transform={`rotate(${-legSwing} ${ANCHORS.leftHip.x} ${ANCHORS.leftHip.y})`}>
            <Leg side="left" />
          </g>
          <g transform={`rotate(${legSwing} ${ANCHORS.rightHip.x} ${ANCHORS.rightHip.y})`}>
            <Leg side="right" />
          </g>
          <g transform={`rotate(${pose.armL + armLExtra} ${ANCHORS.leftShoulder.x} ${ANCHORS.leftShoulder.y})`}>
            <Arm side="left" />
          </g>
          <g transform={`rotate(${pose.armR + armRExtra} ${ANCHORS.rightShoulder.x} ${ANCHORS.rightShoulder.y})`}>
            <Arm side="right" />
          </g>
          <MascotBody />
          <g
            transform={`translate(${pose.lookX} ${pose.lookY}) translate(${ANCHORS.face.x} 64) scale(${pose.eyeScale} ${pose.eyeScale * blink}) translate(${-ANCHORS.face.x} -64)`}
          >
            <EyesFor kind={target.eyes} />
          </g>
          <Brows shape={target.brows} />
          {target.eyes === 'sleepy' && (
            <g opacity={0.35 + 0.65 * (0.5 + 0.5 * Math.sin(snoozePhase))} transform={`translate(0 ${-2 * Math.sin(snoozePhase)})`}>
              <Snooze />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}

function EyesFor({ kind }: { kind: Eyes }) {
  switch (kind) {
    case 'happy':
      return <EyesHappy />;
    case 'wink':
      return <EyesWink />;
    case 'heart':
      return <EyesHeart />;
    case 'sleepy':
      return <EyesSleepy />;
    case 'shades':
      return <Shades />;
    case 'open':
      return <EyesOpen />;
  }
}
