import type { TalkingHead, TalkingHeadAvatar } from '@met4citizen/talkinghead';
import type { HeadAudio } from '@met4citizen/headaudio/dist/headaudio.min.mjs';
import workletUrl from '@met4citizen/headaudio/dist/headworklet.min.mjs?url';
import lipsyncModelUrl from '@met4citizen/headaudio/dist/model-en-mixed.bin?url';
import type { Camera, Object3D, Quaternion, Vector3 } from 'three';
import { AVATAR_GAZE, LIPSYNC, SENTENCE_EYE_CONTACT_MS } from '../config';
import { TrackTap, addWorkletModuleOnce, getPresenceAudioContext, keepPresenceAudioRunning } from '../audio';
import { AVATAR_PROFILES, avatarSources, configuredBody, detectBody, ensureArmatureRoot, hasQuantisedSkin, incompatibility, type AvatarBody } from './avatars';
import { firstAvailable, hasWebGL2 } from './environment';

/**
 * The advisor as a full-body guide standing inside another three.js scene (the 3D tour).
 *
 * TalkingHead runs in its avatar-only mode: it owns the armature, face, gaze and lip-sync, and the
 * host scene renders it. A procedural walk is layered on top of TalkingHead's pose each frame, so
 * no animation files are needed. Lip-sync comes from the advisor's audio track through HeadAudio,
 * exactly as in the call tile.
 */

const MODEL_ROOT = 'Armature';
const RESTING_SMILE = 0.12;

/** Walk cycle, in radians. Swings are about the character's own side-to-side axis. */
const GAIT = {
  thigh: 0.42,
  knee: 0.85,
  foot: 0.25,
  arm: 0.32,
  elbow: 0.18,
  /** Vertical bob of the whole body per step, metres. */
  bob: 0.025,
  /** How quickly the walk blends in and out (per second). */
  blendRate: 5,
} as const;

const GAIT_BONES = ['LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm'] as const;
type GaitBone = (typeof GAIT_BONES)[number];

export class GuideUnavailableError extends Error {}

export class GuideAvatar {
  private lipsync: HeadAudio | null = null;
  private tap: TrackTap | null = null;
  private track: MediaStreamTrack | null = null;
  private disposed = false;
  private walkBlend = 0;
  private readonly bones = new Map<GaitBone, Object3D>();
  private readonly restore = new Map<GaitBone, Quaternion>();
  private lastSpeechEndAt = 0;

  private constructor(
    private readonly three: typeof import('three'),
    private readonly head: TalkingHead,
    /** The avatar's root; the host positions and turns it. */
    readonly root: Object3D,
  ) {
    for (const name of GAIT_BONES) {
      const bone = root.getObjectByName(name);
      if (bone) this.bones.set(name, bone);
    }
  }

  /** Loads the advisor avatar for a scene seen through `camera`. Rejects if WebGL, the file or lip-sync is unavailable. */
  static async create(camera: Camera): Promise<GuideAvatar> {
    if (!hasWebGL2()) throw new GuideUnavailableError('WebGL 2 is not available');
    const source = await firstAvailable(avatarSources());
    if (!source) throw new GuideUnavailableError('No avatar file is available');
    const [three, talkingHead, headAudio] = await Promise.all([
      import('three'),
      import('@met4citizen/talkinghead'),
      import('@met4citizen/headaudio/dist/headaudio.min.mjs'),
    ]);
    const ctx = getPresenceAudioContext();
    // Avatar-only mode never draws into this node; TalkingHead just requires one.
    const head = new talkingHead.TalkingHead(document.createElement('div'), {
      ttsEndpoint: null,
      lipsyncModules: [],
      modelRoot: MODEL_ROOT,
      audioCtx: ctx,
      avatarOnly: true,
      avatarOnlyCamera: camera,
      avatarMood: 'neutral',
      ...AVATAR_GAZE,
    } as ConstructorParameters<typeof talkingHead.TalkingHead>[1]);

    const profile = AVATAR_PROFILES[source.kind];
    const envBody = configuredBody();
    const avatar: TalkingHeadAvatar & { body: AvatarBody } = {
      url: source.url,
      body: envBody ?? profile.defaultBody,
      avatarMood: 'neutral',
      baseline: { ...profile.baseline, mouthSmile: RESTING_SMILE },
      ...(profile.retarget ? { retarget: profile.retarget } : {}),
      ...(profile.dynamicBones ? { modelDynamicBones: profile.dynamicBones } : {}),
      ...AVATAR_GAZE,
    };
    await head.showAvatar(avatar, null, (gltf) => {
      const problem = incompatibility(gltf);
      if (problem) throw new GuideUnavailableError(problem);
      if (avatar.retarget && hasQuantisedSkin(gltf)) delete avatar.retarget;
      ensureArmatureRoot(gltf, MODEL_ROOT, three.Group);
      const fileBody = detectBody(gltf.parser.json);
      if (!envBody && fileBody) avatar.body = fileBody;
    });

    const guide = new GuideAvatar(three, head, head.armature);
    try {
      await addWorkletModuleOnce(ctx, workletUrl);
      const lipsync = new headAudio.HeadAudio(ctx, {
        visemeMinMs: LIPSYNC.visemeMinMs,
        visemeRampMs: LIPSYNC.visemeRampMs,
        parameterData: { vadGateActiveDb: LIPSYNC.vadGateActiveDb, vadGateInactiveDb: LIPSYNC.vadGateInactiveDb },
      });
      await lipsync.loadModel(lipsyncModelUrl);
      lipsync.onvalue = (key, value) => {
        const target = head.mtAvatar[key];
        if (!target) return;
        target.newvalue = value;
        target.needsUpdate = true;
      };
      lipsync.onstarted = guide.onSpeechStart;
      lipsync.onended = guide.onSpeechEnd;
      guide.lipsync = lipsync;
    } catch {
      // The guide still walks and looks at the buyer without lip-sync; the tile keeps its own.
    }
    return guide;
  }

  attachAudio(track: MediaStreamTrack | null): void {
    if (track === this.track || this.disposed) return;
    this.track = track;
    this.tap?.dispose();
    this.tap = null;
    if (track && this.lipsync) {
      this.tap = new TrackTap(getPresenceAudioContext(), track);
      this.tap.source.connect(this.lipsync);
    }
  }

  /**
   * Advances one frame. `walking` blends the gait in or out; `phase` is the step cycle in radians
   * (the host advances it with distance travelled, so feet match the ground speed).
   */
  update(dtMs: number, walking: boolean, phase: number): void {
    if (this.disposed) return;
    // Bones TalkingHead does not rewrite every frame would otherwise accumulate the gait.
    for (const [name, q] of this.restore) this.bones.get(name)?.quaternion.copy(q);
    this.restore.clear();

    this.lipsync?.update(dtMs);
    this.head.animate(dtMs);

    const step = Math.min(1, (GAIT.blendRate * dtMs) / 1000);
    this.walkBlend += ((walking ? 1 : 0) - this.walkBlend) * step;
    const w = this.walkBlend;
    if (w < 0.01) return;

    const s = Math.sin(phase);
    const c = Math.cos(phase);
    // Forward swing is negative about the character's +X (it faces +Z).
    this.swing('LeftUpLeg', -GAIT.thigh * s * w);
    this.swing('RightUpLeg', GAIT.thigh * s * w);
    this.swing('LeftLeg', GAIT.knee * Math.max(0, c) * w);
    this.swing('RightLeg', GAIT.knee * Math.max(0, -c) * w);
    this.swing('LeftFoot', -GAIT.foot * Math.max(0, c) * w);
    this.swing('RightFoot', -GAIT.foot * Math.max(0, -c) * w);
    this.swing('LeftArm', GAIT.arm * s * w);
    this.swing('RightArm', -GAIT.arm * s * w);
    this.swing('LeftForeArm', -GAIT.elbow * w);
    this.swing('RightForeArm', -GAIT.elbow * w);
  }

  /** Extra height for the walking bob, metres. */
  bob(phase: number): number {
    return GAIT.bob * Math.abs(Math.sin(phase)) * this.walkBlend;
  }

  /** Looks at the buyer (the tour camera) for a moment, e.g. on arriving at a spot. */
  lookAtBuyer(ms: number): void {
    this.head.lookAtCamera(ms);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tap?.dispose();
    this.tap = null;
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
    this.root.removeFromParent();
    try {
      this.head.dispose();
    } catch {
      // Nothing more to release.
    }
    keepPresenceAudioRunning();
  }

  /**
   * Rotates a bone about the character's side-to-side axis, whatever the rig's local axes are:
   * the axis is carried from the character's space into the bone's parent space.
   */
  private swing(name: GaitBone, angle: number): void {
    const bone = this.bones.get(name);
    if (!bone || !bone.parent || angle === 0) return;
    const { Quaternion: Q, Vector3: V } = this.three;
    this.restore.set(name, bone.quaternion.clone());
    const rootWorld = this.root.getWorldQuaternion(new Q());
    const parentWorld = bone.parent.getWorldQuaternion(new Q());
    const parentInRoot = rootWorld.invert().multiply(parentWorld);
    const axis: Vector3 = new V(1, 0, 0).applyQuaternion(parentInRoot.clone().invert());
    bone.quaternion.premultiply(new Q().setFromAxisAngle(axis, angle));
  }

  private readonly onSpeechStart = () => {
    this.head.stateName = 'speaking';
    if (performance.now() - this.lastSpeechEndAt > 1500) this.head.lookAtCamera(SENTENCE_EYE_CONTACT_MS);
  };

  private readonly onSpeechEnd = () => {
    this.lastSpeechEndAt = performance.now();
    this.head.stateName = 'idle';
  };
}
