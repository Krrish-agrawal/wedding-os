import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { BuyerSchema, CallLanguageSchema, SessionActionSchema, ActionSourceSchema } from '@ave/shared';
import { deskFor } from '../desk/runtime.js';

/** REST routes for creating and inspecting sessions. */
export const sessionRoutes: FastifyPluginAsync = async (app) => {
  const { store } = app.ctx;

  app.post('/api/sessions', async (req, reply) => {
    const parsed = BuyerSchema.safeParse(req.body);
    const language = CallLanguageSchema.optional().safeParse((req.body as { language?: unknown } | null)?.language);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Please check your name, phone and email.', issues: parsed.error.issues });
    }
    const state = store.create(parsed.data, language.success ? language.data : undefined);
    req.log.info({ sessionId: state.id }, 'session created');
    return reply.code(201).send({ sessionId: state.id });
  });

  app.get('/api/sessions', async () => ({ sessions: store.summaries() }));

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    // Live calls are in memory; ended ones survive restarts in the Lead Desk store (so a summary link keeps working).
    const state = store.get(req.params.id) ?? deskFor(app.ctx).getState(req.params.id);
    if (!state) return reply.code(404).send({ error: 'Session not found' });
    return { state };
  });

  /** Used by the Director and tests to drive a session by hand. */
  const ActionBody = z.object({ action: SessionActionSchema, source: ActionSourceSchema.default('presenter') });
  app.post<{ Params: { id: string } }>('/api/sessions/:id/actions', async (req, reply) => {
    const parsed = ActionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid action', issues: parsed.error.issues });
    const state = store.dispatch(req.params.id, parsed.data.action, parsed.data.source);
    if (!state) return reply.code(404).send({ error: 'Session not found' });
    return { state };
  });

  app.get('/api/health', async () => ({ ok: true, features: app.ctx.features, advisorName: app.ctx.config.ADVISOR_NAME }));
};
