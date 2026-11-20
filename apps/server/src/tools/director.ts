import type { FastifyPluginAsync } from 'fastify';
import { TOOL_ACTIVITY } from '@ave/shared';
import { isProduction } from './auth.js';
import type { ToolDeps } from './context.js';
import { isToolName, runTool } from './runner.js';
import { toolDefinitions } from './schema.js';

const DEV_ONLY = { error: 'The tool console is only available in development.' };

/**
 * Studio tool console: runs any tool against a session exactly as the advisor would.
 * Development only; refuses when NODE_ENV is production.
 */
export const directorRoutes: FastifyPluginAsync<{ deps?: Partial<ToolDeps> }> = async (app, opts) => {
  app.get('/api/tools', async (_req, reply) => {
    if (isProduction()) return reply.code(403).send(DEV_ONLY);
    return { tools: toolDefinitions().map((t) => ({ ...t, activity: TOOL_ACTIVITY[t.name] })) };
  });

  app.post<{ Params: { id: string; name: string } }>('/api/sessions/:id/tools/:name', async (req, reply) => {
    if (isProduction()) return reply.code(403).send(DEV_ONLY);
    const { id, name } = req.params;
    if (!app.ctx.store.get(id)) return reply.code(404).send({ error: 'Session not found' });
    if (!isToolName(name)) return reply.code(404).send({ error: `There is no tool called "${name}".` });
    const started = performance.now();
    const result = await runTool(app.ctx, id, name, req.body ?? {}, { source: 'agent', via: 'director', log: req.log, deps: opts.deps });
    return { result, ms: Math.round((performance.now() - started) * 10) / 10 };
  });
};
