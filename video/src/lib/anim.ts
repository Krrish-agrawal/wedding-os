import { Easing, interpolate, spring, type SpringConfig } from 'remotion';
import { VIDEO } from '../timeline';

/** The brand's "snap" ease from the app tokens (--ease-snap). */
export const SNAP = Easing.bezier(0.2, 0.9, 0.25, 1);
export const SMOOTH = Easing.bezier(0.45, 0, 0.25, 1);

export const sec = (s: number): number => Math.round(s * VIDEO.fps);

/** Clamped interpolation over a frame range, eased with the brand snap by default. */
export function tween(
  frame: number,
  [from, to]: readonly [number, number],
  [a, b]: readonly [number, number],
  easing: (t: number) => number = SNAP,
): number {
  if (to <= from) return frame >= to ? b : a;
  return interpolate(frame, [from, to], [a, b], {
    easing,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/** 0 → 1 progress over a range. */
export function progress(frame: number, from: number, to: number, easing = SNAP): number {
  return tween(frame, [from, to], [0, 1], easing);
}

const POP: Partial<SpringConfig> = { damping: 13, stiffness: 190, mass: 0.9 };
const SOFT: Partial<SpringConfig> = { damping: 20, stiffness: 120, mass: 1 };

/** A springy 0 → 1 (with a little overshoot) starting at `at`. */
export function pop(frame: number, at: number, config: Partial<SpringConfig> = POP): number {
  return spring({ frame: frame - at, fps: VIDEO.fps, config });
}

/** A calm 0 → 1 spring with no visible overshoot. */
export function settle(frame: number, at: number): number {
  return spring({ frame: frame - at, fps: VIDEO.fps, config: SOFT });
}

/** Splits text into user-perceived characters, so Hindi and Kannada conjuncts type as one key. */
export function graphemes(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/** Characters per second for typed titles. */
export const TYPE_RATE = 24;

/** How many graphemes of a typed string show at `frame`, starting at `at`. */
export function typedCount(frame: number, at: number, rate = TYPE_RATE): number {
  return Math.max(0, Math.floor(((frame - at) / VIDEO.fps) * rate));
}

/** Frames a string takes to type out. */
export function typeFrames(text: string, rate = TYPE_RATE): number {
  return Math.ceil((graphemes(text).length / rate) * VIDEO.fps);
}

/** A caret that blinks once a second while idle. */
export function caretOn(frame: number, typing: boolean): boolean {
  if (typing) return true;
  return Math.floor(frame / (VIDEO.fps / 2)) % 2 === 0;
}

/** Smooth deterministic wobble in [-1, 1], for idle drift. */
export function wobble(frame: number, periodS: number, phase = 0): number {
  return Math.sin(((frame / VIDEO.fps) * Math.PI * 2) / periodS + phase);
}
