import { z } from 'zod';
import {
  DEMO_DATA_NOTICE, VENDOR_CATEGORIES, VENDOR_CATEGORY_LABELS, budgetCategoryFor, cheapestEstimate, checkAvailability, formatInr, packageEstimate, packageFits, searchVendors, summarizeBudget, trustLabel,
  type Vendor, type WeddingState,
} from '@ave/shared';
import { apply, defineTool, fail, ok, state, toFail, type Specialist, type ToolContext } from '../toolkit.js';

/**
 * Vendor specialist. Searches ONLY our own curated catalogue (VendorStore); it cannot invent a vendor, a price, an
 * availability or a quotation. Prices are list prices from the vendor record; a quotation is a computed
 * SAMPLE QUOTATION. Every figure comes from shared code, never from the model.
 */

const category = z.enum(VENDOR_CATEGORIES);

/** How an estimate sits against what the customer budgeted for that kind of spend. All numbers computed here. */
export function budgetFit(s: WeddingState, v: Vendor, estimateInr: number) {
  const cat = budgetCategoryFor(v.category);
  const b = summarizeBudget(s);
  const limit = s.budget.limits[cat] ?? null;
  const allocation = s.budget.allocations[cat] ?? null;
  const spent = s.budget.expenses.filter((e) => e.category === cat).reduce((n, e) => n + e.amount, 0);
  return {
    budgetCategory: cat,
    estimateInr,
    customerLimitInr: limit,
    withinCustomerLimit: limit === null ? null : estimateInr <= limit,
    plannedAllocationInr: allocation,
    plannedRemainingInr: allocation === null ? null : allocation - spent,
    withinPlannedRemaining: allocation === null ? null : estimateInr <= allocation - spent,
    totalBudgetSet: b.total > 0,
  };
}

const card = (v: Vendor, s: WeddingState) => {
  const est = cheapestEstimate(v, s.profile.guestCount);
  return {
    id: v.id, name: v.businessName, category: VENDOR_CATEGORY_LABELS[v.category], location: v.location, serviceAreas: v.serviceAreas, specialisations: v.specialisations,
    guestCapacity: `${v.capacity.min}–${v.capacity.max}`, startingPriceInr: v.startingPriceInr, cheapestForYourGuestCountInr: est,
    trust: trustLabel(v), source: v.source, verified: v.verification.status === 'verified', rating: v.reviews, shortlisted: s.vendorShortlist.some((x) => x.vendorId === v.id),
    packages: v.packages.map((p) => ({ id: p.id, name: p.name, estimateInr: packageEstimate(p, s.profile.guestCount), pricing: p.pricingUnit === 'per_guest' ? `${formatInr(p.priceInr)} per guest` : 'flat', suitsGuestCount: packageFits(p, s.profile.guestCount) })),
    budget: est === null ? null : budgetFit(s, v, est),
  };
};

const requireVendor = (ctx: ToolContext, id: string) => {
  const v = ctx.vendors.get(id);
  return v ?? null;
};
const notFound = (id: string) => fail(`No vendor with id "${id}" in our catalogue.`, 'Call searchOurVendors to find real catalogue ids. Do not invent a vendor.');

export const vendorSpecialist: Specialist = {
  id: 'vendor',
  title: 'Vendors',
  summary: "Search and compare vendors in OUR curated catalogue, shortlist them, and request sample quotations. Never invents vendors, prices or availability.",
  tools: [
    defineTool({
      name: 'searchOurVendors',
      description: "Search our own vendor catalogue (not the internet). Location defaults to the wedding's city and guests to the wedding's guest count; pass maxBudgetInr to keep only vendors with a package at or under that estimate. Entries marked DEMO DATA are fictional examples. If nothing matches, say so; never invent vendors.",
      input: z.object({
        category: category.optional(), location: z.string().trim().max(60).optional().describe("A town or city; defaults to the wedding's city. Pass 'any' to ignore location."),
        maxBudgetInr: z.number().int().min(1).max(1_000_000_000).optional(), style: z.string().trim().max(60).optional().describe('Specialisation, e.g. "traditional south indian", "luxury".'),
        text: z.string().trim().max(80).optional(), verifiedOnly: z.boolean().optional(),
      }),
      label: (i) => `Searching our vendors${i.category ? ` (${VENDOR_CATEGORY_LABELS[i.category].toLowerCase()})` : ''}`,
      run: (i, ctx) => {
        const s = state(ctx);
        const location = i.location?.toLowerCase() === 'any' ? undefined : (i.location ?? (s.profile.city || undefined));
        const base = { category: i.category, maxBudgetInr: i.maxBudgetInr, guests: s.profile.guestCount, verifiedOnly: i.verifiedOnly };
        // Style words match a specialisation or description; fall back to free text so "traditional south indian" works.
        const style = i.style?.toLowerCase().replace(/\b(wedding|decorators?|decor)\b/g, '').trim();
        let hits = searchVendors(ctx.vendors.list(), { ...base, location, specialisation: style || undefined, text: i.text });
        let relaxed: string | null = null;
        if (hits.length === 0 && style) {
          hits = searchVendors(ctx.vendors.list(), { ...base, location, text: [style, i.text].filter(Boolean).join(' ') });
          if (hits.length === 0) { const words = style.split(/\s+/).filter((w) => w.length > 3); hits = words.length ? searchVendors(ctx.vendors.list(), { ...base, location, text: words[words.length - 1] }) : []; if (hits.length) relaxed = `No exact "${style}" match; showing vendors that mention "${words[words.length - 1]}".`; }
        }
        ctx.session.lastVendors = hits.slice(0, 8).map((h) => h.vendor.id);
        const data = { notice: DEMO_DATA_NOTICE, searched: { ...base, location: location ?? 'any', style: style || null }, relaxed, count: hits.length, vendors: hits.slice(0, 8).map((h) => card(h.vendor, s)) };
        return hits.length
          ? ok(`Found ${hits.length} vendor${hits.length === 1 ? '' : 's'} in our catalogue${location ? ` serving ${location}` : ''}.`, data)
          : ok('No vendor in our catalogue matches those filters.', { ...data, hint: 'Say plainly that nothing matched. Offer to widen the budget, location or category. Do not invent vendors.' });
      },
    }),
    defineTool({
      name: 'getVendorDetails',
      description: 'Full profile of one catalogue vendor: services, packages with estimates for this wedding, verification and trust label, and how each package sits against the budget.',
      input: z.object({ vendorId: z.string().min(1).max(60) }),
      label: () => 'Reading a vendor profile',
      run: (i, ctx) => {
        const v = requireVendor(ctx, i.vendorId);
        if (!v) return notFound(i.vendorId);
        const s = state(ctx);
        return ok(`${v.businessName} (${trustLabel(v)}).`, { ...card(v, s), description: v.description, services: v.services, portfolioImages: v.portfolio.length, verification: v.verification, notice: v.source === 'demo' ? DEMO_DATA_NOTICE : null });
      },
    }),
    defineTool({
      name: 'compareVendorPackages',
      description: 'Compare packages across catalogue vendors (ids from searchOurVendors): estimate for this wedding\'s guest count, what is included, and whether each fits the customer\'s limit and planned budget. Costs are computed, not estimated by you.',
      input: z.object({ vendorIds: z.array(z.string().min(1).max(60)).min(1).max(5) }),
      label: () => 'Comparing vendor packages',
      run: (i, ctx) => {
        const s = state(ctx);
        const vendors = i.vendorIds.map((id) => requireVendor(ctx, id));
        const missing = i.vendorIds.filter((_, n) => !vendors[n]);
        if (missing.length) return notFound(missing[0]!);
        const rows = vendors.flatMap((v) => v!.packages.map((p) => ({ vendorId: v!.id, vendor: v!.businessName, trust: trustLabel(v!), packageId: p.id, package: p.name, includes: p.includes, estimateInr: packageEstimate(p, s.profile.guestCount), suitsGuestCount: packageFits(p, s.profile.guestCount) && s.profile.guestCount >= v!.capacity.min && s.profile.guestCount <= v!.capacity.max, budget: budgetFit(s, v!, packageEstimate(p, s.profile.guestCount)) })))
          .sort((a, b) => a.estimateInr - b.estimateInr);
        return ok(`Compared ${rows.length} packages from ${vendors.length} vendor${vendors.length === 1 ? '' : 's'}.`, { guests: s.profile.guestCount, notice: DEMO_DATA_NOTICE, rows });
      },
    }),
    defineTool({
      name: 'shortlistVendor',
      description: 'Add a catalogue vendor to the customer\'s shortlist (optionally noting a package). Only call when the customer asked to shortlist or save it.',
      input: z.object({ vendorId: z.string().min(1).max(60), packageId: z.string().max(60).optional() }),
      label: () => 'Shortlisting a vendor',
      run: (i, ctx) => {
        const v = requireVendor(ctx, i.vendorId);
        if (!v) return notFound(i.vendorId);
        if (i.packageId && !v.packages.some((p) => p.id === i.packageId)) return fail(`${v.businessName} has no package "${i.packageId}".`, `Use one of: ${v.packages.map((p) => p.id).join(', ')}.`);
        const r = apply(ctx, { type: 'shortlist_vendor', vendor: { vendorId: v.id, name: v.businessName.slice(0, 80), category: v.category, source: v.source, packageId: i.packageId ?? null } });
        return r.ok ? ok(`Shortlisted ${v.businessName}${v.source === 'demo' ? ' (DEMO DATA)' : ''}. The shortlist has ${r.state.vendorShortlist.length} vendor${r.state.vendorShortlist.length === 1 ? '' : 's'}.`, { shortlist: r.state.vendorShortlist }) : toFail(r);
      },
    }),
    defineTool({
      name: 'removeShortlistedVendor',
      description: 'Remove a vendor from the shortlist by id.',
      input: z.object({ vendorId: z.string().min(1).max(60) }),
      label: () => 'Removing from the shortlist',
      run: (i, ctx) => {
        const r = apply(ctx, { type: 'unshortlist_vendor', vendorId: i.vendorId });
        return r.ok ? ok('Removed from the shortlist.', { shortlist: r.state.vendorShortlist }) : toFail(r);
      },
    }),
    defineTool({
      name: 'requestQuotation',
      description: 'Request a quotation from a catalogue vendor for this wedding. Right now it records the request and returns a computed SAMPLE QUOTATION from the vendor\'s list price: it is NOT an offer from the vendor and nothing is sent to them. Always call it a sample quotation.',
      input: z.object({ vendorId: z.string().min(1).max(60), packageId: z.string().max(60).optional(), message: z.string().trim().max(500).optional() }),
      label: () => 'Requesting a sample quotation',
      run: (i, ctx) => {
        const v = requireVendor(ctx, i.vendorId);
        if (!v) return notFound(i.vendorId);
        const s = state(ctx);
        const r = ctx.vendors.requestQuote(ctx.weddingId, { vendorId: v.id, packageId: i.packageId ?? null, guestCount: s.profile.guestCount, eventDate: s.profile.date, message: i.message });
        if (!r.ok) return fail(r.error, 'Pick a package that suits the guest count, or a different vendor.');
        const q = r.value.quotation;
        return ok(`SAMPLE QUOTATION from ${v.businessName}: ${q ? formatInr(q.amountInr) : 'n/a'} (${r.value.packageName ?? 'starting price'}). Status: ${r.value.status}. This is computed from the list price; it is not an offer from the vendor.`, { enquiryId: r.value.id, quotation: q, status: r.value.status, budget: q ? budgetFit(s, v, q.amountInr) : null });
      },
    }),
    defineTool({
      name: 'getVendorAvailability',
      description: 'What we know about a vendor\'s availability for the wedding date. Most vendors have not supplied availability, in which case it is UNKNOWN: say so, and never guess.',
      input: z.object({ vendorId: z.string().min(1).max(60) }),
      label: () => 'Checking availability',
      run: (i, ctx) => {
        const v = requireVendor(ctx, i.vendorId);
        if (!v) return notFound(i.vendorId);
        const a = checkAvailability(v, state(ctx).profile.date);
        return ok(a.known ? `${v.businessName}: ${a.available ? 'not marked booked' : 'marked booked'} on ${a.date}. ${a.note}` : `${v.businessName}: availability unknown. ${a.note}`, { vendorId: v.id, ...a });
      },
    }),
  ],
};
