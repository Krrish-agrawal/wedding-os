import { buildApp } from './app.js';
import { features, loadConfig } from './config.js';
import { loadContent } from './content.js';
import { SessionStore } from './sessions/store.js';

async function main() {
  const config = loadConfig();
  const content = await loadContent();
  const store = new SessionStore();
  const app = await buildApp({ config, features: features(config), content, store });

  await app.listen({ port: config.SERVER_PORT, host: config.SERVER_HOST });
  app.log.info({ features: app.ctx.features, properties: content.properties.map((p) => p.property.id) }, 'server ready');

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
