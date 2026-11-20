/**
 * Optimises the advisor's avatar files for the call tile.
 *
 *   npx --no-install tsx scripts/avatar/optimize-avatar.ts             every known avatar that exists
 *   npx --no-install tsx scripts/avatar/optimize-avatar.ts advisor     just the Avaturn advisor
 *   npx --no-install tsx scripts/avatar/optimize-avatar.ts in.glb out.glb [--profile rig-safe|compact]
 *
 * Known avatars (apps/web/public/avatar):
 *   advisor.glb → advisor.opt.glb   the owner's Avaturn avatar            profile "rig-safe"
 *   mpfb.glb    → mpfb.opt.glb      the CC0 MPFB stand-in                 profile "compact"
 *
 * Both profiles: dedup → prune (keeps leaf nodes, attributes and extras, so the skeleton is
 * untouched) → textures resized to 1024 px and re-encoded as WebP (TalkingHead's loader has no
 * KTX2) → Meshopt compression.
 * - compact: positions, normals and morph targets are quantised (smallest file). The quantisation
 *   scale moves into each skin's inverse bind matrices, which is fine for a rig used as is.
 * - rig-safe: positions, normals and morph targets stay 32-bit floats in their original space and
 *   the inverse bind matrices are not touched; only UVs, joints and weights are quantised. Needed
 *   for Avaturn: TalkingHead retargets that rig at load (shoulder and neck fixes) by rewriting
 *   vertex positions and rebinding the skeleton, which breaks quantised positions.
 *
 * Before optimising, the input is checked for what TalkingHead and HeadAudio need: the 15 Oculus
 * visemes (lip-sync; fatal if missing), the 52 ARKit blend shapes (expressions; listed if
 * missing) and the Mixamo-named skeleton with eye bones (fatal if missing).
 * Afterwards the output is read back and compared with the input: same meshes, same morph target
 * names and counts, same skin joints and node names, every morph target's deltas within
 * tolerance, and for rig-safe also unchanged inverse bind matrices and node transforms.
 * The script exits non-zero if any check fails.
 *
 * sharp is not a direct dependency of this workspace; it is resolved through
 * @gltf-transform/functions → ndarray-pixels, which already depends on it. Adding
 * `sharp` to scripts/package.json would make that explicit.
 */
import { createRequire } from 'node:module';
import { access, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, type Mesh } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, dequantize, meshopt, prune, quantize, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AVATAR_DIR = path.join(REPO_ROOT, 'apps/web/public/avatar');

type Profile = 'compact' | 'rig-safe';
const PROFILES: readonly Profile[] = ['compact', 'rig-safe'];

interface Job {
  name: string;
  input: string;
  output: string;
  profile: Profile;
}

const KNOWN_AVATARS: readonly Job[] = [
  { name: 'advisor', input: path.join(AVATAR_DIR, 'advisor.glb'), output: path.join(AVATAR_DIR, 'advisor.opt.glb'), profile: 'rig-safe' },
  { name: 'mpfb', input: path.join(AVATAR_DIR, 'mpfb.glb'), output: path.join(AVATAR_DIR, 'mpfb.opt.glb'), profile: 'compact' },
];

/** Attributes the rig-safe profile may quantise: none that retargeting rewrites. */
const RIG_SAFE_QUANTIZE = /^(TEXCOORD|JOINTS|WEIGHTS)(_\d+)?$/;
/** Matches nothing: morph targets stay float in the rig-safe profile. */
const NOTHING = /$^/;
/**
 * Inverse bind matrices and node transforms must match to this (rig-safe). The glTF writer snaps
 * scales within about 1e-5 of 1 to exactly 1, so exact equality is too strict.
 */
const RIG_TOLERANCE = 1e-4;

/** What TalkingHead + HeadAudio need from the model (TalkingHead README, Appendix A). */
const OCULUS_VISEMES = [
  'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD', 'viseme_kk', 'viseme_CH', 'viseme_SS',
  'viseme_nn', 'viseme_RR', 'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U',
];
/** Silence: optional, the resting mouth stands in for it (MPFB has none). */
const SILENCE_VISEME = 'viseme_sil';
const ARKIT_SHAPES = [
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight',
  'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawRight', 'jawOpen', 'mouthClose', 'mouthFunnel',
  'mouthPucker', 'mouthLeft', 'mouthRight', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthDimpleLeft', 'mouthDimpleRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthRollLower', 'mouthRollUpper',
  'mouthShrugLower', 'mouthShrugUpper', 'mouthPressLeft', 'mouthPressRight', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft',
  'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'noseSneerLeft', 'noseSneerRight', 'tongueOut',
];
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3].map((n) => `${f}${n}`));
/** Bones TalkingHead poses (its pose templates) plus the eyes it aims. A "mixamorig" prefix is fine. */
const REQUIRED_BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftEye', 'RightEye',
  ...['Left', 'Right'].flatMap((side) => [
    `${side}Shoulder`, `${side}Arm`, `${side}ForeArm`, `${side}Hand`,
    `${side}UpLeg`, `${side}Leg`, `${side}Foot`, `${side}ToeBase`,
    ...FINGERS.map((f) => `${side}Hand${f}`),
  ]),
];

/** Largest texture edge. The advisor tile is a few hundred pixels wide, so 1k is ample. */
const TEXTURE_MAX_PX = 1024;
/** WebP quality for colour textures (skin, clothes, hair, eyes, teeth). */
const COLOR_TEXTURE_QUALITY = 85;
/** Normal maps carry geometry detail, so they get a higher quality setting. */
const NORMAL_TEXTURE_QUALITY = 92;
/**
 * A morph target fails only if its error is both above this absolute size (0.1 mm, invisible in a
 * head-and-shoulders tile) and above MAX_MORPH_RELATIVE_ERROR of that target's largest delta.
 */
const MAX_MORPH_ABSOLUTE_ERROR_M = 0.0001;
const MAX_MORPH_RELATIVE_ERROR = 0.01;
/** Deltas below this (metres) are treated as zero when checking a target still moves. */
const MORPH_EPSILON = 1e-6;
const BYTES_PER_MB = 1_000_000;
const MM_PER_M = 1000;

interface MorphCheck {
  /** Largest per-vertex error in metres across all targets. */
  worstAbs: number;
  /** Largest error relative to its own target's peak delta. */
  worstRel: number;
  failing: number;
  dead: number;
}

type Sharp = (input?: Buffer) => unknown;

function loadSharp(): Sharp {
  const local = createRequire(import.meta.url);
  const functionsEntry = local.resolve('@gltf-transform/functions');
  const ndarrayPixelsEntry = createRequire(functionsEntry).resolve('ndarray-pixels');
  return createRequire(ndarrayPixelsEntry)('sharp') as Sharp;
}

interface MeshSnapshot {
  targetNames: string[];
  /**
   * Per primitive, per target: the displacement length of every vertex, sorted. Meshopt reorders
   * vertices for cache locality, so the comparison has to be independent of vertex order.
   */
  targets: Float32Array[][];
}

interface Snapshot {
  meshes: Map<string, MeshSnapshot>;
  /** Joint names of each skin. Quantisation gives every mesh its own skin over the same joints. */
  skins: string[][];
  /** Inverse bind matrices of each skin, flattened. */
  inverseBinds: number[][];
  nodes: string[];
  /** Translation, rotation and scale of every named node. */
  transforms: Map<string, number[]>;
}

function targetNamesOf(mesh: Mesh): string[] {
  const extras = mesh.getExtras() as { targetNames?: unknown };
  return Array.isArray(extras.targetNames) ? extras.targetNames.map(String) : [];
}

function snapshot(doc: Document): Snapshot {
  const root = doc.getRoot();
  const meshes = new Map<string, MeshSnapshot>();
  for (const mesh of root.listMeshes()) {
    const targets = mesh.listPrimitives().map((prim) =>
      prim.listTargets().map((target) => {
        const accessor = target.getAttribute('POSITION');
        if (!accessor) return new Float32Array();
        const out = new Float32Array(accessor.getCount());
        const el: number[] = [];
        for (let i = 0; i < accessor.getCount(); i++) {
          accessor.getElement(i, el);
          out[i] = Math.hypot(el[0] ?? 0, el[1] ?? 0, el[2] ?? 0);
        }
        return out.sort();
      }),
    );
    meshes.set(mesh.getName(), { targetNames: targetNamesOf(mesh), targets });
  }
  return {
    meshes,
    skins: root.listSkins().map((s) => s.listJoints().map((j) => j.getName())),
    inverseBinds: root.listSkins().map((s) => Array.from(s.getInverseBindMatrices()?.getArray() ?? [])),
    nodes: root.listNodes().map((n) => n.getName()).sort(),
    transforms: new Map(root.listNodes().map((n) => [n.getName(), [...n.getTranslation(), ...n.getRotation(), ...n.getScale()]])),
  };
}

/** For rig-safe output: the skeleton's bind pose and every node transform must be exactly as before. */
function verifyRigUnchanged(before: Snapshot, after: Snapshot): string[] {
  const problems: string[] = [];
  const close = (a: number[], b: number[] | undefined) => !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) <= RIG_TOLERANCE);
  if (before.inverseBinds.length !== after.inverseBinds.length) problems.push('Skin count changed');
  before.inverseBinds.forEach((ibm, i) => {
    if (!close(ibm, after.inverseBinds[i])) problems.push(`Skin ${i}: inverse bind matrices changed`);
  });
  const moved = [...before.transforms].filter(([name, trs]) => name && !close(trs, after.transforms.get(name))).map(([name]) => name);
  if (moved.length) problems.push(`Node transforms changed: ${moved.slice(0, 8).join(', ')}${moved.length > 8 ? '…' : ''}`);
  return problems;
}

interface Compatibility {
  errors: string[];
  notes: string[];
}

/** Does the model have what TalkingHead and HeadAudio need? Checked on the input, before any change. */
function checkCompatibility(doc: Document): Compatibility {
  const root = doc.getRoot();
  const shapes = new Set(root.listMeshes().flatMap(targetNamesOf));
  const bones = new Set(root.listNodes().map((n) => n.getName().replace(/^mixamorig:?/, '')));
  const errors: string[] = [];
  const notes: string[] = [];

  const missingVisemes = OCULUS_VISEMES.filter((v) => !shapes.has(v));
  const missingSpoken = missingVisemes.filter((v) => v !== SILENCE_VISEME);
  if (missingSpoken.length === OCULUS_VISEMES.length - 1) {
    errors.push(
      shapes.size
        ? 'No Oculus visemes (viseme_aa … viseme_U): lip-sync cannot move this mouth.'
        : 'No blend shapes at all: this is a static-face export (Avaturn "Type-1"). Re-export as a Type-2 avatar, which has ARKit blend shapes and visemes.',
    );
  } else if (missingSpoken.length) {
    errors.push(`Missing visemes: ${missingSpoken.join(', ')}`);
  } else if (missingVisemes.length) {
    notes.push(`No ${SILENCE_VISEME}: fine, the resting mouth is used for silence.`);
  }
  const missingArkit = ARKIT_SHAPES.filter((a) => !shapes.has(a));
  if (missingArkit.length === ARKIT_SHAPES.length) {
    notes.push('No ARKit blend shapes: blinks, smiles and expressions will not show.');
  } else if (missingArkit.length) {
    notes.push(`Missing ARKit blend shapes (those expressions will not show): ${missingArkit.join(', ')}`);
  }
  const missingBones = REQUIRED_BONES.filter((b) => !bones.has(b));
  if (missingBones.length) {
    const eyesOnly = missingBones.every((b) => b === 'LeftEye' || b === 'RightEye');
    errors.push(
      eyesOnly
        ? 'No LeftEye / RightEye bones: the eyes cannot look at the buyer (Avaturn "Type-1" exports have no separate eyeballs; Type-2 do).'
        : `Missing bones TalkingHead needs (Mixamo names): ${missingBones.join(', ')}`,
    );
  }
  if (!bones.has('Armature')) notes.push('No root node named "Armature"; the app wraps the scene in one at load.');
  notes.push(`${shapes.size} blend shapes on ${root.listMeshes().length} meshes, ${root.listSkins()[0]?.listJoints().length ?? 0} joints.`);
  return { errors, notes };
}

/**
 * Quantisation stores morph deltas divided by a per-mesh scale (compensated in the skin's
 * inverse bind matrices). Estimate that scale by least squares, then compare each target's
 * sorted displacement lengths.
 */
function morphError(before: Float32Array[], after: Float32Array[]): MorphCheck {
  let num = 0;
  let den = 0;
  for (let t = 0; t < before.length; t++) {
    const a = before[t]!;
    const b = after[t]!;
    for (let i = 0; i < a.length; i++) {
      num += a[i]! * b[i]!;
      den += b[i]! * b[i]!;
    }
  }
  const scale = den > 0 ? num / den : 1;
  const result: MorphCheck = { worstAbs: 0, worstRel: 0, failing: 0, dead: 0 };
  for (let t = 0; t < before.length; t++) {
    const a = before[t]!;
    const b = after[t]!;
    if (a.length !== b.length) return { ...result, failing: before.length };
    const peak = a[a.length - 1] ?? 0;
    const peakAfter = (b[b.length - 1] ?? 0) * scale;
    let err = 0;
    for (let i = 0; i < a.length; i++) err = Math.max(err, Math.abs(a[i]! - b[i]! * scale));
    if (peak <= MORPH_EPSILON) continue;
    const rel = err / peak;
    result.worstAbs = Math.max(result.worstAbs, err);
    result.worstRel = Math.max(result.worstRel, rel);
    if (err > MAX_MORPH_ABSOLUTE_ERROR_M && rel > MAX_MORPH_RELATIVE_ERROR) result.failing += 1;
    if (peakAfter <= MORPH_EPSILON) result.dead += 1;
  }
  return result;
}

function verify(before: Snapshot, after: Snapshot): string[] {
  const problems: string[] = [];
  const original = before.skins[0]?.join('|') ?? '';
  if (!after.skins.length || after.skins.some((joints) => joints.join('|') !== original)) {
    problems.push('Skin joints changed');
  }
  const missingNodes = before.nodes.filter((n) => !after.nodes.includes(n));
  if (missingNodes.length) problems.push(`Nodes removed: ${missingNodes.join(', ')}`);

  for (const [name, a] of before.meshes) {
    const b = after.meshes.get(name);
    if (!b) {
      problems.push(`Mesh "${name}" missing`);
      continue;
    }
    if (a.targetNames.join('|') !== b.targetNames.join('|')) problems.push(`Mesh "${name}": morph target names changed`);
    if (a.targets.length !== b.targets.length) {
      problems.push(`Mesh "${name}": primitive count changed`);
      continue;
    }
    a.targets.forEach((primTargets, p) => {
      const other = b.targets[p]!;
      if (primTargets.length !== other.length) {
        problems.push(`Mesh "${name}" primitive ${p}: ${primTargets.length} → ${other.length} morph targets`);
        return;
      }
      if (!primTargets.length) return;
      const check = morphError(primTargets, other);
      console.log(
        `  ${name}[${p}]: ${primTargets.length} morph targets, worst error ${(check.worstAbs * MM_PER_M).toFixed(3)} mm` +
          ` (worst relative ${(check.worstRel * 100).toFixed(1)}%, on a target that barely moves)`,
      );
      if (check.failing) problems.push(`Mesh "${name}" primitive ${p}: ${check.failing} morph targets changed beyond tolerance`);
      if (check.dead) problems.push(`Mesh "${name}" primitive ${p}: ${check.dead} morph targets lost their deltas`);
    });
  }
  return problems;
}

function geometryTransforms(profile: Profile) {
  if (profile === 'compact') return [meshopt({ encoder: MeshoptEncoder, level: 'medium' })];
  // No reorder here: it drops unreferenced vertices, which changes vertex counts and makes the
  // one-to-one morph target verification impossible (seen on the Avaturn Type 2 head, 2026-11-20).
  return [quantize({ pattern: RIG_SAFE_QUANTIZE, patternTargets: NOTHING })];
}

async function optimise(io: NodeIO, job: Job): Promise<boolean> {
  console.log(`\n${job.name}: ${path.relative(REPO_ROOT, job.input)} → ${path.relative(REPO_ROOT, job.output)} (${job.profile})`);
  const doc = await io.read(job.input);

  const compat = checkCompatibility(doc);
  for (const note of compat.notes) console.log(`  note: ${note}`);
  if (compat.errors.length) {
    console.error('  Not usable as the advisor avatar:');
    for (const e of compat.errors) console.error(`  - ${e}`);
    return false;
  }

  const before = snapshot(doc);
  const sharp = loadSharp();
  await doc.transform(
    dedup(),
    prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [TEXTURE_MAX_PX, TEXTURE_MAX_PX],
      slots: /^(?!normalTexture$).*/,
      quality: COLOR_TEXTURE_QUALITY,
    }),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [TEXTURE_MAX_PX, TEXTURE_MAX_PX],
      slots: /^normalTexture$/,
      quality: NORMAL_TEXTURE_QUALITY,
    }),
    ...geometryTransforms(job.profile),
  );
  if (job.profile === 'rig-safe') {
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  }

  await io.write(job.output, doc);

  console.log('  Verifying');
  const check = await io.read(job.output);
  await check.transform(dequantize());
  const after = snapshot(check);
  const problems = [...verify(before, after), ...(job.profile === 'rig-safe' ? verifyRigUnchanged(before, after) : [])];

  const [inSize, outSize] = await Promise.all([stat(job.input), stat(job.output)]);
  console.log(`  ${(outSize.size / BYTES_PER_MB).toFixed(1)} MB (from ${(inSize.size / BYTES_PER_MB).toFixed(1)} MB)`);
  for (const t of check.getRoot().listTextures()) {
    const size = t.getSize();
    console.log(`  texture ${t.getName()}: ${t.getMimeType()} ${size ? size.join('×') : '?'}`);
  }

  if (problems.length) {
    console.error('  Verification failed:');
    for (const p of problems) console.error(`  - ${p}`);
    // Never leave an unverified file where the app would load it.
    await rm(job.output, { force: true });
    console.error(`  Removed ${path.relative(REPO_ROOT, job.output)}; the app falls back to the next file.`);
    return false;
  }
  console.log(`  Verified: meshes, morph targets, skeleton and nodes intact${job.profile === 'rig-safe' ? '; bind pose and node transforms unchanged' : ''}.`);
  return true;
}

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/** Jobs from the command line: nothing (every known avatar that exists), names, or `in out [--profile p]`. */
async function jobsFromArgs(argv: string[]): Promise<Job[]> {
  const profileFlag = argv.indexOf('--profile');
  const profileArg = profileFlag >= 0 ? argv[profileFlag + 1] : undefined;
  const args = argv.filter((_, i) => i !== profileFlag && i !== profileFlag + 1);
  if (profileArg && !(PROFILES as readonly string[]).includes(profileArg)) throw new Error(`Unknown profile "${profileArg}" (${PROFILES.join(', ')})`);

  if (args.length === 2 && args.every((a) => a.endsWith('.glb'))) {
    const input = path.resolve(args[0]!);
    const output = path.resolve(args[1]!);
    const profile = (profileArg as Profile | undefined) ?? (/mpfb/i.test(input) ? 'compact' : 'rig-safe');
    return [{ name: path.basename(input, '.glb'), input, output, profile }];
  }
  const wanted = args.length ? KNOWN_AVATARS.filter((j) => args.includes(j.name)) : KNOWN_AVATARS;
  if (args.length && wanted.length !== args.length) throw new Error(`Unknown avatar name. Known: ${KNOWN_AVATARS.map((j) => j.name).join(', ')}`);
  const present: Job[] = [];
  for (const job of wanted) {
    if (await exists(job.input)) present.push(profileArg ? { ...job, profile: profileArg as Profile } : job);
    else console.log(`${job.name}: ${path.relative(REPO_ROOT, job.input)} not found, skipped`);
  }
  return present;
}

async function main(): Promise<void> {
  const jobs = await jobsFromArgs(process.argv.slice(2));
  if (!jobs.length) {
    console.log('Nothing to optimise.');
    return;
  }
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

  let ok = true;
  for (const job of jobs) ok = (await optimise(io, job)) && ok;
  if (!ok) process.exitCode = 1;
}

await main();
