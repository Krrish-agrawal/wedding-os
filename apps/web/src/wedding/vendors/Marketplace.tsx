import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Check, GitCompareArrows, Heart, MapPin, Users, X } from 'lucide-react';
import { VENDOR_CATEGORY_LABELS, formatInr, packageEstimate, packageFits, type VendorCategory } from '@ave/shared';
import { Button, Card, EmptyState, ErrorState, ICON_STROKE, LoadingState, Notice, Pill, TextField, buttonClasses, cn } from '@/ui';
import { useWedding } from '../useWedding';
import { vendorApi, type VendorFilters, type VendorList, type VendorView } from './api';
import { Art, TrustBadge } from './parts';

export function MarketplaceNav({ active }: { active: 'browse' | 'mine' | 'admin' }) {
  const tabs = [{ to: '/vendors', id: 'browse', label: 'Browse vendors' }, { to: '/vendors/mine', id: 'mine', label: 'Shortlist & quotes' }, { to: '/vendors/admin', id: 'admin', label: 'Admin' }] as const;
  return (
    <nav aria-label="Vendor marketplace" className="flex flex-wrap gap-2">
      {tabs.map((t) => <Link key={t.id} to={t.to} aria-current={active === t.id ? 'page' : undefined} className={cn(buttonClasses(active === t.id ? 'primary' : 'secondary', 'sm'))}>{t.label}</Link>)}
    </nav>
  );
}

const select = 'h-11 w-full rounded-[var(--radius-control)] border-2 border-ink bg-canvas px-3 text-sm font-semibold';

export default function Marketplace() {
  const { state, id, adopt } = useWedding();
  const guests = state?.profile.guestCount;
  const [filters, setFilters] = useState<VendorFilters>({ category: '', location: '', q: '', style: '' });
  const [budget, setBudget] = useState('');
  const [useGuests, setUseGuests] = useState(true);
  const [list, setList] = useState<VendorList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [compare, setCompare] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const effective = useMemo<VendorFilters>(() => ({ ...filters, maxBudget: Number(budget) > 0 ? Number(budget) : undefined, guests: useGuests ? guests : undefined }), [filters, budget, useGuests, guests]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setList(await vendorApi.list(effective)); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [effective]);
  useEffect(() => { const t = setTimeout(() => void refresh(), 200); return () => clearTimeout(t); }, [refresh]);

  const shortlisted = (vid: string) => state?.vendorShortlist.some((v) => v.vendorId === vid) ?? false;
  async function toggleShortlist(v: VendorView) {
    try {
      const r = shortlisted(v.id) ? await vendorApi.unshortlist(id, v.id) : await vendorApi.shortlist(id, v.id);
      adopt(r.state);
      setNotice(shortlisted(v.id) ? `Removed ${v.businessName} from your shortlist.` : `Shortlisted ${v.businessName}.`);
    } catch (e) { setNotice(`Could not update the shortlist: ${(e as Error).message}`); }
  }
  const toggleCompare = (vid: string) => setCompare((c) => (c.includes(vid) ? c.filter((x) => x !== vid) : c.length >= 4 ? c : [...c, vid]));
  const compared = (list?.vendors ?? []).filter((v) => compare.includes(v.id));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-extrabold">Vendor Marketplace</h1>
          <p className="mt-1 text-ink-soft">Our own curated network of wedding vendors. {state ? `Showing prices for ${state.profile.guestCount} guests.` : ''}</p>
        </div>
        <MarketplaceNav active="browse" />
      </header>

      {list ? <Notice tone="warn" title="Demo catalogue" body={`${list.notice} Vendors are only marked Verified after an admin completes a verification check.`} live="off" /> : null}

      <Card className="grid gap-3 p-4 md:grid-cols-6">
        <TextField className="md:col-span-2" label="Search" placeholder="decorator, mandap, candid…" value={filters.q ?? ''} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <label className="flex flex-col gap-1 text-sm font-semibold">Category
          <select className={select} value={filters.category ?? ''} onChange={(e) => setFilters({ ...filters, category: e.target.value as VendorCategory | '' })}>
            <option value="">All categories</option>
            {(list?.categories ?? []).map((c) => <option key={c} value={c}>{VENDOR_CATEGORY_LABELS[c]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Location
          <select className={select} value={filters.location ?? ''} onChange={(e) => setFilters({ ...filters, location: e.target.value })}>
            <option value="">Anywhere</option>
            {(list?.locations ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <TextField label="Max budget (₹)" type="number" min={0} placeholder="e.g. 200000" value={budget} onChange={(e) => setBudget(e.target.value)} />
        <TextField label="Style" placeholder="traditional, luxury…" value={filters.style ?? ''} onChange={(e) => setFilters({ ...filters, style: e.target.value })} />
        <label className="flex items-center gap-2 text-sm font-semibold md:col-span-3"><input type="checkbox" checked={useGuests} onChange={(e) => setUseGuests(e.target.checked)} className="h-4 w-4" />Only vendors that support my {guests ?? ''} guests</label>
        <label className="flex items-center gap-2 text-sm font-semibold md:col-span-3"><input type="checkbox" checked={filters.verifiedOnly ?? false} onChange={(e) => setFilters({ ...filters, verifiedOnly: e.target.checked })} className="h-4 w-4" />Verified vendors only</label>
      </Card>

      <div aria-live="polite">{notice ? <Notice tone="info" title={notice} live="polite" actions={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>} /> : null}</div>

      {loading && !list ? <LoadingState title="Loading vendors…" /> : error ? <ErrorState title="Couldn't load vendors" body={error} actions={<Button onClick={() => void refresh()}>Try again</Button>} />
        : list && list.vendors.length === 0 ? <EmptyState title="No vendors match" body="Try a wider budget, another location, or clear a filter." actions={<Button variant="secondary" onClick={() => { setFilters({ category: '', location: '', q: '', style: '' }); setBudget(''); setUseGuests(false); }}>Clear filters</Button>} />
        : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(list?.vendors ?? []).map((v) => {
              const best = v.packages.filter((p) => !guests || packageFits(p, guests)).sort((a, b) => packageEstimate(a, guests ?? 100) - packageEstimate(b, guests ?? 100))[0];
              return (
                <li key={v.id}>
                  <Card className="flex h-full flex-col overflow-hidden">
                    <Art src={v.portfolio[0] ?? v.logo} className="h-28 w-full" />
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <div className="flex flex-wrap gap-1.5"><TrustBadge vendor={v} /><Pill size="sm" tone="neutral">{VENDOR_CATEGORY_LABELS[v.category]}</Pill></div>
                      <h2 className="font-display text-lg font-extrabold leading-tight"><Link to={`/vendors/${v.id}`} className="hover:underline">{v.businessName}</Link></h2>
                      <p className="line-clamp-2 text-sm text-ink-soft">{v.description}</p>
                      <p className="flex flex-wrap gap-x-3 text-[13px] text-ink-soft"><span className="inline-flex items-center gap-1"><MapPin size={14} aria-hidden />{v.location}</span><span className="inline-flex items-center gap-1"><Users size={14} aria-hidden />{v.capacity.min}–{v.capacity.max}</span></p>
                      <p className="tabular mt-auto text-sm"><span className="text-ink-soft">{best ? `${best.name}: ` : 'From '}</span><strong>{best ? formatInr(packageEstimate(best, guests ?? 100)) : formatInr(v.startingPriceInr)}</strong>{best?.pricingUnit === 'per_guest' ? <span className="text-ink-soft"> for {guests ?? 100} guests</span> : null}</p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" variant={shortlisted(v.id) ? 'confirm' : 'secondary'} icon={shortlisted(v.id) ? Check : Heart} onClick={() => void toggleShortlist(v)} aria-pressed={shortlisted(v.id)}>{shortlisted(v.id) ? 'Shortlisted' : 'Shortlist'}</Button>
                        <Button size="sm" variant={compare.includes(v.id) ? 'primary' : 'ghost'} icon={GitCompareArrows} onClick={() => toggleCompare(v.id)} aria-pressed={compare.includes(v.id)}>Compare</Button>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

      {compare.length > 0 ? (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border-2 border-ink bg-canvas p-3 shadow-[var(--shadow-pop-sm)]">
          <p className="text-sm font-semibold">{compare.length} selected to compare (max 4)</p>
          <div className="flex gap-2"><Button size="sm" disabled={compare.length < 2} onClick={() => setShowCompare(true)}>Compare now</Button><Button size="sm" variant="ghost" onClick={() => setCompare([])}>Clear</Button></div>
        </div>
      ) : null}

      {showCompare ? <CompareDialog vendors={compared} guests={guests ?? 100} onClose={() => setShowCompare(false)} /> : null}
    </div>
  );
}

function CompareDialog({ vendors, guests, onClose }: { vendors: VendorView[]; guests: number; onClose: () => void }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  const rows: [string, (v: VendorView) => React.ReactNode][] = [
    ['Trust', (v) => <TrustBadge vendor={v} />], ['Category', (v) => VENDOR_CATEGORY_LABELS[v.category]], ['Location', (v) => v.location], ['Service areas', (v) => v.serviceAreas.join(', ') || '—'],
    ['Guest capacity', (v) => `${v.capacity.min}–${v.capacity.max}`], ['Specialisations', (v) => v.specialisations.join(', ') || '—'], ['Services', (v) => v.services.join(', ') || '—'],
    ['Rating', (v) => (v.reviews ? `${v.reviews.rating}/5 (${v.reviews.count})` : 'No reviews yet')],
    ['Availability', (v) => (v.availability.provided ? 'Supplied by vendor' : 'Unknown')],
    ['Packages', (v) => <ul className="flex flex-col gap-1">{v.packages.map((p) => <li key={p.id} className={cn(!packageFits(p, guests) && 'text-ink-soft line-through')}><strong>{p.name}</strong><br />{formatInr(packageEstimate(p, guests))}{p.pricingUnit === 'per_guest' ? ` (${formatInr(p.priceInr)}/guest)` : ''}</li>)}</ul>],
  ];
  return (
    <div role="dialog" aria-modal="true" aria-label="Compare vendors" className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-[20px] border-2 border-ink bg-canvas p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-2xl font-extrabold">Compare vendors</h2><Button iconOnly icon={X} label="Close comparison" variant="ghost" onClick={onClose} /></div>
        <p className="mb-3 text-sm text-ink-soft">Prices computed for {guests} guests from list prices. Demo data is fictional.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead><tr><th className="p-2" />{vendors.map((v) => <th key={v.id} className="p-2 align-bottom font-display text-base"><Link to={`/vendors/${v.id}`} className="hover:underline">{v.businessName}</Link></th>)}</tr></thead>
          <tbody>{rows.map(([label, cell]) => <tr key={label} className="border-t-2 border-line align-top"><th scope="row" className="p-2 font-semibold text-ink-soft">{label}</th>{vendors.map((v) => <td key={v.id} className="p-2">{cell(v)}</td>)}</tr>)}</tbody>
        </table></div>
      </div>
    </div>
  );
}
