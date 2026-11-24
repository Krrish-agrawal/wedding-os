import { describe, expect, it } from 'vitest';
import { GARMENTS, GarmentSchema, applyWeddingAction, createSampleWedding, findGarment, searchGarments, CATEGORY_INFO, GARMENT_CATEGORIES } from '@ave/shared';
import { runWeddingTool, weddingToolDefinitions } from './orchestrator.js';
import { WeddingPlanner } from './planner.js';
import { ProposalStore } from './proposals.js';
import { WeddingStore } from './store.js';
import { newSession, type ToolContext } from './toolkit.js';
import { tryOnRequestsFor } from './tryon-requests.js';
import { VendorStore } from './vendor-store.js';
import { buildApp } from '../app.js';
import { toolTestContext } from '../tools/testkit.js';

const noKey = { OPENAI_API_KEY: undefined, LLM_MODEL: 'm', LLM_REASONING_EFFORT: undefined } as const;
const rig = () => {
  const store = new WeddingStore();
  const ctx: ToolContext = { store, vendors: new VendorStore(), proposals: new ProposalStore(), weddingId: 'w', session: newSession() };
  return { store, ctx, call: (n: string, i: unknown = {}) => runWeddingTool(ctx, n, i), st: () => store.getOrCreate('w') };
};

describe('garment catalogue', () => {
  it('is valid, illustrated, and honest about what is supported', () => {
    for (const g of GARMENTS) { expect(GarmentSchema.safeParse(g).success).toBe(true); expect(g.illustration).toBe(true); expect(g.name).toMatch(/illustration/); expect(g.supported).toBe(g.status !== 'future'); }
    expect(CATEGORY_INFO.sherwani.status).toBe('future');
    expect(CATEGORY_INFO.traditional_men.status).toBe('future');
    expect(CATEGORY_INFO.lehenga.status).toBe('supported');
    expect(GARMENTS.some((g) => /saree|sari/i.test(g.name))).toBe(false);
    for (const c of GARMENT_CATEGORIES) expect(GARMENTS.some((g) => g.category === c)).toBe(true);
    expect(GARMENTS.filter((g) => g.category === 'sherwani').every((g) => !g.supported)).toBe(true);
  });
  it('anchors sit inside the artwork canvas', () => {
    for (const g of GARMENTS) for (const [x, y] of Object.values(g.anchors)) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(600); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(900); }
  });
  it('searches by category, colour, price and tryable', () => {
    expect(searchGarments({ category: 'lehenga' }).length).toBe(3);
    expect(searchGarments({ color: 'pink' }).map((g) => g.id)).toEqual(['lehenga-blush']);
    expect(searchGarments({ maxPriceInr: 10_000 }).every((g) => g.priceInr <= 10_000)).toBe(true);
    expect(searchGarments({ tryableOnly: true }).some((g) => !g.supported)).toBe(false);
  });
});

describe('outfit reducer actions', () => {
  const base = () => createSampleWedding('w');
  it('saves a look for a real, tryable garment only', () => {
    const s = base();
    const ok = applyWeddingAction(s, { type: 'save_outfit', outfit: { id: 'a', label: 'Blush', garmentId: 'lehenga-blush' } });
    expect(ok.ok && ok.state.outfits[0]).toMatchObject({ id: 'a', garmentId: 'lehenga-blush', note: '' });
    expect(applyWeddingAction(s, { type: 'save_outfit', outfit: { id: 'a', label: 'x', garmentId: 'ghost' } }).ok).toBe(false);
    expect(applyWeddingAction(s, { type: 'save_outfit', outfit: { id: 'a', label: 'x', garmentId: 'sherwani-gold' } }).ok).toBe(false);
    if (ok.ok) expect(applyWeddingAction(ok.state, { type: 'save_outfit', outfit: { id: 'a', label: 'again', garmentId: 'lehenga-ruby' } }).ok).toBe(false);
  });
  it('removes a look and rejects unknown ids', () => {
    const r = applyWeddingAction(base(), { type: 'save_outfit', outfit: { id: 'a', label: 'Blush', garmentId: 'lehenga-blush' } });
    if (!r.ok) throw new Error('setup');
    const gone = applyWeddingAction(r.state, { type: 'remove_outfit', outfitId: 'a' });
    expect(gone.ok && gone.state.outfits).toEqual([]);
    expect(applyWeddingAction(r.state, { type: 'remove_outfit', outfitId: 'zzz' }).ok).toBe(false);
  });
  it('old saved looks without the new fields still load', () => {
    const s = base() as unknown as { outfits: unknown[] };
    s.outfits = [{ id: 'o', label: 'Old', garmentId: 'lehenga-blush' }];
    const r = applyWeddingAction(s as never, { type: 'update_profile', patch: { city: 'Mysuru' } });
    expect(r.ok && r.state.outfits[0]).toMatchObject({ note: '', createdAt: '' });
  });
});

describe('fashion tools', () => {
  it('exposes the six required tools', () => {
    const names = weddingToolDefinitions().map((t) => t.name);
    for (const n of ['listGarments', 'searchGarments', 'generateOutfitPreview', 'saveLook', 'compareLooks', 'deleteLook']) expect(names).toContain(n);
  });
  it('lists categories with their real support status', () => {
    const { call } = rig();
    const r = call('listGarments');
    if (!r.ok) throw new Error('x');
    const cats = (r.data as { categories: { category: string; status: string }[] }).categories;
    expect(cats.find((c) => c.category === 'sherwani')!.status).toBe('future');
  });
  it('generateOutfitPreview does not claim a generated image; it records a browser request', () => {
    const { call, store } = rig();
    const r = call('generateOutfitPreview', { garmentId: 'lehenga-blush' });
    if (!r.ok) throw new Error('x');
    expect(r.summary).toMatch(/NOT generated/);
    expect((r.data as { status: string }).status).toBe('needs_browser_generation');
    const pending = tryOnRequestsFor(store).pending('w');
    expect(pending).toHaveLength(1);
    expect(call('generateOutfitPreview', { garmentId: 'lehenga-blush' }).ok).toBe(true);
    expect(tryOnRequestsFor(store).pending('w')).toHaveLength(1);
  });
  it('refuses future options and unknown garments', () => {
    const { call } = rig();
    const r = call('generateOutfitPreview', { garmentId: 'sherwani-gold' });
    expect(r.ok).toBe(false);
    expect(call('generateOutfitPreview', { garmentId: 'saree-red' }).ok).toBe(false);
  });
  it('saves, compares and deletes looks through the reducer', () => {
    const { call, st } = rig();
    call('saveLook', { garmentId: 'lehenga-blush' });
    call('saveLook', { garmentId: 'gown-champagne', label: 'Reception gown' });
    expect(st().outfits.map((o) => o.label)).toEqual(['Blush Pink Lehenga', 'Reception gown']);
    expect(call('saveLook', { garmentId: 'sherwani-gold' }).ok).toBe(false);
    const ids = st().outfits.map((o) => o.id);
    const c = call('compareLooks', { ids });
    expect(c.ok).toBe(true);
    expect(call('compareLooks', { ids: [ids[0], ids[0]] }).ok).toBe(false);
    expect(call('deleteLook', { lookId: ids[0] }).ok).toBe(true);
    expect(st().outfits).toHaveLength(1);
    expect(call('deleteLook', { lookId: ids[0] }).ok).toBe(false);
  });
});

describe('demo planner with outfits', () => {
  const demo = () => { const store = new WeddingStore(); const planner = new WeddingPlanner(store, noKey, null); return { store, say: (t: string) => planner.chat('w', t), st: () => store.getOrCreate('w') }; };
  it('browses, requests a preview, saves and deletes', async () => {
    const { say, st } = demo();
    const show = await say('show me lehengas');
    expect(show.toolCalls[0]!.name).toBe('searchGarments');
    expect(show.reply).toMatch(/illustration/);
    const tryIt = await say('try the pink lehenga');
    expect(tryIt.toolCalls.map((c) => c.name)).toEqual(['generateOutfitPreview']);
    expect(tryIt.reply).toMatch(/NOT generated/);
    const save = await say('save this look');
    expect(save.toolCalls[0]!.name).toBe('saveLook');
    expect(st().outfits[0]!.garmentId).toBe('lehenga-blush');
    const del = await say('delete this look');
    expect(del.toolCalls[0]!.name).toBe('deleteLook');
    expect(st().outfits).toEqual([]);
  });
  it('says sherwanis are a future option and does not offer a preview', async () => {
    const { say } = demo();
    const r = await say('show me sherwanis');
    expect(r.reply).toMatch(/future option/i);
    const t = await say('try the gold sherwani');
    expect(t.reply).toMatch(/cannot be tried on/i);
  });
  it('does not hijack budget or decoration phrases', async () => {
    const { say, st } = demo();
    await say('we spent 50000 on the lehenga');
    expect(st().outfits).toEqual([]);
    const m = await say('Add a traditional mandap');
    expect(m.toolCalls[0]!.name).not.toMatch(/Garment|Look|Outfit/);
  });
});

describe('try-on request routes', () => {
  it('serves the catalogue, lists pending requests and lets the browser report back', async () => {
    const a = await buildApp(await toolTestContext(), { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: null, create: null } });
    expect((await a.inject({ url: '/api/garments' })).json().garments.length).toBe(GARMENTS.length);
    await a.inject({ method: 'POST', url: '/api/wedding/w9/chat', payload: { message: 'try the champagne gown' } });
    const pending = (await a.inject({ url: '/api/wedding/w9/tryon-requests' })).json().requests;
    expect(pending).toHaveLength(1);
    expect((await a.inject({ url: '/api/wedding/w8/tryon-requests' })).json().requests).toHaveLength(0);
    const done = await a.inject({ method: 'POST', url: `/api/wedding/w9/tryon-requests/${pending[0].id}/complete`, payload: { status: 'failed', message: 'Model not available' } });
    expect(done.json().request.status).toBe('failed');
    expect((await a.inject({ method: 'POST', url: `/api/wedding/w9/tryon-requests/${pending[0].id}/complete`, payload: { status: 'generated' } })).statusCode).toBe(404);
    await a.close();
  });
});
void findGarment;
