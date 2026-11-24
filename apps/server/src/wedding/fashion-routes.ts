import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GARMENTS, TRYON_DISCLAIMER } from '@ave/shared';
import { isValidWeddingId, type WeddingStore } from './store.js';
import { tryOnRequestsFor } from './tryon-requests.js';

/**
 * Routes the Virtual Try-On page uses to pick up planner requests and report back. No photo or image ever
 * passes through these: they carry garment ids and a short status message only.
 */
export function registerFashionRoutes(app: FastifyInstance, deps: { store: WeddingStore }): void {
  const reg = tryOnRequestsFor(deps.store);

  app.get('/api/garments', async () => ({ disclaimer: TRYON_DISCLAIMER, garments: GARMENTS }));

  app.get<{ Params: { id: string } }>('/api/wedding/:id/tryon-requests', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    return { requests: reg.pending(req.params.id) };
  });

  const Done = z.object({ status: z.enum(['generated', 'failed']), message: z.string().max(300).nullable().optional() });
  app.post<{ Params: { id: string; rid: string } }>('/api/wedding/:id/tryon-requests/:rid/complete', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    const b = Done.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Send { status: "generated" | "failed", message? }.' });
    const r = reg.complete(req.params.id, req.params.rid, b.data.status, b.data.message ?? null);
    return r ? { request: r } : reply.code(404).send({ error: 'No such pending request.' });
  });
}
