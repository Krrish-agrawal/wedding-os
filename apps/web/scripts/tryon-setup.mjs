/**
 * Prepares the in-browser try-on engine's runtime files (none are committed):
 *  - copies the LiteRT.js Wasm runtime from node_modules into public/litert-wasm/
 *  - downloads two small Google MediaPipe/TF Hub .tflite models (~3.5 MB total) into public/models/
 * Usage: pnpm --filter @ave/web tryon:setup [--force]
 * Model licences: MediaPipe selfie segmenter and MoveNet are Google models (Apache-2.0 per their model cards; check before commercial use).
 * Adapted from pravoobi/try-on tools/fetch-models.mjs and copy-litert-wasm.mjs (MIT).
 */
import { cp, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const MODELS = [
  { file: 'selfie_segmenter.tflite', url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite' },
  { file: 'movenet_singlepose_lightning.tflite', url: 'https://tfhub.dev/google/lite-model/movenet/singlepose/lightning/tflite/float16/4?lite-format=tflite' },
];
const exists = (p) => access(p).then(() => true, () => false);

await mkdir(path.join(root, 'public', 'litert-wasm'), { recursive: true });
await cp(path.join(root, 'node_modules', '@litertjs', 'core', 'wasm'), path.join(root, 'public', 'litert-wasm'), { recursive: true });
console.log('copied LiteRT wasm runtime -> public/litert-wasm/');

const dir = path.join(root, 'public', 'models');
await mkdir(dir, { recursive: true });
let failed = false;
for (const { file, url } of MODELS) {
  const dest = path.join(dir, file);
  if (!force && (await exists(dest))) { console.log(`skip ${file}`); continue; }
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`fetched ${file}`);
  } catch (e) { failed = true; console.error(`FAILED ${file}: ${e.message}`); }
}
process.exit(failed ? 1 : 0);
