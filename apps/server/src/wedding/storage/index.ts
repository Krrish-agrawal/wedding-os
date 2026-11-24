import path from 'node:path';
import { VAR_DIR, type Config } from '../../config.js';
import { LocalBlobStore, S3BlobStore, type BlobStore } from './blob.js';
import { ImageServiceImpl } from './service.js';

export * from './types.js';
export * from './blob.js';
export * from './service.js';

/** Builds the image service from config. `dir` null = in-memory metadata and a throwaway local directory is not created (tests pass their own blobs). */
export function createImageService(config: Config, opts: { dir?: string | null; blobs?: BlobStore } = {}): ImageServiceImpl {
  const root = opts.dir === undefined ? VAR_DIR : opts.dir;
  const blobs = opts.blobs ?? (config.STORAGE_DRIVER === 's3'
    ? new S3BlobStore({ endpoint: config.STORAGE_ENDPOINT, bucket: config.STORAGE_BUCKET!, region: config.STORAGE_REGION, accessKeyId: config.STORAGE_ACCESS_KEY_ID!, secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY!, forcePathStyle: config.STORAGE_FORCE_PATH_STYLE === '1' })
    : new LocalBlobStore(path.join(root ?? path.join(VAR_DIR, 'tmp-images'), 'images')));
  const svc = new ImageServiceImpl({ blobs, metaFile: root ? path.join(root, 'images.json') : undefined, limits: { maxFiles: config.IMAGE_MAX_FILES, maxBytesPerFile: config.IMAGE_MAX_BYTES, retentionHours: config.IMAGE_RETENTION_HOURS } });
  svc.startSweeper();
  return svc;
}
