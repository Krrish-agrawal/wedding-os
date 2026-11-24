import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BlobStore } from './blob.js';
import { DEFAULT_IMAGE_LIMITS, type ImageLimits, type ImageMime, type ImageService, type StoredImageMeta, type UploadResult } from './types.js';

/** The model path refuses anything bigger than this (cost and latency); smaller images are passed through unchanged. */
export const MODEL_MAX_BYTES = 6 * 1024 * 1024;
export const MODEL_MAX_SIDE = 1024;

/** File type from the first bytes. The client's declared type is never trusted. */
export function sniffMime(b: Buffer): ImageMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Pixel size read from headers (no decoding). Null when it cannot be read. */
export function imageSize(b: Buffer, mime: ImageMime): { width: number; height: number } | null {
  try {
    if (mime === 'image/png') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1]!;
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
      return null;
    }
    const fmt = b.toString('ascii', 12, 16);
    if (fmt === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (fmt === 'VP8L') { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    if (fmt === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  } catch { /* unreadable */ }
  return null;
}

interface Options { blobs: BlobStore; limits?: Partial<ImageLimits>; /** JSON metadata file; omit for in-memory. */ metaFile?: string; now?: () => number }

export class ImageServiceImpl implements ImageService {
  private readonly metas = new Map<string, StoredImageMeta>();
  private readonly limits: ImageLimits;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly o: Options) {
    this.limits = { ...DEFAULT_IMAGE_LIMITS, ...o.limits };
    this.now = o.now ?? Date.now;
    if (o.metaFile) {
      try { for (const m of JSON.parse(fs.readFileSync(o.metaFile, 'utf8')) as StoredImageMeta[]) this.metas.set(m.id, m); } catch { /* none yet */ }
    }
  }

  get blobKind() { return this.o.blobs.kind; }
  get imageLimits(): Readonly<ImageLimits> { return this.limits; }
  signedUrl(key: string, ttl: number) { return this.o.blobs.signedUrl?.(key, ttl); }

  /** Sweeps expired images every `everyMs`. The timer never keeps the process alive. */
  startSweeper(everyMs = 10 * 60_000) { this.timer ??= setInterval(() => void this.sweep(), everyMs); this.timer.unref(); }
  stopSweeper() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private persist() {
    if (!this.o.metaFile) return;
    try {
      fs.mkdirSync(path.dirname(this.o.metaFile), { recursive: true });
      const tmp = `${this.o.metaFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify([...this.metas.values()]), { mode: 0o600 });
      fs.renameSync(tmp, this.o.metaFile);
    } catch { /* best effort */ }
  }

  async upload(weddingId: string, data: Buffer, _declaredMime?: string): Promise<UploadResult> {
    await this.sweep();
    if (data.length === 0) return { ok: false, status: 400, code: 'empty', message: 'That file is empty.' };
    if (data.length > this.limits.maxBytesPerFile) return { ok: false, status: 413, code: 'too_large', message: `Each photo can be up to ${Math.round(this.limits.maxBytesPerFile / 1048576)} MB.` };
    const mime = sniffMime(data);
    if (!mime) return { ok: false, status: 415, code: 'bad_type', message: 'Only JPEG, PNG and WebP photographs are accepted.' };
    const mine = this.list(weddingId);
    if (mine.length >= this.limits.maxFiles) return { ok: false, status: 409, code: 'too_many', message: `You can add up to ${this.limits.maxFiles} photographs. Remove one first.` };
    if (mine.reduce((n, m) => n + m.bytes, 0) + data.length > this.limits.maxTotalBytes) return { ok: false, status: 413, code: 'too_large', message: 'Those photographs are too large in total. Remove one or use smaller files.' };
    const id = randomBytes(18).toString('base64url');
    const t = this.now();
    const meta: StoredImageMeta = { id, weddingId, mime, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), createdAt: t, expiresAt: t + this.limits.retentionHours * 3_600_000 };
    try { await this.o.blobs.put(id, data, mime); } catch { return { ok: false, status: 409, code: 'storage_full', message: 'The photograph could not be stored. Try again.' }; }
    this.metas.set(id, meta);
    this.persist();
    return { ok: true, meta };
  }

  list(weddingId: string): StoredImageMeta[] {
    const t = this.now();
    return [...this.metas.values()].filter((m) => m.weddingId === weddingId && m.expiresAt > t).sort((a, b) => a.createdAt - b.createdAt);
  }

  private own(weddingId: string, id: string): StoredImageMeta | null {
    const m = this.metas.get(id);
    return m && m.weddingId === weddingId && m.expiresAt > this.now() ? m : null;
  }

  async read(weddingId: string, id: string) {
    const meta = this.own(weddingId, id);
    if (!meta) return null;
    const data = await this.o.blobs.get(id);
    return data ? { meta, data } : null;
  }

  /**
   * LIMITATION: no image library is a dependency of the server, so photographs are NOT downscaled. Images whose longest side is
   * at most MODEL_MAX_SIDE (or whose size cannot be read but is small) are passed through; larger ones are still sent as long as
   * they are under MODEL_MAX_BYTES, because the vision request uses `detail: "low"`, which makes the provider resize them.
   */
  async readForModel(weddingId: string, id: string) {
    const r = await this.read(weddingId, id);
    if (!r || r.data.length > MODEL_MAX_BYTES) return null;
    return { mime: r.meta.mime, dataUrl: `data:${r.meta.mime};base64,${r.data.toString('base64')}` };
  }

  async delete(weddingId: string, id: string) {
    const m = this.own(weddingId, id) ?? (this.metas.get(id)?.weddingId === weddingId ? this.metas.get(id)! : null);
    if (!m) return false;
    this.metas.delete(id);
    this.persist();
    await this.o.blobs.delete(id).catch(() => undefined);
    return true;
  }

  async deleteAll(weddingId: string) {
    const ids = [...this.metas.values()].filter((m) => m.weddingId === weddingId).map((m) => m.id);
    for (const id of ids) await this.delete(weddingId, id);
    return ids.length;
  }

  async sweep() {
    const t = this.now();
    const dead = [...this.metas.values()].filter((m) => m.expiresAt <= t);
    for (const m of dead) { this.metas.delete(m.id); await this.o.blobs.delete(m.id).catch(() => undefined); }
    if (dead.length) this.persist();
    return dead.length;
  }
}
