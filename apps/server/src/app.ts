import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { AppContext } from './context.js';
import './context.js';
import { sessionRoutes } from './sessions/routes.js';
import { wsRoutes } from './sessions/ws.js';
import { voicePlugin } from './voice/plugin.js';
import { toolsPlugin } from './tools/plugin.js';
import { deskPlugin, type DeskPluginOptions } from './desk/plugin.js';
import { devPlugin } from './dev/plugin.js';
import { weddingPlugin, type WeddingPluginOptions } from './wedding/routes.js';

export async function buildApp(ctx: AppContext, opts: { logger?: boolean; wedding?: WeddingPluginOptions; desk?: DeskPluginOptions } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 1024 * 1024,
  });
  app.decorate('ctx', ctx);

  const origins = [ctx.config.WEB_ORIGIN, ...ctx.config.CORS_ORIGINS.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)];
  // Explicit methods: the plugin's default allows only GET, HEAD and POST, which would block the PUT, PATCH and DELETE routes
  // when the web app is hosted on a different origin from the API.
  await app.register(cors, { origin: origins, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['content-type', 'x-workspace-token', 'x-admin-key'] });
  await app.register(websocket);

  await app.register(sessionRoutes);
  await app.register(wsRoutes);
  await app.register(voicePlugin);
  await app.register(toolsPlugin);
  await app.register(deskPlugin, opts.desk ?? {});
  await app.register(weddingPlugin, opts.wedding ?? {});
  if (process.env.NODE_ENV !== 'production') await app.register(devPlugin);

  return app;
}
