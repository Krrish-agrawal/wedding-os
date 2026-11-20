import { describe, expect, it } from 'vitest';
import { SILENT, rms, smoothLevel, stepVoiceActivity } from './audio';
import { MASCOT_LEVEL } from './config';
import { mascotDisplayState } from './expressions';

const FRAME_MS = MASCOT_LEVEL.frameIntervalMs;

describe('rms', () => {
  it('is zero for silence and the amplitude for a square wave', () => {
    expect(rms(new Float32Array(64))).toBe(0);
    expect(rms(Float32Array.from({ length: 64 }, (_, i) => (i % 2 ? 0.5 : -0.5)))).toBeCloseTo(0.5);
  });
});

describe('smoothLevel', () => {
  it('rises faster than it falls', () => {
    const loud = 1 / MASCOT_LEVEL.gain;
    const rise = smoothLevel(0, loud, FRAME_MS);
    const fall = 1 - smoothLevel(1, 0, FRAME_MS);
    expect(rise).toBeGreaterThan(0.5);
    expect(fall).toBeLessThan(rise);
  });

  it('ignores the noise floor and settles to exactly zero', () => {
    let level = 0.5;
    for (let i = 0; i < 60; i++) level = smoothLevel(level, 0.001, FRAME_MS);
    expect(level).toBe(0);
  });

  it('never exceeds 1', () => {
    expect(smoothLevel(0.9, 10, 1000)).toBeLessThanOrEqual(1);
  });
});

describe('stepVoiceActivity', () => {
  const run = (levels: number[]) => levels.reduce((a, l) => stepVoiceActivity(a, l, FRAME_MS), SILENT);

  it('needs a short run of sound to start, so a click does not open the mouth', () => {
    expect(run([0.6]).active).toBe(false);
    const frames = Math.ceil(MASCOT_LEVEL.speechOnsetMs / FRAME_MS);
    expect(run(Array(frames).fill(0.6)).active).toBe(true);
  });

  it('holds through short pauses between words, then stops', () => {
    const talking = Array(10).fill(0.6);
    const shortPause = Array(Math.floor(MASCOT_LEVEL.speechHangMs / FRAME_MS) - 1).fill(0);
    const longPause = Array(Math.ceil(MASCOT_LEVEL.speechHangMs / FRAME_MS) + 1).fill(0);
    expect(run([...talking, ...shortPause]).active).toBe(true);
    expect(run([...talking, ...longPause]).active).toBe(false);
  });
});

describe('mascotDisplayState', () => {
  it('lets a moment win, then audio, then the agent state', () => {
    expect(mascotDisplayState('listening', 'happy', true)).toBe('happy');
    expect(mascotDisplayState('listening', null, true)).toBe('speaking');
    expect(mascotDisplayState('thinking', null, false)).toBe('thinking');
  });

  it('keeps quiet on standby even if audio is heard', () => {
    expect(mascotDisplayState('standby', null, true)).toBe('idle');
  });
});
