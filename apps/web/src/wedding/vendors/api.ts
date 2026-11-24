import type { Enquiry, EnquiryStatus, Vendor, VendorCategory, VendorInput, WeddingState } from '@ave/shared';
import { ApiError, authHeaders } from '../api';

/** Typed wrappers over the vendor endpoints. Admin calls send the admin key in `x-admin-key`. */

export type VendorView = Vendor & { trust: 'DEMO DATA' | 'Verified' | 'Verification pending' | 'Unverified'; cheapestForGuestsInr?: number | null };

export interface VendorFilters {
  q?: string; category?: VendorCategory | ''; location?: string; maxBudget?: number; guests?: number; style?: string; verifiedOnly?: boolean;
}
export interface VendorList { notice: string; count: number; vendors: VendorView[]; locations: string[]; categories: VendorCategory[] }

async function call<T>(url: string, init?: RequestInit & { adminKey?: string }): Promise<T> {
  let res: Response;
  try {
    const { adminKey, ...rest } = init ?? {};
    res = await fetch(url, { ...rest, headers: { ...(rest.body !== undefined ? { 'content-type': 'application/json' } : {}), ...authHeaders(url), ...(adminKey ? { 'x-admin-key': adminKey } : {}), ...rest.headers } });
  } catch {
    throw new ApiError('Cannot reach the server. Is it running?', 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.hint);
  return body as T;
}

const qs = (f: VendorFilters) => {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.category) p.set('category', f.category);
  if (f.location) p.set('location', f.location);
  if (f.maxBudget) p.set('maxBudget', String(f.maxBudget));
  if (f.guests) p.set('guests', String(f.guests));
  if (f.style) p.set('style', f.style);
  if (f.verifiedOnly) p.set('verifiedOnly', 'true');
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const vendorApi = {
  list: (f: VendorFilters = {}) => call<VendorList>(`/api/vendors${qs(f)}`),
  get: (id: string) => call<{ vendor: VendorView; notice: string | null }>(`/api/vendors/${id}`),
  shortlist: (weddingId: string, vendorId: string, packageId?: string | null) => call<{ state: WeddingState }>(`/api/wedding/${weddingId}/shortlist`, { method: 'POST', body: JSON.stringify({ vendorId, packageId: packageId ?? null }) }),
  unshortlist: (weddingId: string, vendorId: string) => call<{ state: WeddingState }>(`/api/wedding/${weddingId}/shortlist/${vendorId}`, { method: 'DELETE' }),
  enquiries: (weddingId: string) => call<{ enquiries: Enquiry[] }>(`/api/wedding/${weddingId}/enquiries`),
  requestQuote: (weddingId: string, vendorId: string, packageId?: string | null, message?: string) => call<{ enquiry: Enquiry }>(`/api/wedding/${weddingId}/enquiries`, { method: 'POST', body: JSON.stringify({ vendorId, packageId: packageId ?? null, message }) }),

  admin: {
    vendors: (adminKey: string) => call<{ vendors: VendorView[] }>('/api/admin/vendors', { adminKey }),
    create: (adminKey: string, v: VendorInput) => call<{ vendor: VendorView }>('/api/admin/vendors', { adminKey, method: 'POST', body: JSON.stringify(v) }),
    update: (adminKey: string, id: string, v: VendorInput) => call<{ vendor: VendorView }>(`/api/admin/vendors/${id}`, { adminKey, method: 'PUT', body: JSON.stringify(v) }),
    verify: (adminKey: string, id: string, status: 'unverified' | 'pending' | 'verified', verifiedBy?: string) => call<{ vendor: VendorView }>(`/api/admin/vendors/${id}/verification`, { adminKey, method: 'POST', body: JSON.stringify({ status, verifiedBy: verifiedBy ?? null }) }),
    availability: (adminKey: string, id: string, bookedDates: string[], note: string) => call<{ vendor: VendorView }>(`/api/admin/vendors/${id}/availability`, { adminKey, method: 'PUT', body: JSON.stringify({ bookedDates, note }) }),
    enquiries: (adminKey: string) => call<{ enquiries: Enquiry[] }>('/api/admin/enquiries', { adminKey }),
    updateEnquiry: (adminKey: string, id: string, patch: { status?: EnquiryStatus; adminNote?: string }) => call<{ enquiry: Enquiry }>(`/api/admin/enquiries/${id}`, { adminKey, method: 'PATCH', body: JSON.stringify(patch) }),
  },
};
