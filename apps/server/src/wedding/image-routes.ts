import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import type { ImageServiceImpl } from './storage/service.js';
import { isValidWeddingId, type WeddingStore } from './store.js';

const publicMeta = (m: { id: string; mime: string; bytes: number; createdAt: number; expiresAt: number }) => ({ id: m.id, mime: m.mime, bytes: m.bytes, createdAt: m.createdAt, expiresAt: m.expiresAt });

/**
 * Reference-photo routes. Ownership is enforced by the workspace hook in routes.ts (every /api/wedding/:id/... request).
 * The client's filename and declared type are ignored: the type comes from the file's bytes, the name is a random id.
 */
export async function registerImageRoutes(app: FastifyInstance, deps: { images: ImageServiceImpl; store: WeddingStore }): Promise<void> {
  const { images, store } = deps;
  const lim = images.imageLimits;
  await app.register(async (scope) => {
    await scope.register(multipart, { limits: { files: 1, fields: 0, parts: 2, fileSize: lim.maxBytesPerFile } });

    scope.post<{ Params: { id: string } }>('/api/wedding/:id/images', async (req, reply) => {
      if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
      if (!req.isMultipart()) return reply.code(415).send({ error: 'Send the photo as multipart/form-data with a "file" field.', code: 'bad_type' });
      let part;
      try { part = await req.file(); } catch { return reply.code(400).send({ error: 'The upload could not be read.', code: 'unreadable' }); }
      if (!part || part.fieldname !== 'file') return reply.code(400).send({ error: 'Send the photo in a "file" field.', code: 'empty' });
      let data: Buffer;
      try { data = await part.toBuffer(); } catch { return reply.code(413).send({ error: `Each photo can be up to ${Math.round(lim.maxBytesPerFile / 1048576)} MB.`, code: 'too_large' }); }
      if (part.file.truncated) return reply.code(413).send({ error: `Each photo can be up to ${Math.round(lim.maxBytesPerFile / 1048576)} MB.`, code: 'too_large' });
      const r = await images.upload(req.params.id, data, part.mimetype);
      if (!r.ok) return reply.code(r.status).send({ error: r.message, code: r.code });
      store.dispatch(req.params.id, { type: 'set_reference_images', ids: images.list(req.params.id).map((m) => m.id) });
      return reply.code(201).send({ image: publicMeta(r.meta) });
    });
  });

  app.get<{ Params: { id: string } }>('/api/wedding/:id/images', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    return { images: images.list(req.params.id).map(publicMeta) };
  });

  app.get<{ Params: { id: string; imageId: string } }>('/api/wedding/:id/images/:imageId', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    const r = await images.read(req.params.id, req.params.imageId);
    if (!r) return reply.code(404).send({ error: 'No such image.' });
    return reply.header('content-type', r.meta.mime).header('cache-control', 'private, no-store').header('content-disposition', 'inline').header('x-content-type-options', 'nosniff').send(r.data);
  });

  app.delete<{ Params: { id: string; imageId: string } }>('/api/wedding/:id/images/:imageId', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    if (!(await images.delete(req.params.id, req.params.imageId))) return reply.code(404).send({ error: 'No such image.' });
    store.dispatch(req.params.id, { type: 'set_reference_images', ids: images.list(req.params.id).map((m) => m.id) });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/wedding/:id/images', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    const n = await images.deleteAll(req.params.id);
    store.dispatch(req.params.id, { type: 'set_reference_images', ids: [] });
    return { ok: true, deleted: n };
  });

  app.addHook('onClose', async () => images.stopSweeper());
}
