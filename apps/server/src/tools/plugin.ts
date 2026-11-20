import type { FastifyPluginAsync } from 'fastify';
import { simRoutes } from '../agent/routes.js';
import type { ToolDeps } from './context.js';
import { directorRoutes } from './director.js';
import { httpToolRoutes } from './http.js';
import { mcpRoutes } from './mcp.js';

export interface ToolsPluginOptions {
  /** Test seam: replace live routing, report delivery or the clock. */
  deps?: Partial<ToolDeps>;
}

/**
 * Tools workstream: MCP endpoint at /mcp (primary), Agora custom HTTP tools at /tools/:name (fallback),
 * the Studio tool console and the simulated advisor.
 */
export const toolsPlugin: FastifyPluginAsync<ToolsPluginOptions> = async (app, opts) => {
  // The engine's HTTP tool requests may arrive with an unexpected content type; read any body as JSON
  // when possible. Scoped to this plugin's routes only.
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      done(null, {});
    }
  });

  await app.register(mcpRoutes, { deps: opts.deps });
  await app.register(httpToolRoutes, { deps: opts.deps });
  await app.register(directorRoutes, { deps: opts.deps });
  await app.register(simRoutes, { deps: opts.deps });
};
