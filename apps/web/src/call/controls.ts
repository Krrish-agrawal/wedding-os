import { create } from 'zustand';
import type { AgentStatus } from '@ave/shared';

/**
 * Contract between the call UI (Design workstream) and the live call (Voice workstream).
 * The UI reads this store and calls these functions; the Voice workstream replaces the
 * implementations with real Agora RTC/RTM behaviour by calling `useCallControls.setState`.
 */
export type MicState = 'off' | 'requesting' | 'on' | 'muted' | 'denied';
export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'unavailable';

export interface CallControls {
  voice: VoiceStatus;
  /** Human-readable reason when voice is failed or unavailable (e.g. "Voice is not configured"). */
  voiceDetail: string | null;
  mic: MicState;
  camera: 'off' | 'on' | 'denied';
  /** Local camera preview track for the buyer self-view tile, if any. */
  cameraTrack: MediaStreamTrack | null;
  /** Advisor's voice, for the avatar lip-sync. */
  agentAudioTrack: MediaStreamTrack | null;
  /** Human advisor audio/video when one has joined. */
  humanAudioTrack: MediaStreamTrack | null;
  humanVideoTrack: MediaStreamTrack | null;
  /**
   * The AI advisor's display name as configured on the server (ADVISOR_NAME). Optional: the UI
   * falls back to the default name until the Voice workstream sets it. See call/advisor.ts.
   */
  advisorName?: string | null;
  /**
   * Local mirror of the engine's agent state (toolkit AGENT_STATE_CHANGED), set by the Voice
   * workstream. Optional: presence prefers it over `state.agent.state` because it skips the
   * server round trip, and falls back to session state when it is absent.
   */
  agentState?: AgentStatus['state'] | null;
  /**
   * `Date.now()` of the latest toolkit AGENT_INTERRUPTED event, set by the Voice workstream.
   * Presence stops any gesture the moment this changes. Optional.
   */
  agentInterruptedAt?: number | null;
  /** Why the microphone is unavailable when `mic` is 'denied' (blocked, missing, in use). Set by Voice. */
  micDetail?: string | null;
  /**
   * True while the browser blocks the advisor's audio until the buyer clicks or presses a key
   * (a reloaded call has no user gesture yet). Voice resumes playback on the next gesture.
   */
  audioBlocked?: boolean;

  /** Called when the buyer accepts the ringing call. Starts RTC and the voice agent. */
  startCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  /** Typed input for when the mic is unavailable; reaches the same advisor. */
  sendText: (text: string) => Promise<void>;
  requestHuman: () => Promise<void>;
}

/**
 * The Voice workstream's implementation (call/voice/client.ts), loaded on first use so the Agora
 * SDKs are downloaded only when a call starts, never on the landing page or the Desk.
 */
const voice = () => import('./voice/client');

export const useCallControls = create<CallControls>(() => ({
  voice: 'idle',
  voiceDetail: null,
  mic: 'off',
  camera: 'off',
  cameraTrack: null,
  agentAudioTrack: null,
  humanAudioTrack: null,
  humanVideoTrack: null,
  startCall: async () => (await voice()).startCall(),
  endCall: async () => (await voice()).endCall(),
  toggleMute: () => void voice().then((v) => v.toggleMute()),
  toggleCamera: () => void voice().then((v) => v.toggleCamera()),
  sendText: async (text) => (await voice()).sendText(text),
  requestHuman: async () => (await voice()).requestHuman(),
}));
