import type { Group } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { TalkingHeadDynamicBone, TalkingHeadRetarget } from '@met4citizen/talkinghead';

/**
 * Which avatar file the advisor uses, and the per-model settings TalkingHead needs for it.
 *
 * Preference: the owner's Avaturn avatar (`advisor`), optimised then original, then the CC0
 * MPFB stand-in. Missing files are skipped silently. `VITE_AVATAR_URL` replaces the whole list.
 */

export type AvatarKind = 'avaturn' | 'mpfb';
export type AvatarBody = 'M' | 'F';

export interface AvatarSource {
  kind: AvatarKind;
  url: string;
}

export interface AvatarProfile {
  /** Used when neither VITE_AVATAR_BODY nor the file says which body form it is. */
  defaultBody: AvatarBody;
  /** Resting values for blend shapes and head angle. */
  baseline: Record<string, number>;
  retarget?: TalkingHeadRetarget;
  dynamicBones?: TalkingHeadDynamicBone[];
}

export const DEFAULT_AVATAR_SOURCES: readonly AvatarSource[] = [
  { kind: 'avaturn', url: '/avatar/advisor.opt.glb' },
  { kind: 'avaturn', url: '/avatar/advisor.glb' },
  { kind: 'mpfb', url: '/avatar/mpfb.opt.glb' },
  { kind: 'mpfb', url: '/avatar/mpfb.glb' },
];

const PONYTAIL_LIMITS = (z: number): Array<[number | null, number | null] | null> => [null, null, [null, z], null];

/**
 * Settings from the TalkingHead project's own site config (github.com/met4citizen/TalkingHead,
 * siteconfig.js) for each model family.
 */
export const AVATAR_PROFILES: Record<AvatarKind, AvatarProfile> = {
  // Avaturn Type-2: TalkingHead-compatible rig with ARKit and Oculus visemes. Its site config
  // lifts the spine and neck slightly, lowers the shoulders, and rests the eyelids a little closed.
  avaturn: {
    defaultBody: 'F',
    retarget: {
      Hips: { y: 0.03 },
      Spine: { y: 0.02 },
      Spine1: { y: 0.02, z: 0.01 },
      Spine2: { y: 0.02, z: 0.01 },
      Neck: { z: 0.02, y: 0.01 },
      Head: { z: 0.02 },
      LeftShoulder: { rx: -0.5 },
      RightShoulder: { rx: -0.5 },
      scaleToHipsLevel: 1.0,
    },
    baseline: { headRotateX: -0.05, eyeBlinkLeft: 0.15, eyeBlinkRight: 0.15 },
  },
  // MPFB (CC0). Only the ponytail swings: the one secondary motion a head-and-shoulders view shows.
  mpfb: {
    defaultBody: 'F',
    baseline: { headRotateX: -0.01, eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 },
    dynamicBones: [
      { bone: 'Ponytail1', type: 'mix2', stiffness: 100, damping: 4, limits: PONYTAIL_LIMITS(0.02), pivot: true },
      { bone: 'Ponytail2', type: 'mix2', stiffness: 150, damping: 4, limits: PONYTAIL_LIMITS(0.01) },
      { bone: 'Ponytail3', type: 'mix2', stiffness: 200, damping: 4, limits: PONYTAIL_LIMITS(0.01) },
    ],
  },
};

const kindOfUrl = (url: string): AvatarKind => (/mpfb/i.test(url) ? 'mpfb' : 'avaturn');

export function avatarSources(): AvatarSource[] {
  const override = (import.meta.env.VITE_AVATAR_URL as string | undefined)?.trim();
  return override ? [{ kind: kindOfUrl(override), url: override }] : [...DEFAULT_AVATAR_SOURCES];
}

/** `VITE_AVATAR_BODY`: `M` or `F`. Unset or anything else: decide from the file. */
export function configuredBody(): AvatarBody | null {
  const raw = (import.meta.env.VITE_AVATAR_BODY as string | undefined)?.trim().toUpperCase();
  return raw === 'M' || raw === 'F' ? raw : null;
}

const FEMALE = /(^|[^a-z])(female|woman|women|girl|feminine)([^a-z]|$)/i;
const MALE = /(^|[^a-z])(male|man|men|boy|masculine)([^a-z]|$)/i;
const GENDER_KEYS = ['gender', 'sex', 'body', 'bodyType', 'body_type'];

function namesIn(list: unknown): string[] {
  return Array.isArray(list) ? list.map((x) => (x && typeof x === 'object' && 'name' in x ? String((x as { name: unknown }).name) : '')) : [];
}

function genderIn(extras: unknown): AvatarBody | null {
  if (!extras || typeof extras !== 'object') return null;
  for (const key of GENDER_KEYS) {
    const value = String((extras as Record<string, unknown>)[key] ?? '').trim();
    if (/^(f|female|woman)$/i.test(value)) return 'F';
    if (/^(m|male|man)$/i.test(value)) return 'M';
  }
  return null;
}

/**
 * Body form from a glTF's JSON: explicit extras first (`gender`, `sex`, `body`…), then the words
 * female/male in mesh, material, image, texture and node names (MPFB names its skin
 * `young_lightskinned_female_diffuse`). Null when it does not say, or says both.
 */
export function detectBody(json: unknown): AvatarBody | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  const explicit = genderIn(j.extras) ?? genderIn((j.asset as { extras?: unknown } | undefined)?.extras);
  if (explicit) return explicit;
  const names = ['meshes', 'materials', 'images', 'textures', 'nodes'].flatMap((k) => namesIn(j[k])).join(' ');
  const female = FEMALE.test(names);
  const male = MALE.test(names);
  if (female === male) return null;
  return female ? 'F' : 'M';
}

/** Visemes HeadAudio drives. `viseme_sil` is optional: a closed mouth is the resting face anyway. */
const LIPSYNC_VISEMES = [
  'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U', 'viseme_PP', 'viseme_SS',
  'viseme_TH', 'viseme_DD', 'viseme_FF', 'viseme_kk', 'viseme_nn', 'viseme_RR', 'viseme_CH',
];
const EYE_BONES = ['LeftEye', 'RightEye'];

/**
 * Why a loaded model cannot be the advisor, or null if it can: it needs the Oculus visemes for
 * lip-sync and eye bones for eye contact. An Avaturn "Type-1" export (static face, no blend shapes,
 * no eyeballs) fails here, and the next avatar file is tried instead.
 */
export function incompatibility(gltf: GLTF): string | null {
  const shapes = new Set<string>();
  const bones = new Set<string>();
  gltf.scene.traverse((node) => {
    bones.add(node.name.replace(/^mixamorig:?/, ''));
    const dictionary = (node as { morphTargetDictionary?: Record<string, number> }).morphTargetDictionary;
    if (dictionary) for (const name of Object.keys(dictionary)) shapes.add(name);
  });
  const missingVisemes = LIPSYNC_VISEMES.filter((v) => !shapes.has(v));
  if (missingVisemes.length === LIPSYNC_VISEMES.length) {
    return shapes.size ? 'it has blend shapes but no Oculus visemes' : 'it has no blend shapes (a static-face export)';
  }
  if (missingVisemes.length) return `it is missing visemes ${missingVisemes.join(', ')}`;
  const missingEyes = EYE_BONES.filter((b) => !bones.has(b));
  if (missingEyes.length) return `it has no ${missingEyes.join(' / ')} bones`;
  return null;
}

/**
 * True when skinned meshes store quantised positions (KHR_mesh_quantization, as the "compact"
 * optimiser profile writes). TalkingHead's retarget rewrites positions in world units, which a
 * quantised attribute cannot hold, so such a file is shown without retargeting.
 */
export function hasQuantisedSkin(gltf: GLTF): boolean {
  let quantised = false;
  gltf.scene.traverse((node) => {
    const mesh = node as { isSkinnedMesh?: boolean; geometry?: { attributes?: { position?: { normalized?: boolean } } } };
    if (mesh.isSkinnedMesh && mesh.geometry?.attributes?.position?.normalized) quantised = true;
  });
  return quantised;
}

export class AvatarIncompatibleError extends Error {
  constructor(readonly url: string, readonly reason: string) {
    super(`${url}: ${reason}`);
    this.name = 'AvatarIncompatibleError';
  }
}

/**
 * TalkingHead looks for the armature under `rootName` and otherwise warns and uses the whole scene.
 * When an export names its root differently, wrap the scene's children in a group with that name:
 * the same result, without the warning.
 */
export function ensureArmatureRoot(gltf: GLTF, rootName: string, GroupClass: new () => Group): void {
  if (gltf.scene.getObjectByName(rootName)) return;
  const root = new GroupClass();
  root.name = rootName;
  root.add(...gltf.scene.children);
  gltf.scene.add(root);
}
