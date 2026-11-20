import type { Expression } from '@ave/shared';

/** What the advisor is doing in the conversation (BUILD_PLAN.md section 5). */
export const PRESENCE_STATES = ['idle', 'listening', 'thinking', 'speaking', 'standby'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

/** `human3d`: TalkingHead avatar with HeadAudio lip-sync. `mascot`: the brand mascot. */
export const PRESENCE_MODES = ['human3d', 'mascot'] as const;
export type PresenceMode = (typeof PRESENCE_MODES)[number];

/**
 * The advisor's on-screen presence. One interface, swappable by configuration; the mascot is
 * also the automatic fallback when the 3D avatar cannot load.
 */
export interface AgentPresence {
  readonly mode: PresenceMode;
  /** Renders into `el` (which it fills). Rejects if this implementation cannot run here. */
  mount(el: HTMLElement): Promise<void>;
  /** The advisor's voice. Analysed only: Agora's own playback stays the audible path. `null` detaches. */
  attachAudio(track: MediaStreamTrack | null): void;
  setState(state: PresenceState): void;
  /** A short-lived expression for a conversational moment. Never loops. */
  express(expression: Expression): void;
  /** The buyer cut in: stop any gesture at once and return to attentive. */
  interrupt(): void;
  dispose(): void;
}

/** Why the 3D avatar is not shown. Shown in the Studio lab; never to the buyer. */
export type FallbackReason = 'mode' | 'webgl' | 'asset' | 'timeout' | 'load' | 'audio';

export class PresenceUnavailableError extends Error {
  constructor(
    readonly reason: FallbackReason,
    message: string,
  ) {
    super(message);
    this.name = 'PresenceUnavailableError';
  }
}

/** Thrown into a pending mount when the presence was disposed first. Not a failure. */
export class PresenceDisposedError extends Error {
  constructor() {
    super('Presence disposed during mount');
    this.name = 'PresenceDisposedError';
  }
}
