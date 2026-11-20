import { describe, expect, it } from 'vitest';
import { MIN_SPEECH_WINDOWS, SPEECH_RMS_THRESHOLD, pickMimeType, rms, worthSending } from './consultRecorder';

describe('consult recorder helpers', () => {
  it('prefers Opus in WebM and falls back to what the browser records', () => {
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickMimeType(() => false)).toBeUndefined();
  });

  it('measures loudness and only sends chunks with enough speech', () => {
    expect(rms(new Float32Array(256))).toBe(0);
    expect(rms(new Float32Array(256).fill(0.2))).toBeCloseTo(0.2);
    expect(rms(new Float32Array(256).fill(SPEECH_RMS_THRESHOLD / 2))).toBeLessThan(SPEECH_RMS_THRESHOLD);
    expect(worthSending(MIN_SPEECH_WINDOWS - 1, true)).toBe(false);
    expect(worthSending(MIN_SPEECH_WINDOWS, true)).toBe(true);
    expect(worthSending(0, false)).toBe(true);
  });
});
