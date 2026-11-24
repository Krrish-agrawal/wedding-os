import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DesignFormSchema, MAX_REFERENCE_IMAGES } from '@ave/shared';
import type { FlagService } from '../flags.js';
import { isValidWeddingId } from '../store.js';
import type { DesignService } from './jobs.js';
import type { ImageService } from '../storage/types.js';

/**
 * Design routes. The workspace-ownership hook in routes.ts already guards every /api/wedding/:id/... request; these are
 * also behind the `studio.ai_design` flag. Bodies are validated with zod.
 */

const GenerateBody = z.object({
  form: DesignFormSchema,
  venueId: z.string().min(1).max(60).optional(),
  imageIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(MAX_REFERENCE_IMAGES).default([]),
});

export function registerDesignRoutes(app: FastifyInstance, deps: { design: DesignService; images: ImageService | null; flags: FlagService }): void {
  const { design, images, flags } = deps;

  app.addHook('preHandler', async (req, reply) => {
    if (!/^\/api\/wedding\/[^/?]+\/design(?:\/|\?|$)/.test(req.url)) return;
    await flags.refresh();
    if (!flags.isEnabled('studio.ai_design')) return reply.code(403).send({ error: 'AI design is switched off right now.', code: 'feature_disabled' });
  });

  type P = { Params: { id: string } };
  const ok = (id: string, reply: FastifyReply) => (isValidWeddingId(id) ? true : (void reply.code(400).send({ error: 'Invalid wedding id' }), false));

  app.get<P>('/api/wedding/:id/design/status', async (req, reply) => {
    if (!ok(req.params.id, reply)) return;
    return { ...design.status(), flagEnabled: true };
  });

  app.post<P>('/api/wedding/:id/design/generate', async (req, reply) => {
    if (!ok(req.params.id, reply)) return;
    const b = GenerateBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Send { form, venueId?, imageIds }.', code: 'bad_request' });
    if (b.data.imageIds.length > 0) {
      if (!images) return reply.code(503).send({ error: 'Image storage is not ready on this server.', code: 'storage_unavailable' });
      const owned = new Set(images.list(req.params.id).map((m) => m.id));
      if (b.data.imageIds.some((i) => !owned.has(i)) || new Set(b.data.imageIds).size !== b.data.imageIds.length) return reply.code(400).send({ error: 'One of the photographs is not part of this wedding. Upload it again.', code: 'unknown_image' });
    }
    const r = design.startGenerate(req.params.id, b.data);
    return r.ok ? reply.code(202).send({ job: r.job }) : reply.code(r.status).send({ error: r.message, code: r.code });
  });

  app.post<P>('/api/wedding/:id/design/another', async (req, reply) => {
    if (!ok(req.params.id, reply)) return;
    const r = design.startAnother(req.params.id);
    return r.ok ? reply.code(202).send({ job: r.job }) : reply.code(r.status).send({ error: r.message, code: r.code });
  });

  app.get<{ Params: { id: string; jobId: string } }>('/api/wedding/:id/design/jobs/:jobId', async (req, reply) => {
    if (!ok(req.params.id, reply)) return;
    const j = design.get(req.params.id, req.params.jobId);
    return j ? { job: j } : reply.code(404).send({ error: 'No such job.', code: 'not_found' });
  });

  app.post<{ Params: { id: string; jobId: string } }>('/api/wedding/:id/design/jobs/:jobId/cancel', async (req, reply) => {
    if (!ok(req.params.id, reply)) return;
    const j = design.cancel(req.params.id, req.params.jobId);
    return j ? { job: j } : reply.code(404).send({ error: 'No such job.', code: 'not_found' });
  });
}
