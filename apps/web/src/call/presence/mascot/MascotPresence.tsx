import { useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Expression } from '@ave/shared';
import { Mascot, type MascotState } from '@/ui';
import { MASCOT_LEVEL } from '../config';
import { LevelMeter, SILENT, TrackTap, getPresenceAudioContext, stepVoiceActivity, type VoiceActivity } from '../audio';
import { MASCOT_EXPRESSIONS, mascotDisplayState } from '../expressions';
import type { AgentPresence, PresenceState } from '../types';

interface MascotSnapshot {
  base: PresenceState;
  moment: MascotState | null;
  audioActive: boolean;
  level: number;
}

/** Tiny external store so the mascot re-renders only when what it shows changes. */
class MascotStore {
  private snapshot: MascotSnapshot = { base: 'idle', moment: null, audioActive: false, level: 0 };
  private readonly listeners = new Set<() => void>();

  readonly get = (): MascotSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(patch: Partial<MascotSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    const s = this.snapshot;
    if (next.base === s.base && next.moment === s.moment && next.audioActive === s.audioActive && next.level === s.level) return;
    this.snapshot = next;
    for (const l of this.listeners) l();
  }
}

function MascotFace({ store, title }: { store: MascotStore; title: string | undefined }) {
  const snap = useSyncExternalStore(store.subscribe, store.get);
  return (
    // Same framing as the call tile's own mascot (call/PresenceSlot.tsx).
    <div className="grid h-full w-full place-items-center">
      <div className="aspect-square h-[80%] max-w-[64%]">
        <Mascot state={mascotDisplayState(snap.base, snap.moment, snap.audioActive)} level={snap.level} size="100%" alive title={title} />
      </div>
    </div>
  );
}

export interface MascotPresenceOptions {
  /** Accessible name, e.g. "Asha, your advisor". */
  title?: string;
}

/**
 * The brand mascot as the advisor's face, behind the same interface as the 3D avatar. Its bounce and
 * arm gestures follow the smoothed RMS level of the advisor's audio (AnalyserNode on the shared context);
 * its pose follows the agent state, with short-lived poses for moments.
 */
export class MascotPresence implements AgentPresence {
  readonly mode = 'mascot' as const;
  private readonly store = new MascotStore();
  private root: Root | null = null;
  private layer: HTMLDivElement | null = null;
  private track: MediaStreamTrack | null = null;
  private tap: TrackTap | null = null;
  private meter: LevelMeter | null = null;
  private raf = 0;
  private lastFrame = 0;
  private activity: VoiceActivity = SILENT;
  private momentTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly options: MascotPresenceOptions = {}) {}

  mount(el: HTMLElement): Promise<void> {
    if (this.disposed) return Promise.resolve();
    // Own layer per instance: a root is unmounted a tick after dispose, and its replacement
    // must not share the container meanwhile.
    const layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;inset:0;';
    el.appendChild(layer);
    this.layer = layer;
    this.root = createRoot(layer);
    this.root.render(<MascotFace store={this.store} title={this.options.title} />);
    return Promise.resolve();
  }

  attachAudio(track: MediaStreamTrack | null): void {
    if (track === this.track || this.disposed) return;
    this.track = track;
    this.stopMeter();
    if (!track) return;
    const ctx = getPresenceAudioContext();
    this.tap = new TrackTap(ctx, track);
    this.meter = new LevelMeter(ctx, this.tap.source);
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  setState(state: PresenceState): void {
    this.store.set({ base: state });
  }

  express(expression: Expression): void {
    const moment = MASCOT_EXPRESSIONS[expression];
    if (!moment || this.disposed) return;
    clearTimeout(this.momentTimer);
    this.store.set({ moment: moment.state });
    this.momentTimer = setTimeout(() => this.store.set({ moment: null }), moment.holdMs);
  }

  interrupt(): void {
    clearTimeout(this.momentTimer);
    this.store.set({ moment: null });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.momentTimer);
    this.stopMeter();
    const root = this.root;
    const layer = this.layer;
    this.root = null;
    this.layer = null;
    if (layer) layer.style.display = 'none';
    // Unmounting a root while React is committing another one is not allowed; defer a tick.
    setTimeout(() => {
      root?.unmount();
      layer?.remove();
    }, 0);
  }

  private readonly tick = (now: number) => {
    if (!this.meter) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = now - this.lastFrame;
    if (dt < MASCOT_LEVEL.frameIntervalMs) return;
    this.lastFrame = now;
    const level = this.meter.read(dt);
    this.activity = stepVoiceActivity(this.activity, level, dt);
    const shown = this.store.get().level;
    const settled = level === 0 && shown !== 0;
    this.store.set({
      audioActive: this.activity.active,
      level: settled || Math.abs(level - shown) >= MASCOT_LEVEL.minChange ? level : shown,
    });
  };

  private stopMeter(): void {
    cancelAnimationFrame(this.raf);
    this.meter?.dispose();
    this.tap?.dispose();
    this.meter = null;
    this.tap = null;
    this.activity = SILENT;
    this.store.set({ audioActive: false, level: 0 });
  }
}
