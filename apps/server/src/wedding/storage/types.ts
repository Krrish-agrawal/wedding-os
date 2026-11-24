/** Contract between the upload layer and everything that reads reference images (vision, routes). Blobs never enter WeddingState. */

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];

export interface StoredImageMeta {
  /** Unguessable id, `[A-Za-z0-9_-]{1,64}`. The original filename is never kept. */
  id: string;
  weddingId: string;
  /** Detected from the file's magic bytes, not from the client's header. */
  mime: ImageMime;
  bytes: number;
  sha256: string;
  createdAt: number;
  expiresAt: number;
}

export type UploadResult = { ok: true; meta: StoredImageMeta } | { ok: false; status: 400 | 409 | 413 | 415 | 429; code: 'too_large' | 'bad_type' | 'too_many' | 'empty' | 'storage_full' | 'unreadable'; message: string };

/** Every method is scoped to one wedding: an image of another wedding is simply not found. */
export interface ImageService {
  upload(weddingId: string, data: Buffer, declaredMime?: string): Promise<UploadResult>;
  list(weddingId: string): StoredImageMeta[];
  read(weddingId: string, id: string): Promise<{ meta: StoredImageMeta; data: Buffer } | null>;
  /** A copy for the vision model: downscaled so the longest side is at most 1024 px where the platform allows, as a data URL. */
  readForModel(weddingId: string, id: string): Promise<{ mime: ImageMime; dataUrl: string } | null>;
  delete(weddingId: string, id: string): Promise<boolean>;
  deleteAll(weddingId: string): Promise<number>;
  /** Removes images past their retention. Returns how many. */
  sweep(): Promise<number>;
}

export interface ImageLimits { maxFiles: number; maxBytesPerFile: number; maxTotalBytes: number; retentionHours: number }
export const DEFAULT_IMAGE_LIMITS: ImageLimits = { maxFiles: 6, maxBytesPerFile: 6 * 1024 * 1024, maxTotalBytes: 24 * 1024 * 1024, retentionHours: 24 };
