import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { toolTestContext } from '../tools/testkit.js';
import { buildApp } from '../app.js';
import { WeddingStore, isValidWeddingId } from './store.js';

const tmp: string[] = [];
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wedding-'));
  tmp.push(d);
  return d;
};
afterEach(() => {
  while (tmp.length) fs.rmSync(tmp.pop()!, { recursive: true, force: true });
});

describe('store', () => {
  it('rejects unsafe ids', () => {
    for (const bad of ['../x', 'a/b', '', 'x'.repeat(65), 'a b']) expect(isValidWeddingId(bad)).toBe(false);
    expect(() => new WeddingStore().getOrCreate('../etc')).toThrow();
  });
  it('persists accepted changes and reloads them', () => {
    const dir = tmpDir();
    const a = new WeddingStore(dir);
    a.getOrCreate('w1');
    expect(a.dispatch('w1', { type: 'set_total_budget', total: 500_000 }).ok).toBe(true);
    const b = new WeddingStore(dir);
    expect(b.getOrCreate('w1').budget.total).toBe(500_000);
    expect(b.getOrCreate('w1').rev).toBe(1);
  });
  it('does not persist or emit rejected actions', () => {
    const dir = tmpDir();
    const s = new WeddingStore(dir);
    let changes = 0;
    s.on('change', () => changes++);
    expect(s.dispatch('w1', { type: 'set_total_budget', total: -1 }).ok).toBe(false);
    expect(changes).toBe(0);
    expect(fs.existsSync(path.join(dir, 'w1.json'))).toBe(false);
  });
  it('sets aside a corrupt or mismatched file instead of trusting it', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'w1.json'), '{"nope":true}');
    const s = new WeddingStore(dir);
    expect(s.getOrCreate('w1').rev).toBe(0);
    expect(fs.readdirSync(dir).some((f) => f.includes('unreadable'))).toBe(true);
  });
});

describe('http routes', () => {
  async function app() {
    const ctx = await toolTestContext();
    return buildApp(ctx, { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: null, create: null } });
  }
  it('serves a sample workspace and meta', async () => {
    const a = await app();
    const r = await a.inject({ url: '/api/wedding/abc' });
    expect(r.statusCode).toBe(200);
    expect(r.json().state.profile.coupleNames).toContain('sample');
    const m = await a.inject({ url: '/api/wedding-meta' });
    expect(m.json()).toMatchObject({ plannerMode: 'demo' });
    expect(m.json().venues.every((v: { source: string }) => v.source === 'sample')).toBe(true);
    await a.close();
  });
  it('rejects bad ids, invalid actions (422), and server-only actions (403)', async () => {
    const a = await app();
    expect((await a.inject({ url: '/api/wedding/a.b' })).statusCode).toBe(400);
    const post = (payload: unknown) => a.inject({ method: 'POST', url: '/api/wedding/abc/actions', payload: payload as object });
    expect((await post({ type: 'set_total_budget', total: -1 })).statusCode).toBe(400);
    expect((await post({ type: 'reset_to_sample' })).statusCode).toBe(403);
    await post({ type: 'set_total_budget', total: 1000 });
    expect((await post({ type: 'set_allocations', allocations: { venue: 5000 } })).statusCode).toBe(422);
    const ok = await post({ type: 'set_allocations', allocations: { venue: 400 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().state.rev).toBe(2);
    await a.close();
  });
  it('chat updates the same state the dashboard reads', async () => {
    const a = await app();
    const c = await a.inject({ method: 'POST', url: '/api/wedding/abc/chat', payload: { message: 'budget 10 lakh' } });
    expect(c.statusCode).toBe(200);
    expect(c.json().state.budget.total).toBe(1_000_000);
    expect((await a.inject({ url: '/api/wedding/abc' })).json().state.budget.total).toBe(1_000_000);
    expect((await a.inject({ method: 'POST', url: '/api/wedding/abc/chat', payload: { message: '' } })).statusCode).toBe(400);
    await a.close();
  });
  it('reset restores the sample wedding', async () => {
    const a = await app();
    await a.inject({ method: 'POST', url: '/api/wedding/abc/chat', payload: { message: 'budget 10 lakh' } });
    const r = await a.inject({ method: 'POST', url: '/api/wedding/abc/reset' });
    expect(r.json().state.budget.total).toBe(0);
    await a.close();
  });
});

describe('studio over http, and persistence of designs', () => {
  it('scene actions work from the browser, refusals carry the reason, and a saved design survives a restart', async () => {
    const dir = tmpDir();
    const ctx = await toolTestContext();
    const a = await buildApp(ctx, { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir, create: null } });
    const post = (payload: object) => a.inject({ method: 'POST', url: '/api/wedding/studio1/actions', payload });
    expect((await post({ type: 'add_decor', id: 'm1', catalogId: 'mandap-traditional' })).statusCode).toBe(200);
    const refused = await post({ type: 'move_decor', id: 'm1', x: -40, z: 2 });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toMatch(/fit inside/i);
    expect((await post({ type: 'set_decor_color', id: 'm1', part: 'flowers', color: '#FF00AA' })).statusCode).toBe(200);
    expect((await post({ type: 'save_design', id: 'd1', name: 'Mandap only' })).statusCode).toBe(200);
    expect((await post({ type: 'undo_scene' })).statusCode).toBe(200);
    await a.close();

    const b = await buildApp(await toolTestContext(), { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir, create: null } });
    const state = (await b.inject({ url: '/api/wedding/studio1' })).json().state;
    expect(state.designs).toHaveLength(1);
    expect(state.scene.objects[0].colors).toEqual({});
    const loaded = await b.inject({ method: 'POST', url: '/api/wedding/studio1/actions', payload: { type: 'load_design', id: 'd1' } });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().state.scene.objects[0].colors).toEqual({ flowers: '#ff00aa' });
    await b.close();
  });
});
