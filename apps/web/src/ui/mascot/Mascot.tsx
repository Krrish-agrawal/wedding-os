import { useEffect, useId, useState } from 'react';
import { motion, useReducedMotion, useSpring, useTransform, type TargetAndTransition, type Transition } from 'motion/react';
import { cn } from '../cn';
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
import type { MascotState } from './states';

/**
 * Stable API. The owner's artwork replaces the drawing in ./art.tsx; callers never change.
 */
export interface MascotProps {
  state?: MascotState;
  /**
   * 0–1 audio level. Drives the bounce and arm gestures while `state` is `speaking`; ignored otherwise.
   * Leave it undefined when no audio is available and the mascot gestures on its own while speaking.
   */
  level?: number;
  /** Rendered width and height (px number or any CSS length). */
  size?: number | string;
  /** Natural blinking. On for the live advisor tile, off for static brand uses. */
  alive?: boolean;
  /** The hard ink offset shadow under the letter. */
  shadow?: boolean;
  /** Sitting on a ledge: tilts pivot at the seat and the legs dangle and swing. */
  seated?: boolean;
  /** Accessible name. Omit for decorative uses next to visible text. */
  title?: string;
  className?: string;
}

/** Arm rotation about its shoulder, in degrees. 0 hangs down; left arm raises with +, right arm with −. */
type ArmAngle = number | number[];

interface Pose {
  body: TargetAndTransition;
  eyes: 'open' | 'happy' | 'wink' | 'heart' | 'sleepy' | 'shades';
  /** Pupils look direction, in viewBox units. */
  look: { x: number; y: number };
  eyeScale: number;
  brows: BrowShape;
  arms: { left: ArmAngle; right: ArmAngle };
}

/** Arms fully raised (about 120 degrees from hanging). */
const ARM_UP = 120;
/** Left arm waving: up, then two swings, ending raised. */
const WAVE_SWINGS = [0, 128, 98, 128, 98, 116];

const POSES: Record<MascotState, Pose> = {
  idle: { body: { rotate: 0, y: 0, scaleY: 1 }, eyes: 'open', look: { x: 0, y: 0 }, eyeScale: 1, brows: 'none', arms: { left: 0, right: 0 } },
  listening: { body: { rotate: -5, y: 0, scaleY: 1 }, eyes: 'open', look: { x: -0.8, y: -0.6 }, eyeScale: 1.1, brows: 'raised', arms: { left: 10, right: -10 } },
  thinking: { body: { rotate: 3, y: 0, scaleY: 1 }, eyes: 'open', look: { x: 1.8, y: -2 }, eyeScale: 1, brows: 'quizzical', arms: { left: -12, right: -125 } },
  speaking: { body: { rotate: 0, y: 0, scaleY: 1 }, eyes: 'open', look: { x: 0, y: 0 }, eyeScale: 1, brows: 'none', arms: { left: 0, right: 0 } },
  happy: { body: { rotate: 0, y: [0, -9, 0, -3, 0], scaleY: 1 }, eyes: 'happy', look: { x: 0, y: 0 }, eyeScale: 1, brows: 'none', arms: { left: [0, ARM_UP + 12, ARM_UP], right: [0, -ARM_UP - 12, -ARM_UP] } },
  apologetic: { body: { rotate: -3, y: 2, scaleY: 0.98 }, eyes: 'open', look: { x: 0, y: 1 }, eyeScale: 0.9, brows: 'worried', arms: { left: -18, right: 18 } },
  wave: { body: { rotate: [0, -3, 2, -2, 0], y: 0, scaleY: 1 }, eyes: 'open', look: { x: 0, y: 0 }, eyeScale: 1, brows: 'raised', arms: { left: WAVE_SWINGS, right: 0 } },
  surprised: { body: { rotate: 0, y: [0, -6, 0], scaleY: 1 }, eyes: 'open', look: { x: 0, y: -0.6 }, eyeScale: 1.3, brows: 'raised', arms: { left: 48, right: -48 } },
  wink: { body: { rotate: 4, y: 0, scaleY: 1 }, eyes: 'wink', look: { x: 0, y: 0 }, eyeScale: 1, brows: 'none', arms: { left: 0, right: -100 } },
  love: { body: { rotate: [0, -3, 3, 0], y: 0, scaleY: 1 }, eyes: 'heart', look: { x: 0, y: 0 }, eyeScale: 1, brows: 'none', arms: { left: -26, right: 26 } },
  sleepy: { body: { rotate: -4, y: 1.5, scaleY: 0.98 }, eyes: 'sleepy', look: { x: 0, y: 0 }, eyeScale: 1, brows: 'none', arms: { left: -6, right: 6 } },
  cool: { body: { rotate: 3, y: 0, scaleY: 1 }, eyes: 'shades', look: { x: 0, y: 0 }, eyeScale: 1, brows: 'none', arms: { left: -18, right: -72 } },
};

/** Legs swing about the hips while seated: a slow, alternating kick. */
const LEG_SWING = [-14, 12, -14];
const LEG_SWING_S = 1.8;

const BODY_TRANSITION: Transition = { type: 'spring', stiffness: 380, damping: 22 };
const KEYFRAME_TRANSITION: Transition = { duration: 0.7, ease: 'easeOut' };
const FACE_TRANSITION: Transition = { type: 'spring', stiffness: 500, damping: 30 };
const VOICE_SPRING = { stiffness: 520, damping: 26, mass: 0.35 };
const BOUNCE_Y: [number, number] = [0, -3.5];
/** While speaking, the arms gesture with the voice: the right hand lifts, the left one opens a little. */
const GESTURE_RIGHT: [number, number] = [0, -34];
const GESTURE_LEFT: [number, number] = [0, 14];
const ARM_TRANSITION: Transition = { type: 'spring', stiffness: 300, damping: 20 };
const WAVE_DURATION_S = 1.4;
const BLINK_MS = 130;
const SNOOZE_S = 2.4;
const BLINK_GAP_MS: [number, number] = [2800, 6200];
/** Synthetic talking: a new voice pulse every 90–170 ms, with an occasional quiet beat. */
const SYNTH_STEP_MS: [number, number] = [90, 170];
const SYNTH_MIN = 0.25;
const SYNTH_PAUSE_CHANCE = 0.18;

function toLength(size: number | string): string {
  return typeof size === 'number' ? `${size}px` : size;
}

/**
 * The Agora Virtual Estates mascot: a lowercase "a" with a face in its counter, arms and legs.
 * Used as the brand mark, the advisor's face in `mascot` presence mode, and in empty,
 * error, ringing, handoff and summary moments.
 */
export function Mascot({ state = 'idle', level, size = 120, alive = false, shadow = true, seated = false, title, className }: MascotProps) {
  const reduce = useReducedMotion() ?? false;
  const pose = POSES[state];
  const titleId = useId();

  // Audio level drives a small bounce and the arm gestures through springs, without re-rendering.
  const voice = useSpring(0, VOICE_SPRING);
  const synthetic = useSyntheticLevel(state === 'speaking' && level === undefined && !reduce);
  const effective = level ?? synthetic;
  useEffect(() => {
    voice.set(state === 'speaking' ? Math.max(0, Math.min(1, effective)) : 0);
  }, [voice, state, effective]);
  const bounceY = useTransform(voice, [0, 1], reduce ? [0, 0] : BOUNCE_Y);
  const gestureRight = useTransform(voice, [0, 1], reduce ? [0, 0] : GESTURE_RIGHT);
  const gestureLeft = useTransform(voice, [0, 1], reduce ? [0, 0] : GESTURE_LEFT);

  const blink = useBlink(alive && !reduce && pose.eyes === 'open');

  const keyframed = Array.isArray(pose.body.y) || Array.isArray(pose.body.rotate);
  const bodyTarget = reduce ? { rotate: 0, y: 0, scaleY: 1 } : pose.body;
  const bodyTransition = reduce ? { duration: 0 } : keyframed ? KEYFRAME_TRANSITION : BODY_TRANSITION;
  const faceTransition = reduce ? { duration: 0 } : FACE_TRANSITION;
  const length = toLength(size);
  const pivot = seated ? ANCHORS.seat : ANCHORS.base;

  return (
    <svg
      viewBox={MASCOT_VIEWBOX}
      width={length}
      height={length}
      role={title ? 'img' : undefined}
      aria-labelledby={title ? titleId : undefined}
      aria-hidden={title ? undefined : true}
      className={cn('block shrink-0 overflow-visible', className)}
      data-mascot-state={state}
    >
      {title ? <title id={titleId}>{title}</title> : null}
      <motion.g
        initial={false}
        animate={bodyTarget}
        transition={bodyTransition}
        style={{ originX: `${pivot.x}px`, originY: `${pivot.y}px`, transformBox: 'view-box' }}
      >
        <motion.g style={{ y: bounceY }}>
          {shadow && <MascotShadow />}
          {(['left', 'right'] as const).map((side) => {
            const hip = side === 'left' ? ANCHORS.leftHip : ANCHORS.rightHip;
            const swing = seated && !reduce;
            return (
              <motion.g
                key={side}
                initial={false}
                animate={{ rotate: swing ? (side === 'left' ? LEG_SWING : LEG_SWING.map((d) => -d)) : 0 }}
                transition={swing ? { duration: LEG_SWING_S, ease: 'easeInOut', repeat: Infinity } : { duration: 0.2 }}
                style={{ originX: `${hip.x}px`, originY: `${hip.y}px`, transformBox: 'view-box' }}
              >
                <Leg side={side} />
              </motion.g>
            );
          })}
          {(['left', 'right'] as const).map((side) => {
            const target = pose.arms[side];
            const keyframes = Array.isArray(target);
            const shoulder = side === 'left' ? ANCHORS.leftShoulder : ANCHORS.rightShoulder;
            const origin = { originX: `${shoulder.x}px`, originY: `${shoulder.y}px`, transformBox: 'view-box' as const };
            const settled = keyframes ? target[target.length - 1]! : target;
            return (
              <motion.g
                key={side}
                initial={false}
                animate={{ rotate: reduce ? settled : target }}
                transition={reduce ? { duration: 0 } : keyframes ? { duration: state === 'wave' ? WAVE_DURATION_S : KEYFRAME_TRANSITION.duration, ease: 'easeInOut' } : ARM_TRANSITION}
                style={origin}
              >
                <motion.g style={{ ...origin, rotate: side === 'left' ? gestureLeft : gestureRight }}>
                  <Arm side={side} />
                </motion.g>
              </motion.g>
            );
          })}

          <MascotBody />

          <motion.g
            initial={false}
            animate={{ x: pose.look.x, y: pose.look.y, scale: pose.eyeScale, scaleY: blink ? 0.12 : 1 }}
            transition={blink ? { duration: BLINK_MS / 2000 } : faceTransition}
            style={{ originX: `${ANCHORS.face.x}px`, originY: '64px', transformBox: 'view-box' }}
          >
            <Eyes kind={pose.eyes} />
          </motion.g>

          <Brows shape={pose.brows} />
          {pose.eyes === 'sleepy' && (
            <motion.g
              initial={false}
              animate={reduce ? { opacity: 1 } : { opacity: [0.35, 1, 0.35], y: [2, -2, 2] }}
              transition={reduce ? { duration: 0 } : { duration: SNOOZE_S, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Snooze />
            </motion.g>
          )}
        </motion.g>
      </motion.g>
    </svg>
  );
}

function Eyes({ kind }: { kind: Pose['eyes'] }) {
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

/**
 * A plausible talking rhythm for when no audio level is available: syllable-length pulses
 * with short pauses. Runs only while the advisor is speaking.
 */
function useSyntheticLevel(enabled: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setLevel(0);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const pause = Math.random() < SYNTH_PAUSE_CHANCE;
      setLevel(pause ? 0 : SYNTH_MIN + Math.random() * (1 - SYNTH_MIN));
      timer = setTimeout(step, SYNTH_STEP_MS[0] + Math.random() * (SYNTH_STEP_MS[1] - SYNTH_STEP_MS[0]));
    };
    step();
    return () => clearTimeout(timer);
  }, [enabled]);
  return level;
}

/** Returns true for a moment every few seconds while enabled. */
function useBlink(enabled: boolean): boolean {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setClosed(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const [min, max] = BLINK_GAP_MS;
      timer = setTimeout(() => {
        setClosed(true);
        timer = setTimeout(() => {
          setClosed(false);
          schedule();
        }, BLINK_MS);
      }, min + Math.random() * (max - min));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [enabled]);
  return closed;
}
