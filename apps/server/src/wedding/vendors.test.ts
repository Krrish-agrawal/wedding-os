import { describe, expect, it } from 'vitest';
import { DEMO_VENDORS, VendorSchema, checkAvailability, packageEstimate, searchVendors, trustLabel, type Vendor } from '@ave/shared';
import { toolTestContext } from '../tools/testkit.js';
import { buildApp } from '../app.js';
import { runWeddingTool, weddingToolDefinitions } from './orchestrator.js';
import { WeddingPlanner } from './planner.js';
import { ProposalStore } from './proposals.js';
import { WeddingStore } from './store.js';
import { newSession, type ToolContext } from './toolkit.js';
import { VendorStore } from './vendor-store.js';

const noKey = { OPENAI_API_KEY: undefined, LLM_MODEL: 'm', LLM_REASONING_EFFORT: undefined } as const;

const rig = () => {
  const store = new WeddingStore();
  const vendors = new VendorStore();
  const ctx: ToolContext = { store, vendors, proposals: new ProposalStore(), weddingId: 'w', session: newSession() };
  const call = (n: string, i: unknown = {}) => runWeddingTool(ctx, n, i);
  return { store, vendors, ctx, call, st: () => store.getOrCreate('w') };
};
const data = (r: ReturnType<typeof runWeddingTool>) => { if (!r.ok) throw new Error(`${r.error} ${r.hint}`); return r.data as Record<string, any>; };

describe('vendor catalogue data', () => {
  it('is valid, fictional and honestly labelled', () => {
    expect(DEMO_VENDORS.length).toBeGreaterThanOrEqual(12);
    for (const v of DEMO_VENDORS) {
      expect(VendorSchema.safeParse(v).success).toBe(true);
      expect(v.source).toBe('demo');
      expect(v.businessName.startsWith('Demo ')).toBe(true);
      expect(v.verification.status).toBe('unverified');
      expect(v.reviews).toBeNull();
      expect(v.availability.provided).toBe(false);
      expect(trustLabel(v)).toBe('DEMO DATA');
    }
    const cats = new Set(DEMO_VENDORS.map((v) => v.category));
    for (const c of ['decorator', 'caterer', 'photographer', 'makeup', 'florist']) expect(cats.has(c as never)).toBe(true);
  });
  it('rejects verified demo data and verified without a verifier', () => {
    const v: Vendor = structuredClone(DEMO_VENDORS[0]!);
    expect(VendorSchema.safeParse({ ...v, verification: { status: 'verified', verifiedAt: new Date().toISOString(), verifiedBy: 'x' } }).success).toBe(false);
    expect(VendorSchema.safeParse({ ...v, source: 'admin', verification: { status: 'verified', verifiedAt: null, verifiedBy: null } }).success).toBe(false);
  });
  it('searches by location, budget and guests with computed prices', () => {
    const hits = searchVendors(DEMO_VENDORS, { category: 'decorator', location: 'Ramanagara', maxBudgetInr: 200_000, guests: 250 });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) { expect(h.cheapestInr!).toBeLessThanOrEqual(200_000); expect(h.vendor.category).toBe('decorator'); }
    const caterer = DEMO_VENDORS.find((v) => v.id === 'demo-saffron-table')!;
    expect(packageEstimate(caterer.packages[0]!, 250)).toBe(650 * 250);
    expect(searchVendors(DEMO_VENDORS, { category: 'decorator', location: 'Atlantis' })).toEqual([]);
  });
  it('treats availability as unknown unless supplied', () => {
    expect(checkAvailability(DEMO_VENDORS[0]!, '2027-02-14').known).toBe(false);
    const v: Vendor = { ...structuredClone(DEMO_VENDORS[0]!), availability: { provided: true, bookedDates: ['2027-02-14'], note: '', updatedAt: null } };
    expect(checkAvailability(v, '2027-02-14')).toMatchObject({ known: true, available: false });
    expect(checkAvailability(v, '2027-02-15')).toMatchObject({ known: true, available: true });
  });
});

describe('vendor tools', () => {
  it('exposes the seven required tools with schemas', () => {
    const names = weddingToolDefinitions().map((t) => t.name);
    for (const n of ['searchOurVendors', 'getVendorDetails', 'compareVendorPackages', 'shortlistVendor', 'removeShortlistedVendor', 'requestQuotation', 'getVendorAvailability']) expect(names).toContain(n);
  });
  it('searches only the real catalogue and uses the wedding city and guests by default', () => {
    const { call, ctx } = rig();
    call('updateWeddingProfile', { city: 'Ramanagara', guestCount: 250 });
    const d = data(call('searchOurVendors', { category: 'decorator', style: 'traditional south indian', maxBudgetInr: 200_000 }));
    expect(d.searched.location).toBe('Ramanagara');
    expect(d.count).toBeGreaterThan(0);
    const real = new Set(ctx.vendors.list().map((v) => v.id));
    for (const v of d.vendors) { expect(real.has(v.id)).toBe(true); expect(v.trust).toBe('DEMO DATA'); expect(v.cheapestForYourGuestCountInr).toBeLessThanOrEqual(200_000); }
    expect(ctx.session.lastVendors.length).toBe(d.vendors.length);
  });
  it('says nothing matched instead of inventing vendors', () => {
    const { call } = rig();
    const d = data(call('searchOurVendors', { category: 'decorator', location: 'Ramanagara', maxBudgetInr: 1_000 }));
    expect(d.count).toBe(0);
    expect(d.vendors).toEqual([]);
  });
  it('rejects unknown vendor ids with a recovery hint', () => {
    const { call } = rig();
    for (const [n, i] of [['getVendorDetails', { vendorId: 'ghost' }], ['shortlistVendor', { vendorId: 'ghost' }], ['requestQuotation', { vendorId: 'ghost' }], ['getVendorAvailability', { vendorId: 'ghost' }], ['compareVendorPackages', { vendorIds: ['ghost'] }]] as const) {
      const r = call(n, i);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.hint).toMatch(/searchOurVendors/);
    }
  });
  it('compares packages with budget fit computed from the customer limit', () => {
    const { call } = rig();
    call('setTotalBudget', { total: 2_500_000 });
    call('setBudgetLimit', { category: 'decoration', amount: 200_000 });
    const rows = data(call('compareVendorPackages', { vendorIds: ['demo-mysore-mandap', 'demo-ramanagara-royal'] })).rows as Array<{ package: string; estimateInr: number; budget: { withinCustomerLimit: boolean } }>;
    expect(rows.length).toBe(4);
    expect(rows.find((r) => r.package === 'Muhurtham Essentials')!.budget.withinCustomerLimit).toBe(true);
    expect(rows.find((r) => r.package === 'Royal Signature')!.budget.withinCustomerLimit).toBe(false);
    expect([...rows].map((r) => r.estimateInr)).toEqual([...rows].map((r) => r.estimateInr).sort((a, b) => a - b));
  });
  it('shortlists and removes through the reducer, copying details from the catalogue', () => {
    const { call, st } = rig();
    expect(call('shortlistVendor', { vendorId: 'demo-mysore-mandap', packageId: 'nope' }).ok).toBe(false);
    expect(call('shortlistVendor', { vendorId: 'demo-mysore-mandap', packageId: 'muhurtham' }).ok).toBe(true);
    expect(st().vendorShortlist).toEqual([{ vendorId: 'demo-mysore-mandap', name: 'Demo Mysore Mandap Works', category: 'decorator', source: 'demo', packageId: 'muhurtham' }]);
    call('shortlistVendor', { vendorId: 'demo-mysore-mandap' });
    expect(st().vendorShortlist.length).toBe(1);
    expect(call('removeShortlistedVendor', { vendorId: 'demo-mysore-mandap' }).ok).toBe(true);
    expect(st().vendorShortlist).toEqual([]);
    expect(call('removeShortlistedVendor', { vendorId: 'demo-mysore-mandap' }).ok).toBe(false);
  });
  it('quotations are computed, labelled SAMPLE QUOTATION, deduplicated and nothing else', () => {
    const { call, vendors } = rig();
    call('updateWeddingProfile', { guestCount: 200 });
    const d = data(call('requestQuotation', { vendorId: 'demo-saffron-table', packageId: 'feast' }));
    expect(d.quotation.label).toBe('SAMPLE QUOTATION');
    expect(d.quotation.amountInr).toBe(650 * 200);
    const again = data(call('requestQuotation', { vendorId: 'demo-saffron-table', packageId: 'feast' }));
    expect(again.enquiryId).toBe(d.enquiryId);
    expect(vendors.enquiriesFor('w').length).toBe(1);
    expect(call('requestQuotation', { vendorId: 'demo-saffron-table', packageId: 'feast-live' }).ok).toBe(true);
    call('updateWeddingProfile', { guestCount: 60 });
    expect(call('requestQuotation', { vendorId: 'demo-grand-spice' }).ok).toBe(false);
  });
  it('availability is unknown for vendors that never supplied it', () => {
    const { call } = rig();
    const d = data(call('getVendorAvailability', { vendorId: 'demo-mysore-mandap' }));
    expect(d.known).toBe(false);
  });
});

describe('demo planner with vendors', () => {
  const demo = () => {
    const store = new WeddingStore();
    const planner = new WeddingPlanner(store, noKey, null);
    return { store, say: (t: string) => planner.chat('w', t), st: () => store.getOrCreate('w') };
  };
  it('handles the headline request end to end', async () => {
    const { say, st } = demo();
    await say('Our wedding is in Ramanagara for 250 guests and our budget is 25 lakh');
    const t = await say('Find a traditional South Indian decorator in Ramanagara within ₹2 lakhs.');
    expect(t.toolCalls.map((c) => c.name)).toEqual(['searchOurVendors']);
    expect(t.reply).toMatch(/DEMO DATA/);
    expect(t.reply).toMatch(/Mysore Mandap/);
    expect(t.reply).toMatch(/₹/);
    expect(t.reply).not.toMatch(/Royal Signature/);
    const s = await say('shortlist the first one');
    expect(s.toolCalls.map((c) => c.name)).toEqual(['shortlistVendor']);
    expect(st().vendorShortlist.length).toBe(1);
    const q = await say('request a quote from the first one');
    expect(q.reply).toMatch(/SAMPLE QUOTATION/);
  });
  it('does not treat a vendor budget as a decoration limit', async () => {
    const { say, st } = demo();
    await say('Find a decorator in Ramanagara within ₹2 lakhs');
    expect(st().budget.limits.decoration).toBeUndefined();
  });
  it('compares the last search and reports an empty result honestly', async () => {
    const { say } = demo();
    await say('find a decorator in Ramanagara');
    const c = await say('compare them');
    expect(c.toolCalls[0]!.name).toBe('compareVendorPackages');
    const none = await say('find a photographer in Ramanagara within ₹1000');
    expect(none.reply).toMatch(/no match/i);
  });
});

describe('vendor HTTP routes', () => {
  const app = async () => buildApp(await toolTestContext(), { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: null, create: null, adminKey: 'secret-key' } });
  it('lists and filters the catalogue, with data-driven filter options', async () => {
    const a = await app();
    const r = await a.inject({ url: '/api/vendors?category=decorator&location=Ramanagara&guests=250&maxBudget=200000' });
    const j = r.json();
    expect(j.vendors.length).toBeGreaterThan(0);
    expect(j.vendors.every((v: { trust: string }) => v.trust === 'DEMO DATA')).toBe(true);
    expect(j.locations).toContain('Ramanagara');
    expect((await a.inject({ url: '/api/vendors?category=nonsense' })).statusCode).toBe(400);
    expect((await a.inject({ url: '/api/vendors/ghost' })).statusCode).toBe(404);
    await a.close();
  });
  it('shortlists and requests quotes per wedding; the browser cannot forge shortlist data', async () => {
    const a = await app();
    const s = await a.inject({ method: 'POST', url: '/api/wedding/w1/shortlist', payload: { vendorId: 'demo-glow-studio' } });
    expect(s.json().state.vendorShortlist[0]).toMatchObject({ name: 'Demo Glow Bridal Studio', source: 'demo' });
    const forged = await a.inject({ method: 'POST', url: '/api/wedding/w1/actions', payload: { type: 'shortlist_vendor', vendor: { vendorId: 'x', name: 'Verified Star', category: 'decorator', source: 'admin' } } });
    expect(forged.statusCode).toBe(403);
    const q = await a.inject({ method: 'POST', url: '/api/wedding/w1/enquiries', payload: { vendorId: 'demo-frame-and-thread', packageId: 'one-day' } });
    expect(q.statusCode).toBe(200);
    expect(q.json().enquiry.quotation.label).toBe('SAMPLE QUOTATION');
    expect((await a.inject({ url: '/api/wedding/w1/enquiries' })).json().enquiries.length).toBe(1);
    expect((await a.inject({ url: '/api/wedding/w2/enquiries' })).json().enquiries.length).toBe(0);
    expect((await a.inject({ method: 'DELETE', url: '/api/wedding/w1/shortlist/demo-glow-studio' })).json().state.vendorShortlist).toEqual([]);
    await a.close();
  });
  it('admin routes need the key, and verification needs a real method and a non-demo vendor', async () => {
    const a = await app();
    const h = { 'x-admin-key': 'secret-key' };
    expect((await a.inject({ url: '/api/admin/vendors' })).statusCode).toBe(401);
    expect((await a.inject({ url: '/api/admin/vendors', headers: { 'x-admin-key': 'wrong' } })).statusCode).toBe(401);
    expect((await a.inject({ url: '/api/admin/vendors', headers: h })).statusCode).toBe(200);
    const body = { businessName: 'Test Decor Co', category: 'decorator', location: 'Ramanagara', serviceAreas: ['Ramanagara'], capacity: { min: 50, max: 300 }, startingPriceInr: 50_000, packages: [{ id: 'basic', name: 'Basic', priceInr: 50_000, pricingUnit: 'flat' }] };
    const created = await a.inject({ method: 'POST', url: '/api/admin/vendors', headers: h, payload: body });
    expect(created.statusCode).toBe(201);
    const v = created.json().vendor;
    expect(v).toMatchObject({ source: 'admin', verification: { status: 'unverified' } });
    expect((await a.inject({ method: 'POST', url: `/api/admin/vendors/${v.id}/verification`, headers: h, payload: { status: 'verified' } })).statusCode).toBe(422);
    const ver = await a.inject({ method: 'POST', url: `/api/admin/vendors/${v.id}/verification`, headers: h, payload: { status: 'verified', verifiedBy: 'Ops site visit and GST check, 22 Nov' } });
    expect(ver.json().vendor.verification.status).toBe('verified');
    expect((await a.inject({ method: 'POST', url: '/api/admin/vendors/demo-glow-studio/verification', headers: h, payload: { status: 'verified', verifiedBy: 'trust me bro' } })).statusCode).toBe(409);
    const edit = await a.inject({ method: 'PUT', url: `/api/admin/vendors/${v.id}`, headers: h, payload: { ...body, serviceAreas: ['Ramanagara', 'Kanakapura'] } });
    expect(edit.json().vendor.serviceAreas).toContain('Kanakapura');
    const av = await a.inject({ method: 'PUT', url: `/api/admin/vendors/${v.id}/availability`, headers: h, payload: { bookedDates: ['2027-03-01'], note: 'Per phone call' } });
    expect(av.json().vendor.availability.provided).toBe(true);
    const bad = await a.inject({ method: 'POST', url: '/api/admin/vendors', headers: h, payload: { ...body, capacity: { min: 500, max: 10 } } });
    expect(bad.statusCode).toBe(422);
    await a.close();
  });
  it('admin reviews quote requests across weddings', async () => {
    const a = await app();
    const h = { 'x-admin-key': 'secret-key' };
    await a.inject({ method: 'POST', url: '/api/wedding/w1/enquiries', payload: { vendorId: 'demo-frame-and-thread' } });
    const list = (await a.inject({ url: '/api/admin/enquiries', headers: h })).json().enquiries;
    expect(list.length).toBe(1);
    const p = await a.inject({ method: 'PATCH', url: `/api/admin/enquiries/${list[0].id}`, headers: h, payload: { status: 'vendor_responded', adminNote: 'Called back' } });
    expect(p.json().enquiry).toMatchObject({ status: 'vendor_responded', adminNote: 'Called back' });
    expect((await a.inject({ url: '/api/wedding/w1/enquiries' })).json().enquiries[0].status).toBe('vendor_responded');
    await a.close();
  });
  it('admin is disabled when no key is configured', async () => {
    const a = await buildApp(await toolTestContext(), { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: null, create: null, adminKey: null } });
    expect((await a.inject({ url: '/api/admin/vendors', headers: { 'x-admin-key': 'anything' } })).statusCode).toBe(503);
    await a.close();
  });
});
