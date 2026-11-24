import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Check, FileText, Heart, MapPin, Users } from 'lucide-react';
import { VENDOR_CATEGORY_LABELS, budgetCategoryFor, checkAvailability, formatInr, packageEstimate, packageFits } from '@ave/shared';
import { Button, Card, ErrorState, LoadingState, Notice, Pill, TextField } from '@/ui';
import { useWedding } from '../useWedding';
import { vendorApi, type VendorView } from './api';
import { Art, TrustBadge } from './parts';

export default function VendorProfile() {
  const { vid = '' } = useParams();
  const { state, id, adopt } = useWedding();
  const [vendor, setVendor] = useState<VendorView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { setVendor(null); vendorApi.get(vid).then((r) => { setVendor(r.vendor); setNotice(r.notice); }).catch((e: Error) => setError(e.message)); }, [vid]);

  if (error) return <ErrorState title="Vendor not found" body={error} actions={<Link to="/vendors" className="font-semibold underline">Back to the marketplace</Link>} />;
  if (!vendor || !state) return <LoadingState title="Loading vendor…" />;

  const guests = state.profile.guestCount;
  const avail = checkAvailability(vendor, state.profile.date);
  const short = state.vendorShortlist.find((s) => s.vendorId === vendor.id);
  const cat = budgetCategoryFor(vendor.category);
  const limit = state.budget.limits[cat];
  const supports = guests >= vendor.capacity.min && guests <= vendor.capacity.max;

  async function shortlist(packageId?: string) {
    setBusy('s');
    try { adopt((short && !packageId ? await vendorApi.unshortlist(id, vendor!.id) : await vendorApi.shortlist(id, vendor!.id, packageId)).state); setFeedback({ tone: 'success', text: short && !packageId ? 'Removed from your shortlist.' : 'Saved to your shortlist.' }); }
    catch (e) { setFeedback({ tone: 'error', text: (e as Error).message }); } finally { setBusy(null); }
  }
  async function quote(packageId: string | null) {
    setBusy(packageId ?? 'q');
    try { const r = await vendorApi.requestQuote(id, vendor!.id, packageId, message || undefined); setFeedback({ tone: 'success', text: `Sample quotation recorded: ${r.enquiry.quotation ? formatInr(r.enquiry.quotation.amountInr) : ''}. Track it under Shortlist & quotes.` }); }
    catch (e) { setFeedback({ tone: 'error', text: (e as Error).message }); } finally { setBusy(null); }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <Link to="/vendors" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"><ArrowLeft size={16} aria-hidden />All vendors</Link>
      {notice ? <Notice tone="warn" title="DEMO DATA" body={notice} live="off" /> : null}
      <Card className="overflow-hidden">
        <Art src={vendor.portfolio[0] ?? vendor.logo} className="h-40 w-full" />
        <div className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap gap-2"><TrustBadge vendor={vendor} size="md" /><Pill>{VENDOR_CATEGORY_LABELS[vendor.category]}</Pill></div>
          <h1 className="font-display text-3xl font-extrabold">{vendor.businessName}</h1>
          <p className="text-ink-soft">{vendor.description}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft"><span className="inline-flex items-center gap-1.5"><MapPin size={15} aria-hidden />{vendor.location}; serves {vendor.serviceAreas.join(', ')}</span><span className="inline-flex items-center gap-1.5"><Users size={15} aria-hidden />{vendor.capacity.min}–{vendor.capacity.max} guests</span></p>
          {!supports ? <Notice tone="warn" title={`Outside this vendor's range`} body={`Your wedding has ${guests} guests; ${vendor.businessName} supports ${vendor.capacity.min}–${vendor.capacity.max}.`} live="off" /> : null}
          <div className="flex flex-wrap gap-1.5">{vendor.specialisations.map((s) => <Pill key={s} size="sm" tone="blue">{s}</Pill>)}</div>
          <div className="flex flex-wrap gap-2"><Button icon={short ? Check : Heart} variant={short ? 'confirm' : 'primary'} busy={busy === 's'} onClick={() => void shortlist()}>{short ? 'Shortlisted (click to remove)' : 'Shortlist'}</Button></div>
        </div>
      </Card>

      {feedback ? <Notice tone={feedback.tone} title={feedback.text} live={feedback.tone === 'error' ? 'assertive' : 'polite'} /> : null}

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-display text-xl font-extrabold">Packages for {guests} guests</h2>
        <ul className="flex flex-col gap-3">
          {vendor.packages.map((p) => {
            const est = packageEstimate(p, guests);
            const over = limit !== undefined && est > limit;
            return (
              <li key={p.id} className="rounded-[14px] border-2 border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="font-semibold">{p.name}</p><p className="text-sm text-ink-soft">{p.description}</p></div>
                  <div className="text-right"><p className="tabular font-display text-xl font-extrabold">{formatInr(est)}</p>{p.pricingUnit === 'per_guest' ? <p className="text-[13px] text-ink-soft">{formatInr(p.priceInr)} per guest</p> : null}</div>
                </div>
                <ul className="mt-2 flex flex-wrap gap-1.5">{p.includes.map((x) => <Pill key={x} size="sm">{x}</Pill>)}</ul>
                {!packageFits(p, guests) ? <p className="mt-2 text-[13px] font-semibold text-coral-deep">Not offered for {guests} guests ({p.minGuests ?? 0}–{p.maxGuests ?? '∞'}).</p> : null}
                {limit !== undefined ? <p className={`mt-2 text-[13px] font-semibold ${over ? 'text-coral-deep' : 'text-ink-soft'}`}>{over ? `Over` : `Within`} your {cat} limit of {formatInr(limit)}.</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" icon={FileText} busy={busy === p.id} disabled={!supports || !packageFits(p, guests)} onClick={() => void quote(p.id)}>Request sample quotation</Button>
                  <Button size="sm" variant="ghost" onClick={() => void shortlist(p.id)}>Shortlist this package</Button>
                </div>
              </li>
            );
          })}
        </ul>
        <TextField label="Message for the vendor (optional)" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} hint="Quote requests are recorded in Wedding OS; nothing is sent to the vendor yet." />
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <h2 className="font-display text-xl font-extrabold">Availability & trust</h2>
        <p className="text-sm">{avail.known ? `${avail.available ? 'Not marked booked' : 'Marked booked'} on ${avail.date}. ${avail.note}` : `Availability unknown. ${avail.note}`}</p>
        <p className="text-sm text-ink-soft">{vendor.verification.status === 'verified' ? `Verified ${vendor.verification.verifiedAt?.slice(0, 10)}: ${vendor.verification.verifiedBy}` : vendor.source === 'demo' ? 'Fictional vendor: not verified, no reviews, no contact details.' : `Verification status: ${vendor.verification.status}.`}</p>
        <p className="text-sm text-ink-soft">{vendor.reviews ? `Rated ${vendor.reviews.rating}/5 from ${vendor.reviews.count} reviews.` : 'No reviews yet.'}</p>
      </Card>
    </div>
  );
}
