import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { toolTestContext } from './tools/testkit.js';

describe('deployment config', () => {
  it('binds the platform PORT unless SERVER_PORT is set', () => {
    expect(loadConfig({ PORT: '10000' }).SERVER_PORT).toBe(10000);
    expect(loadConfig({ PORT: '10000', SERVER_PORT: '9000' }).SERVER_PORT).toBe(9000);
    expect(loadConfig({}).SERVER_PORT).toBe(8787);
  });
  it('allows only the configured origins, with every method the API uses', async () => {
    const app = await buildApp(await toolTestContext({ WEB_ORIGIN: 'https://wedding.example.com', CORS_ORIGINS: 'https://preview.example.com/, https://b.example.com' }), { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: null, create: null } });
    const pre = (origin: string, method: string) => app.inject({ method: 'OPTIONS', url: '/api/wedding/w1/shortlist/x', headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': 'x-workspace-token,content-type' } });
    for (const m of ['DELETE', 'PUT', 'PATCH']) {
      const r = await pre('https://preview.example.com', m);
      expect(r.headers['access-control-allow-origin']).toBe('https://preview.example.com');
      expect(String(r.headers['access-control-allow-methods'])).toContain(m);
      expect(String(r.headers['access-control-allow-headers']).toLowerCase()).toContain('x-workspace-token');
    }
    expect((await pre('https://evil.example.com', 'DELETE')).headers['access-control-allow-origin']).toBeUndefined();
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
    await app.close();
  });
});
