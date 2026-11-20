import type { Content } from '@ave/shared';
import type { Config, Features } from './config.js';
import type { SessionStore } from './sessions/store.js';

/** Everything a route or plugin needs. Passed explicitly; no globals. */
export interface AppContext {
  config: Config;
  features: Features;
  content: Content;
  store: SessionStore;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
