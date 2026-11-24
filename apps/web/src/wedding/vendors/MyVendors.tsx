import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { RefreshCw, Trash2 } from 'lucide-react';
import { VENDOR_CATEGORY_LABELS, formatInr, type Enquiry } from '@ave/shared';
import { Button, Card, EmptyState, ErrorState, LoadingState, Notice, Pill, type PillTone } from '@/ui';
import { useWedding } from '../useWedding';
import { vendorApi } from './api';
import { MarketplaceNav } from './Marketplace';

export const ENQUIRY_LABEL: Record<Enquiry['status'], { text: string; tone: PillTone }> = {
  requested: { text: 'Requested', tone: 'waiting' }, sample_quote_ready: { text: 'Sample quotation ready', tone: 'blue' }, vendor_responded: { text: 'Vendor responded', tone: 'live' },
  accepted: { text: 'Accepted', tone: 'live' }, declined: { text: 'Declined', tone: 'error' }, closed: { text: 'Closed', tone: 'muted' },
};

/** Shortlist and quote-request tracking for the current wedding. */
export default function MyVendors() {
  const { state, id, adopt } = useWedding();
  const [enquiries, setEnquiries] = useState<Enquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setEnquiries((await vendorApi.enquiries(id)).enquiries); setError(null); } catch (e) { setError((e as Error).message); } }, [id]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3"><h1 className="font-display text-4xl font-extrabold">Shortlist & quotes</h1><MarketplaceNav active="mine" /></header>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-display text-xl font-extrabold">Shortlisted vendors</h2>
        {!state ? <LoadingState title="Loading…" /> : state.vendorShortlist.length === 0 ? <EmptyState title="Nothing shortlisted yet" body="Shortlist vendors from the marketplace, or ask the planner." actions={<Link to="/vendors" className="font-semibold underline">Browse vendors</Link>} /> : (
          <ul className="flex flex-col gap-2">
            {state.vendorShortlist.map((v) => (
              <li key={v.vendorId} className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border-2 border-line p-3">
                <div><Link to={`/vendors/${v.vendorId}`} className="font-semibold hover:underline">{v.name}</Link><p className="text-[13px] text-ink-soft">{VENDOR_CATEGORY_LABELS[v.category]}</p></div>
                <div className="flex items-center gap-2">{v.source === 'demo' ? <Pill tone="warn" size="sm">DEMO DATA</Pill> : null}<Button size="sm" variant="ghost" icon={Trash2} label={`Remove ${v.name}`} onClick={async () => { try { adopt((await vendorApi.unshortlist(id, v.vendorId)).state); } catch (e) { setError((e as Error).message); } }}>Remove</Button></div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between"><h2 className="font-display text-xl font-extrabold">Quote requests</h2><Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void load()}>Refresh</Button></div>
        <Notice tone="info" title="How quotes work today" body="A sample quotation is computed from the vendor's list price. It is not an offer from the vendor, and nothing is sent to vendors yet. The status updates when an admin records a response." live="off" />
        {error ? <ErrorState title="Couldn't load" body={error} actions={<Button onClick={() => void load()}>Try again</Button>} /> : enquiries === null ? <LoadingState title="Loading quote requests…" /> : enquiries.length === 0 ? <EmptyState title="No quote requests" body="Open a vendor and choose “Request sample quotation”." /> : (
          <ul className="flex flex-col gap-2">
            {enquiries.map((e) => (
              <li key={e.id} className="rounded-[14px] border-2 border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><Link to={`/vendors/${e.vendorId}`} className="font-semibold hover:underline">{e.vendorName}{e.packageName ? ` · ${e.packageName}` : ''}</Link><Pill tone={ENQUIRY_LABEL[e.status].tone} size="sm">{ENQUIRY_LABEL[e.status].text}</Pill></div>
                {e.quotation ? <p className="tabular mt-1 text-sm"><strong>{e.quotation.label}:</strong> {formatInr(e.quotation.amountInr)} <span className="text-ink-soft">for {e.guestCount} guests. {e.quotation.basis}</span></p> : null}
                {e.adminNote ? <p className="mt-1 text-sm text-ink-soft">Note: {e.adminNote}</p> : null}
                <p className="mt-1 text-[12px] text-ink-soft">Requested {e.createdAt.slice(0, 10)}{e.vendorSource === 'demo' ? ' · DEMO DATA vendor' : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
