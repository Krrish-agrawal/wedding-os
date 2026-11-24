import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DEMO_DATA_NOTICE, ENQUIRY_STATUSES, VENDOR_CATEGORIES, VendorInputSchema, cheapestEstimate, searchVendors, trustLabel, type Vendor,
} from '@ave/shared';
import { isValidWeddingId, type WeddingStore } from './store.js';
import type { VendorStore } from './vendor-store.js';
import type { FlagService } from './flags.js';

/**
 * Marketplace routes. Customer routes read the catalogue, shortlist, and request (sample) quotations.
 * Admin routes need the admin key (header `x-admin-key`). The key comes from WEDDING_ADMIN_KEY; outside production a
 * visible demo key ("demo-admin") is used when none is set. In production with no key, admin routes are disabled.
 */

export const DEMO_ADMIN_KEY = 'demo-admin';

export function adminKeyFrom(env: NodeJS.ProcessEnv): string | null {
  return env.WEDDING_ADMIN_KEY?.trim() || (env.NODE_ENV === 'production' ? null : DEMO_ADMIN_KEY);
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const Filters = z.object({
  q: z.string().max(80).optional(), category: z.enum(VENDOR_CATEGORIES).optional(), location: z.string().max(60).optional(),
  maxBudget: z.coerce.number().int().min(1).optional(), guests: z.coerce.number().int().min(1).max(5000).optional(),
  style: z.string().max(60).optional(), verifiedOnly: z.enum(['true', 'false']).optional(),
});

const publicVendor = (v: Vendor, guests: number) => ({ ...v, trust: trustLabel(v), cheapestForGuestsInr: cheapestEstimate(v, guests) });

export function registerVendorRoutes(app: FastifyInstance, deps: { vendors: VendorStore; store: WeddingStore; adminKey: string | null; flags: FlagService }): void {
  const { vendors, store, adminKey, flags } = deps;

  // Customer-facing marketplace routes sit behind the `vendor.marketplace.enabled` flag; admin routes stay available.
  app.addHook('preHandler', async (req, reply) => {
    const p = req.url;
    const customer = p.startsWith('/api/vendors') || /^\/api\/wedding\/[^/]+\/(shortlist|enquiries)/.test(p);
    if (!customer) return;
    await flags.refresh();
    if (!flags.isEnabled('vendor.marketplace.enabled')) return reply.code(403).send({ error: 'The vendor marketplace is switched off right now.', code: 'feature_disabled' });
  });

  const requireAdmin = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (!adminKey) { void reply.code(503).send({ error: 'Admin is disabled: set WEDDING_ADMIN_KEY on the server.' }); return false; }
    const given = req.headers['x-admin-key'];
    if (typeof given !== 'string' || !safeEqual(given, adminKey)) { void reply.code(401).send({ error: 'Admin key required.' }); return false; }
    return true;
  };

  // ---- customers ------------------------------------------------------------------------------------------------
  app.get('/api/vendors', async (req, reply) => {
    const f = Filters.safeParse(req.query);
    if (!f.success) return reply.code(400).send({ error: 'Invalid filters.' });
    const q = f.data;
    const guests = q.guests ?? 100;
    const hits = searchVendors(vendors.list(), { text: q.q, category: q.category, location: q.location, maxBudgetInr: q.maxBudget, guests: q.guests, specialisation: q.style, verifiedOnly: q.verifiedOnly === 'true' }, guests);
    // Filter options are derived from the real catalogue, so locations stay data-driven and location-independent.
    const all = vendors.list();
    return {
      notice: DEMO_DATA_NOTICE, count: hits.length, vendors: hits.map((h) => publicVendor(h.vendor, guests)),
      locations: [...new Set(all.flatMap((v) => [v.location, ...v.serviceAreas]))].sort(),
      categories: VENDOR_CATEGORIES.filter((c) => all.some((v) => v.category === c)),
    };
  });

  app.get<{ Params: { vid: string } }>('/api/vendors/:vid', async (req, reply) => {
    const v = vendors.get(req.params.vid);
    return v ? { vendor: publicVendor(v, 100), notice: v.source === 'demo' ? DEMO_DATA_NOTICE : null } : reply.code(404).send({ error: 'No such vendor.' });
  });

  const wid = (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => (isValidWeddingId(req.params.id) ? true : (void reply.code(400).send({ error: 'Invalid wedding id' }), false));

  const Shortlist = z.object({ vendorId: z.string().min(1).max(60), packageId: z.string().max(60).nullable().optional() });
  app.post<{ Params: { id: string } }>('/api/wedding/:id/shortlist', async (req, reply) => {
    if (!wid(req, reply)) return;
    const b = Shortlist.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Send { vendorId }.' });
    const v = vendors.get(b.data.vendorId);
    if (!v) return reply.code(404).send({ error: 'No such vendor.' });
    if (b.data.packageId && !v.packages.some((p) => p.id === b.data.packageId)) return reply.code(404).send({ error: 'No such package.' });
    // Name, category and source come from the catalogue, never from the browser.
    const r = store.dispatch(req.params.id, { type: 'shortlist_vendor', vendor: { vendorId: v.id, name: v.businessName.slice(0, 80), category: v.category, source: v.source, packageId: b.data.packageId ?? null } });
    return r.ok ? { state: r.state } : reply.code(422).send({ error: r.error, hint: r.hint });
  });

  app.delete<{ Params: { id: string; vid: string } }>('/api/wedding/:id/shortlist/:vid', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    const r = store.dispatch(req.params.id, { type: 'unshortlist_vendor', vendorId: req.params.vid });
    return r.ok ? { state: r.state } : reply.code(404).send({ error: r.error, hint: r.hint });
  });

  const QuoteBody = z.object({ vendorId: z.string().min(1).max(60), packageId: z.string().max(60).nullable().optional(), message: z.string().trim().max(1000).optional() });
  app.get<{ Params: { id: string } }>('/api/wedding/:id/enquiries', async (req, reply) => (wid(req, reply) ? { enquiries: vendors.enquiriesFor(req.params.id) } : undefined));
  app.post<{ Params: { id: string } }>('/api/wedding/:id/enquiries', async (req, reply) => {
    if (!wid(req, reply)) return;
    const b = QuoteBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Send { vendorId, packageId?, message? }.' });
    const s = store.getOrCreate(req.params.id);
    const r = vendors.requestQuote(req.params.id, { ...b.data, guestCount: s.profile.guestCount, eventDate: s.profile.date });
    return r.ok ? { enquiry: r.value } : reply.code(r.status).send({ error: r.error });
  });

  // ---- admin ----------------------------------------------------------------------------------------------------
  app.get('/api/admin/vendors', async (req, reply) => (requireAdmin(req, reply) ? { vendors: vendors.list().map((v) => ({ ...v, trust: trustLabel(v) })) } : undefined));

  app.post('/api/admin/vendors', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = VendorInputSchema.safeParse(req.body);
    if (!b.success) return reply.code(422).send({ error: b.error.issues[0] ? `${b.error.issues[0].path.join('.')}: ${b.error.issues[0].message}` : 'Invalid vendor' });
    const r = vendors.create(b.data);
    return r.ok ? reply.code(201).send({ vendor: r.value }) : reply.code(r.status).send({ error: r.error });
  });

  app.put<{ Params: { vid: string } }>('/api/admin/vendors/:vid', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = VendorInputSchema.safeParse(req.body);
    if (!b.success) return reply.code(422).send({ error: b.error.issues[0] ? `${b.error.issues[0].path.join('.')}: ${b.error.issues[0].message}` : 'Invalid vendor' });
    const r = vendors.update(req.params.vid, b.data);
    return r.ok ? { vendor: r.value } : reply.code(r.status).send({ error: r.error });
  });

  const VerifyBody = z.object({ status: z.enum(['unverified', 'pending', 'verified']), verifiedBy: z.string().trim().max(120).nullable().optional() });
  app.post<{ Params: { vid: string } }>('/api/admin/vendors/:vid/verification', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = VerifyBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Send { status, verifiedBy }.' });
    const r = vendors.setVerification(req.params.vid, b.data.status, b.data.verifiedBy ?? null);
    return r.ok ? { vendor: r.value } : reply.code(r.status).send({ error: r.error });
  });

  const AvailBody = z.object({ bookedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(400), note: z.string().trim().max(200).default('') });
  app.put<{ Params: { vid: string } }>('/api/admin/vendors/:vid/availability', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = AvailBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Send { bookedDates: ["YYYY-MM-DD"], note }.' });
    const r = vendors.setAvailability(req.params.vid, b.data);
    return r.ok ? { vendor: r.value } : reply.code(r.status).send({ error: r.error });
  });

  app.get('/api/admin/enquiries', async (req, reply) => (requireAdmin(req, reply) ? { enquiries: vendors.allEnquiries() } : undefined));

  const EnqPatch = z.object({ status: z.enum(ENQUIRY_STATUSES).optional(), adminNote: z.string().trim().max(500).optional() });
  app.patch<{ Params: { eid: string } }>('/api/admin/enquiries/:eid', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = EnqPatch.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Send { status?, adminNote? }.' });
    const r = vendors.updateEnquiry(req.params.eid, b.data);
    return r.ok ? { enquiry: r.value } : reply.code(r.status).send({ error: r.error });
  });
}
