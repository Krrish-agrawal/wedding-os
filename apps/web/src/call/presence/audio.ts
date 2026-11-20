import { MASCOT_LEVEL } from './config';

/**
 * One AudioContext for presence, used only to analyse the advisor's voice (HeadAudio worklet for
 * the 3D avatar, an AnalyserNode for the mascot). Nothing here connects to `destination`:
 * Agora's own playback is the only audible path, so there is no double audio and no echo.
 */
let sharedContext: AudioContext | null = null;
const GESTURE_EVENTS = ['pointerdown', 'keydown'] as const;

function hasUserActivation(): boolean {
  return navigator.userActivation?.hasBeenActive ?? false;
}

/**
 * Resumes the presence AudioContext. Call from a user gesture (the Accept click); it is also
 * called automatically on the first pointer or key press after the context exists. Resuming a
 * running context is a no-op, and a suspend() still in flight is undone because calls queue.
 */
export function unlockPresenceAudio(): void {
  if (!sharedContext || sharedContext.state === 'closed') return;
  void sharedContext.resume().catch(() => undefined);
}

/** Resumes only when the page already has a user gesture, so the browser has nothing to warn about. */
export function keepPresenceAudioRunning(): void {
  if (hasUserActivation()) unlockPresenceAudio();
}

function listenForGesture(ctx: AudioContext): void {
  const onGesture = () => {
    unlockPresenceAudio();
    for (const type of GESTURE_EVENTS) window.removeEventListener(type, onGesture, true);
  };
  if (ctx.state === 'running') return;
  for (const type of GESTURE_EVENTS) window.addEventListener(type, onGesture, true);
}

export function getPresenceAudioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new AudioContext({ latencyHint: 'interactive' });
    if (hasUserActivation()) unlockPresenceAudio();
    else listenForGesture(sharedContext);
  }
  return sharedContext;
}

/** Registers the HeadAudio worklet once per context. */
const workletModules = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();
export function addWorkletModuleOnce(ctx: BaseAudioContext, url: string): Promise<void> {
  const byUrl = workletModules.get(ctx) ?? new Map<string, Promise<void>>();
  workletModules.set(ctx, byUrl);
  let pending = byUrl.get(url);
  if (!pending) {
    pending = ctx.audioWorklet.addModule(url);
    // Allow a retry after a failure instead of caching the rejection forever.
    pending.catch(() => byUrl.delete(url));
    byUrl.set(url, pending);
  }
  return pending;
}

/**
 * A remote MediaStreamTrack as a Web Audio source.
 *
 * Chrome only delivers samples from a remote WebRTC stream to Web Audio while the stream is also
 * attached to a media element, so a muted, detached <audio> holds it. It makes no sound.
 */
export class TrackTap {
  readonly source: MediaStreamAudioSourceNode;
  private readonly keepAlive: HTMLAudioElement;

  constructor(ctx: AudioContext, track: MediaStreamTrack) {
    const stream = new MediaStream([track]);
    this.keepAlive = new Audio();
    this.keepAlive.muted = true;
    this.keepAlive.srcObject = stream;
    void this.keepAlive.play().catch(() => undefined);
    this.source = ctx.createMediaStreamSource(stream);
  }

  dispose(): void {
    this.source.disconnect();
    this.keepAlive.pause();
    this.keepAlive.srcObject = null;
  }
}

/**
 * One step of the mascot's level smoothing: fast attack, slower release, noise floor, 0–1.
 * Pure, so it can be tested without audio.
 */
export function smoothLevel(previous: number, rms: number, dtMs: number, opts = MASCOT_LEVEL): number {
  const raw = Math.min(1, rms * opts.gain);
  const target = raw < opts.noiseFloor ? 0 : raw;
  const tau = target > previous ? opts.attackMs : opts.releaseMs;
  const alpha = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  const next = previous + (target - previous) * alpha;
  return next < opts.noiseFloor / 2 ? 0 : Math.min(1, next);
}

export interface VoiceActivity {
  active: boolean;
  aboveMs: number;
  belowMs: number;
}

export const SILENT: VoiceActivity = { active: false, aboveMs: 0, belowMs: 0 };

/**
 * Is the advisor audibly speaking? Needs a short run of sound to start (no flicker on clicks) and
 * a longer run of silence to stop (no mouth snapping shut between words). Pure.
 */
export function stepVoiceActivity(prev: VoiceActivity, level: number, dtMs: number, opts = MASCOT_LEVEL): VoiceActivity {
  const loud = level >= opts.noiseFloor;
  const aboveMs = loud ? prev.aboveMs + dtMs : 0;
  const belowMs = loud ? 0 : prev.belowMs + dtMs;
  const active = prev.active ? belowMs < opts.speechHangMs : aboveMs >= opts.speechOnsetMs;
  return { active, aboveMs, belowMs };
}

export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

/** Smoothed 0–1 loudness of a source node, read once per animation frame. */
export class LevelMeter {
  private readonly analyser: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;
  private level = 0;

  constructor(ctx: AudioContext, source: AudioNode) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = MASCOT_LEVEL.fftSize;
    this.samples = new Float32Array(this.analyser.fftSize);
    source.connect(this.analyser);
  }

  read(dtMs: number): number {
    this.analyser.getFloatTimeDomainData(this.samples);
    this.level = smoothLevel(this.level, rms(this.samples), dtMs);
    return this.level;
  }

  dispose(): void {
    this.analyser.disconnect();
  }
}
