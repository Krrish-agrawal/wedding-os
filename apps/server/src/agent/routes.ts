import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { isProduction } from '../tools/auth.js';
import type { ToolDeps } from '../tools/context.js';
import { SimAdvisor, SimError } from './sim.js';

const MAX_MESSAGE_CHARS = 2000;
const ChatBody = z.object({ message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS), reset: z.boolean().optional() });
const DEV_ONLY = { error: 'The simulated advisor is only available in development.' };

/** Studio's simulated advisor: text chat against the real prompt and tools. Development only. */
export const simRoutes: FastifyPluginAsync<{ deps?: Partial<ToolDeps> }> = async (app, opts) => {
  const sim = new SimAdvisor(app.ctx, { deps: opts.deps, log: app.log, recordTranscript: true });

  // Forget a conversation once its call ends.
  app.ctx.store.on('change', (state, action) => {
    if (action.type === 'set_status' && state.status === 'ended') sim.reset(state.id);
  });

  app.get('/api/sim/status', async (_req, reply) => {
    if (isProduction()) return reply.code(403).send(DEV_ONLY);
    return { available: sim.available, model: app.ctx.config.LLM_MODEL };
  });

  app.post<{ Params: { sessionId: string } }>('/api/sim/:sessionId/chat', async (req, reply) => {
    if (isProduction()) return reply.code(403).send(DEV_ONLY);
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Send { "message": "..." } with some text.' });
    const { sessionId } = req.params;
    if (!app.ctx.store.get(sessionId)) return reply.code(404).send({ error: 'Session not found' });
    if (parsed.data.reset) sim.reset(sessionId);
    try {
      return await sim.chat(sessionId, parsed.data.message);
    } catch (err) {
      if (err instanceof SimError) return reply.code(err.status).send({ error: err.message });
      req.log.error({ sessionId, err: (err as Error).message }, 'sim chat failed');
      return reply.code(500).send({ error: 'The simulated advisor failed. Check the server log.' });
    }
  });

  app.delete<{ Params: { sessionId: string } }>('/api/sim/:sessionId', async (req, reply) => {
    if (isProduction()) return reply.code(403).send(DEV_ONLY);
    sim.reset(req.params.sessionId);
    return reply.code(204).send();
  });
};
