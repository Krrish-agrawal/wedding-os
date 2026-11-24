import { useCallback, useEffect, useMemo, useState } from 'react';
import { ENQUIRY_STATUSES, VENDOR_CATEGORIES, VENDOR_CATEGORY_LABELS, formatInr, type Enquiry, type EnquiryStatus, type VendorCategory, type VendorInput, type VendorPackage } from '@ave/shared';
import { Button, Card, Notice, Pill, TextField } from '@/ui';
import { weddingApi } from '../../api';
import { vendorApi, type VendorView } from '../api';

const KEY = 'wedding-os:admin-key';
const readKey = () => { try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; } };
const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const tone = (t: VendorView['trust']) => (t === 'Verified' ? 'live' : t === 'DEMO DATA' ? 'warn' : t === 'Verification pending' ? 'waiting' : 'muted') as 'live' | 'warn' | 'waiting' | 'muted';
const selectCls = 'rounded-[var(--radius-control)] border-2 border-ink bg-canvas px-3 py-2 text-sm';

interface Form {
  businessName: string; category: VendorCategory; description: string; location: string; serviceAreas: string; specialisations: string; services: string;
  capMin: string; capMax: string; startingPriceInr: string; logo: string; portfolio: string[]; packages: PkgForm[];
}
interface PkgForm { id: string; name: string; description: string; priceInr: string; pricingUnit: 'flat' | 'per_guest'; includes: string; minGuests: string; maxGuests: string }

const emptyForm = (): Form => ({ businessName: '', category: 'decorator', description: '', location: '', serviceAreas: '', specialisations: '', services: '', capMin: '0', capMax: '500', startingPriceInr: '0', logo: '', portfolio: [], packages: [] });
const fromVendor = (v: VendorView): Form => ({
  businessName: v.businessName, category: v.category, description: v.description, location: v.location, serviceAreas: v.serviceAreas.join(', '), specialisations: v.specialisations.join(', '), services: v.services.join(', '),
  capMin: String(v.capacity.min), capMax: String(v.capacity.max), startingPriceInr: String(v.startingPriceInr), logo: v.logo ?? '', portfolio: [...v.portfolio],
  packages: v.packages.map((p) => ({ id: p.id, name: p.name, description: p.description, priceInr: String(p.priceInr), pricingUnit: p.pricingUnit, includes: p.includes.join(', '), minGuests: p.minGuests?.toString() ?? '', maxGuests: p.maxGuests?.toString() ?? '' })),
});
const toInput = (f: Form): VendorInput => ({
  businessName: f.businessName.trim(), category: f.category, description: f.description.trim(), logo: f.logo.trim() || null, portfolio: f.portfolio.map((p) => p.trim()).filter(Boolean),
  location: f.location.trim(), serviceAreas: csv(f.serviceAreas), specialisations: csv(f.specialisations), services: csv(f.services),
  capacity: { min: Number(f.capMin), max: Number(f.capMax) }, startingPriceInr: Number(f.startingPriceInr),
  packages: f.packages.map((p): VendorPackage => ({ id: p.id.trim(), name: p.name.trim(), description: p.description.trim(), priceInr: Number(p.priceInr), pricingUnit: p.pricingUnit, includes: csv(p.includes), ...(p.minGuests ? { minGuests: Number(p.minGuests) } : {}), ...(p.maxGuests ? { maxGuests: Number(p.maxGuests) } : {}) })),
});

export default function AdminPage() {
  const [key, setKey] = useState(readKey);
  const [keyInput, setKeyInput] = useState(readKey);
  const [demoKey, setDemoKey] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorView[] | null>(null);
  const [enquiries, setEnquiries] = useState<Enquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [filter, setFilter] = useState({ q: '', category: '' });
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [tab, setTab] = useState<'vendors' | 'enquiries'>('vendors');

  useEffect(() => { weddingApi.meta().then((m) => { const k = (m as { adminDemoKey?: string | null }).adminDemoKey ?? null; setDemoKey(k); setKeyInput((cur) => cur || k || ''); }).catch(() => undefined); }, []);

  const load = useCallback(async (k: string) => {
    setError(null);
    try {
      const [v, e] = await Promise.all([vendorApi.admin.vendors(k), vendorApi.admin.enquiries(k)]);
      setVendors(v.vendors); setEnquiries(e.enquiries);
    } catch (err) { setVendors(null); setError(msg(err)); if ((err as { status?: number }).status === 401) { setKey(''); try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } } }
  }, []);
  useEffect(() => { if (key) void load(key); }, [key, load]);

  const signIn = () => { try { sessionStorage.setItem(KEY, keyInput); } catch { /* ignore */ } setKey(keyInput); };
  const signOut = () => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } setKey(''); setVendors(null); setEnquiries(null); };
  const flash = (m: string) => { setOk(m); setError(null); };

  const shown = useMemo(() => (vendors ?? []).filter((v) => (!filter.category || v.category === filter.category) && (!filter.q || `${v.businessName} ${v.location}`.toLowerCase().includes(filter.q.toLowerCase()))), [vendors, filter]);

  if (!key || (!vendors && !error)) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <h1 className="font-display text-4xl font-extrabold">Vendor admin</h1>
        {error ? <Notice tone="error" title="Could not sign in" body={error} live="assertive" /> : null}
        {demoKey ? <Notice tone="warn" title="Demo admin key" body="This server is running with a demo key (not for production). Set WEDDING_ADMIN_KEY to secure admin." live="off" /> : null}
        <Card className="flex flex-col gap-3 p-5">
          <TextField label="Admin key" type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} hint="Kept in this tab's session only." />
          <Button disabled={!keyInput} onClick={signIn}>{key ? 'Loading…' : 'Open admin'}</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl font-extrabold">Vendor admin</h1>
        <div className="flex gap-2">
          <Button variant={tab === 'vendors' ? 'primary' : 'secondary'} onClick={() => setTab('vendors')}>Vendors</Button>
          <Button variant={tab === 'enquiries' ? 'primary' : 'secondary'} onClick={() => setTab('enquiries')}>Quote requests{enquiries ? ` (${enquiries.length})` : ''}</Button>
          <Button variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      </div>
      {demoKey ? <Notice tone="warn" title="Demo admin key in use" body="Not for production. Set WEDDING_ADMIN_KEY on the server." live="off" /> : null}
      {error ? <Notice tone="error" title="That did not work" body={error} live="assertive" /> : null}
      {ok ? <Notice tone="success" title={ok} live="polite" /> : null}

      {tab === 'vendors' ? (
        editing ? (
          <VendorEditor
            adminKey={key} id={editing.id} initial={editing.form} vendor={vendors?.find((v) => v.id === editing.id) ?? null}
            onCancel={() => setEditing(null)} onError={setError}
            onSaved={(m, v) => { flash(m); setVendors((cur) => (cur ? (cur.some((x) => x.id === v.id) ? cur.map((x) => (x.id === v.id ? v : x)) : [...cur, v]) : cur)); setEditing({ id: v.id, form: fromVendor(v) }); }}
          />
        ) : (
          <>
            <Card className="flex flex-wrap items-end gap-3 p-4">
              <TextField className="w-56" label="Search" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
              <label className="flex flex-col gap-1 text-sm font-semibold">Category
                <select className={selectCls} value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
                  <option value="">All</option>{VENDOR_CATEGORIES.map((c) => <option key={c} value={c}>{VENDOR_CATEGORY_LABELS[c]}</option>)}
                </select>
              </label>
              <Button className="ml-auto" onClick={() => { setOk(null); setEditing({ id: null, form: emptyForm() }); }}>Add vendor</Button>
            </Card>
            {!vendors ? <p className="text-ink-soft">Loading…</p> : shown.length === 0 ? <Card className="p-6 text-ink-soft">No vendors match.</Card> : (
              <div className="grid gap-3 md:grid-cols-2">
                {shown.map((v) => (
                  <Card key={v.id} className="flex flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2"><h2 className="font-display text-lg font-extrabold">{v.businessName}</h2><Pill tone={tone(v.trust)} size="sm">{v.trust}</Pill></div>
                    <p className="text-sm text-ink-soft">{VENDOR_CATEGORY_LABELS[v.category]} · {v.location} · from {formatInr(v.startingPriceInr)} · {v.packages.length} package(s)</p>
                    <Button variant="secondary" onClick={() => { setOk(null); setEditing({ id: v.id, form: fromVendor(v) }); }}>Edit</Button>
                  </Card>
                ))}
              </div>
            )}
          </>
        )
      ) : (
        <EnquiryTable adminKey={key} enquiries={enquiries} onChange={(e) => setEnquiries((cur) => cur?.map((x) => (x.id === e.id ? e : x)) ?? cur)} onError={setError} onOk={flash} />
      )}
    </div>
  );
}

function VendorEditor({ adminKey, id, initial, vendor, onCancel, onSaved, onError }: { adminKey: string; id: string | null; initial: Form; vendor: VendorView | null; onCancel: () => void; onSaved: (m: string, v: VendorView) => void; onError: (m: string | null) => void }) {
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState(vendor?.availability.bookedDates.join(', ') ?? '');
  const [note, setNote] = useState(vendor?.availability.note ?? '');
  const [how, setHow] = useState('');
  useEffect(() => { setF(initial); setBooked(vendor?.availability.bookedDates.join(', ') ?? ''); setNote(vendor?.availability.note ?? ''); }, [initial, vendor]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const setPkg = (i: number, patch: Partial<PkgForm>) => set('packages', f.packages.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  const run = async (m: string, fn: () => Promise<{ vendor: VendorView }>) => { setBusy(true); onError(null); try { onSaved(m, (await fn()).vendor); } catch (e) { onError(msg(e)); } finally { setBusy(false); } };
  const save = () => run(id ? 'Vendor saved.' : 'Vendor added.', () => (id ? vendorApi.admin.update(adminKey, id, toInput(f)) : vendorApi.admin.create(adminKey, toInput(f))));
  const isDemo = vendor?.source === 'demo';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h2 className="font-display text-2xl font-extrabold">{id ? `Edit ${vendor?.businessName ?? ''}` : 'Add vendor'}</h2><Button variant="ghost" onClick={onCancel}>Back to list</Button></div>
      {isDemo ? <Notice tone="warn" title="DEMO DATA vendor" body="Fictional example. It can be edited but never verified." live="off" /> : null}
      <Card className="grid gap-3 p-5 md:grid-cols-2">
        <TextField label="Business name" value={f.businessName} onChange={(e) => set('businessName', e.target.value)} />
        <label className="flex flex-col gap-1 text-sm font-semibold">Category
          <select className={selectCls} value={f.category} onChange={(e) => set('category', e.target.value as VendorCategory)}>{VENDOR_CATEGORIES.map((c) => <option key={c} value={c}>{VENDOR_CATEGORY_LABELS[c]}</option>)}</select>
        </label>
        <TextField label="Base location" value={f.location} onChange={(e) => set('location', e.target.value)} />
        <TextField label="Service areas (comma separated)" value={f.serviceAreas} onChange={(e) => set('serviceAreas', e.target.value)} />
        <TextField label="Specialisations (comma separated)" value={f.specialisations} onChange={(e) => set('specialisations', e.target.value)} />
        <TextField label="Services (comma separated)" value={f.services} onChange={(e) => set('services', e.target.value)} />
        <TextField label="Guests: minimum" type="number" min={0} value={f.capMin} onChange={(e) => set('capMin', e.target.value)} />
        <TextField label="Guests: maximum" type="number" min={1} value={f.capMax} onChange={(e) => set('capMax', e.target.value)} />
        <TextField label="Starting price (₹)" type="number" min={0} value={f.startingPriceInr} onChange={(e) => set('startingPriceInr', e.target.value)} />
        <TextField label="Logo image URL" value={f.logo} onChange={(e) => set('logo', e.target.value)} />
        <label className="flex flex-col gap-1 text-sm font-semibold md:col-span-2">Description
          <textarea className="min-h-20 rounded-[var(--radius-control)] border-2 border-ink bg-canvas p-3 text-sm font-normal" value={f.description} onChange={(e) => set('description', e.target.value)} />
        </label>
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <h3 className="font-display text-lg font-extrabold">Portfolio images</h3>
        {f.portfolio.length === 0 ? <p className="text-sm text-ink-soft">No images yet.</p> : null}
        {f.portfolio.map((p, i) => (
          <div key={i} className="flex gap-2"><TextField className="flex-1" label={`Image ${i + 1} URL`} value={p} onChange={(e) => set('portfolio', f.portfolio.map((x, n) => (n === i ? e.target.value : x)))} /><Button variant="ghost" onClick={() => set('portfolio', f.portfolio.filter((_, n) => n !== i))}>Remove</Button></div>
        ))}
        <div><Button variant="secondary" onClick={() => set('portfolio', [...f.portfolio, ''])}>Add image URL</Button></div>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h3 className="font-display text-lg font-extrabold">Packages</h3>
        {f.packages.length === 0 ? <p className="text-sm text-ink-soft">No packages yet.</p> : null}
        {f.packages.map((p, i) => (
          <div key={i} className="grid gap-2 rounded-[var(--radius-control)] border-2 border-line p-3 md:grid-cols-3">
            <TextField label="Id (letters, digits, -)" value={p.id} onChange={(e) => setPkg(i, { id: e.target.value })} />
            <TextField label="Name" value={p.name} onChange={(e) => setPkg(i, { name: e.target.value })} />
            <TextField label="Price (₹)" type="number" min={0} value={p.priceInr} onChange={(e) => setPkg(i, { priceInr: e.target.value })} />
            <label className="flex flex-col gap-1 text-sm font-semibold">Pricing
              <select className={selectCls} value={p.pricingUnit} onChange={(e) => setPkg(i, { pricingUnit: e.target.value as 'flat' | 'per_guest' })}><option value="flat">Flat</option><option value="per_guest">Per guest</option></select>
            </label>
            <TextField label="Min guests" type="number" min={0} value={p.minGuests} onChange={(e) => setPkg(i, { minGuests: e.target.value })} />
            <TextField label="Max guests" type="number" min={0} value={p.maxGuests} onChange={(e) => setPkg(i, { maxGuests: e.target.value })} />
            <TextField className="md:col-span-2" label="Includes (comma separated)" value={p.includes} onChange={(e) => setPkg(i, { includes: e.target.value })} />
            <TextField label="Description" value={p.description} onChange={(e) => setPkg(i, { description: e.target.value })} />
            <div><Button variant="ghost" onClick={() => set('packages', f.packages.filter((_, n) => n !== i))}>Remove package</Button></div>
          </div>
        ))}
        <div><Button variant="secondary" onClick={() => set('packages', [...f.packages, { id: `pkg-${f.packages.length + 1}`, name: '', description: '', priceInr: '0', pricingUnit: 'flat', includes: '', minGuests: '', maxGuests: '' }])}>Add package</Button></div>
      </Card>

      <div className="flex gap-2"><Button disabled={busy || !f.businessName.trim() || !f.location.trim()} onClick={() => void save()}>{busy ? 'Saving…' : id ? 'Save vendor' : 'Create vendor'}</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>

      {id && vendor ? (
        <>
          <Card className="flex flex-col gap-3 p-5">
            <h3 className="font-display text-lg font-extrabold">Availability</h3>
            <p className="text-sm text-ink-soft">{vendor.availability.provided ? 'Supplied by an admin.' : 'Not supplied: availability is shown to customers as unknown.'}</p>
            <TextField label="Booked dates (YYYY-MM-DD, comma separated)" value={booked} onChange={(e) => setBooked(e.target.value)} />
            <TextField label="Note (source of this information)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div><Button disabled={busy} onClick={() => void run('Availability updated.', () => vendorApi.admin.availability(adminKey, id, csv(booked), note.trim()))}>Save availability</Button></div>
          </Card>
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2"><h3 className="font-display text-lg font-extrabold">Verification</h3><Pill tone={tone(vendor.trust)} size="sm">{vendor.trust}</Pill></div>
            {isDemo ? <p className="text-sm text-ink-soft">DEMO DATA vendors are fictional and cannot be verified.</p> : (
              <>
                <p className="text-sm text-ink-soft">Only mark verified after a real check (e.g. site visit, registration documents). Nothing is verified automatically.</p>
                <TextField label="How was this vendor verified?" value={how} onChange={(e) => setHow(e.target.value)} placeholder="Who checked what, and when" />
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={busy} onClick={() => void run('Marked pending.', () => vendorApi.admin.verify(adminKey, id, 'pending'))}>Mark pending</Button>
                  <Button disabled={busy || how.trim().length < 5} onClick={() => void run('Vendor verified.', () => vendorApi.admin.verify(adminKey, id, 'verified', how.trim()))}>Mark verified</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void run('Verification removed.', () => vendorApi.admin.verify(adminKey, id, 'unverified'))}>Remove verification</Button>
                </div>
                {vendor.verification.status === 'verified' ? <p className="text-sm text-ink-soft">Verified by: {vendor.verification.verifiedBy} on {vendor.verification.verifiedAt?.slice(0, 10)}</p> : null}
              </>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function EnquiryTable({ adminKey, enquiries, onChange, onError, onOk }: { adminKey: string; enquiries: Enquiry[] | null; onChange: (e: Enquiry) => void; onError: (m: string | null) => void; onOk: (m: string) => void }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!enquiries) return <p className="text-ink-soft">Loading…</p>;
  if (enquiries.length === 0) return <Card className="p-6 text-ink-soft">No quote requests yet.</Card>;
  const patch = async (id: string, p: { status?: EnquiryStatus; adminNote?: string }) => { try { onChange((await vendorApi.admin.updateEnquiry(adminKey, id, p)).enquiry); onError(null); onOk('Quote request updated.'); } catch (e) { onError(msg(e)); } };
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-left text-[15px]">
        <thead><tr className="border-b-2 border-ink text-[13px] text-ink-soft"><th className="p-3">Vendor</th><th className="p-3">Wedding</th><th className="p-3">Quotation</th><th className="p-3">Status</th><th className="p-3">Admin note</th></tr></thead>
        <tbody>
          {enquiries.map((e) => (
            <tr key={e.id} className="border-b border-line align-top">
              <td className="p-3"><strong>{e.vendorName}</strong><br /><span className="text-sm text-ink-soft">{e.packageName ?? 'No package'}{e.vendorSource === 'demo' ? ' · DEMO DATA' : ''}</span></td>
              <td className="p-3 text-sm">{e.weddingId.slice(0, 10)}…<br />{e.guestCount} guests{e.eventDate ? ` · ${e.eventDate}` : ''}{e.message ? <><br />“{e.message}”</> : null}</td>
              <td className="p-3 text-sm">{e.quotation ? <><Pill tone="warn" size="sm">{e.quotation.label}</Pill><br />{formatInr(e.quotation.amountInr)}</> : '—'}</td>
              <td className="p-3"><select aria-label="Status" className={selectCls} value={e.status} onChange={(ev) => void patch(e.id, { status: ev.target.value as EnquiryStatus })}>{ENQUIRY_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></td>
              <td className="p-3"><div className="flex gap-1"><input aria-label="Admin note" className="w-40 rounded-[var(--radius-control)] border-2 border-ink bg-canvas px-2 py-1 text-sm" value={notes[e.id] ?? e.adminNote} onChange={(ev) => setNotes({ ...notes, [e.id]: ev.target.value })} /><Button variant="secondary" disabled={(notes[e.id] ?? e.adminNote) === e.adminNote} onClick={() => void patch(e.id, { adminNote: notes[e.id] ?? '' })}>Save</Button></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
