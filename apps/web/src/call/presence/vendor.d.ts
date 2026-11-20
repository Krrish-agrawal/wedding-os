/**
 * Type declarations for the parts of TalkingHead 1.8.2 and HeadAudio 1.1.0 that presence uses.
 * Neither package ships types. Written from their README and published source
 * (modules/talkinghead.mjs, modules/headaudio.mjs); keep to what is actually called.
 */

declare module '@met4citizen/talkinghead' {
  import type { Object3D, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
  import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

  export type TalkingHeadView = 'full' | 'mid' | 'upper' | 'head';
  export type TalkingHeadMood = 'neutral' | 'happy' | 'angry' | 'sad' | 'fear' | 'disgust' | 'love' | 'sleep';
  /** Built-in hand gestures plus the animated emoji templates (e.g. "yes" is a nod). */
  export type TalkingHeadGesture = 'handup' | 'index' | 'ok' | 'thumbup' | 'thumbdown' | 'side' | 'shrug' | 'namaste';

  export interface TalkingHeadLighting {
    lightAmbientColor?: number | string;
    lightAmbientIntensity?: number;
    lightDirectColor?: number | string;
    lightDirectIntensity?: number;
    lightDirectPhi?: number;
    lightDirectTheta?: number;
    lightSpotColor?: number | string;
    lightSpotIntensity?: number;
    lightSpotPhi?: number;
    lightSpotTheta?: number;
    lightSpotDispersion?: number;
  }

  export interface TalkingHeadCamera {
    cameraDistance?: number;
    cameraX?: number;
    cameraY?: number;
    cameraRotateX?: number;
    cameraRotateY?: number;
  }

  export interface TalkingHeadOptions extends TalkingHeadLighting, TalkingHeadCamera {
    ttsEndpoint?: string | null;
    lipsyncModules?: string[];
    /** Name of the armature root object. Default "Armature". */
    modelRoot?: string;
    lipsyncLang?: string;
    audioCtx?: AudioContext | null;
    modelPixelRatio?: number;
    modelFPS?: number;
    modelMovementFactor?: number;
    cameraView?: TalkingHeadView;
    cameraRotateEnable?: boolean;
    cameraPanEnable?: boolean;
    cameraZoomEnable?: boolean;
    avatarMood?: TalkingHeadMood;
    avatarIdleEyeContact?: number;
    avatarIdleHeadMove?: number;
    avatarSpeakingEyeContact?: number;
    avatarSpeakingHeadMove?: number;
    avatarIgnoreCamera?: boolean;
    /** Called inside the animation loop with the frame's delta time in ms. */
    update?: ((dtMs: number) => void) | null;
  }

  export interface TalkingHeadDynamicBone {
    bone: string;
    type: 'point' | 'link' | 'mix1' | 'mix2' | 'full';
    stiffness: number | number[];
    damping: number | number[];
    limits?: Array<[number | null, number | null] | null>;
    deltaLocal?: [number, number, number];
    deltaWorld?: [number, number, number];
    pivot?: boolean;
  }

  /** Skeleton correction for one bone: position (m) and rotation (rad) deltas. */
  export interface TalkingHeadBoneFix {
    x?: number;
    y?: number;
    z?: number;
    rx?: number;
    ry?: number;
    rz?: number;
  }

  /** Bone corrections, plus `scaleToHipsLevel` / `scaleToEyesLevel` factors and an `origin` shift. */
  export type TalkingHeadRetarget = Record<string, TalkingHeadBoneFix | number>;

  export interface TalkingHeadAvatar {
    url: string;
    body?: 'M' | 'F';
    avatarMood?: TalkingHeadMood;
    lipsyncLang?: string;
    baseline?: Record<string, number>;
    retarget?: TalkingHeadRetarget;
    modelDynamicBones?: TalkingHeadDynamicBone[];
    avatarIdleEyeContact?: number;
    avatarIdleHeadMove?: number;
    avatarSpeakingEyeContact?: number;
    avatarSpeakingHeadMove?: number;
    avatarListeningEyeContact?: number;
  }

  /** One morph target's animation state. Setting `newvalue` + `needsUpdate` drives it this frame. */
  export interface TalkingHeadMorphTarget {
    value: number;
    newvalue: number | null;
    needsUpdate: boolean;
  }

  /** Animation template: delta times `dt` (ms) and value sequences `vs` per morph target. */
  export interface TalkingHeadAnimTemplate {
    name: string;
    delay?: number | [number, number];
    dt: Array<number | number[]>;
    vs: Record<string, Array<number | number[] | null>>;
  }

  /** A running animation built from a template. Setting every `ts` to 0 finishes it on the next frame. */
  export interface TalkingHeadAnim {
    /** Animated emoji templates (e.g. the "yes" nod) have no name. */
    template: { name?: string };
    ts: number[];
  }

  /** One animation template set per mood; `anims` hold the breathing, head, eyes, blink... loops. */
  export interface TalkingHeadMoodTemplate {
    anims: Array<{ name: string } & Record<string, unknown>>;
  }

  export class TalkingHead {
    constructor(node: HTMLElement, opt?: TalkingHeadOptions);
    opt: TalkingHeadOptions;
    audioCtx: AudioContext;
    renderer: WebGLRenderer;
    scene: Scene;
    camera: PerspectiveCamera;
    controls: { target: Vector3; update(): void };
    /** Camera easing used by setView(); null when no move is in progress. */
    cameraClock: number | null;
    cameraStart: Vector3;
    cameraEnd: Vector3;
    controlsStart: Vector3;
    controlsEnd: Vector3;
    objectLeftEye: Object3D | undefined;
    objectRightEye: Object3D | undefined;
    /** The avatar's root object (in avatarOnly mode the host scene adds and positions it). */
    armature: Object3D;
    /** One frame of animation. In avatarOnly mode `t` is the time since the last frame, in ms. */
    animate(t: number): void;
    animMoods: Record<TalkingHeadMood, TalkingHeadMoodTemplate>;
    mtAvatar: Record<string, TalkingHeadMorphTarget>;
    /** Selects the idle or speaking variants of the built-in animation templates. */
    stateName: 'idle' | 'speaking';
    /** Minimum time between rendered frames (1000 / modelFPS). */
    animFrameDur: number;
    animQueue: TalkingHeadAnim[];
    isRunning: boolean;
    animFactory(template: TalkingHeadAnimTemplate, loop?: boolean | number): TalkingHeadAnim;
    /** `onpreprocess` runs on the loaded glTF before TalkingHead reads the armature from it. */
    showAvatar(avatar: TalkingHeadAvatar, onprogress?: ((ev: ProgressEvent) => void) | null, onpreprocess?: ((gltf: GLTF) => void) | null): Promise<void>;
    setView(view: TalkingHeadView, opt?: TalkingHeadCamera | null): void;
    setLighting(opt: TalkingHeadLighting): void;
    setMood(mood: TalkingHeadMood): void;
    getMood(): TalkingHeadMood;
    /** Hand gesture or animated emoji (`"yes"`, `"🤔"` …) for `dur` seconds with an `ms` transition. */
    playGesture(name: TalkingHeadGesture | string, dur?: number, mirror?: boolean, ms?: number): void;
    stopGesture(ms?: number): void;
    lookAtCamera(ms: number): void;
    lookAhead(ms: number): void;
    makeEyeContact(ms: number): void;
    speakWithHands(delay?: number, prob?: number): void;
    start(): void;
    /** Stops the loop. Note: also suspends `audioCtx`. */
    stop(): void;
    dispose(): void;
  }
}

declare module '@met4citizen/headaudio/dist/headaudio.min.mjs' {
  export type OculusViseme =
    | 'viseme_aa'
    | 'viseme_E'
    | 'viseme_I'
    | 'viseme_O'
    | 'viseme_U'
    | 'viseme_PP'
    | 'viseme_SS'
    | 'viseme_TH'
    | 'viseme_DD'
    | 'viseme_FF'
    | 'viseme_kk'
    | 'viseme_nn'
    | 'viseme_RR'
    | 'viseme_CH'
    | 'viseme_sil';

  export type HeadAudioParameter =
    | 'vadMode'
    | 'vadGateActiveDb'
    | 'vadGateActiveMs'
    | 'vadGateInactiveDb'
    | 'vadGateInactiveMs'
    | 'silMode'
    | 'silCalibrationWindowSec'
    | 'silSensitivity';

  export interface HeadAudioOptions {
    /** Minimum hold per viseme (ms). Default 120. */
    visemeMinMs?: number;
    /** Ramp duration (ms). Default 100. */
    visemeRampMs?: number;
    visemeEasingSharpness?: number;
    /** Maximum blend shape value per viseme, in Oculus order. */
    visemeMaxs?: number[];
    processorOptions?: {
      frameEventsEnabled?: boolean;
      vadEventsEnabled?: boolean;
      featureEventsEnabled?: boolean;
      visemeEventsEnabled?: boolean;
    };
    parameterData?: Partial<Record<HeadAudioParameter, number>>;
  }

  /** AudioWorkletNode: one mono input, no outputs. Register `headworklet.min.mjs` first. */
  export class HeadAudio extends AudioWorkletNode {
    constructor(ctx: BaseAudioContext, options?: HeadAudioOptions | null);
    onvalue: ((key: OculusViseme, value: number) => void) | null;
    onstarted: ((data: { t: number }) => void) | null;
    onended: ((data: { t: number }) => void) | null;
    loadModel(url: string, reset?: boolean): Promise<void>;
    /** Advances viseme easing; call once per animation frame. */
    update(dtMs: number): void;
    start(): void;
    stop(): void;
    resetAll(): void;
  }
}
