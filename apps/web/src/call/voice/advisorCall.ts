import type { IAgoraRTCClient, IAgoraRTCRemoteUser, ICameraVideoTrack, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';
import { VOICE_UIDS, type SessionState, type VoiceTokenGrant } from '@ave/shared';
import { useSessionStore } from '@/session/useSession';
import { consultApi } from '@/desk/consultApi';
import { voiceApi } from './api';
import { ConsultRecorder } from './consultRecorder';
import { cameraBlocked, configureAgora, createCamera, createMicrophone, microphoneProblem } from './media';
import { SttRelay } from './sttRelay';

export type AdvisorAudioStatus = 'idle' | 'connecting' | 'connected' | 'failed' | 'unavailable';

/** What the human advisor's call screen shows. Tracks are for <audio>/<video> elements; audio already plays. */
export interface AdvisorAudioSnapshot {
  status: AdvisorAudioStatus;
  detail: string | null;
  muted: boolean;
  camera: 'off' | 'on' | 'denied';
  /** The advisor's own camera, for a self-view. */
  localVideoTrack: MediaStreamTrack | null;
  /** The buyer's voice (already playing) and camera, when they share it. */
  buyerAudioTrack: MediaStreamTrack | null;
  buyerVideoTrack: MediaStreamTrack | null;
}

const LOST_CONNECTION = 'Your connection to the call dropped. Leave and join again.';

/** True while the server wants this browser to record both voices for OpenAI transcription. */
function wantsOpenAiChunks(state: SessionState | null): boolean {
  return Boolean(state && state.status !== 'ended' && state.handoff.status === 'joined' && state.consult.transcriptSource === 'openai');
}

/**
 * The human advisor in the buyer's channel: own token and uid (the agent subscribes only to the
 * buyer, so it never hears or answers the advisor), microphone published, optional camera, and the
 * buyer's audio played. Audio from the AI advisor's last handover line plays too.
 *
 * It also carries the consult transcript: Real-Time STT captions from the STT bot are relayed to the session,
 * or, when the server falls back to OpenAI, both voices are recorded in chunks and uploaded.
 */
export class AdvisorCall {
  private grant: VoiceTokenGrant | null = null;
  private rtc: IAgoraRTCClient | null = null;
  private mic: IMicrophoneAudioTrack | null = null;
  private cam: ICameraVideoTrack | null = null;
  private stopped = false;
  /** Consult transcription: Real-Time STT captions relayed from the bot, or OpenAI chunks recorded here. */
  private stt: SttRelay | null = null;
  private recorder: ConsultRecorder | null = null;
  private buyerTrack: MediaStreamTrack | null = null;
  private unsubscribeSession: (() => void) | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly onChange: (patch: Partial<AdvisorAudioSnapshot>) => void,
  ) {}

  async start(): Promise<void> {
    this.onChange({ status: 'connecting', detail: null });
    try {
      const grant = await voiceApi.token(this.sessionId, 'advisor');
      if (this.stopped) return;
      if (!grant.available) {
        this.onChange({ status: 'unavailable', detail: grant.reason });
        return;
      }
      this.grant = grant;
      const rtc = configureAgora().createClient({ mode: 'rtc', codec: 'vp8' });
      this.rtc = rtc;
      rtc.on('user-published', (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video' | 'datachannel') => void this.onPublished(user, mediaType));
      rtc.on('user-unpublished', (user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video' | 'datachannel') => this.onUnpublished(user, mediaType));
      rtc.on('user-left', (user: IAgoraRTCRemoteUser) => {
        if (Number(user.uid) !== grant.buyerUid) return;
        this.buyerTrack = null;
        this.recorder?.setTrack('buyer', null);
        this.onChange({ buyerAudioTrack: null, buyerVideoTrack: null });
      });
      rtc.on('connection-state-change', (state: string, _prev: string, reason?: string) => {
        if (state === 'DISCONNECTED' && reason !== 'LEAVE' && !this.stopped) this.onChange({ status: 'failed', detail: LOST_CONNECTION });
        if (state === 'CONNECTED' && !this.stopped && this.mic) this.onChange({ status: 'connected', detail: null });
      });
      rtc.on('token-privilege-will-expire', () => void this.renewToken());
      // Only this browser (the human on the call) relays the STT bot's captions, so lines are never doubled.
      this.stt = new SttRelay({
        buyerUid: grant.buyerUid,
        advisorUid: grant.advisorUid,
        send: (line) => useSessionStore.getState().dispatch({ type: 'add_transcript', line }),
        onProblem: (reason) => {
          console.warn(`[consult] Real-Time STT captions unreadable: ${reason}`);
          void consultApi.reportSttProblem(this.sessionId, reason);
        },
      });
      const sttBotUid = grant.sttBotUid ?? VOICE_UIDS.stt;
      rtc.on('stream-message', (uid, payload) => {
        if (Number(uid) === sttBotUid) void this.stt?.handle(payload).catch((err: unknown) => console.warn('[consult] caption relay failed', err));
      });

      // Ask for the microphone while joining.
      const micReady = createMicrophone().then(
        (mic) => ({ ok: true as const, mic }),
        (err: unknown) => ({ ok: false as const, err }),
      );
      await rtc.join(grant.appId, grant.channel, grant.token, grant.uid);
      const result = await micReady;
      if (this.stopped) {
        if (result.ok) result.mic.close();
        return;
      }
      if (result.ok) {
        this.mic = result.mic;
        await rtc.publish(result.mic);
        this.onChange({ status: 'connected', detail: null, muted: false });
        this.watchConsult();
      } else {
        // Connected and hearing the buyer, but the buyer cannot hear the advisor.
        this.onChange({ status: 'failed', detail: microphoneProblem(result.err) });
      }
    } catch (err) {
      if (this.stopped) return;
      this.onChange({ status: 'failed', detail: err instanceof Error && err.message ? err.message : LOST_CONNECTION });
      await this.stop();
    }
  }

  private async onPublished(user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video' | 'datachannel'): Promise<void> {
    if (!this.rtc || mediaType === 'datachannel') return;
    const fromBuyer = Number(user.uid) === this.grant?.buyerUid;
    const fromAgent = Number(user.uid) === this.grant?.agentUid;
    if (!fromBuyer && !fromAgent) return;
    if (mediaType === 'video' && !fromBuyer) return;
    await this.rtc.subscribe(user, mediaType);
    if (mediaType === 'audio' && user.audioTrack) {
      user.audioTrack.play();
      if (fromBuyer) {
        this.buyerTrack = user.audioTrack.getMediaStreamTrack();
        this.recorder?.setTrack('buyer', this.buyerTrack);
        this.onChange({ buyerAudioTrack: this.buyerTrack });
      }
    }
    if (mediaType === 'video' && user.videoTrack) this.onChange({ buyerVideoTrack: user.videoTrack.getMediaStreamTrack() });
  }

  private onUnpublished(user: IAgoraRTCRemoteUser, mediaType: 'audio' | 'video' | 'datachannel'): void {
    if (Number(user.uid) !== this.grant?.buyerUid) return;
    if (mediaType === 'audio') {
      this.buyerTrack = null;
      this.recorder?.setTrack('buyer', null);
    }
    this.onChange(mediaType === 'audio' ? { buyerAudioTrack: null } : { buyerVideoTrack: null });
  }

  /** Starts or stops the OpenAI chunk recorder as the server switches transcription source. */
  private watchConsult(): void {
    this.unsubscribeSession?.();
    const sync = (state: SessionState | null) => {
      if (this.stopped) return;
      const want = wantsOpenAiChunks(state) && state?.id === this.sessionId;
      if (want && !this.recorder) {
        this.recorder = new ConsultRecorder({ upload: (speaker, blob) => consultApi.uploadChunk(this.sessionId, speaker, blob) });
        this.recorder.setTrack('human', this.mic?.getMediaStreamTrack() ?? null);
        this.recorder.setTrack('buyer', this.buyerTrack);
      } else if (!want && this.recorder) {
        this.recorder.stop();
        this.recorder = null;
      }
    };
    this.unsubscribeSession = useSessionStore.subscribe((s) => sync(s.state));
    sync(useSessionStore.getState().state);
  }

  private async renewToken(): Promise<void> {
    const grant = await voiceApi.token(this.sessionId, 'advisor').catch(() => null);
    if (grant?.available && this.rtc) await this.rtc.renewToken(grant.token).catch(() => {});
  }

  toggleMute(): void {
    const mic = this.mic;
    if (!mic) return;
    const muted = !mic.muted;
    void mic.setMuted(muted).then(() => this.onChange({ muted }));
  }

  async toggleCamera(): Promise<void> {
    if (this.cam) {
      const cam = this.cam;
      this.cam = null;
      await this.rtc?.unpublish(cam).catch(() => {});
      cam.close();
      this.onChange({ camera: 'off', localVideoTrack: null });
      return;
    }
    try {
      const cam = await createCamera();
      if (this.stopped) {
        cam.close();
        return;
      }
      this.cam = cam;
      this.onChange({ camera: 'on', localVideoTrack: cam.getMediaStreamTrack() });
      if (this.rtc?.connectionState === 'CONNECTED') await this.rtc.publish(cam);
    } catch (err) {
      this.onChange({ camera: cameraBlocked(err) ? 'denied' : 'off', localVideoTrack: null });
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    this.recorder?.stop();
    this.recorder = null;
    this.stt = null;
    this.buyerTrack = null;
    this.mic?.close();
    this.mic = null;
    this.cam?.close();
    this.cam = null;
    const rtc = this.rtc;
    this.rtc = null;
    if (rtc) {
      rtc.removeAllListeners();
      await rtc.leave().catch(() => {});
    }
  }
}
