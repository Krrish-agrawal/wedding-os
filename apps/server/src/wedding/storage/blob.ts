import fs from 'node:fs';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Raw bytes by opaque key. Keys are random ids chosen by the service, never client filenames. */
export interface BlobStore {
  readonly kind: 'local' | 's3';
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** Short-lived private link, where the backend supports it. Local storage has none: the server streams the file. */
  signedUrl?(key: string, ttlSeconds: number): Promise<string>;
}

const SAFE_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const assertKey = (k: string) => { if (!SAFE_KEY.test(k)) throw new Error('Unsafe storage key'); };

/** Files in a private directory (mode 0700), one per key, mode 0600, never served statically. */
export class LocalBlobStore implements BlobStore {
  readonly kind = 'local' as const;
  constructor(private readonly dir: string) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  private file(key: string) { assertKey(key); return path.join(this.dir, key); }
  async put(key: string, data: Buffer, _contentType?: string) { fs.writeFileSync(this.file(key), data, { mode: 0o600 }); }
  async get(key: string) { try { return fs.readFileSync(this.file(key)); } catch { return null; } }
  async delete(key: string) { fs.rmSync(this.file(key), { force: true }); }
}

export interface S3Options { endpoint?: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; forcePathStyle?: boolean }

/** S3-compatible object storage. The client is injectable so tests never touch the network. */
export class S3BlobStore implements BlobStore {
  readonly kind = 's3' as const;
  private readonly client: S3Client;
  constructor(private readonly o: S3Options, client?: S3Client) {
    this.client = client ?? new S3Client({ region: o.region, endpoint: o.endpoint, forcePathStyle: o.forcePathStyle, credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey } });
  }
  private key(k: string) { assertKey(k); return `reference-images/${k}`; }
  async put(key: string, data: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.o.bucket, Key: this.key(key), Body: data, ContentType: contentType, ServerSideEncryption: undefined, CacheControl: 'private, no-store' }));
  }
  async get(key: string) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.o.bucket, Key: this.key(key) }));
      return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
    } catch { return null; }
  }
  async delete(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.o.bucket, Key: this.key(key) })); }
  async signedUrl(key: string, ttlSeconds: number) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.o.bucket, Key: this.key(key) }), { expiresIn: ttlSeconds });
  }
}

/** In-memory blobs, for tests and for runs with no persistence directory. Nothing touches disk. */
export class MemoryBlobStore implements BlobStore {
  readonly kind = 'local' as const;
  private readonly m = new Map<string, Buffer>();
  async put(key: string, data: Buffer) { assertKey(key); this.m.set(key, Buffer.from(data)); }
  async get(key: string) { return this.m.get(key) ?? null; }
  async delete(key: string) { this.m.delete(key); }
  has(key: string) { return this.m.has(key); }
  get size() { return this.m.size; }
}
