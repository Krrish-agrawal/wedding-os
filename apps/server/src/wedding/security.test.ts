import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolTestContext } from '../tools/testkit.js';
import { buildApp } from '../app.js';
import { ProposalStore } from './proposals.js';
import { WeddingStore } from './store.js';

const tmpBase = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wedding-sec-'));
const build = async (base: string | null) => buildApp(await toolTestContext(), { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: base ? path.join(base, 'weddings') : null, create: null } });

describe('workspace ownership (demo session)', () => {
  it('claimed workspaces need the token for every route, including confirm and cancel', async () => {
    const a = await build(null);
    const claim = await a.inject({ method: 'POST', url: '/api/wedding/w1/claim' });
    expect(claim.statusCode).toBe(200);
    const token = claim.json().token as string;
    expect((await a.inject({ method: 'POST', url: '/api/wedding/w1/claim' })).statusCode).toBe(409);
    const h = { 'x-workspace-token': token };
    const paths: [string, string][] = [['GET', '/api/wedding/w1'], ['GET', '/api/wedding/w1/proposals'], ['GET', '/api/wedding/w1/enquiries'], ['POST', '/api/wedding/w1/reset'], ['POST', '/api/wedding/w1/proposals/6f1c1f0e-3b0e-4d6e-8d0a-2f1d3a5b7c9d/confirm'], ['POST', '/api/wedding/w1/proposals/6f1c1f0e-3b0e-4d6e-8d0a-2f1d3a5b7c9d/cancel']];
    for (const [method, url] of paths) {
      expect((await a.inject({ method: method as 'GET', url })).statusCode, `${method} ${url} without token`).toBe(401);
      expect((await a.inject({ method: method as 'GET', url, headers: { 'x-workspace-token': 'wt_wrong' } })).statusCode).toBe(401);
    }
    expect((await a.inject({ method: 'POST', url: '/api/wedding/w1/chat', payload: { message: 'status' } })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: '/api/wedding/w1/voice', headers: { 'content-type': 'audio/webm' }, payload: Buffer.alloc(2000) })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: '/api/wedding/w1/actions', payload: { type: 'set_total_budget', total: 5 } })).statusCode).toBe(401);
    expect((await a.inject({ url: '/api/wedding/w1', headers: h })).statusCode).toBe(200);
    expect((await a.inject({ method: 'POST', url: '/api/wedding/w1/actions', headers: h, payload: { type: 'set_total_budget', total: 5 } })).statusCode).toBe(200);
    // Another workspace is unaffected, and its id does not grant access to w1.
    expect((await a.inject({ url: '/api/wedding/w2' })).statusCode).toBe(200);
    await a.close();
  });
  it('a proposal can only be confirmed by the owner of its workspace', async () => {
    const a = await build(null);
    const t1 = (await a.inject({ method: 'POST', url: '/api/wedding/w1/claim' })).json().token as string;
    const t2 = (await a.inject({ method: 'POST', url: '/api/wedding/w2/claim' })).json().token as string;
    const h1 = { 'x-workspace-token': t1 };
    await a.inject({ method: 'POST', url: '/api/wedding/w1/actions', headers: h1, payload: { type: 'set_total_budget', total: 1_000_000 } });
    await a.inject({ method: 'POST', url: '/api/wedding/w1/chat', headers: h1, payload: { message: 'Our budget is 30 lakh' } });
    const pending = (await a.inject({ url: '/api/wedding/w1/proposals', headers: h1 })).json().proposals;
    expect(pending.length).toBe(1);
    const pid = pending[0].id;
    expect((await a.inject({ method: 'POST', url: `/api/wedding/w1/proposals/${pid}/confirm` })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: `/api/wedding/w1/proposals/${pid}/confirm`, headers: { 'x-workspace-token': t2 } })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: `/api/wedding/w2/proposals/${pid}/confirm`, headers: { 'x-workspace-token': t2 } })).statusCode).toBe(404);
    expect((await a.inject({ method: 'POST', url: `/api/wedding/w1/proposals/${pid}/confirm`, headers: h1 })).statusCode).toBe(200);
    await a.close();
  });
  it('ownership survives a restart (only a hash is stored)', async () => {
    const base = tmpBase();
    try {
      const a = await build(base);
      const token = (await a.inject({ method: 'POST', url: '/api/wedding/w1/claim' })).json().token as string;
      await a.close();
      const raw = fs.readFileSync(path.join(base, 'owners.json'), 'utf8');
      expect(raw).not.toContain(token);
      const b = await build(base);
      expect((await b.inject({ url: '/api/wedding/w1' })).statusCode).toBe(401);
      expect((await b.inject({ url: '/api/wedding/w1', headers: { 'x-workspace-token': token } })).statusCode).toBe(200);
      await b.close();
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

describe('persistence across restarts', () => {
  it('pending proposals survive a restart and can still be confirmed once; a tampered file is refused', async () => {
    const base = tmpBase();
    try {
      const store = new WeddingStore();
      store.dispatch('w', { type: 'set_total_budget', total: 1_000_000 });
      const p1 = new ProposalStore({ dir: path.join(base, 'p') });
      const v = p1.create('w', { tool: 'setTotalBudget', summary: 'Raise to 30 lakh', changes: [], action: { type: 'set_total_budget', total: 3_000_000 }, kind: 'budget', state: store.getOrCreate('w') })!;
      const p2 = new ProposalStore({ dir: path.join(base, 'p') });
      expect(p2.pending('w').map((x) => x.id)).toEqual([v.id]);
      expect(p2.confirm(store, 'w', v.id).ok).toBe(true);
      expect(store.getOrCreate('w').budget.total).toBe(3_000_000);
      expect(new ProposalStore({ dir: path.join(base, 'p') }).confirm(store, 'w', v.id)).toMatchObject({ ok: false, code: 'already_used' });
      // Tamper with the saved action: the integrity check must refuse it.
      const store2 = new WeddingStore();
      store2.dispatch('w', { type: 'set_total_budget', total: 1_000_000 });
      const p3 = new ProposalStore({ dir: path.join(base, 'q') });
      const v3 = p3.create('w', { tool: 'setTotalBudget', summary: 'x', changes: [], action: { type: 'set_total_budget', total: 3_000_000 }, kind: 'budget', state: store2.getOrCreate('w') })!;
      const file = path.join(base, 'q', 'proposals.json');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('3000000', '900000000'));
      expect(new ProposalStore({ dir: path.join(base, 'q') }).confirm(store2, 'w', v3.id)).toMatchObject({ ok: false, code: 'tampered' });
      expect(store2.getOrCreate('w').budget.total).toBe(1_000_000);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});
