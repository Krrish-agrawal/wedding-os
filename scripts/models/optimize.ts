/**
 * Optimises the owner's source models into web-ready GLBs.
 *
 *   tsx scripts/models/optimize.ts [model-id ...] [--stats-only]
 *
 * Steps: normalise (metres, Y up, origin at the centre of the floor, y = 0 on the main floor),
 * classify top-level objects into Structure / Furnishing / Exterior groups, weld, simplify heavy
 * meshes per rule, join by material inside each group, resize and convert textures to WebP,
 * prune, dedup, and Meshopt-compress.
 *
 * Textures are resized and re-encoded through gltf-transform's built-in fallback encoder
 * (ndarray-pixels, which uses the sharp build gltf-transform already depends on).
 */
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Document, ImageUtils, type Node, type Primitive, type Scene } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import {
  clearNodeTransform,
  compactPrimitive,
  compressTexture,
  dedup,
  flatten,
  getBounds,
  join,
  meshopt,
  prune,
  weld,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { createIO } from './io.js';
import { MODELS, type ModelConfig } from './models.config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GROUPS = { structure: 'Structure', furnishing: 'Furnishing', exterior: 'Exterior' } as const;
type Group = keyof typeof GROUPS;
/** Tolerance when deciding whether an object reaches outside the interior footprint, in source units. */
const INTERIOR_TOLERANCE = 0.25;
/** Objects below this triangle count are left out of the simplification report. */
const SIMPLIFY_REPORT_MIN_TRIANGLES = 5000;

const { positionals } = parseArgs({ allowPositionals: true, options: {} });
const selected = positionals.length ? MODELS.filter((m) => positionals.includes(m.id)) : MODELS;
if (!selected.length) {
  console.error(`No model matches ${positionals.join(', ')}. Known: ${MODELS.map((m) => m.id).join(', ')}`);
  process.exit(1);
}

const io = await createIO();
await MeshoptSimplifier.ready;

for (const config of selected) {
  await optimise(config);
}

interface Stats {
  triangles: number;
  primitives: number;
  meshes: number;
  materials: number;
  textures: number;
  textureBytes: number;
}

function collectStats(doc: Document): Stats {
  const root = doc.getRoot();
  let triangles = 0;
  let primitives = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const p of mesh.listPrimitives()) {
      primitives++;
      triangles += primTriangles(p);
    }
  }
  return {
    triangles,
    primitives,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    textureBytes: root.listTextures().reduce((s, t) => s + (t.getImage()?.byteLength ?? 0), 0),
  };
}

function primTriangles(p: Primitive): number {
  const count = p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0;
  return p.getMode() === 4 ? count / 3 : Math.max(0, count - 2);
}

/**
 * Simplifies one triangle primitive with meshoptimizer's permissive mode, which may collapse edges
 * across UV and normal seams. Many source objects are flat-shaded or seam-heavy, and the default
 * mode cannot reduce them at all. `ratio` is the target fraction of triangles; `error` is the
 * largest allowed deviation as a fraction of the primitive's size.
 */
function simplifyPermissive(doc: Document, prim: Primitive, ratio: number, error: number) {
  const position = prim.getAttribute('POSITION');
  const srcIndices = prim.getIndices();
  if (!position || !srcIndices) return;
  const positions = position.getArray();
  if (!(positions instanceof Float32Array)) return;
  const indices = new Uint32Array(srcIndices.getArray()!);
  const target = Math.floor((ratio * indices.length) / 3) * 3;
  const [dst] = MeshoptSimplifier.simplify(indices, positions, 3, target, error, ['Permissive', 'Prune']);
  if (dst.length === 0 || dst.length >= indices.length) return;
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(dst)).setBuffer(srcIndices.getBuffer()));
  if (srcIndices.listParents().length <= 1) srcIndices.dispose();
  compactPrimitive(prim);
}

/**
 * Vertices of the triangles whose centroid lies inside `box`, when no triangle outside the box
 * shares them (so the frame around a handle is never bent).
 */
function handleVertices(prim: Primitive, box: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }): Set<number> {
  const pos = prim.getAttribute('POSITION')!;
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : pos.getCount();
  const tris: [number, number, number][] = [];
  const outside = new Set<number>();
  const a: number[] = [0, 0, 0];
  for (let t = 0; t < count; t += 3) {
    const ids = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k)) as [number, number, number];
    let cx = 0, cy = 0, cz = 0;
    for (const i of ids) {
      pos.getElement(i, a);
      cx += a[0]! / 3; cy += a[1]! / 3; cz += a[2]! / 3;
    }
    const hit = cx >= box.minX && cx <= box.maxX && cy >= box.minY && cy <= box.maxY && cz >= box.minZ && cz <= box.maxZ;
    if (hit) tris.push(ids);
    else for (const i of ids) outside.add(i);
  }
  // Drop any selected triangle that shares a vertex with the frame, until none do, so nothing stretches.
  let selected = tris;
  for (let changed = true; changed; ) {
    changed = false;
    const keep: [number, number, number][] = [];
    for (const tri of selected) {
      if (tri.some((i) => outside.has(i))) {
        for (const i of tri) outside.add(i);
        changed = true;
      } else keep.push(tri);
    }
    selected = keep;
  }
  return new Set(selected.flat());
}

function findRootNode(scene: Scene): Node {
  let found: Node | null = null;
  scene.traverse((n) => {
    if (!found && n.getName() === 'RootNode') found = n;
  });
  if (!found) throw new Error('No "RootNode" in source; check the export');
  return found;
}

/** World-space top (max y) of every primitive using one of the given materials. */
function floorTop(scene: Scene, materials: string[], pick: 'highest' | 'lowest'): number {
  const tops: number[] = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (!materials.includes(prim.getMaterial()?.getName() ?? '')) continue;
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const v: number[] = [0, 0, 0];
      let top = -Infinity;
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const y = m[1] * v[0]! + m[5] * v[1]! + m[9] * v[2]! + m[13];
        top = Math.max(top, y);
      }
      tops.push(top);
    }
  });
  if (!tops.length) throw new Error(`No primitives use floor materials ${materials.join(', ')}`);
  return pick === 'highest' ? Math.max(...tops) : Math.min(...tops);
}

async function optimise(config: ModelConfig) {
  const started = Date.now();
  const src = path.join(ROOT, config.source);
  const out = path.join(ROOT, config.output);
  console.log(`\n== ${config.id}: ${config.source}`);
  const doc = await io.read(src);
  const before = collectStats(doc);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
  const rootNode = findRootNode(scene);

  // 1. Classify every mesh node by its top-level object.
  const topOf = new Map<Node, string>();
  const groupOf = new Map<string, Group>();
  const structure = new Set(config.structure);
  for (const top of rootNode.listChildren()) {
    const name = top.getName();
    if (config.drop.includes(name)) {
      top.traverse((n) => n.dispose());
      continue;
    }
    let group: Group = structure.has(name) ? 'structure' : 'furnishing';
    if (group === 'furnishing' && config.interior) {
      const b = getBounds(top);
      const i = config.interior;
      const t = INTERIOR_TOLERANCE;
      if (b.min[0] < i.minX - t || b.max[0] > i.maxX + t || b.min[2] < i.minZ - t || b.max[2] > i.maxZ + t) group = 'exterior';
    }
    groupOf.set(name, group);
    top.traverse((n) => {
      if (n.getMesh()) topOf.set(n, name);
    });
  }
  for (const name of config.structure) if (!groupOf.has(name)) console.warn(`  structure node "${name}" not found`);

  // 1b. Repaint selected primitives as self-lit surfaces (each gets its own material copy).
  for (const rule of config.selfLit ?? []) {
    let painted = 0;
    for (const top of rootNode.listChildren()) {
      if (top.getName() !== rule.node) continue;
      top.traverse((n) => {
        for (const prim of n.getMesh()?.listPrimitives() ?? []) {
          const mat = prim.getMaterial();
          if (mat?.getName() !== rule.material) continue;
          const lit = mat.clone().setName(`${rule.material} (self-lit)`).setBaseColorFactor([0, 0, 0, 1]).setEmissiveFactor(rule.color).setRoughnessFactor(1).setMetallicFactor(0);
          prim.setMaterial(lit);
          painted++;
        }
      });
    }
    console.log(`  self-lit ${rule.node}/${rule.material}: ${painted} primitive(s)`);
  }

  // 2. Normalise: metres, origin at the floor centre, y = 0 on the main floor.
  const k = config.scale;
  const structureBounds = (() => {
    if (config.interior) return config.interior;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const top of rootNode.listChildren()) {
      if (groupOf.get(top.getName()) !== 'structure') continue;
      const b = getBounds(top);
      minX = Math.min(minX, b.min[0]); maxX = Math.max(maxX, b.max[0]);
      minZ = Math.min(minZ, b.min[2]); maxZ = Math.max(maxZ, b.max[2]);
    }
    return { minX, maxX, minZ, maxZ };
  })();
  const cx = (structureBounds.minX + structureBounds.maxX) / 2;
  const cz = (structureBounds.minZ + structureBounds.maxZ) / 2;
  const fy = config.floorY ?? floorTop(scene, config.floorMaterials, config.floorLevel);
  console.log(`  source origin: x ${cx.toFixed(4)}, floor y ${fy.toFixed(4)}, z ${cz.toFixed(4)}; scale ${k.toFixed(6)}`);
  const wrapper = doc.createNode('Normalise').setScale([k, k, k]).setTranslation([-cx * k, -fy * k, -cz * k]);
  for (const child of scene.listChildren()) wrapper.addChild(child);
  scene.addChild(wrapper);

  // 3. Flatten the hierarchy and regroup.
  await doc.transform(flatten());
  const groups = Object.fromEntries(
    (Object.keys(GROUPS) as Group[]).map((g) => [g, doc.createNode(GROUPS[g])]),
  ) as Record<Group, Node>;
  for (const node of [...scene.listChildren()]) {
    node.traverse((n) => {
      if (!n.getMesh()) return;
      const g = groupOf.get(topOf.get(n) ?? '') ?? 'furnishing';
      groups[g].addChild(n);
    });
  }
  for (const child of [...scene.listChildren()]) scene.removeChild(child);
  for (const g of Object.values(groups)) if (g.listChildren().length) scene.addChild(g);
  for (const g of Object.values(groups)) for (const n of g.listChildren()) clearNodeTransform(n);

  // 3b. Swing doors open (vertices are now in normalised world space).
  for (const door of config.openDoors ?? []) {
    const t = (door.angleDeg * Math.PI) / 180;
    const [hx, hz] = door.hinge;
    const rotate = (x: number, z: number): [number, number] => {
      const dx = x - hx;
      const dz = z - hz;
      return [hx + dx * Math.cos(t) + dz * Math.sin(t), hz - dx * Math.sin(t) + dz * Math.cos(t)];
    };
    const rotateDir = (x: number, z: number): [number, number] => [x * Math.cos(t) + z * Math.sin(t), -x * Math.sin(t) + z * Math.cos(t)];
    let leaf = 0;
    let handle = 0;
    for (const g of Object.values(groups)) {
      for (const n of g.listChildren()) {
        if (topOf.get(n) !== door.node) continue;
        for (const prim of n.getMesh()?.listPrimitives() ?? []) {
          const mat = prim.getMaterial()?.getName();
          const pos = prim.getAttribute('POSITION');
          const nor = prim.getAttribute('NORMAL');
          if (!pos) continue;
          let move: Set<number>;
          if (mat === door.leafMaterial) {
            move = new Set(Array.from({ length: pos.getCount() }, (_, i) => i));
          } else if (mat === door.handleMaterial) {
            move = handleVertices(prim, door.handleBox);
          } else continue;
          const v: number[] = [0, 0, 0];
          for (const i of move) {
            pos.getElement(i, v);
            const [x, z] = rotate(v[0]!, v[2]!);
            pos.setElement(i, [x, v[1]!, z]);
            if (nor) {
              nor.getElement(i, v);
              const [nx, nz] = rotateDir(v[0]!, v[2]!);
              nor.setElement(i, [nx, v[1]!, nz]);
            }
          }
          if (mat === door.leafMaterial) leaf += move.size;
          else handle += move.size;
        }
      }
    }
    console.log(`  opened ${door.node}: ${leaf} leaf and ${handle} handle vertices rotated ${door.angleDeg}°`);
  }

  // 4. Weld, then simplify per rule.
  await doc.transform(dedup(), weld());
  const ruleFor = (top: string) => config.simplify.find((r) => r.nodes.includes(top)) ?? config.defaultSimplify;
  const seen = new Set<Primitive>();
  const perTop = new Map<string, { before: number; after: number }>();
  for (const g of Object.values(groups)) {
    for (const n of g.listChildren()) {
      const top = topOf.get(n) ?? '';
      const rule = ruleFor(top);
      const tally = perTop.get(top) ?? { before: 0, after: 0 };
      perTop.set(top, tally);
      for (const prim of n.getMesh()?.listPrimitives() ?? []) {
        if (seen.has(prim) || prim.getMode() !== 4) continue;
        seen.add(prim);
        tally.before += primTriangles(prim);
        if (rule.ratio < 1) {
          simplifyPermissive(doc, prim, rule.ratio, rule.error);
        }
        tally.after += primTriangles(prim);
      }
    }
  }
  for (const [top, t] of [...perTop].sort((a, b) => b[1].after - a[1].after)) {
    if (t.before > SIMPLIFY_REPORT_MIN_TRIANGLES) console.log(`  simplify ${top}: ${fmt(t.before)} → ${fmt(t.after)}`);
  }

  // 5. Join by material inside each group, then clean up.
  await doc.transform(join(), prune(), dedup());

  // 6. Textures: resize and convert to WebP.
  const webp = doc.createExtension(EXTTextureWebP).setRequired(true);
  for (const texture of doc.getRoot().listTextures()) {
    const uri = texture.getURI() || texture.getName();
    const maxSize = config.textures.find((r) => r.pattern.test(uri))?.maxSize ?? config.defaultTextureSize;
    const image = texture.getImage();
    const size = image ? ImageUtils.getSize(image, texture.getMimeType()) : null;
    await compressTexture(texture, { targetFormat: 'webp', resize: [maxSize, maxSize] });
    const after = texture.getImage();
    const newSize = after ? ImageUtils.getSize(after, texture.getMimeType()) : null;
    console.log(`  texture ${uri}: ${size?.join('×')} → ${newSize?.join('×')} (${kb(image?.byteLength)} → ${kb(after?.byteLength)})`);
  }
  if (!doc.getRoot().listTextures().some((t) => t.getMimeType() === 'image/webp')) webp.dispose();

  // 7. Compress geometry.
  await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  await mkdir(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  const after = collectStats(doc);
  const bytes = (await stat(out)).size;
  const finalBounds = getBounds(scene);

  console.log(`  triangles ${fmt(before.triangles)} → ${fmt(after.triangles)}`);
  console.log(`  primitives (draw calls) ${before.primitives} → ${after.primitives}; meshes ${before.meshes} → ${after.meshes}`);
  console.log(`  materials ${before.materials} → ${after.materials}; textures ${before.textures} → ${after.textures}`);
  console.log(`  texture bytes ${mb(before.textureBytes)} → ${mb(after.textureBytes)}`);
  console.log(`  output ${path.relative(ROOT, out)}: ${mb(bytes)}`);
  console.log(`  bounds min ${finalBounds.min.map((v) => v.toFixed(2)).join(', ')} max ${finalBounds.max.map((v) => v.toFixed(2)).join(', ')}`);
  for (const g of Object.values(groups)) {
    if (!g.listChildren().length) continue;
    const b = getBounds(g);
    let t = 0;
    for (const n of g.listChildren()) for (const p of n.getMesh()?.listPrimitives() ?? []) t += primTriangles(p);
    console.log(`  group ${g.getName()}: ${g.listChildren().length} nodes, ${fmt(t)} triangles, bounds ${b.min.map((v) => v.toFixed(2)).join(',')} → ${b.max.map((v) => v.toFixed(2)).join(',')}`);
  }
  console.log(`  done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
function kb(n = 0): string {
  return `${(n / 1024).toFixed(0)} KB`;
}
function mb(n: number): string {
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
