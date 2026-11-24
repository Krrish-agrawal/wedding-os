import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { toolTestContext } from '../tools/testkit.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { LocalBlobStore, MemoryBlobStore, S3BlobStore } from './storage/blob.js';
import { ImageServiceImpl, imageSize, sniffMime } from './storage/service.js';
import { createImageService } from './storage/index.js';

const PNG = (extra = 100) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0, 0, 0, 1, 0x80]), Buffer.alloc(extra, 7)]);
const JPG = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const WEBP = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'), Buffer.alloc(40)]);

const multipartBody = (data: Buffer, filename = 'evil/../name.png', type = 'image/png', field = 'file') => {
  const boundary = '----t' + Math.random().toString(36).slice(2);
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
};

describe('file sniffing', () => {
  it('detects by bytes and reads sizes', () => {
    expect(sniffMime(PNG())).toBe('image/png');
    expect(sniffMime(JPG())).toBe('image/jpeg');
    expect(sniffMime(WEBP())).toBe('image/webp');
    expect(sniffMime(Buffer.from('<svg></svg>'))).toBeNull();
    expect(sniffMime(Buffer.from('GIF89a......'))).toBeNull();
    expect(imageSize(PNG(), 'image/png')).toEqual({ width: 512, height: 384 });
  });
});

describe('image service', () => {
    const make = (limits = {}, t = { now: 1_000_000 }) => { const blobs = new MemoryBlobStore(); const s = new ImageServiceImpl({ blobs, limits, now: () => t.now }); return { blobs, s, t }; };

  it('rejects spoofed types, empty, oversize and too many; accepts real images', async () => {
    const { s } = make({ maxFiles: 2, maxBytesPerFile: 1000, maxTotalBytes: 5000 });
    expect(await s.upload('w', Buffer.from('<svg onload=alert(1)>'), 'image/png')).toMatchObject({ ok: false, status: 415 });
    expect(await s.upload('w', Buffer.alloc(0))).toMatchObject({ ok: false, status: 400, code: 'empty' });
    expect(await s.upload('w', PNG(2000))).toMatchObject({ ok: false, status: 413 });
    expect((await s.upload('w', PNG())).ok).toBe(true);
    expect((await s.upload('w', JPG())).ok).toBe(true);
    expect(await s.upload('w', WEBP())).toMatchObject({ ok: false, status: 409, code: 'too_many' });
    expect((await s.upload('other', WEBP())).ok).toBe(true); // caps are per wedding
  });
  it('enforces the total size cap', async () => {
    const { s } = make({ maxTotalBytes: 300, maxBytesPerFile: 300 });
    expect((await s.upload('w', PNG(150))).ok).toBe(true);
    expect(await s.upload('w', PNG(150))).toMatchObject({ ok: false, status: 413 });
  });
  it('scopes everything to the wedding, with unguessable ids', async () => {
    const { s } = make();
    const r = await s.upload('a', PNG());
    if (!r.ok) throw new Error('upload');
    expect(r.meta.id).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(await s.read('b', r.meta.id)).toBeNull();
    expect(await s.readForModel('b', r.meta.id)).toBeNull();
    expect(await s.delete('b', r.meta.id)).toBe(false);
    expect((await s.read('a', r.meta.id))!.data.equals(PNG())).toBe(true);
    expect((await s.readForModel('a', r.meta.id))!.dataUrl).toMatch(/^data:image\/png;base64,/);
  });
  it('delete removes the blob; retention sweep removes expired images', async () => {
    const { s, blobs, t } = make({ retentionHours: 1 });
    const r = await s.upload('w', PNG());
    if (!r.ok) throw new Error('upload');
    expect(blobs.has(r.meta.id)).toBe(true);
    t.now += 59 * 60_000;
    expect(s.list('w')).toHaveLength(1);
    t.now += 2 * 60_000;
    expect(s.list('w')).toHaveLength(0);
    expect(await s.read('w', r.meta.id)).toBeNull();
    expect(await s.sweep()).toBe(1);
    expect(blobs.size).toBe(0);
    const r2 = await s.upload('w', PNG());
    if (!r2.ok) throw new Error('upload');
    expect(await s.delete('w', r2.meta.id)).toBe(true);
    expect(blobs.size).toBe(0);
  });
  it('persists metadata across restarts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));
    try {
      const blobs = new LocalBlobStore(path.join(dir, 'b'));
      const a = new ImageServiceImpl({ blobs, metaFile: path.join(dir, 'images.json') });
      const r = await a.upload('w', PNG());
      if (!r.ok) throw new Error('upload');
      const b = new ImageServiceImpl({ blobs, metaFile: path.join(dir, 'images.json') });
      expect(b.list('w').map((m) => m.id)).toEqual([r.meta.id]);
      expect(JSON.stringify(fs.readFileSync(path.join(dir, 'images.json'), 'utf8'))).not.toMatch(/evil|\.png/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('local blob store', () => {
  it('uses private permissions and random names only, and rejects unsafe keys', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blob-'));
    try {
      const b = new LocalBlobStore(path.join(dir, 'x'));
      await b.put('abc_123', Buffer.from('hi'), 'image/png');
      expect(fs.statSync(path.join(dir, 'x', 'abc_123')).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.join(dir, 'x')).mode & 0o777).toBe(0o700);
      expect(fs.readdirSync(path.join(dir, 'x'))).toEqual(['abc_123']);
      await expect(b.put('../escape', Buffer.from('x'), 'image/png')).rejects.toThrow();
      expect((await b.get('abc_123'))!.toString()).toBe('hi');
      await b.delete('abc_123');
      expect(await b.get('abc_123')).toBeNull();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('S3 blob store (mock client; NOT a real bucket)', () => {
  it('shapes put/get/delete calls and presigns a GET', async () => {
    const sent: unknown[] = [];
    const client = { send: async (c: unknown) => { sent.push(c); if (c instanceof GetObjectCommand) return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } }; return {}; }, config: { region: async () => 'auto', credentials: async () => ({ accessKeyId: 'AK', secretAccessKey: 'SK' }), endpoint: async () => ({ protocol: 'https:', hostname: 'example.r2.test', path: '/', port: undefined }), useFipsEndpoint: async () => false, useDualstackEndpoint: async () => false } } as unknown as S3Client;
    const b = new S3BlobStore({ bucket: 'bkt', region: 'auto', accessKeyId: 'AK', secretAccessKey: 'SK', endpoint: 'https://example.r2.test' }, client);
    await b.put('id1', Buffer.from('x'), 'image/png');
    expect(sent[0]).toBeInstanceOf(PutObjectCommand);
    expect((sent[0] as PutObjectCommand).input).toMatchObject({ Bucket: 'bkt', Key: 'reference-images/id1', ContentType: 'image/png' });
    expect([...(await b.get('id1'))!]).toEqual([1, 2, 3]);
    expect((sent[1] as GetObjectCommand).input).toMatchObject({ Bucket: 'bkt', Key: 'reference-images/id1' });
    await b.delete('id1');
    expect(sent[2]).toBeInstanceOf(DeleteObjectCommand);
    await expect(b.put('../x', Buffer.from('x'), 'image/png')).rejects.toThrow();
    expect(typeof b.signedUrl).toBe('function');
  });
  it('config requires every S3 variable when STORAGE_DRIVER=s3', () => {
    expect(() => loadConfig({ STORAGE_DRIVER: 's3' })).toThrow(/STORAGE_BUCKET/);
    expect(loadConfig({ STORAGE_DRIVER: 's3', STORAGE_BUCKET: 'b', STORAGE_ENDPOINT: 'https://x.test', STORAGE_ACCESS_KEY_ID: 'a', STORAGE_SECRET_ACCESS_KEY: 's' }).STORAGE_DRIVER).toBe('s3');
    expect(loadConfig({}).STORAGE_DRIVER).toBe('local');
    expect(createImageService(loadConfig({}), { dir: null, blobs: new MemoryBlobStore() }).imageLimits.maxFiles).toBe(6);
  });
});

describe('image routes', () => {
  const build = async () => buildApp(await toolTestContext(), { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: null, create: null } });
  const up = (a: Awaited<ReturnType<typeof build>>, id: string, data: Buffer, headers: Record<string, string> = {}, extra: [string?, string?, string?] = []) => {
    const m = multipartBody(data, extra[0], extra[1], extra[2]);
    return a.inject({ method: 'POST', url: `/api/wedding/${id}/images`, headers: { ...m.headers, ...headers }, payload: m.body });
  };

  it('uploads, lists, serves with private headers, and records the reference id', async () => {
    const a = await build();
    const r = await up(a, 'w1', PNG(), {}, ['../../etc/passwd.png', 'image/jpeg']);
    expect(r.statusCode).toBe(201);
    const img = r.json().image;
    expect(Object.keys(img).sort()).toEqual(['bytes', 'createdAt', 'expiresAt', 'id', 'mime']);
    expect(img.mime).toBe('image/png'); // by bytes, not the declared jpeg
    expect(JSON.stringify(r.json())).not.toMatch(/passwd|etc/);
    expect((await a.inject({ url: '/api/wedding/w1' })).json().state.design.referenceImageIds).toEqual([img.id]);
    const got = await a.inject({ url: `/api/wedding/w1/images/${img.id}` });
    expect(got.headers).toMatchObject({ 'content-type': 'image/png', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline' });
    expect(got.rawPayload.equals(PNG())).toBe(true);
    expect((await a.inject({ url: '/api/wedding/w1/images' })).json().images).toHaveLength(1);
    expect((await a.inject({ url: `/api/wedding/w2/images/${img.id}` })).statusCode).toBe(404);
    await a.close();
  });
  it('rejects bad uploads with clear codes', async () => {
    const a = await build();
    expect((await up(a, 'w1', Buffer.from('<svg/>'))).json()).toMatchObject({ code: 'bad_type' });
    expect((await up(a, 'w1', PNG(7_000_000))).statusCode).toBe(413);
    expect((await up(a, 'w1', PNG(), {}, ['a.png', 'image/png', 'other'])).statusCode).toBe(400);
    expect((await a.inject({ method: 'POST', url: '/api/wedding/w1/images', payload: { x: 1 } })).statusCode).toBe(415);
    for (let i = 0; i < 6; i++) expect((await up(a, 'w1', PNG(100 + i))).statusCode).toBe(201);
    expect((await up(a, 'w1', PNG(500))).statusCode).toBe(409);
    await a.close();
  });
  it('delete removes the image, the blob and the reference id; delete-all clears everything', async () => {
    const a = await build();
    const a1 = (await up(a, 'w1', PNG(10))).json().image.id;
    const a2 = (await up(a, 'w1', PNG(20))).json().image.id;
    expect((await a.inject({ method: 'DELETE', url: `/api/wedding/w1/images/${a1}` })).statusCode).toBe(200);
    expect((await a.inject({ url: `/api/wedding/w1/images/${a1}` })).statusCode).toBe(404);
    expect((await a.inject({ url: '/api/wedding/w1' })).json().state.design.referenceImageIds).toEqual([a2]);
    expect((await a.inject({ method: 'DELETE', url: `/api/wedding/w1/images/${a1}` })).statusCode).toBe(404);
    expect((await a.inject({ method: 'DELETE', url: '/api/wedding/w1/images' })).json().deleted).toBe(1);
    expect((await a.inject({ url: '/api/wedding/w1' })).json().state.design.referenceImageIds).toEqual([]);
    await a.close();
  });
  it('a claimed workspace needs its token for every image route', async () => {
    const a = await build();
    const token = (await a.inject({ method: 'POST', url: '/api/wedding/w1/claim' })).json().token as string;
    const h = { 'x-workspace-token': token };
    const id = (await up(a, 'w1', PNG(), h)).json().image.id;
    expect((await up(a, 'w1', PNG(9))).statusCode).toBe(401);
    expect((await up(a, 'w1', PNG(9), { 'x-workspace-token': 'wt_wrong' })).statusCode).toBe(401);
    for (const [method, url] of [['GET', '/api/wedding/w1/images'], ['GET', `/api/wedding/w1/images/${id}`], ['DELETE', `/api/wedding/w1/images/${id}`], ['DELETE', '/api/wedding/w1/images']] as const) {
      expect((await a.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
    expect((await a.inject({ url: `/api/wedding/w1/images/${id}`, headers: h })).statusCode).toBe(200);
    expect((await a.inject({ method: 'DELETE', url: `/api/wedding/w1/images/${id}`, headers: h })).statusCode).toBe(200);
    await a.close();
  });
  it('logs no photo bytes or keys', async () => {
    const lines: string[] = [];
    const ctx = await toolTestContext({ STORAGE_SECRET_ACCESS_KEY: 'super-secret-key' });
    const a = await buildApp(ctx, { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: null, create: null } });
    const spy = (a.log as unknown as { info: (...x: unknown[]) => void });
    spy.info = (...x) => lines.push(JSON.stringify(x));
    await up(a, 'w1', PNG());
    expect(lines.join('')).not.toMatch(/super-secret|iVBOR/);
    await a.close();
  });
});
