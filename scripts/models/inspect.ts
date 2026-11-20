/**
 * Inspects a source glTF/GLB and prints a Markdown report: node tree, mesh, material and texture
 * stats, triangle counts per node, world bounds, up axis and scale, lights and cameras.
 *
 *   tsx scripts/models/inspect.ts <path/to/scene.gltf> [--out notes.md] [--tree-depth 3]
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getBounds, inspect } from '@gltf-transform/functions';
import { ImageUtils, type Document, type Node, type Primitive } from '@gltf-transform/core';
import { createIO } from './io.js';

const DEFAULT_TREE_DEPTH = 4;
const HEAVY_NODE_COUNT = 40;
const MAX_CHILDREN_LISTED = 400;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' }, 'tree-depth': { type: 'string' } },
});
const input = positionals[0];
if (!input) {
  console.error('usage: tsx scripts/models/inspect.ts <scene.gltf|.glb> [--out notes.md]');
  process.exit(1);
}
const treeDepth = values['tree-depth'] ? Number(values['tree-depth']) : DEFAULT_TREE_DEPTH;

const io = await createIO();
const doc = await io.read(input);
const report = buildReport(doc, input, treeDepth);
if (values.out) {
  await writeFile(values.out, report);
  console.log(`wrote ${values.out}`);
} else {
  console.log(report);
}

function primitiveTriangles(prim: Primitive): number {
  const indices = prim.getIndices();
  const position = prim.getAttribute('POSITION');
  const count = indices ? indices.getCount() : position ? position.getCount() : 0;
  switch (prim.getMode()) {
    case 4: // TRIANGLES
      return count / 3;
    case 5: // TRIANGLE_STRIP
    case 6: // TRIANGLE_FAN
      return Math.max(0, count - 2);
    default:
      return 0;
  }
}

function nodeTriangles(node: Node): number {
  const mesh = node.getMesh();
  if (!mesh) return 0;
  return mesh.listPrimitives().reduce((s, p) => s + primitiveTriangles(p), 0);
}

function subtreeTriangles(node: Node): number {
  return nodeTriangles(node) + node.listChildren().reduce((s, c) => s + subtreeTriangles(c), 0);
}

function fmt(n: number, digits = 2): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(digits);
}

function buildReport(doc: Document, file: string, depth: number): string {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('no scene');
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);

  const stats = inspect(doc);
  const totalTris = root.listNodes().reduce((s, n) => s + nodeTriangles(n), 0);
  const bounds = getBounds(scene);
  const size = bounds.max.map((v, i) => v - bounds.min[i]!);

  out(`# Inspection: ${path.basename(path.dirname(file))}`);
  out();
  out(`Source: \`${path.relative(process.cwd(), file)}\``);
  out();
  out('## Totals');
  out();
  out(`| What | Count |`);
  out(`|---|---|`);
  out(`| Nodes | ${root.listNodes().length} |`);
  out(`| Meshes | ${root.listMeshes().length} |`);
  out(`| Primitives | ${root.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0)} |`);
  out(`| Materials | ${root.listMaterials().length} |`);
  out(`| Textures | ${root.listTextures().length} |`);
  out(`| Triangles (instanced per node) | ${fmt(totalTris)} |`);
  out(`| Cameras | ${root.listCameras().length} |`);
  out(`| Extensions used | ${root.listExtensionsUsed().map((e) => e.extensionName).join(', ') || 'none'} |`);
  out();
  out('## World bounds (scene units, after all node transforms)');
  out();
  out(`- min: ${bounds.min.map((v) => fmt(v, 3)).join(', ')}`);
  out(`- max: ${bounds.max.map((v) => fmt(v, 3)).join(', ')}`);
  out(`- size (x, y, z): ${size.map((v) => fmt(v, 3)).join(' × ')}`);
  out();

  out('## Root transforms');
  out();
  for (const n of scene.listChildren()) {
    let cur: Node | undefined = n;
    let level = 0;
    while (cur && level < 4) {
      out(`- ${'  '.repeat(level)}\`${cur.getName()}\` matrix=[${cur.getMatrix().map((v) => fmt(v, 4)).join(', ')}]`);
      const kids: Node[] = cur.listChildren();
      cur = kids.length === 1 ? kids[0] : undefined;
      level++;
    }
  }
  out();

  // Lights (KHR_lights_punctual) appear as an extension on nodes.
  const lights = root.listNodes().filter((n) => n.getExtension('KHR_lights_punctual'));
  out(`## Lights and cameras`);
  out();
  out(`- Punctual lights: ${lights.length}${lights.length ? ` (${lights.map((n) => n.getName()).join(', ')})` : ''}`);
  out(`- Cameras: ${root.listCameras().length}${root.listCameras().length ? ` (${root.listCameras().map((c) => c.getName()).join(', ')})` : ''}`);
  out();

  out('## Materials');
  out();
  out('| Material | Double-sided | Alpha | Base colour tex | Normal | MR | Emissive | Factor |');
  out('|---|---|---|---|---|---|---|---|');
  for (const m of root.listMaterials()) {
    const tex = (t: ReturnType<typeof m.getBaseColorTexture>) => (t ? `${t.getName() || t.getURI()}` : '');
    out(
      `| ${m.getName()} | ${m.getDoubleSided() ? 'yes' : 'no'} | ${m.getAlphaMode()} | ${tex(m.getBaseColorTexture())} | ${m.getNormalTexture() ? 'yes' : ''} | ${m.getMetallicRoughnessTexture() ? 'yes' : ''} | ${m.getEmissiveTexture() ? 'tex' : m.getEmissiveFactor().some((v) => v > 0) ? 'factor' : ''} | ${m.getBaseColorFactor().map((v) => v.toFixed(2)).join(',')} |`,
    );
  }
  out();

  out('## Textures');
  out();
  out('| Texture | MIME | Size (px) | Bytes |');
  out('|---|---|---|---|');
  let texBytes = 0;
  for (const t of root.listTextures()) {
    const img = t.getImage();
    const sz = img ? ImageUtils.getSize(img, t.getMimeType()) : null;
    texBytes += img?.byteLength ?? 0;
    out(`| ${t.getURI() || t.getName()} | ${t.getMimeType()} | ${sz ? `${sz[0]}×${sz[1]}` : '?'} | ${fmt(img?.byteLength ?? 0)} |`);
  }
  out();
  out(`Texture bytes total: ${(texBytes / 1e6).toFixed(1)} MB`);
  out();

  out(`## Heaviest nodes (top ${HEAVY_NODE_COUNT} by own triangles)`);
  out();
  out('| Node | Triangles | Mesh | Materials |');
  out('|---|---|---|---|');
  const heavy = root
    .listNodes()
    .filter((n) => n.getMesh())
    .map((n) => ({ n, t: nodeTriangles(n) }))
    .sort((a, b) => b.t - a.t)
    .slice(0, HEAVY_NODE_COUNT);
  for (const { n, t } of heavy) {
    const mats = [...new Set(n.getMesh()!.listPrimitives().map((p) => p.getMaterial()?.getName() ?? '-'))].join(', ');
    out(`| ${n.getName()} | ${fmt(t)} | ${n.getMesh()!.getName()} | ${mats} |`);
  }
  out();

  out(`## Node tree (to depth ${depth}; triangles are per subtree)`);
  out();
  let listed = 0;
  const walk = (n: Node, level: number) => {
    if (listed >= MAX_CHILDREN_LISTED) return;
    const b = n.getMesh() ? ` mesh` : '';
    out(`${'  '.repeat(level)}- ${n.getName() || '(unnamed)'}${b} — ${fmt(subtreeTriangles(n))} tris`);
    listed++;
    if (level + 1 < depth) for (const c of n.listChildren()) walk(c, level + 1);
  };
  for (const n of scene.listChildren()) walk(n, 0);
  if (listed >= MAX_CHILDREN_LISTED) out(`- … truncated at ${MAX_CHILDREN_LISTED} entries`);
  out();

  out('## gltf-transform inspect (meshes, top 30 by size)');
  out();
  const meshes = [...stats.meshes.properties].sort((a, b) => b.size - a.size).slice(0, 30);
  out('| Mesh | Vertices | GL primitives | Bytes |');
  out('|---|---|---|---|');
  for (const m of meshes) out(`| ${m.name} | ${fmt(m.vertices)} | ${fmt(m.glPrimitives)} | ${fmt(m.size)} |`);
  out();
  return lines.join('\n');
}
