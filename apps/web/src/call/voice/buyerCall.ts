import type {
  ConnectionDisconnectedReason,
  ConnectionState,
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
} from 'agora-rtc-sdk-ng';
import AgoraRTM, { type RTMClient } from 'agora-rtm';
import { AgoraVoiceAI, AgoraVoiceAIEvents, TranscriptHelperMode, type RTCEngine, type RTMEngine } from 'agora-agent-client-toolkit';
import type { AgentStatus, SessionAction, SessionState, VoiceTokenGrant } from '@ave/shared';
import { useSessionStore } from '@/session/useSession';
import { useCallControls, type CallControls } from '../controls';
import { voiceApi } from './api';
import { createLatencyLog } from './latency';
import { cameraBlocked, configureAgora, createCamera, createMicrophone, microphoneProblem } from './media';
import { TranscriptRelay } from './transcriptRelay';

/** A newly started agent must appear in the channel within this time, or it is replaced. */
const AGENT_JOIN_TIMEOUT_MS = 15_000;
/** After the agent drops out unexpectedly, wait this long for it to come back before replacing it. */
const AGENT_GONE_GRACE_MS = 5_000;
/** Replacements per call, so a broken configuration never loops. */
const MAX_AGENT_RESTARTS = 3;
/** Manual rejoin attempts after the SDK gives up reconnecting. */
const REJOIN_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];
/** Engine state reaches the server (for the Desk) only once it has settled this long. */
const STATE_REPORT_DEBOUNCE_MS = 150;

const MESSAGES = {
  lostConnection: 'The call connection dropped. Check your network, then try again.',
  agentUnreachable: 'The advisor keeps dropping off the call. You can keep typing, or ask for a senior advisor.',
} as const;

const set = (patch: Partial<CallControls>) => useCallControls.setState(patch);

const devWarn = (message: string, detail?: unknown) => {
  if (import.meta.env.DEV) console.warn(`[voice] ${message}`, detail ?? '');
};

/**
 * One buyer's live call: Agora RTC (mic, the advisor's voice, the human advisor), RTM and the
 * conversational toolkit (captions, agent state, metrics), and the server's voice routes (agent
 * start, restart, typed input). Writes UI state to `useCallControls` and transcript lines to the
 * session; the server owns `agent.status`.
 */
export class BuyerCall {
  private grant: VoiceTokenGrant | null = null;
  private rtc: IAgoraRTCClient | null = null;
  private rtm: RTMClient | null = null;
  private ai: AgoraVoiceAI | null = null;
  private mic: IMicrophoneAudioTrack | null = null;
  private cam: ICameraVideoTrack | null = null;
  private camPublished = false;
  private readonly relay: TranscriptRelay;
  private readonly latency = createLatencyLog();
  private ended = false;
  private rejoining = false;
  private agentTimer: ReturnType<typeof setTimeout> | null = null;
  private agentRestarts = 0;
  private lastAgentId: string | null = null;
  private reportedState: AgentStatus['state'] | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeSession: (() => void) | null = null;
  private resumeAudio: (() => void) | null = null;

  constructor(readonly sessionId: string) {
    this.relay = new TranscriptRelay({ send: (line) => this.dispatch({ type: 'add_transcript', line }) });
  }

  get isEnded(): boolean {
    return this.ended;
  }

  /* ------------------------------ start ------------------------------ */

  /** Connects the call. Resolves with `voice` set to connected, unavailable or failed; never leaves it connecting. */
  async start(): Promise<void> {
    set({ voice: 'connecting', voiceDetail: null });
    try {
      const grant = await voiceApi.token(this.sessionId, 'buyer');
      if (!grant.available) {
        set({ voice: 'unavailable', voiceDetail: grant.reason });
        return;
      }
      this.grant = grant;
      set({ advisorName: grant.advisorName });

      const AgoraRTC = configureAgora();
      this.rtc = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      this.bindRtc(this.rtc);
      AgoraRTC.onAutoplayFailed = () => this.waitForGestureToPlay();

      const micReady = this.openMicrophone(); // ask for permission while the rest connects
      await this.connectRtm(grant);
      await this.startToolkit(grant);
      await this.rtc.join(grant.appId, grant.channel, grant.token, grant.uid);
      if (this.ended) return;
      await micReady;
      await this.publishLocal();
      set({ voice: 'connected' });

      this.watchSession();
      await this.startAgent(false);
    } catch (err) {
      if (this.ended) return;
      devWarn('call could not start', err);
      set({ voice: 'failed', voiceDetail: err instanceof Error && err.message ? err.message : MESSAGES.lostConnection });
      // Keep the camera preview: the self-view does not depend on the call connecting.
      await this.teardown({ keepCamera: true });
    }
  }

  private async openMicrophone(): Promise<void> {
    set({ mic: 'requesting', micDetail: null });
    try {
      const mic = await createMicrophone();
      if (this.ended) {
        mic.close();
        return;
      }
      this.mic = mic;
      set({ mic: 'on' });
    } catch (err) {
      set({ mic: 'denied', micDetail: microphoneProblem(err) });
    }
  }

  private async connectRtm(grant: VoiceTokenGrant): Promise<void> {
    try {
      const rtm = new AgoraRTM.RTM(grant.appId, grant.rtmUserId, { logLevel: import.meta.env.DEV ? 'warn' : 'error', logUpload: false });
      await rtm.login({ token: grant.rtmToken });
      // The toolkit only attaches listeners; subscribing is the app's job.
      await rtm.subscribe(grant.channel, { withMessage: true, withPresence: true });
      rtm.addEventListener('tokenPrivilegeWillExpire', () => void this.renewTokens());
      this.rtm = rtm;
    } catch (err) {
      // Voice still works without RTM; captions and the advisor's state will be missing.
      devWarn('RTM unavailable', err);
    }
  }

  private async startToolkit(grant: VoiceTokenGrant): Promise<void> {
    if (!this.rtc) return;
    const ai = await AgoraVoiceAI.init({
      rtcEngine: this.rtc as unknown as RTCEngine,
      ...(this.rtm ? { rtmEngine: this.rtm as unknown as RTMEngine } : {}),
      // TEXT, not WORD: in word mode the toolkit lost the start of replies that follow a tool call (live test 2026-11-20).
      renderMode: TranscriptHelperMode.TEXT,
      enableRenderModeFallback: true,
      enableLog: false,
    });
    ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (items) => {
      // Dev builds keep the raw list for diagnosing captions in the browser console.
      if (import.meta.env.DEV) (window as unknown as { __aveTranscript?: unknown }).__aveTranscript = items;
      this.relay.update(items);
    });
    ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (_agent, event) => this.onAgentState(event.state));
    ai.on(AgoraVoiceAIEvents.AGENT_INTERRUPTED, () => set({ agentInterruptedAt: Date.now() }));
    ai.on(AgoraVoiceAIEvents.AGENT_METRICS, (_agent, metric) => this.latency.metric(metric));
    ai.on(AgoraVoiceAIEvents.AGENT_TURN_FINISHED, (_agent, turn) => this.latency.turn(turn));
    ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (_agent, error) => devWarn(`agent ${error.type} error ${error.code}: ${error.message}`));
    ai.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (_agent, error) => devWarn(`message error ${error.code}: ${error.message}`));
    ai.subscribeMessage(grant.channel);
    this.ai = ai;
  }

  private async publishLocal(): Promise<void> {
    if (!this.rtc) return;
    if (this.mic) await this.rtc.publish(this.mic);
    this.camPublished = false;
    await this.syncCamera();
  }

  /** Starts (or replaces) the advisor through the server, which owns `agent.status`. */
  private async startAgent(restart: boolean): Promise<void> {
    try {
      const res = await voiceApi.start(this.sessionId, restart);
      if (this.ended) return;
      if (!res.available) {
        // Agora works (a human advisor can still join) but the AI advisor cannot run.
        set({ voice: 'unavailable', voiceDetail: res.reason });
        return;
      }
      if (res.agentId) this.expectAgent(res.agentId);
    } catch (err) {
      if (this.ended) return;
      set({ voice: 'failed', voiceDetail: err instanceof Error ? err.message : MESSAGES.agentUnreachable });
    }
  }

  /* --------------------------- the advisor --------------------------- */

  private agentUid(): number | null {
    return this.grant?.agentUid ?? null;
  }

  private agentInChannel(): boolean {
    const uid = this.agentUid();
    return Boolean(this.rtc?.remoteUsers.some((u) => Number(u.uid) === uid));
  }

  /** The server says this agent is live: it must show up in the channel, or it gets replaced. */
  private expectAgent(agentId: string): void {
    this.noteAgent(agentId);
    this.clearAgentTimer();
    if (this.agentInChannel()) return;
    this.agentTimer = setTimeout(() => void this.replaceAgentIfMissing(), AGENT_JOIN_TIMEOUT_MS);
  }

  private clearAgentTimer(): void {
    if (this.agentTimer) clearTimeout(this.agentTimer);
    this.agentTimer = null;
  }

  /** The advisor should be on the call: the call is live, the agent is live, and no human has taken over. */
  private agentExpected(): boolean {
    const s = this.session();
    return !this.ended && s?.status === 'live' && s.agent.status === 'live' && s.handoff.status !== 'joined';
  }

  private async replaceAgentIfMissing(): Promise<void> {
    this.agentTimer = null;
    if (!this.agentExpected() || this.agentInChannel() || this.rejoining) return;
    if (this.agentRestarts >= MAX_AGENT_RESTARTS) {
      set({ voiceDetail: MESSAGES.agentUnreachable });
      return;
    }
    this.agentRestarts += 1;
    devWarn(`advisor missing from the channel; replacing it (${this.agentRestarts}/${MAX_AGENT_RESTARTS})`);
    await this.startAgent(true);
  }

  /** A different agent means new turn ids: start the captions afresh so lines never collide. */
  private noteAgent(agentId: string): void {
    if (agentId === this.lastAgentId) return;
    if (this.lastAgentId !== null && this.ai && this.grant) {
      this.relay.reset();
      this.ai.unsubscribe();
      this.ai.subscribeMessage(this.grant.channel);
    }
    this.lastAgentId = agentId;
  }

  private onAgentState(state: AgentStatus['state']): void {
    set({ agentState: state });
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      if (state === this.reportedState || this.ended) return;
      this.reportedState = state;
      voiceApi.state(this.sessionId, state).catch(() => {});
    }, STATE_REPORT_DEBOUNCE_MS);
  }

  /* ------------------------------- RTC ------------------------------- */

  private bindRtc(rtc: IAgoraRTCClient): void {
    rtc.on('user-joined', (user: IAgoraRTCRemoteUser) => {
      if (Number(user.uid) === this.agentUid()) this.clearAgentTimer();
    });
    rtc.on('user-published', (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video' | 'datachannel') => void this.onPublished(user, mediaType));
    rtc.on('user-unpublished', (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video' | 'datachannel') => this.onUnpublished(user, mediaType));
    rtc.on('user-left', (user: IAgoraRTCRemoteUser) => this.onUserLeft(user));
    rtc.on('connection-state-change', (cur: ConnectionState, _prev: ConnectionState, reason?: ConnectionDisconnectedReason) =>
      this.onConnectionState(cur, reason),
    );
    rtc.on('token-privilege-will-expire', () => void this.renewTokens());
    rtc.on('token-privilege-did-expire', () => void this.rejoin());
  }

  private async onPublished(user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video' | 'datachannel'): Promise<void> {
    const uid = Number(user.uid);
    const isAgent = uid === this.grant?.agentUid;
    const isHuman = uid === this.grant?.advisorUid;
    if (!this.rtc || (!isAgent && !isHuman) || mediaType === 'datachannel') return;
    try {
      await this.rtc.subscribe(user, mediaType);
    } catch (err) {
      devWarn(`could not subscribe to ${isAgent ? 'the advisor' : 'the human advisor'}`, err);
      return;
    }
    if (mediaType === 'audio' && user.audioTrack) {
      user.audioTrack.play();
      const track = user.audioTrack.getMediaStreamTrack();
      set(isAgent ? { agentAudioTrack: track } : { humanAudioTrack: track });
      if (isAgent) this.clearAgentTimer();
    }
    if (mediaType === 'video' && isHuman && user.videoTrack) set({ humanVideoTrack: user.videoTrack.getMediaStreamTrack() });
  }

  private onUnpublished(user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video' | 'datachannel'): void {
    const uid = Number(user.uid);
    if (uid === this.grant?.agentUid && mediaType === 'audio') set({ agentAudioTrack: null });
    if (uid === this.grant?.advisorUid) set(mediaType === 'audio' ? { humanAudioTrack: null } : { humanVideoTrack: null });
  }

  private onUserLeft(user: IAgoraRTCRemoteUser): void {
    const uid = Number(user.uid);
    if (uid === this.grant?.advisorUid) set({ humanAudioTrack: null, humanVideoTrack: null });
    if (uid !== this.grant?.agentUid) return;
    set({ agentAudioTrack: null, agentState: null });
    // Leaving for a human handoff or the end of the call is expected; anything else is checked after a grace period.
    this.clearAgentTimer();
    this.agentTimer = setTimeout(() => void this.replaceAgentIfMissing(), AGENT_GONE_GRACE_MS);
  }

  private onConnectionState(state: ConnectionState, reason?: ConnectionDisconnectedReason): void {
    if (this.ended) return;
    if (state === 'RECONNECTING') set({ voice: 'reconnecting' });
    if (state === 'CONNECTED' && !this.rejoining) {
      set({ voice: 'connected' });
      // The agent idles out if the buyer was gone too long; check it is still here.
      this.clearAgentTimer();
      this.agentTimer = setTimeout(() => void this.replaceAgentIfMissing(), AGENT_GONE_GRACE_MS);
    }
    if (state === 'DISCONNECTED' && reason !== 'LEAVE') void this.rejoin();
  }

  /** The SDK gave up reconnecting (or the token lapsed): fresh token, join again, republish. */
  private async rejoin(): Promise<void> {
    if (this.rejoining || this.ended || !this.rtc) return;
    this.rejoining = true;
    set({ voice: 'reconnecting' });
    try {
      for (const delay of REJOIN_DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (this.ended) return;
        try {
          const grant = await voiceApi.token(this.sessionId, 'buyer');
          if (!grant.available) break;
          this.grant = grant;
          await this.rtc.leave().catch(() => {});
          await this.rtc.join(grant.appId, grant.channel, grant.token, grant.uid);
          await this.rtm?.renewToken(grant.rtmToken).catch(() => {});
          await this.publishLocal();
          set({ voice: 'connected' });
          this.clearAgentTimer();
          this.agentTimer = setTimeout(() => void this.replaceAgentIfMissing(), AGENT_GONE_GRACE_MS);
          return;
        } catch (err) {
          devWarn('rejoin attempt failed', err);
        }
      }
      if (!this.ended) set({ voice: 'failed', voiceDetail: MESSAGES.lostConnection });
    } finally {
      this.rejoining = false;
    }
  }

  private async renewTokens(): Promise<void> {
    try {
      const grant = await voiceApi.token(this.sessionId, 'buyer');
      if (!grant.available || this.ended) return;
      this.grant = grant;
      await this.rtc?.renewToken(grant.token);
      await this.rtm?.renewToken(grant.rtmToken);
    } catch (err) {
      devWarn('token renewal failed', err);
    }
  }

  /** Browsers block audio that starts without a gesture (a reloaded call): play on the next click or key. */
  private waitForGestureToPlay(): void {
    if (this.resumeAudio) return;
    const resume = () => {
      for (const user of this.rtc?.remoteUsers ?? []) user.audioTrack?.play();
      this.stopWaitingForGesture();
    };
    this.resumeAudio = resume;
    set({ audioBlocked: true });
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
  }

  private stopWaitingForGesture(): void {
    if (!this.resumeAudio) return;
    window.removeEventListener('pointerdown', this.resumeAudio);
    window.removeEventListener('keydown', this.resumeAudio);
    this.resumeAudio = null;
    set({ audioBlocked: false });
  }

  /* ------------------------------ session ---------------------------- */

  private session(): SessionState | null {
    const s = useSessionStore.getState().state;
    return s?.id === this.sessionId ? s : null;
  }

  private dispatch(action: SessionAction): void {
    useSessionStore.getState().dispatch(action);
  }

  /** Follows the session: a new agent (hand-back), standby, the human joining or leaving, the end of the call. */
  private watchSession(): void {
    const onState = (next: SessionState | null) => {
      if (!next || next.id !== this.sessionId || this.ended) return;
      if (next.agent.agentId && next.agent.agentId !== this.lastAgentId && next.agent.status === 'live') this.expectAgent(next.agent.agentId);
      if (next.agent.status !== 'live') {
        this.clearAgentTimer();
        this.relay.flush();
      }
      void this.syncCamera();
      if (next.status === 'ended') void this.end({ notifyServer: false });
    };
    this.unsubscribeSession = useSessionStore.subscribe((s, prev) => {
      if (s.state !== prev.state) onState(s.state);
    });
    onState(this.session());
  }

  /* ------------------------- local controls ------------------------- */

  toggleMute(): void {
    const mic = this.mic;
    if (!mic) return;
    const muted = !mic.muted;
    void mic.setMuted(muted).then(() => set({ mic: muted ? 'muted' : 'on' }));
  }

  /** Camera is a local preview; it is published only while a human advisor is on the call. */
  async toggleCamera(): Promise<void> {
    if (this.cam) {
      const cam = this.cam;
      this.cam = null;
      if (this.camPublished) await this.rtc?.unpublish(cam).catch(() => {});
      this.camPublished = false;
      cam.close();
      set({ camera: 'off', cameraTrack: null });
      return;
    }
    try {
      const cam = await createCamera();
      if (this.ended) {
        cam.close();
        return;
      }
      this.cam = cam;
      set({ camera: 'on', cameraTrack: cam.getMediaStreamTrack() });
      await this.syncCamera();
    } catch (err) {
      set({ camera: cameraBlocked(err) ? 'denied' : 'off', cameraTrack: null });
    }
  }

  private async syncCamera(): Promise<void> {
    const rtc = this.rtc;
    const cam = this.cam;
    if (!rtc || !cam || rtc.connectionState !== 'CONNECTED') return;
    const humanHere = this.session()?.handoff.status === 'joined';
    try {
      if (humanHere && !this.camPublished) {
        this.camPublished = true;
        await rtc.publish(cam);
      } else if (!humanHere && this.camPublished) {
        this.camPublished = false;
        await rtc.unpublish(cam);
      }
    } catch (err) {
      devWarn('camera publish change failed', err);
    }
  }

  noteTyped(text: string): void {
    this.relay.noteTyped(text);
  }

  /* ------------------------------- end ------------------------------- */

  /** Stops everything this call started. The server stops the agent (and reads its history) on stop or end. */
  async end(opts: { notifyServer: boolean }): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.relay.dispose();
    if (opts.notifyServer) await voiceApi.stop(this.sessionId).catch(() => {});
    await this.teardown({ keepCamera: false });
    set({
      voice: 'idle',
      voiceDetail: null,
      mic: 'off',
      micDetail: null,
      camera: 'off',
      cameraTrack: null,
      agentAudioTrack: null,
      humanAudioTrack: null,
      humanVideoTrack: null,
      agentState: null,
      audioBlocked: false,
    });
  }

  private async teardown(opts: { keepCamera: boolean }): Promise<void> {
    this.clearAgentTimer();
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stopWaitingForGesture();
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    if (this.ai) {
      this.ai.unsubscribe();
      this.ai.destroy();
      this.ai = null;
    }
    this.mic?.close();
    this.mic = null;
    if (!opts.keepCamera) {
      this.cam?.close();
      this.cam = null;
    }
    this.camPublished = false;
    const rtc = this.rtc;
    this.rtc = null;
    if (rtc) {
      rtc.removeAllListeners();
      await rtc.leave().catch(() => {});
    }
    const rtm = this.rtm;
    this.rtm = null;
    if (rtm && this.grant) {
      await rtm.unsubscribe(this.grant.channel).catch(() => {});
      await rtm.logout().catch(() => {});
    }
  }
}
