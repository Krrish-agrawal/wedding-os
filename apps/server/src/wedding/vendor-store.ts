import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEMO_VENDORS, EnquirySchema, VendorSchema, buildSampleQuotation, packageFits,
  type Enquiry, type EnquiryStatus, type Vendor, type VendorAvailability, type VendorInput,
} from '@ave/shared';

/**
 * The curated vendor network and quote requests. Seeded with fictional DEMO DATA vendors on first use, then persisted to
 * JSON (same approach as the wedding store). Every record is re-validated on load; an unreadable file is set aside.
 * Business rules live here (and in the shared schema), not in the routes or the planner tools.
 */

type Result<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409 | 422; error: string };
const bad = (status: 400 | 404 | 409 | 422, error: string): { ok: false; status: 400 | 404 | 409 | 422; error: string } => ({ ok: false, status, error });
const now = () => new Date().toISOString();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'vendor';

interface Persisted { vendors: Vendor[]; enquiries: Enquiry[] }

export class VendorStore {
  private vendors = new Map<string, Vendor>();
  private enquiries = new Map<string, Enquiry>();

  constructor(private readonly dir?: string) {
    if (dir) fs.mkdirSync(dir, { recursive: true });
    if (!this.load()) {
      for (const v of DEMO_VENDORS) this.vendors.set(v.id, structuredClone(v));
      this.save();
    }
  }

  list(): Vendor[] { return [...this.vendors.values()]; }
  get(id: string): Vendor | undefined { return this.vendors.get(id); }

  create(input: VendorInput): Result<Vendor> {
    let id = `v-${slug(input.businessName)}`;
    for (let n = 2; this.vendors.has(id); n++) id = `v-${slug(input.businessName)}-${n}`;
    const t = now();
    const parsed = VendorSchema.safeParse({ ...input, id, availability: undefined, verification: undefined, reviews: null, source: 'admin', createdAt: t, updatedAt: t });
    if (!parsed.success) return bad(422, parsed.error.issues[0]?.message ?? 'Invalid vendor');
    this.vendors.set(id, parsed.data);
    this.save();
    return { ok: true, value: parsed.data };
  }

  update(id: string, input: VendorInput): Result<Vendor> {
    const cur = this.vendors.get(id);
    if (!cur) return bad(404, 'No such vendor.');
    const parsed = VendorSchema.safeParse({ ...cur, ...input, id, updatedAt: now() });
    if (!parsed.success) return bad(422, parsed.error.issues[0]?.message ?? 'Invalid vendor');
    this.vendors.set(id, parsed.data);
    this.save();
    return { ok: true, value: parsed.data };
  }

  /** Only an explicit admin action with a named method of verification can mark a vendor verified; demo data never can. */
  setVerification(id: string, status: 'unverified' | 'pending' | 'verified', verifiedBy: string | null): Result<Vendor> {
    const cur = this.vendors.get(id);
    if (!cur) return bad(404, 'No such vendor.');
    if (status === 'verified') {
      if (cur.source === 'demo') return bad(409, 'DEMO DATA vendors are fictional and cannot be verified.');
      if (!verifiedBy || verifiedBy.trim().length < 5) return bad(422, 'Describe how the vendor was verified (who checked what).');
    }
    const parsed = VendorSchema.safeParse({ ...cur, verification: { status, verifiedAt: status === 'verified' ? now() : null, verifiedBy: status === 'verified' ? verifiedBy!.trim().slice(0, 120) : null }, updatedAt: now() });
    if (!parsed.success) return bad(422, parsed.error.issues[0]?.message ?? 'Invalid');
    this.vendors.set(id, parsed.data);
    this.save();
    return { ok: true, value: parsed.data };
  }

  setAvailability(id: string, a: Pick<VendorAvailability, 'bookedDates' | 'note'>): Result<Vendor> {
    const cur = this.vendors.get(id);
    if (!cur) return bad(404, 'No such vendor.');
    const parsed = VendorSchema.safeParse({ ...cur, availability: { ...a, provided: true, updatedAt: now() }, updatedAt: now() });
    if (!parsed.success) return bad(422, parsed.error.issues[0]?.message ?? 'Invalid availability');
    this.vendors.set(id, parsed.data);
    this.save();
    return { ok: true, value: parsed.data };
  }

  // ---- quote requests -----------------------------------------------------------------------------------------------

  enquiriesFor(weddingId: string): Enquiry[] { return [...this.enquiries.values()].filter((e) => e.weddingId === weddingId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  allEnquiries(): Enquiry[] { return [...this.enquiries.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

  /** Creates a quote request with a computed SAMPLE QUOTATION. No message is sent to anyone: there is no vendor inbox yet. */
  requestQuote(weddingId: string, input: { vendorId: string; packageId?: string | null; guestCount: number; eventDate: string | null; message?: string }): Result<Enquiry> {
    const v = this.vendors.get(input.vendorId);
    if (!v) return bad(404, 'No such vendor.');
    const p = input.packageId ? v.packages.find((x) => x.id === input.packageId) ?? null : null;
    if (input.packageId && !p) return bad(404, `${v.businessName} has no package "${input.packageId}".`);
    if (input.guestCount < v.capacity.min || input.guestCount > v.capacity.max) return bad(409, `${v.businessName} supports ${v.capacity.min}–${v.capacity.max} guests; this wedding has ${input.guestCount}.`);
    if (p && !packageFits(p, input.guestCount)) return bad(409, `The ${p.name} package does not suit ${input.guestCount} guests.`);
    const open = this.enquiriesFor(weddingId).find((e) => e.vendorId === v.id && (e.packageId ?? null) === (p?.id ?? null) && ['requested', 'sample_quote_ready'].includes(e.status));
    if (open) return { ok: true, value: open };
    if (this.enquiriesFor(weddingId).length >= 100) return bad(409, 'Too many quote requests for this wedding.');
    const t = now();
    const e = EnquirySchema.parse({
      id: randomUUID().slice(0, 12), weddingId, vendorId: v.id, vendorName: v.businessName, packageId: p?.id ?? null, packageName: p?.name ?? null,
      guestCount: input.guestCount, eventDate: input.eventDate, message: (input.message ?? '').slice(0, 1000), status: 'sample_quote_ready',
      quotation: buildSampleQuotation(v, p, input.guestCount), vendorSource: v.source, adminNote: '', createdAt: t, updatedAt: t,
    });
    this.enquiries.set(e.id, e);
    this.save();
    return { ok: true, value: e };
  }

  updateEnquiry(id: string, patch: { status?: EnquiryStatus; adminNote?: string }): Result<Enquiry> {
    const cur = this.enquiries.get(id);
    if (!cur) return bad(404, 'No such quote request.');
    const parsed = EnquirySchema.safeParse({ ...cur, ...(patch.status ? { status: patch.status } : {}), ...(patch.adminNote !== undefined ? { adminNote: patch.adminNote } : {}), updatedAt: now() });
    if (!parsed.success) return bad(422, parsed.error.issues[0]?.message ?? 'Invalid');
    this.enquiries.set(id, parsed.data);
    this.save();
    return { ok: true, value: parsed.data };
  }

  // ---- persistence --------------------------------------------------------------------------------------------------

  private file() { return this.dir ? path.join(this.dir, 'vendors.json') : null; }

  private load(): boolean {
    const file = this.file();
    if (!file || !fs.existsSync(file)) return false;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Persisted>;
      const vendors = (raw.vendors ?? []).map((v) => VendorSchema.parse(v));
      const enquiries = (raw.enquiries ?? []).map((e) => EnquirySchema.parse(e));
      for (const v of vendors) this.vendors.set(v.id, v);
      for (const e of enquiries) this.enquiries.set(e.id, e);
      return true;
    } catch {
      this.vendors.clear();
      this.enquiries.clear();
      try { fs.renameSync(file, `${file}.unreadable-${Date.now()}`); } catch { /* start fresh */ }
      return false;
    }
  }

  private save(): void {
    const file = this.file();
    if (!file) return;
    try {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ vendors: this.list(), enquiries: this.allEnquiries() } satisfies Persisted));
      fs.renameSync(tmp, file);
    } catch { /* best effort; memory stays authoritative */ }
  }
}
