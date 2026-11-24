import { describe, expect, it } from 'vitest';
import { toolTestContext } from '../tools/testkit.js';
import { buildApp } from '../app.js';
import { FLAG_NAMES, FlagService, type FlagName, type FlagProvider } from './flags.js';
import { runWeddingTool, weddingToolDefinitions } from './orchestrator.js';
import { ProposalStore } from './proposals.js';
import { WeddingStore } from './store.js';
import { newSession, type ToolContext } from './toolkit.js';
import { VendorStore } from './vendor-store.js';

/** All provider/HTTP calls here are MOCKS: nothing in this file talks to Flagsmith or Sarvam. */
interface MockProvider extends FlagProvider { values: Partial<Record<FlagName, boolean>>; fail: boolean; reads: number }
const mockProvider = (initial: Partial<Record<FlagName, boolean>>): MockProvider => {
  const p: MockProvider = { values: { ...initial }, fail: false, reads: 0, source: 'flagsmith-remote',
    async read() { p.reads++; if (p.fail) throw new Error('network down'); return { flags: { ...p.values }, defaulted: [] }; } };
  return p;
};

describe('flag service (mock provider)', () => {
  it('defaults every flag on when Flagsmith is not configured', async () => {
    const f = new FlagService(null);
    const s = await f.refresh();
    expect(FLAG_NAMES.every((n) => f.isEnabled(n))).toBe(true);
    expect(s).toMatchObject({ source: 'defaults', degraded: false });
    expect(f.configured).toBe(false);
  });
  it('reads values, caches within the TTL, and re-reads after it', async () => {
    let t = 1000;
    const p = mockProvider({ 'agent.vendor': false });
    const f = new FlagService(p, 5000, () => t);
    await f.refresh();
    expect(f.isEnabled('agent.vendor')).toBe(false);
    expect(f.isEnabled('agent.budget')).toBe(true);
    await f.refresh();
    expect(p.reads).toBe(1);
    p.values['agent.vendor'] = true; t += 6000;
    await f.refresh();
    expect(f.isEnabled('agent.vendor')).toBe(true);
    expect(p.reads).toBe(2);
  });
  it('keeps last known values when Flagsmith fails, and marks the snapshot degraded', async () => {
    let t = 0;
    const p = mockProvider({ 'agent.fashion': false });
    const f = new FlagService(p, 1000, () => t);
    await f.refresh();
    p.fail = true; t += 2000;
    const s = await f.refresh();
    expect(f.isEnabled('agent.fashion')).toBe(false);
    expect(s.degraded).toBe(true);
    expect(s.error).toMatch(/Flagsmith could not be reached/);
    p.fail = false;
    expect((await f.refresh()).degraded).toBe(false);
  });
  it('falls back to defaults (and says so) when Flagsmith is down from the start', async () => {
    const p = mockProvider({}); p.fail = true;
    const f = new FlagService(p);
    const s = await f.refresh();
    expect(s).toMatchObject({ degraded: true, source: 'defaults' });
    expect(f.isEnabled('agent.decoration')).toBe(true);
  });
});

describe('flags gate the orchestrator', () => {
  const rig = async (off: FlagName[]) => {
    const p = mockProvider(Object.fromEntries(off.map((n) => [n, false])));
    const flags = new FlagService(p);
    await flags.refresh();
    const ctx: ToolContext = { store: new WeddingStore(), vendors: new VendorStore(), flags, proposals: new ProposalStore(), weddingId: 'w', session: newSession() };
    return { ctx, flags, p };
  };
  it('does not list a disabled specialist\'s tools to the model', async () => {
    const { flags } = await rig(['agent.vendor', 'agent.decoration']);
    const names = weddingToolDefinitions(flags).map((t) => t.name);
    expect(names).not.toContain('searchOurVendors');
    expect(names).not.toContain('addDecoration');
    expect(names).toContain('getBudgetSummary');
    expect(names).toContain('getWeddingOverview');
    expect(weddingToolDefinitions().map((t) => t.name)).toContain('searchOurVendors');
  });
  it('refuses to run a disabled tool even when called by name, and changes nothing', async () => {
    const { ctx } = await rig(['agent.vendor', 'agent.decoration', 'agent.budget']);
    for (const [n, i] of [['searchOurVendors', {}], ['shortlistVendor', { vendorId: 'demo-mysore-mandap' }], ['addDecoration', { asset: 'stage-wedding' }], ['setTotalBudget', { total: 100000 }]] as const) {
      const r = runWeddingTool(ctx, n, i);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/switched off/);
    }
    const s = ctx.store.getOrCreate('w');
    expect(s.vendorShortlist).toEqual([]);
    expect(s.scene.objects).toEqual([]);
    expect(s.budget.total).toBe(0);
  });
  it('re-enabling takes effect on the next call (live toggle)', async () => {
    const { ctx, p, flags } = await rig(['agent.vendor']);
    expect(runWeddingTool(ctx, 'searchOurVendors', {}).ok).toBe(false);
    p.values['agent.vendor'] = true;
    await flags.refresh(true);
    expect(runWeddingTool(ctx, 'searchOurVendors', {}).ok).toBe(true);
  });
});

describe('HTTP: flags, marketplace gate, voice', () => {
  const build = async (flags: FlagService, extra: Record<string, unknown> = {}, env: Record<string, string> = {}) =>
    buildApp(await toolTestContext(env), { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: null, create: null, flags, ...extra } });

  it('/api/flags reports server-evaluated values and the source', async () => {
    const p = mockProvider({ 'tryon.enabled': false });
    const a = await build(new FlagService(p));
    const j = (await a.inject({ url: '/api/flags' })).json();
    expect(j.flags['tryon.enabled']).toBe(false);
    expect(j.flags['agent.budget']).toBe(true);
    expect(j).toMatchObject({ source: 'flagsmith-remote', configured: true, voiceConfigured: false });
    await a.close();
  });
  it('the marketplace API answers 403 feature_disabled while its flag is off', async () => {
    const p = mockProvider({ 'vendor.marketplace.enabled': false });
    const a = await build(new FlagService(p, 0));
    for (const url of ['/api/vendors', '/api/wedding/w1/enquiries']) {
      const r = await a.inject({ url });
      expect(r.statusCode).toBe(403);
      expect(r.json().code).toBe('feature_disabled');
    }
    p.values['vendor.marketplace.enabled'] = true;
    expect((await a.inject({ url: '/api/vendors' })).statusCode).toBe(200);
    await a.close();
  });

  const audio = Buffer.alloc(4000, 1);
  const sarvam = (transcript: string, status = 200) => (async (url: unknown, init?: RequestInit) => {
    sarvam.last = { url: String(url), headers: init?.headers as Record<string, string>, form: init?.body as FormData };
    return new Response(JSON.stringify(status === 200 ? { transcript, language_code: 'en-IN' } : { error: { message: 'sk-secret-xyz leaked?' } }), { status });
  }) as typeof fetch;
  sarvam.last = {} as { url?: string; headers?: Record<string, string>; form?: FormData };

  it('voice: transcript goes through the SAME planner tools and updates WeddingState (mock Sarvam)', async () => {
    const a = await build(new FlagService(null), { sarvamFetch: sarvam('Our budget is 25 lakh') }, { SARVAM_API_KEY: 'test-key' });
    const r = await a.inject({ method: 'POST', url: '/api/wedding/w1/voice?lang=kn-IN', headers: { 'content-type': 'audio/webm' }, payload: audio });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.transcript).toBe('Our budget is 25 lakh');
    expect(j.turn.toolCalls.map((c: { name: string }) => c.name)).toContain('setTotalBudget');
    expect(j.turn.state.budget.total).toBe(2_500_000);
    expect((await a.inject({ url: '/api/wedding/w1' })).json().state.budget.total).toBe(2_500_000);
    expect(sarvam.last.url).toBe('https://api.sarvam.ai/speech-to-text');
    expect(sarvam.last.headers).toMatchObject({ 'api-subscription-key': 'test-key' });
    expect(sarvam.last.form!.get('language_code')).toBe('kn-IN');
    expect(sarvam.last.form!.get('model')).toBe('saaras:v4');
    await a.close();
  });
  it('voice: not configured, flag off, too short, provider error without leaking', async () => {
    const none = await build(new FlagService(null));
    expect((await none.inject({ method: 'POST', url: '/api/wedding/w1/voice', headers: { 'content-type': 'audio/webm' }, payload: audio })).json().code).toBe('not_configured');
    await none.close();
    const off = await build(new FlagService(mockProvider({ 'voice.sarvam': false })), {}, { SARVAM_API_KEY: 'k' });
    expect((await off.inject({ method: 'POST', url: '/api/wedding/w1/voice', headers: { 'content-type': 'audio/webm' }, payload: audio })).statusCode).toBe(403);
    await off.close();
    const on = await build(new FlagService(null), { sarvamFetch: sarvam('x', 403) }, { SARVAM_API_KEY: 'k' });
    const short = await on.inject({ method: 'POST', url: '/api/wedding/w1/voice', headers: { 'content-type': 'audio/webm' }, payload: Buffer.alloc(10) });
    expect(short.json().code).toBe('too_short');
    const bad = await on.inject({ method: 'POST', url: '/api/wedding/w1/voice', headers: { 'content-type': 'audio/webm' }, payload: audio });
    expect(bad.statusCode).toBe(502);
    expect(JSON.stringify(bad.json())).not.toMatch(/sk-secret/);
    expect((await on.inject({ method: 'POST', url: '/api/wedding/w1/voice', headers: { 'content-type': 'application/json' }, payload: '{}' })).statusCode).toBe(415);
    await on.close();
  });
});
