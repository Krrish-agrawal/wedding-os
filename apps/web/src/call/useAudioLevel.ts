import { useEffect, useState } from 'react';

const FFT_SIZE = 512;
/** RMS is small for speech; scale it so normal speech reaches roughly 0.6–1. */
const LEVEL_GAIN = 4.5;
const MIN_CHANGE = 0.03;
const FRAME_INTERVAL_MS = 33;

/**
 * 0–1 loudness of an audio track, sampled about 30 times a second. Used to open the mascot's
 * mouth while the advisor speaks. Returns 0 when there is no track.
 *
 * Chrome only feeds remote WebRTC audio into Web Audio when the stream is also attached to a
 * media element, so a muted element is attached here; Agora's own playback stays the audible one.
 */
export function useAudioLevel(track: MediaStreamTrack | null): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!track) {
      setLevel(0);
      return;
    }
    const stream = new MediaStream([track]);
    const sink = new Audio();
    sink.muted = true;
    sink.srcObject = stream;
    void sink.play().catch(() => undefined);

    const ctx = new AudioContext();
    void ctx.resume().catch(() => undefined);
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    let raf = 0;
    let last = 0;
    let lastSent = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < FRAME_INTERVAL_MS) return;
      last = t;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const next = Math.min(1, Math.sqrt(sum / samples.length) * LEVEL_GAIN);
      if (Math.abs(next - lastSent) >= MIN_CHANGE) {
        lastSent = next;
        setLevel(next);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close().catch(() => undefined);
      sink.srcObject = null;
      setLevel(0);
    };
  }, [track]);

  return level;
}
