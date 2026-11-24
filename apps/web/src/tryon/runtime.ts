import type { Garment } from '@ave/shared';
import { drawGarment } from './garmentArt';
import { renderOutfitTryOn } from './engine/compositor';
import type { Accelerator, PipelineResult, WorkerRequest, WorkerResponse } from './engine/types';

/**
 * Runs the vendored in-browser try-on engine. Nothing is sent to a server: the photo is decoded, segmented and warped
 * here. Every failure surfaces as a TryOnError with a message for the customer; this module never returns an
 * image unless the engine really produced it.
 */

export const MODEL_FILES = { segmenter: '/models/selfie_segmenter.tflite', pose: '/models/movenet_singlepose_lightning.tflite' } as const;
export const WASM_PATH = '/litert-wasm/';
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_DIM = 1024;

export class TryOnError extends Error {
  constructor(message: string, readonly code: 'assets_missing' | 'engine_failed' | 'no_person' | 'bad_photo') { super(message); }
}

/** Checks a photo before it is decoded. Returns an error message or null. */
export function validatePhoto(file: { type: string; size: number }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return 'Use a JPEG, PNG or WebP photo.';
  if (file.size > MAX_PHOTO_BYTES) return `That photo is ${(file.size / 1048576).toFixed(1)} MB. The limit is 8 MB.`;
  if (file.size < 1024) return 'That file is too small to be a photo.';
  return null;
}

/** The dev server answers a missing file with the app's HTML page, so check the content type, not just the status. */
async function assetPresent(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
  } catch { return false; }
}

export async function checkEngineAssets(): Promise<string | null> {
  const [a, b, w] = await Promise.all([assetPresent(MODEL_FILES.segmenter), assetPresent(MODEL_FILES.pose), assetPresent(`${WASM_PATH}litert_wasm_internal.js`)]);
  return a && b && w ? null : 'The try-on engine files are not installed on this server. An administrator needs to run "pnpm --filter @ave/web tryon:setup". No preview can be made until then.';
}

export interface PreparedPhoto { bitmap: ImageBitmap; width: number; height: number }

/** Decodes and downsizes a photo to at most 1024 px on its longest side. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bad = validatePhoto(file);
  if (bad) throw new TryOnError(bad, 'bad_photo');
  let src: ImageBitmap;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new TryOnError('That file could not be read as an image.', 'bad_photo'); }
  const k = Math.min(1, MAX_DIM / Math.max(src.width, src.height));
  if (k === 1) return { bitmap: src, width: src.width, height: src.height };
  const w = Math.round(src.width * k), h = Math.round(src.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(src, 0, 0, w, h);
  src.close();
  return { bitmap: await createImageBitmap(c), width: w, height: h };
}

export class TryOnEngine {
  private worker: Worker | null = null;
  private ready: Promise<Accelerator> | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: PipelineResult) => void; reject: (e: Error) => void }>();

  /** Starts the worker and loads both models. Safe to call repeatedly. */
  start(): Promise<Accelerator> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const missing = await checkEngineAssets();
      if (missing) throw new TryOnError(missing, 'assets_missing');
      const worker = new Worker(new URL('./engine/inference.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      return await new Promise<Accelerator>((resolve, reject) => {
        const fail = (m: string) => reject(new TryOnError(`The try-on engine failed to start: ${m}`, 'engine_failed'));
        worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
          const msg = e.data;
          if (msg.type === 'ready') resolve(msg.backend);
          else if (msg.type === 'result') { const p = this.pending.get(msg.seq); this.pending.delete(msg.seq); p?.resolve({ keypoints: msg.keypoints, maskBitmap: msg.maskBitmap, timings: msg.timings }); }
          else if (msg.seq !== undefined) { const p = this.pending.get(msg.seq); this.pending.delete(msg.seq); p?.reject(new TryOnError(msg.message, 'engine_failed')); }
          else fail(msg.message);
        };
        worker.onerror = (e) => fail(e.message || 'the worker crashed');
        const init: WorkerRequest = { type: 'init', wasmPath: WASM_PATH, modelPaths: MODEL_FILES, accelerator: 'webgpu' };
        worker.postMessage(init);
      });
    })();
    this.ready.catch(() => { this.dispose(); });
    return this.ready;
  }

  private analyse(bitmap: ImageBitmap): Promise<PipelineResult> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new TryOnError('The engine is not running.', 'engine_failed'));
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      worker.postMessage({ type: 'process', bitmap, seq } satisfies WorkerRequest, [bitmap]);
    });
  }

  /** Warps the garment illustration onto the photo. Throws TryOnError rather than returning anything fake. */
  async generate(photo: PreparedPhoto, garment: Garment): Promise<HTMLCanvasElement> {
    if (!garment.supported) throw new TryOnError(`${garment.name} is a future option and cannot be tried on.`, 'engine_failed');
    await this.start();
    const forWorker = await createImageBitmap(photo.bitmap);
    let result: PipelineResult;
    try { result = await this.analyse(forWorker); } catch (e) { throw e instanceof TryOnError ? e : new TryOnError(String((e as Error).message), 'engine_failed'); }
    const art = drawGarment(garment);
    const out = document.createElement('canvas');
    out.width = photo.width; out.height = photo.height;
    const ctx = out.getContext('2d')!;
    const status = renderOutfitTryOn(ctx, {
      frame: photo.bitmap, maskBitmap: result.maskBitmap, keypoints: result.keypoints,
      top: { image: art, anchors: garment.anchors as never, hemLength: garment.hemLength, sleeves: garment.sleeves, hemFlare: garment.hemFlare },
    });
    result.maskBitmap.close();
    if (status !== 'ok') throw new TryOnError('We could not find your shoulders and hips clearly enough in this photo. Use a full-length, front-facing photo with your whole body visible.', 'no_person');
    return out;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const p of this.pending.values()) p.reject(new TryOnError('The engine was stopped.', 'engine_failed'));
    this.pending.clear();
  }
}
