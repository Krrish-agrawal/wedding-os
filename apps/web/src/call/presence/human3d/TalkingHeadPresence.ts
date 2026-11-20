import type { TalkingHead, TalkingHeadAnimTemplate, TalkingHeadAvatar } from '@met4citizen/talkinghead';
import type { HeadAudio } from '@met4citizen/headaudio/dist/headaudio.min.mjs';
import workletUrl from '@met4citizen/headaudio/dist/headworklet.min.mjs?url';
import lipsyncModelUrl from '@met4citizen/headaudio/dist/model-en-mixed.bin?url';
import type { Expression } from '@ave/shared';
import {
  AVATAR_ENVIRONMENT_INTENSITY,
  AVATAR_FPS,
  AVATAR_GAZE,
  AVATAR_LIGHTING,
  AVATAR_MAX_PIXEL_RATIO,
  AVATAR_MOUNT_TIMEOUT_MS,
  AVATAR_MOVEMENT_FACTOR,
  AVATAR_STANDBY_FPS,
  AVATAR_VIEW,
  FRAMING,
  IDLE_BODY_MOTION_SCALE,
  LIPSYNC,
  SENTENCE_EYE_CONTACT_MS,
  SENTENCE_PAUSE_MS,
  TALKING_HANDS_MIN_GAP_MS,
  TALKING_HANDS_PROBABILITY,
} from '../config';
import { TrackTap, addWorkletModuleOnce, getPresenceAudioContext, keepPresenceAudioRunning } from '../audio';
import { ATTENTIVE_TILT, HUMAN3D_EXPRESSIONS, INTERRUPT_TRANSITION_MS, PRESENCE_ANIM_PREFIX, type FaceCue, type Human3dCue } from '../expressions';
import { PresenceDisposedError, PresenceUnavailableError, type AgentPresence, type PresenceState } from '../types';
import type { Group } from 'three';
import {
  AVATAR_PROFILES,
  AvatarIncompatibleError,
  avatarSources,
  configuredBody,
  detectBody,
  ensureArmatureRoot,
  hasQuantisedSkin,
  incompatibility,
  type AvatarBody,
  type AvatarKind,
  type AvatarSource,
} from './avatars';
import { firstAvailable, hasWebGL2, withTimeout } from './environment';
import { calmIdleMotion, frameHeadAndShoulders } from './staging';

/** A barely-there resting smile: a neutral face reads as stern in a close-up tile. */
const RESTING_SMILE = 0.12;
/** Eye contact while a human advisor has the floor: the AI stays present without staring. */
const STANDBY_EYE_CONTACT = 0.15;
/** How long the eyes drift away when going on standby. */
const STANDBY_LOOK_AWAY_MS = 2500;
/** Talking-hands movement is TalkingHead's own name for it. */
const TALKING_HANDS_ANIM = 'talkinghands';
const LOOK_ANIM = 'lookat';
const MS_PER_S = 1000;
/** TalkingHead's default armature root name. */
const MODEL_ROOT = 'Armature';

export interface TalkingHeadPresenceOptions {
  /** Avatar files to try in order. Default: avatars.ts (Avaturn advisor, then the MPFB stand-in). */
  avatarSources?: readonly AvatarSource[];
  timeoutMs?: number;
}

export interface Human3dDiagnostics {
  avatarUrl: string | null;
  avatarKind: AvatarKind | null;
  body: AvatarBody | null;
  /** Where the body form came from. */
  bodySource: 'env' | 'file' | 'default' | null;
  /** Avatar files that exist but were passed over, and why. */
  skipped: string[];
  loadMs: number | null;
}

function faceTemplate(face: FaceCue, available: Record<string, unknown>): TalkingHeadAnimTemplate {
  const vs: TalkingHeadAnimTemplate['vs'] = {};
  for (const [target, value] of Object.entries(face.targets)) {
    if (target in available) vs[target] = [value, value, 0];
  }
  return { name: face.name, dt: [face.rampInMs, face.holdMs, face.rampOutMs], vs };
}

function tiltTemplate(): TalkingHeadAnimTemplate {
  const r = ATTENTIVE_TILT.radians * (Math.random() < 0.5 ? -1 : 1);
  return {
    name: `${PRESENCE_ANIM_PREFIX}tilt`,
    dt: [ATTENTIVE_TILT.rampInMs, ATTENTIVE_TILT.holdMs, ATTENTIVE_TILT.rampOutMs],
    vs: { headRotateZ: [r, r, 0] },
  };
}

/**
 * The advisor as a TalkingHead 3D avatar, lip-synced by HeadAudio from the advisor's audio track.
 *
 * Audio: the remote track goes MediaStreamSource → HeadAudio worklet and nowhere else. Agora's own
 * playback is what the buyer hears, so there is one audible path and no echo.
 * CPU: frame rate capped (AVATAR_FPS), rendering and lip-sync paused while the tab is hidden.
 */
export class TalkingHeadPresence implements AgentPresence {
  readonly mode = 'human3d' as const;
  readonly diagnostics: Human3dDiagnostics = { avatarUrl: null, avatarKind: null, body: null, bodySource: null, skipped: [], loadMs: null };

  private head: TalkingHead | null = null;
  private stage: HTMLDivElement | null = null;
  private lipsync: HeadAudio | null = null;
  private tap: TrackTap | null = null;
  private track: MediaStreamTrack | null = null;
  private state: PresenceState = 'idle';
  private ready = false;
  private disposed = false;
  /** Pending showAvatar(); disposing mid-load waits for it (see dispose). */
  private avatarLoad: Promise<void> | null = null;
  private lastSpeechEndAt = 0;
  private lastHandsAt = 0;
  private gestureUntil = 0;

  constructor(private readonly options: TalkingHeadPresenceOptions = {}) {}

  mount(el: HTMLElement): Promise<void> {
    return withTimeout(
      this.load(el),
      this.options.timeoutMs ?? AVATAR_MOUNT_TIMEOUT_MS,
      () => new PresenceUnavailableError('timeout', 'The 3D avatar took too long to load'),
    );
  }

  attachAudio(track: MediaStreamTrack | null): void {
    if (track === this.track) return;
    this.track = track;
    if (!this.ready) return;
    this.disconnectAudio();
    if (track) this.connectAudio(track);
  }

  setState(state: PresenceState): void {
    if (state === this.state) return;
    this.state = state;
    this.applyState();
  }

  express(expression: Expression): void {
    if (!this.ready) return;
    this.play(HUMAN3D_EXPRESSIONS[expression], expression);
  }

  interrupt(): void {
    const head = this.head;
    if (!head || !this.ready) return;
    this.finishGestures(INTERRUPT_TRANSITION_MS);
    this.finishAnims((name) => name.startsWith(PRESENCE_ANIM_PREFIX) || name === LOOK_ANIM);
    this.gestureUntil = 0;
    this.play(HUMAN3D_EXPRESSIONS.attentive, 'attentive');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.disconnectAudio();
    const lipsync = this.lipsync;
    this.lipsync = null;
    if (lipsync) {
      lipsync.onvalue = null;
      lipsync.onstarted = null;
      lipsync.onended = null;
      lipsync.stop();
      lipsync.disconnect();
      lipsync.port.close();
    }
    this.stage?.remove();
    this.stage = null;
    const head = this.head;
    this.head = null;
    if (!head) return;
    head.opt.update = null;
    const finish = () => {
      try {
        head.dispose();
      } catch {
        // A head that never finished loading may have nothing to release; nothing to report.
      }
      // TalkingHead.stop() suspends the shared AudioContext; the mascot may still need it.
      keepPresenceAudioRunning();
    };
    // showAvatar() ends by starting the render loop; disposing before it settles would leave
    // that loop running against a released renderer. Wait for it, then release.
    if (this.avatarLoad) this.avatarLoad.then(finish, finish);
    else finish();
  }

  private assertAlive(): void {
    if (this.disposed) throw new PresenceDisposedError();
  }

  private async load(el: HTMLElement): Promise<void> {
    const started = performance.now();
    if (!hasWebGL2()) throw new PresenceUnavailableError('webgl', 'WebGL 2 with hardware acceleration is not available');

    // The first file that exists and suits the advisor wins; files that are missing or unsuitable
    // (e.g. a static-face export without visemes) are skipped, quietly, in favour of the next.
    const sources = [...(this.options.avatarSources ?? avatarSources())];
    let source = await firstAvailable(sources);
    this.assertAlive();
    if (!source) throw new PresenceUnavailableError('asset', 'No avatar file is available');

    let modules: [typeof import('three'), typeof import('@met4citizen/talkinghead'), typeof import('@met4citizen/headaudio/dist/headaudio.min.mjs')];
    try {
      modules = await Promise.all([import('three'), import('@met4citizen/talkinghead'), import('@met4citizen/headaudio/dist/headaudio.min.mjs')]);
    } catch {
      throw new PresenceUnavailableError('load', 'The avatar code could not be loaded');
    }
    this.assertAlive();
    const [three, talkingHead, headAudio] = modules;

    // Each instance renders into its own layer, so one still settling after dispose never
    // shares a box with its replacement.
    const stage = document.createElement('div');
    stage.style.cssText = 'position:absolute;inset:0;line-height:0;';
    el.appendChild(stage);
    this.stage = stage;

    const ctx = getPresenceAudioContext();
    const dpr = window.devicePixelRatio || 1;
    let head: TalkingHead;
    try {
      head = new talkingHead.TalkingHead(stage, {
        ttsEndpoint: null,
        lipsyncModules: [],
        modelRoot: MODEL_ROOT,
        audioCtx: ctx,
        cameraView: AVATAR_VIEW,
        cameraRotateEnable: false,
        cameraPanEnable: false,
        cameraZoomEnable: false,
        modelFPS: AVATAR_FPS,
        modelPixelRatio: Math.min(dpr, AVATAR_MAX_PIXEL_RATIO) / dpr,
        modelMovementFactor: AVATAR_MOVEMENT_FACTOR,
        avatarMood: 'neutral',
        ...AVATAR_GAZE,
        ...AVATAR_LIGHTING,
      });
    } catch {
      throw new PresenceUnavailableError('webgl', 'The 3D renderer could not start');
    }
    this.head = head;
    head.opt.update = null;
    head.scene.environmentIntensity = AVATAR_ENVIRONMENT_INTENSITY;

    let loaded: { source: AvatarSource; body: AvatarBody; bodySource: Human3dDiagnostics['bodySource'] } | null = null;
    while (source && !loaded) {
      try {
        loaded = await this.showAvatar(head, source, three.Group);
      } catch (err) {
        this.assertAlive();
        const reason = err instanceof AvatarIncompatibleError ? err.reason : 'it could not be loaded';
        this.diagnostics.skipped.push(`${source.url}: ${reason}`);
        const next: AvatarSource[] = sources.slice(sources.indexOf(source) + 1);
        source = await firstAvailable(next);
        this.assertAlive();
      }
    }
    if (!loaded) throw new PresenceUnavailableError('load', `No usable avatar file (${this.diagnostics.skipped.join('; ')})`);
    calmIdleMotion(head, IDLE_BODY_MOTION_SCALE);
    this.diagnostics.avatarUrl = loaded.source.url;
    this.diagnostics.avatarKind = loaded.source.kind;
    this.diagnostics.body = loaded.body;
    this.diagnostics.bodySource = loaded.bodySource;

    let lipsync: HeadAudio;
    try {
      await addWorkletModuleOnce(ctx, workletUrl);
      this.assertAlive();
      lipsync = new headAudio.HeadAudio(ctx, {
        visemeMinMs: LIPSYNC.visemeMinMs,
        visemeRampMs: LIPSYNC.visemeRampMs,
        parameterData: { vadGateActiveDb: LIPSYNC.vadGateActiveDb, vadGateInactiveDb: LIPSYNC.vadGateInactiveDb },
      });
      this.lipsync = lipsync;
      await lipsync.loadModel(lipsyncModelUrl);
    } catch (err) {
      if (err instanceof PresenceDisposedError) throw err;
      this.assertAlive();
      throw new PresenceUnavailableError('audio', 'Lip-sync could not start');
    }
    this.assertAlive();

    lipsync.onvalue = (key, value) => {
      const target = head.mtAvatar[key];
      if (!target) return;
      target.newvalue = value;
      target.needsUpdate = true;
    };
    lipsync.onstarted = this.onSpeechStart;
    lipsync.onended = this.onSpeechEnd;
    head.opt.update = (dt) => lipsync.update(dt);

    // Let the first frames move the model from its bind pose into the idle pose, then frame it.
    await new Promise((resolve) => setTimeout(resolve, FRAMING.settleMs));
    this.assertAlive();
    frameHeadAndShoulders(head);

    document.addEventListener('visibilitychange', this.onVisibility);
    // Dev builds expose the tile's head for diagnosing rendering from the browser console.
    if (import.meta.env.DEV) (window as unknown as { __aveTileHead?: unknown }).__aveTileHead = head;
    this.ready = true;
    this.diagnostics.loadMs = Math.round(performance.now() - started);
    if (this.track) this.connectAudio(this.track);
    this.applyState();
    if (document.hidden) this.pause();
  }

  /**
   * Shows one avatar file with its model family's settings. Unsuitable files are rejected before
   * TalkingHead touches its scene, so the next file can be tried on the same instance.
   */
  private async showAvatar(head: TalkingHead, source: AvatarSource, GroupClass: new () => Group) {
    const profile = AVATAR_PROFILES[source.kind];
    const envBody = configuredBody();
    let fileBody: AvatarBody | null = null;
    // lipsyncLang is not set: lip-sync comes from the audio (HeadAudio), not from text.
    const avatar: TalkingHeadAvatar & { body: AvatarBody } = {
      url: source.url,
      body: envBody ?? profile.defaultBody,
      avatarMood: 'neutral',
      baseline: { ...profile.baseline, mouthSmile: RESTING_SMILE },
      ...(profile.retarget ? { retarget: profile.retarget } : {}),
      ...(profile.dynamicBones ? { modelDynamicBones: profile.dynamicBones } : {}),
      ...AVATAR_GAZE,
    };
    this.avatarLoad = head.showAvatar(avatar, null, (gltf) => {
      const problem = incompatibility(gltf);
      if (problem) throw new AvatarIncompatibleError(source.url, problem);
      // TalkingHead checks for the key, not its value, so it has to go entirely.
      if (avatar.retarget && hasQuantisedSkin(gltf)) delete avatar.retarget;
      ensureArmatureRoot(gltf, MODEL_ROOT, GroupClass);
      fileBody = detectBody(gltf.parser.json);
      // TalkingHead reads the body form after this hook, so the file can still decide it.
      if (!envBody && fileBody) avatar.body = fileBody;
    });
    try {
      await this.avatarLoad;
    } finally {
      this.avatarLoad = null;
    }
    const bodySource: Human3dDiagnostics['bodySource'] = envBody ? 'env' : fileBody ? 'file' : 'default';
    return { source, body: avatar.body, bodySource };
  }

  private connectAudio(track: MediaStreamTrack): void {
    if (!this.lipsync) return;
    this.tap = new TrackTap(getPresenceAudioContext(), track);
    this.tap.source.connect(this.lipsync);
  }

  private disconnectAudio(): void {
    this.tap?.dispose();
    this.tap = null;
  }

  private readonly onVisibility = () => {
    if (document.hidden) this.pause();
    else this.resume();
  };

  private pause(): void {
    this.head?.stop();
    this.lipsync?.stop();
  }

  private resume(): void {
    this.head?.start();
    this.lipsync?.start();
  }

  private readonly onSpeechStart = () => {
    const head = this.head;
    if (!head) return;
    head.stateName = 'speaking';
    const now = performance.now();
    if (now - this.lastSpeechEndAt <= SENTENCE_PAUSE_MS) return;
    // A new sentence: find the buyer's eyes, and now and then talk with the hands.
    head.lookAtCamera(SENTENCE_EYE_CONTACT_MS);
    if (this.state !== 'standby' && now > this.gestureUntil && now - this.lastHandsAt > TALKING_HANDS_MIN_GAP_MS) {
      this.lastHandsAt = now;
      head.speakWithHands(0, TALKING_HANDS_PROBABILITY);
    }
  };

  private readonly onSpeechEnd = () => {
    this.lastSpeechEndAt = performance.now();
    if (this.head && this.state !== 'speaking') this.head.stateName = 'idle';
  };

  private applyState(): void {
    const head = this.head;
    if (!head || !this.ready) return;
    const state = this.state;
    head.stateName = state === 'speaking' ? 'speaking' : 'idle';
    head.opt.avatarIdleEyeContact = state === 'standby' ? STANDBY_EYE_CONTACT : AVATAR_GAZE.avatarIdleEyeContact;
    head.animFrameDur = MS_PER_S / (state === 'standby' ? AVATAR_STANDBY_FPS : AVATAR_FPS);
    switch (state) {
      case 'listening':
        this.play(HUMAN3D_EXPRESSIONS.attentive, 'attentive');
        break;
      case 'thinking':
        this.play(HUMAN3D_EXPRESSIONS.thinking, 'thinking');
        break;
      case 'speaking':
        this.finishAnims((name) => name === HUMAN3D_EXPRESSIONS.thinking.face?.name);
        break;
      case 'standby':
        this.finishGestures();
        this.finishAnims((name) => name.startsWith(PRESENCE_ANIM_PREFIX));
        head.lookAhead(STANDBY_LOOK_AWAY_MS);
        break;
      case 'idle':
        break;
    }
  }

  private play(cue: Human3dCue, expression: Expression): void {
    const head = this.head;
    if (!head) return;
    if (cue.settle) {
      this.finishGestures();
      this.finishAnims((name) => name.startsWith(PRESENCE_ANIM_PREFIX));
    }
    if (cue.look?.kind === 'camera') head.lookAtCamera(cue.look.ms);
    else if (cue.look?.kind === 'ahead') head.lookAhead(cue.look.ms);
    if (cue.face) {
      const name = cue.face.name;
      this.finishAnims((n) => n === name);
      head.animQueue.push(head.animFactory(faceTemplate(cue.face, head.mtAvatar)));
    }
    if (cue.tilt) {
      const tilt = tiltTemplate();
      this.finishAnims((n) => n === tilt.name);
      head.animQueue.push(head.animFactory(tilt));
    }
    // While a human advisor has the floor, only the hand-over nod moves.
    const gestureAllowed = this.state !== 'standby' || expression === 'nod';
    if (cue.gesture && gestureAllowed) {
      const g = cue.gesture;
      head.playGesture(g.name, g.seconds, g.mirror, g.transitionMs);
      this.gestureUntil = performance.now() + g.seconds * MS_PER_S;
    }
  }

  /** Ends matching animations on the next frame, letting each return to its resting value. */
  private finishAnims(match: (name: string) => boolean): void {
    const head = this.head;
    if (!head) return;
    for (const anim of head.animQueue) {
      if (match(anim.template.name ?? '')) anim.ts = anim.ts.map(() => 0);
    }
  }

  private finishGestures(transitionMs?: number): void {
    this.head?.stopGesture(transitionMs);
    this.finishAnims((name) => name === TALKING_HANDS_ANIM);
  }
}
