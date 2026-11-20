/**
 * A soft two-tone ring made with Web Audio, so there is no sound file to ship. Browsers block audio until the
 * page has had a user gesture, so it only plays once `navigator.userActivation.hasBeenActive` is true.
 */

/** Two gentle sine tones, high then low, like a desk phone. */
const RING_TONES_HZ = [880, 660] as const;
const TONE_SECONDS = 0.32;
const TONE_GAP_SECONDS = 0.08;
const ATTACK_SECONDS = 0.02;
/** Quiet on purpose: it should be noticed, not startle anyone mid-call. */
const PEAK_GAIN = 0.08;
/** Time between rings while a call waits. */
export const RING_INTERVAL_MS = 3000;

const MUTE_KEY = 'ave.desk.ringMuted';

/** True once the page has had a click or key press, so the browser lets it play sound. */
export function pageCanPlaySound(): boolean {
  return typeof navigator !== 'undefined' && navigator.userActivation ? navigator.userActivation.hasBeenActive : false;
}

export function loadRingMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveRingMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Private windows may block storage; the choice still holds for this visit.
  }
}

export class Ringer {
  private ctx: AudioContext | null = null;

  /** Plays one ring (two tones). Does nothing before the page has had a gesture. */
  ring(): void {
    if (!pageCanPlaySound()) return;
    try {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      void ctx.resume().catch(() => undefined);
      let start = ctx.currentTime + 0.02;
      for (const hz of RING_TONES_HZ) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(PEAK_GAIN, start + ATTACK_SECONDS);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + TONE_SECONDS);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + TONE_SECONDS);
        start += TONE_SECONDS + TONE_GAP_SECONDS;
      }
    } catch {
      // No Web Audio: the visual alert still shows.
    }
  }

  close(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
