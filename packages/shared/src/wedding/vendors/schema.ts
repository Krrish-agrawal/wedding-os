import { z } from 'zod';
const MAX_AMOUNT_INR = 1_000_000_000;

/**
 * Curated vendor network. Location-independent: a vendor has a base location and service areas (free text names).
 * Honesty rules encoded in the schema:
 *  - `source: 'demo'` records are invented demonstration data and are shown as DEMO DATA everywhere.
 *  - `verification.status === 'verified'` requires `verifiedAt` and `verifiedBy`, and can never be set on demo data.
 *  - Reviews and availability are optional; demo records carry none (no invented reviews or bookings).
 */

export const VENDOR_CATEGORIES = ['decorator', 'caterer', 'photographer', 'videographer', 'makeup', 'florist', 'planner', 'entertainer', 'venue'] as const;
export const VendorCategorySchema = z.enum(VENDOR_CATEGORIES);
export type VendorCategory = z.infer<typeof VendorCategorySchema>;

export const VENDOR_CATEGORY_LABELS: Record<VendorCategory, string> = {
  decorator: 'Decorator', caterer: 'Caterer', photographer: 'Photographer', videographer: 'Videographer', makeup: 'Makeup artist',
  florist: 'Florist', planner: 'Wedding planner', entertainer: 'DJ / entertainer', venue: 'Venue',
};

/** Which budget category a vendor category's spend counts against. */
export const VENDOR_BUDGET_CATEGORY = {
  decorator: 'decoration', florist: 'decoration', caterer: 'catering', photographer: 'photography', videographer: 'photography',
  makeup: 'attire', planner: 'miscellaneous', entertainer: 'entertainment', venue: 'venue',
} as const;

const Rupees = z.number().int().min(0).max(MAX_AMOUNT_INR);
const Text = (n: number) => z.string().trim().max(n);
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,60}$/);

export const VENDOR_SOURCES = ['demo', 'admin'] as const;
export const VERIFICATION_STATUSES = ['unverified', 'pending', 'verified'] as const;

export const VerificationSchema = z
  .object({
    status: z.enum(VERIFICATION_STATUSES),
    verifiedAt: z.string().datetime().nullable().default(null),
    /** Who carried out the check, and how (free text, e.g. "Site visit and GST check by ops"). */
    verifiedBy: Text(120).nullable().default(null),
  })
  .refine((v) => v.status !== 'verified' || (v.verifiedAt !== null && !!v.verifiedBy), 'A verified vendor needs verifiedAt and verifiedBy.');

export const PackageSchema = z.object({
  id: Id,
  name: Text(80).min(1),
  description: Text(400).default(''),
  priceInr: Rupees,
  /** `flat` = one price for the event; `per_guest` = price × guest count. */
  pricingUnit: z.enum(['flat', 'per_guest']),
  includes: z.array(Text(120)).max(20).default([]),
  /** Guests this package suits; omitted = no limit stated. */
  minGuests: z.number().int().min(0).max(5000).optional(),
  maxGuests: z.number().int().min(0).max(5000).optional(),
});
export type VendorPackage = z.infer<typeof PackageSchema>;

export const AvailabilitySchema = z.object({
  /** Dates (YYYY-MM-DD) the vendor has told us are booked. Empty for demo data: we do not invent bookings. */
  bookedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(400).default([]),
  note: Text(200).default(''),
  /** Whether the vendor (or an admin) has ever supplied availability. When false, availability is UNKNOWN. */
  provided: z.boolean().default(false),
  updatedAt: z.string().datetime().nullable().default(null),
});
export type VendorAvailability = z.infer<typeof AvailabilitySchema>;

export const ReviewSummarySchema = z.object({ rating: z.number().min(0).max(5), count: z.number().int().min(0) });

export const VendorSchema = z.object({
  id: Id,
  businessName: Text(100).min(1),
  category: VendorCategorySchema,
  description: Text(800).default(''),
  /** Image URLs. Demo vendors use local gradient artwork keys (`art:<name>`), never someone else's photos. */
  logo: Text(300).nullable().default(null),
  portfolio: z.array(Text(300)).max(24).default([]),
  location: Text(80).min(1),
  serviceAreas: z.array(Text(60)).max(30).default([]),
  specialisations: z.array(Text(60)).max(20).default([]),
  /** Guest range the vendor supports. */
  capacity: z.object({ min: z.number().int().min(0).max(5000), max: z.number().int().min(1).max(5000) }),
  services: z.array(Text(80)).max(30).default([]),
  startingPriceInr: Rupees,
  packages: z.array(PackageSchema).max(12).default([]),
  availability: AvailabilitySchema.default({ bookedDates: [], note: '', provided: false, updatedAt: null }),
  verification: VerificationSchema.default({ status: 'unverified', verifiedAt: null, verifiedBy: null }),
  /** Real, collected reviews only. Omitted for demo data. */
  reviews: ReviewSummarySchema.nullable().default(null),
  source: z.enum(VENDOR_SOURCES),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).refine((v) => !(v.source === 'demo' && v.verification.status === 'verified'), 'Demo data can never be verified.')
  .refine((v) => !(v.source === 'demo' && v.reviews), 'Demo data cannot carry reviews.');
export type Vendor = z.infer<typeof VendorSchema>;

/** What an admin may submit when creating or editing a vendor (id, timestamps and verification are set by the server). */
export const VendorInputSchema = z.object({
  businessName: Text(100).min(1),
  category: VendorCategorySchema,
  description: Text(800).default(''),
  logo: Text(300).nullable().default(null),
  portfolio: z.array(Text(300)).max(24).default([]),
  location: Text(80).min(1),
  serviceAreas: z.array(Text(60)).max(30).default([]),
  specialisations: z.array(Text(60)).max(20).default([]),
  capacity: z.object({ min: z.number().int().min(0).max(5000), max: z.number().int().min(1).max(5000) }).refine((c) => c.min <= c.max, 'min must not exceed max'),
  services: z.array(Text(80)).max(30).default([]),
  startingPriceInr: Rupees,
  packages: z.array(PackageSchema).max(12).default([]),
});
export type VendorInput = z.infer<typeof VendorInputSchema>;

// ---- quote requests (enquiries) ----------------------------------------------------------------------------------

export const ENQUIRY_STATUSES = ['requested', 'sample_quote_ready', 'vendor_responded', 'accepted', 'declined', 'closed'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const EnquirySchema = z.object({
  id: Id,
  weddingId: z.string().min(1).max(64),
  vendorId: Id,
  vendorName: Text(100),
  packageId: Id.nullable(),
  packageName: Text(80).nullable(),
  /** From the customer's profile at request time. */
  guestCount: z.number().int().min(1).max(5000),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  message: Text(1000).default(''),
  status: z.enum(ENQUIRY_STATUSES),
  /**
   * Until a real vendor responds, the figure is a computed SAMPLE QUOTATION from the package list price: it is
   * labelled as such and is not an offer from the vendor.
   */
  quotation: z.object({ label: z.literal('SAMPLE QUOTATION'), amountInr: Rupees, basis: Text(200) }).nullable(),
  vendorSource: z.enum(VENDOR_SOURCES),
  adminNote: Text(500).default(''),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Enquiry = z.infer<typeof EnquirySchema>;
