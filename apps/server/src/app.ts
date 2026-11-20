import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { AppContext } from './context.js';
import './context.js';
import { sessionRoutes } from './sessions/routes.js';
import { wsRoutes } from './sessions/ws.js';
import { voicePlugin } from './voice/plugin.js';
import { toolsPlugin } from './tools/plugin.js';
import { deskPlugin } from './desk/plugin.js';
import { devPlugin } from './dev/plugin.js';

export async function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 1024 * 1024,
  });
  app.decorate('ctx', ctx);

  await app.register(cors, { origin: [ctx.config.WEB_ORIGIN] });
  await app.register(websocket);

  await app.register(sessionRoutes);
  await app.register(wsRoutes);
  await app.register(voicePlugin);
  await app.register(toolsPlugin);
  await app.register(deskPlugin);
  if (process.env.NODE_ENV !== 'production') await app.register(devPlugin);

  return app;
}
