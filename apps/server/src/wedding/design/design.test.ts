import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoBriefFromForm, sceneCost, studioVenueId, type DesignForm, type WeddingDesignBrief } from '@ave/shared';
import type { ChatCreate } from '../../agent/sim.js';
import { toolTestContext } from '../../tools/testkit.js';
import { buildApp } from '../../app.js';
import { FlagService, type FlagName, type FlagProvider } from '../flags.js';
import { runWeddingTool, weddingToolDefinitions } from '../orchestrator.js';
import { WeddingPlanner } from '../planner.js';
import { ProposalStore } from '../proposals.js';
import { WeddingStore } from '../store.js';
import type { ImageService, StoredImageMeta } from '../storage/types.js';
import { newSession, type ToolContext } from '../toolkit.js';
import { VendorStore } from '../vendor-store.js';
import { DesignService, type DesignJob } from './jobs.js';
import { briefJsonSchema } from './vision.js';

/** Every provider call in this file is a MOCK. Nothing here talks to OpenAI, so none of it is evidence about a real model. */

const form: DesignForm = { description: 'Grand south indian wedding with jasmine and marigold', style: 'Traditional South Indian', guestCount: 120, decorationBudgetInr: null, palette: ['marigold', 'maroon', 'gold'] };
const BALLROOM = 'venue-grand-ballroom';
const visionBrief = (): WeddingDesignBrief => ({ ...demoBriefFromForm(form), title: 'Temple wedding', summary: 'A temple-style South Indian mandap with marigold garlands.', limitations: ['No real temple gopuram model.'], provenance: [{ element: 'mandap', imageIndex: 0 }] });
const completion = (content: string | null, extra: Record<string, unknown> = {}) => ({ choices: [{ message: { content, refusal: null, ...extra } }], usage: { prompt_tokens: 1000, completion_tokens: 300 } }) as never;
const sk = 'sk-proj-abcdef1234567890SECRET';

const fakeImages = (ids: string[]): ImageService & Record<string, unknown> => {
  const meta = (id: string): StoredImageMeta => ({ id, weddingId: 'w', mime: 'image/png', bytes: 10, sha256: 'x', createdAt: 0, expiresAt: 1 });
  return {
    imageLimits: { maxFiles: 6, maxBytesPerFile: 6 * 1024 * 1024, maxTotalBytes: 24 * 1024 * 1024, retentionHours: 24 }, blobKind: 'local', stopSweeper: () => undefined,
    upload: async () => { throw new Error('unused'); }, list: () => ids.map(meta), read: async () => null, delete: async () => true, deleteAll: async () => 0, sweep: async () => 0,
    readForModel: async (_w, id) => (ids.includes(id) ? { mime: 'image/png', dataUrl: `data:image/png;base64,AAAA${id}` } : null),
  };
};

const rig = (create: ChatCreate | null, o: { model?: string | undefined; images?: string[]; timeoutMs?: number; dir?: string } = {}) => {
  const store = new WeddingStore();
  const model = 'model' in o ? o.model : 'mock-vision';
  const svc = new DesignService({ store, images: fakeImages(o.images ?? ['img1', 'img2']), create, visionModel: model, timeoutMs: o.timeoutMs, dir: o.dir });
  const run = async (input: Partial<{ form: DesignForm; venueId: string; imageIds: string[] }> = {}, w = 'w'): Promise<DesignJob> => {
    const r = svc.startGenerate(w, { form, venueId: BALLROOM, imageIds: [], ...input });
    if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
    await svc.settled(r.job.id);
    return svc.get(w, r.job.id)!;
  };
  const scene = (w = 'w') => JSON.stringify(store.getOrCreate(w).scene.objects);
  const ctx = (flags?: FlagService): ToolContext => ({ store, vendors: new VendorStore(), design: svc, flags, proposals: new ProposalStore(), weddingId: 'w', session: newSession() });
  return { store, svc, run, scene, ctx };
};
const good = (content: unknown): ChatCreate => async () => completion(JSON.stringify(content));
const data = (r: ReturnType<typeof runWeddingTool>) => { if (!r.ok) throw new Error(`${r.error} ${r.hint}`); return r.data as Record<string, any>; };

describe('vision schema', () => {
  it('is strict-compatible: closed objects, every key required, no unsupported keywords', () => {
    const bad: string[] = [];
    const walk = (n: unknown, at: string) => {
      if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${at}[${i}]`));
      if (!n || typeof n !== 'object') return;
      const o = n as Record<string, unknown>;
      for (const k of ['maxLength', 'minLength', 'minimum', 'maximum', 'maxItems', 'minItems', 'pattern', 'format', '$schema', 'default']) if (k in o && typeof o.properties !== 'object') bad.push(`${at}.${k}`);
      if (o.type === 'object' && o.properties) {
        if (o.additionalProperties !== false) bad.push(`${at} not closed`);
        if (JSON.stringify(o.required) !== JSON.stringify(Object.keys(o.properties as object))) bad.push(`${at} required`);
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${at}.${k}`);
    };
    walk(briefJsonSchema(), '$');
    expect(bad).toEqual([]);
  });
});

describe('design jobs (MOCK vision provider: not live)', () => {
  it('a valid brief completes a vision job and records usage and a vision version', async () => {
    const seen: any[] = [];
    const { run, store, svc } = rig(async (body) => { seen.push(body); return completion(JSON.stringify(visionBrief())); });
    const job = await run({ imageIds: ['img1', 'img2'] });
    expect(job).toMatchObject({ status: 'completed', source: 'vision', analysed: true, progress: 1, error: null, usage: { model: 'mock-vision', promptTokens: 1000, completionTokens: 300 } });
    expect(job.latencyMs).not.toBeNull();
    const s = store.getOrCreate('w');
    expect(s.design.versions[0]).toMatchObject({ source: 'vision', label: 'Version 1' });
    expect(s.design.source).toBe('vision');
    expect(s.design.referenceImageIds).toEqual(['img1', 'img2']);
    expect(s.scene.objects.length).toBeGreaterThan(15);
    // The request: model from config, strict JSON schema, low-detail image parts, no key anywhere.
    expect(seen).toHaveLength(1);
    expect(seen[0].model).toBe('mock-vision');
    expect(seen[0].response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true, name: 'wedding_design_brief' } });
    const parts = seen[0].messages[1].content;
    expect(parts.filter((p: any) => p.type === 'image_url').map((p: any) => p.image_url.detail)).toEqual(['low', 'low']);
    expect(JSON.stringify(job)).not.toMatch(/sk-|AAAA/);
    expect(svc.status()).toMatchObject({ visionConfigured: true, visionModel: 'mock-vision' });
  });

  it('refusal, invalid output, timeout, rate limit, quota and bad credentials fail cleanly and keep the old scene', async () => {
    const mk = (fn: ChatCreate, o = {}) => rig(fn, o);
    const cases: [string, ChatCreate, string, object?][] = [
      ['refused', async () => completion(null, { refusal: 'I cannot help with that.' }), 'refused'],
      ['invalid', async () => completion('not json at all'), 'invalid_output'],
      ['rate', async () => { throw Object.assign(new Error('429 Rate limit reached for key sk-live-zzzzzzzzzz'), { status: 429, code: 'rate_limit_exceeded' }); }, 'rate_limited'],
      ['quota', async () => { throw Object.assign(new Error('You exceeded your quota'), { status: 429, code: 'insufficient_quota' }); }, 'quota'],
      ['auth', async () => { throw Object.assign(new Error(`Incorrect API key provided: ${sk}`), { status: 401 }); }, 'provider_down'],
      ['5xx', async () => { throw Object.assign(new Error('upstream'), { status: 503 }); }, 'provider_down'],
      ['model cannot do images', async () => { throw Object.assign(new Error('this model does not support image_url'), { status: 400 }); }, 'bad_request'],
      ['timeout', (_b, o) => new Promise((_r, rej) => o?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))), 'timeout', { timeoutMs: 30 }],
    ];
    for (const [name, fn, code, opts] of cases) {
      const r = mk(fn, opts);
      await r.run(); // demo job first so there is a valid scene to protect
      const before = r.scene();
      const job = await r.run({ imageIds: ['img1'] });
      expect(job.status, name).toBe('failed');
      expect(job.error?.code, name).toBe(code);
      expect(JSON.stringify(job), name).not.toMatch(/sk-|SECRET|Incorrect API key/);
      expect(r.scene(), `${name}: scene kept`).toBe(before);
    }
  });

  it('repairs malformed JSON exactly once, then gives up (no unbounded retries)', async () => {
    let calls = 0;
    const repaired = rig(async () => (++calls === 1 ? completion('{"title":') : completion(JSON.stringify(visionBrief()))));
    expect((await repaired.run({ imageIds: ['img1'] })).status).toBe('completed');
    expect(calls).toBe(2);
    let n = 0;
    const hopeless = rig(async () => (++n, completion(JSON.stringify({ title: 'x' }))));
    const job = await hopeless.run({ imageIds: ['img1'] });
    expect(job).toMatchObject({ status: 'failed', error: { code: 'invalid_output' } });
    expect(n).toBe(2);
  });

  it('cancel mid-flight leaves the previous design untouched', async () => {
    const r = rig((_b, o) => new Promise((_res, rej) => o?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    await r.run();
    const before = r.scene();
    const start = r.svc.startGenerate('w', { form, venueId: BALLROOM, imageIds: ['img1'] });
    if (!start.ok) throw new Error(start.message);
    await new Promise((res) => setTimeout(res, 10));
    expect(r.svc.get('w', start.job.id)?.status).toBe('analysing');
    expect(r.svc.cancel('w', start.job.id)?.status).toBe('cancelled');
    await r.svc.settled(start.job.id);
    expect(r.svc.get('w', start.job.id)).toMatchObject({ status: 'cancelled', error: { code: 'cancelled' } });
    expect(r.scene()).toBe(before);
    expect(r.store.getOrCreate('w').design.versions).toHaveLength(1);
    expect(r.svc.cancel('other', start.job.id)).toBeNull();
  });

  it('allows one active job per wedding', async () => {
    const r = rig(null);
    const a = r.svc.startGenerate('w', { form, imageIds: [] });
    const b = r.svc.startGenerate('w', { form, imageIds: [] });
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, status: 409, code: 'job_active' });
    if (a.ok) await r.svc.settled(a.job.id);
    expect(r.svc.startGenerate('w', { form, imageIds: [] }).ok).toBe(true);
  });

  it('demo workflow without credentials is labelled and never claims analysis', async () => {
    const r = rig(null, { model: undefined });
    const job = await r.run();
    expect(job).toMatchObject({ status: 'completed', source: 'demo', analysed: false, usage: null });
    expect(job.notice).toMatch(/Sample design/);
    expect(r.store.getOrCreate('w').design.versions[0]).toMatchObject({ source: 'demo' });
    expect(r.store.getOrCreate('w').design.versions[0]!.summary).toMatch(/NOT analysed/);
    expect(r.svc.status()).toMatchObject({ visionConfigured: false, visionModel: null });
  });

  it('with photos but no vision model: kept, NOT analysed, and no provider call', async () => {
    let calls = 0;
    const r = rig(async () => (++calls, completion('{}')), { model: undefined });
    const job = await r.run({ imageIds: ['img1', 'img2'] });
    expect(calls).toBe(0);
    expect(job).toMatchObject({ source: 'demo', analysed: false });
    expect(job.notice).toMatch(/NOT analysed/);
    expect(job.notice).toMatch(/delete/);
  });

  it('applies venue, guest count and decoration limit; a refused plan changes none of them', async () => {
    const r = rig(null);
    const job = await r.run({ form: { ...form, guestCount: 90, decorationBudgetInr: 600_000 }, venueId: 'venue-courtyard-hall' });
    expect(job.status).toBe('completed');
    let s = r.store.getOrCreate('w');
    expect([s.venueId, s.profile.guestCount, s.budget.limits.decoration]).toEqual(['venue-courtyard-hall', 90, 600_000]);
    expect(sceneCost(s.scene.objects)).toBeLessThanOrEqual(600_000);
    const impossible = await r.run({ form: { ...form, guestCount: 60, decorationBudgetInr: 50_000 }, venueId: 'venue-lakeside-lawn' });
    expect(impossible).toMatchObject({ status: 'failed', error: { code: 'plan_failed' } });
    s = r.store.getOrCreate('w');
    expect([s.venueId, s.profile.guestCount, s.budget.limits.decoration]).toEqual(['venue-courtyard-hall', 90, 600_000]);
    const tooMany = await r.run({ form: { ...form, guestCount: 700 }, venueId: BALLROOM });
    expect(tooMany).toMatchObject({ status: 'failed', error: { code: 'venue_conflict' } });
  });

  it('switching to a smaller venue keeps the old design as a version instead of destroying it', async () => {
    const r = rig(null);
    await r.run({ form: { ...form, guestCount: 80 } });
    const first = r.store.getOrCreate('w').design.versions[0]!;
    const job = await r.run({ form: { ...form, guestCount: 80 }, venueId: 'venue-courtyard-hall' });
    expect(job.status).toBe('completed');
    const s = r.store.getOrCreate('w');
    expect(studioVenueId(s)).toBe('venue-courtyard-hall');
    expect(s.design.versions.some((v) => v.objects.length === first.objects.length && v.venueId === BALLROOM)).toBe(true);
  });

  it('persists only non-sensitive job metadata, and a restart fails running jobs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-jobs-'));
    try {
      const r = rig(good(visionBrief()), { dir });
      await r.run({ imageIds: ['img1'] });
      const raw = fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8');
      expect(raw).not.toMatch(/sk-|data:image|AAAA/);
      const jobs = JSON.parse(raw) as DesignJob[];
      jobs.push({ ...jobs[0]!, id: 'job-stuck', status: 'analysing', finishedAt: null, error: null });
      fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(jobs));
      const again = rig(null, { dir });
      expect(again.svc.get('w', 'job-stuck')).toMatchObject({ status: 'failed', error: { code: 'server_restarted' } });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('design tools', () => {
  const withDesign = async (create: ChatCreate | null = null) => { const r = rig(create); await r.run(); return r; };

  it('are listed with schemas', () => {
    const names = weddingToolDefinitions().map((t) => t.name);
    for (const n of ['refineDesign', 'generateAnotherVersion', 'restoreDesignVersion', 'compareDesignVersions', 'listDesignVersions']) expect(names).toContain(n);
  });
  it('refuse politely when there is no design yet', async () => {
    const r = rig(null);
    const res = runWeddingTool(r.ctx(), 'refineDesign', { instruction: 'make the flowers white' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.hint).toMatch(/Studio page/);
  });
  it('refineDesign makes a NEW version from the brief and keeps the old one', async () => {
    const r = await withDesign();
    const ctx = r.ctx();
    const d = data(runWeddingTool(ctx, 'refineDesign', { instruction: 'Make the flowers white' }));
    const s = r.store.getOrCreate('w');
    expect(s.design.versions.map((v) => v.label)).toEqual(['Version 1', 'Version 2']);
    expect(s.design.brief!.flowers.every((f) => f.color === 'white')).toBe(true);
    expect(s.design.activeVersionId).toBe(d.version.id);
    expect(s.design.versions[0]!.brief!.flowers.every((f) => f.color === 'white')).toBe(false);
    expect(d.version.estimateInr).toBe(sceneCost(s.scene.objects));
  });
  it('refineDesign handles grander, unsupported and photo-emphasis requests honestly', async () => {
    const r = await withDesign();
    const before = r.store.getOrCreate('w').design.brief!.grandness;
    runWeddingTool(r.ctx(), 'refineDesign', { instruction: 'make it grander' });
    expect(r.store.getOrCreate('w').design.brief!.grandness).toBe(Math.min(5, before + 1));
    const nope = runWeddingTool(r.ctx(), 'refineDesign', { instruction: 'sing me a song' });
    expect(nope.ok).toBe(false);
    if (!nope.ok) expect(nope.hint).toMatch(/Supported changes/);
    const img = runWeddingTool(r.ctx(), 'refineDesign', { instruction: 'I prefer the second inspiration image' });
    expect(img.ok).toBe(false);
    if (!img.ok) expect(img.error).toMatch(/new image analysis/);
  });
  it('reducing the budget rebuilds within a lower figure and lowers an existing limit', async () => {
    const r = rig(null);
    await r.run({ form: { ...form, decorationBudgetInr: 800_000 } });
    const cost0 = r.store.getOrCreate('w').design.versions[0]!.costInr;
    data(runWeddingTool(r.ctx(), 'refineDesign', { instruction: 'Reduce the decoration budget' }));
    const s = r.store.getOrCreate('w');
    expect(s.budget.limits.decoration).toBe(640_000);
    expect(sceneCost(s.scene.objects)).toBeLessThanOrEqual(640_000);
    expect(cost0).toBeGreaterThan(0);
  });
  it('generateAnotherVersion changes the layout, increments the variant, and keeps earlier versions', async () => {
    const r = await withDesign();
    const a = r.scene();
    data(runWeddingTool(r.ctx(), 'generateAnotherVersion', {}));
    const s = r.store.getOrCreate('w');
    expect(s.design.variantCounter).toBe(1);
    expect(s.design.versions).toHaveLength(2);
    expect(r.scene()).not.toBe(a);
  });
  it('restore, list and compare are computed from stored versions', async () => {
    const r = await withDesign();
    const first = r.scene();
    runWeddingTool(r.ctx(), 'generateAnotherVersion', {});
    runWeddingTool(r.ctx(), 'refineDesign', { instruction: 'make it grander' });
    const list = data(runWeddingTool(r.ctx(), 'listDesignVersions', {}));
    expect(list.versions).toHaveLength(3);
    const cmp = data(runWeddingTool(r.ctx(), 'compareDesignVersions', { versionIdA: 'Version 1', versionIdB: 'Version 3' }));
    const s = r.store.getOrCreate('w');
    expect(cmp.costDifferenceInr).toBe(s.design.versions[2]!.costInr - s.design.versions[0]!.costInr);
    expect(cmp.piecesByCategory.length).toBeGreaterThan(3);
    expect(runWeddingTool(r.ctx(), 'compareDesignVersions', { versionIdA: 'Version 1', versionIdB: 'nope' }).ok).toBe(false);
    expect(runWeddingTool(r.ctx(), 'restoreDesignVersion', { versionId: 'Version 1' }).ok).toBe(true);
    expect(r.scene()).toBe(first);
    expect(runWeddingTool(r.ctx(), 'restoreDesignVersion', { versionId: 'Version 9' }).ok).toBe(false);
  });
});

describe('demo planner phrases', () => {
  it('route to the design tools only once a design exists', async () => {
    const store = new WeddingStore();
    const vendors = new VendorStore();
    const design = new DesignService({ store, images: null, create: null });
    const planner = new WeddingPlanner(store, { OPENAI_API_KEY: undefined, LLM_MODEL: 'm', LLM_REASONING_EFFORT: undefined }, null, new ProposalStore(), vendors, new FlagService(null), undefined, design);
    const say = (t: string) => planner.chat('w', t);
    const before = await say('give me another version');
    expect(before.toolCalls.map((c) => c.name)).not.toContain('generateAnotherVersion');
    const r = design.startGenerate('w', { form, venueId: BALLROOM, imageIds: [] });
    if (r.ok) await design.settled(r.job.id);
    expect((await say('make the flowers white')).toolCalls.map((c) => c.name)).toEqual(['refineDesign']);
    expect((await say('give me another version')).toolCalls.map((c) => c.name)).toEqual(['generateAnotherVersion']);
    const cmp = await say('compare version 1 and 3');
    expect(cmp.toolCalls.map((c) => c.name)).toEqual(['compareDesignVersions']);
    expect((await say('go back to version 1')).toolCalls.map((c) => c.name)).toEqual(['restoreDesignVersion']);
    expect(store.getOrCreate('w').design.activeVersionId).toBe(store.getOrCreate('w').design.versions[0]!.id);
  });
});

describe('design HTTP routes', () => {
  const flagsWith = (off: FlagName[]) => {
    const p: FlagProvider & { values: Partial<Record<FlagName, boolean>> } = { source: 'flagsmith-remote', values: Object.fromEntries(off.map((n) => [n, false])), async read() { return { flags: { ...p.values }, defaulted: [] }; } };
    return { service: new FlagService(p, 0), p };
  };
  const settle = async (a: Awaited<ReturnType<typeof buildApp>>, w: string, id: string) => {
    for (let i = 0; i < 200; i++) { const j = (await a.inject({ url: `/api/wedding/${w}/design/jobs/${id}` })).json().job as DesignJob; if (!['pending', 'analysing', 'planning', 'rendering'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 10)); }
    throw new Error('job did not finish');
  };
  const build = async (o: { create?: ChatCreate | null; env?: Record<string, string>; flags?: FlagService; images?: string[] } = {}) =>
    buildApp(await toolTestContext(o.env ?? {}), { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: null, create: o.create ?? null, flags: o.flags, images: fakeImages(o.images ?? ['img1']) as never } });

  it('status never calls the model; generate -> poll -> completed; jobs are per wedding', async () => {
    const a = await build();
    const st = (await a.inject({ url: '/api/wedding/w1/design/status' })).json();
    expect(st).toMatchObject({ visionConfigured: false, visionModel: null, flagEnabled: true });
    const r = await a.inject({ method: 'POST', url: '/api/wedding/w1/design/generate', payload: { form, venueId: BALLROOM, imageIds: [] } });
    expect(r.statusCode).toBe(202);
    const job = r.json().job as DesignJob;
    expect(job.source).toBe('demo');
    await settle(a, 'w1', job.id);
    expect((await a.inject({ url: `/api/wedding/w1/design/jobs/${job.id}` })).json().job).toMatchObject({ status: 'completed', versionId: expect.any(String) });
    expect((await a.inject({ url: `/api/wedding/w2/design/jobs/${job.id}` })).statusCode).toBe(404);
    const another = await a.inject({ method: 'POST', url: '/api/wedding/w1/design/another' });
    expect(another.statusCode).toBe(202);
    await settle(a, 'w1', another.json().job.id);
    expect((await a.inject({ url: '/api/wedding/w1' })).json().state.design.versions).toHaveLength(2);
    expect((await a.inject({ method: 'POST', url: '/api/wedding/w3/design/another' })).statusCode).toBe(409);
    await a.close();
  });
  it('validates bodies and image ownership', async () => {
    const a = await build();
    const post = (payload: unknown) => a.inject({ method: 'POST', url: '/api/wedding/w1/design/generate', payload: payload as object });
    expect((await post({ form: { ...form, guestCount: 0 } })).statusCode).toBe(400);
    expect((await post({ form, imageIds: ['nope'] })).statusCode).toBe(400);
    expect((await post({ form, imageIds: ['img1', 'img1'] })).statusCode).toBe(400);
    expect((await post({ form, venueId: 'venue-moon' })).statusCode).toBe(400);
    await a.close();
  });
  it('a real-model configuration runs the vision path through the route (mock provider)', async () => {
    const a = await build({ create: good(visionBrief()), env: { OPENAI_API_KEY: 'k', WEDDING_VISION_MODEL: 'mock-vision' } });
    expect((await a.inject({ url: '/api/wedding/w1/design/status' })).json()).toMatchObject({ visionConfigured: true, visionModel: 'mock-vision' });
    const r = await a.inject({ method: 'POST', url: '/api/wedding/w1/design/generate', payload: { form, venueId: BALLROOM, imageIds: ['img1'] } });
    await settle(a, 'w1', r.json().job.id);
    expect((await a.inject({ url: '/api/wedding/w1' })).json().state.design.versions[0].source).toBe('vision');
    await a.close();
  });
  it('the studio.ai_design flag turns the routes off (403) and the tools off (unlisted, refused)', async () => {
    const { service, p } = flagsWith(['studio.ai_design']);
    const a = await build({ flags: service });
    for (const [method, url] of [['GET', '/api/wedding/w1/design/status'], ['POST', '/api/wedding/w1/design/generate'], ['POST', '/api/wedding/w1/design/another']] as const) {
      const r = await a.inject({ method, url, payload: method === 'POST' ? { form } : undefined });
      expect(r.statusCode, url).toBe(403);
      expect(r.json().code).toBe('feature_disabled');
    }
    await service.refresh(true);
    expect(weddingToolDefinitions(service).map((t) => t.name)).not.toContain('refineDesign');
    const ctx: ToolContext = { store: new WeddingStore(), vendors: new VendorStore(), flags: service, proposals: new ProposalStore(), weddingId: 'w', session: newSession() };
    const refused = runWeddingTool(ctx, 'listDesignVersions', {});
    expect(refused.ok).toBe(false);
    p.values['studio.ai_design'] = true;
    await service.refresh(true);
    expect((await a.inject({ url: '/api/wedding/w1/design/status' })).statusCode).toBe(200);
    expect(weddingToolDefinitions(service).map((t) => t.name)).toContain('refineDesign');
    await a.close();
  });
});
