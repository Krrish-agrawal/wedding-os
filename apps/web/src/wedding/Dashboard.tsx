import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CalendarHeart, ListChecks, MapPin, RotateCcw, Sparkles, Users } from 'lucide-react';
import { SAMPLE_VENUES, VENDOR_CATEGORY_LABELS, formatInr, summarizeBudget, type Enquiry, type WeddingProfile } from '@ave/shared';
import { Button, Card, ICON_STROKE, Notice, Pill, TextField, buttonClasses } from '@/ui';
import { useWedding } from './useWedding';
import { SavedLooks } from './tryon/SavedLooks';
import { daysUntil, planningChecklist } from './checklist';
import { vendorApi } from './vendors/api';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[13px] font-semibold text-ink-soft">{label}</p>
      <p className="tabular mt-1 font-display text-2xl font-extrabold">{value}</p>
      {sub ? <p className="mt-0.5 text-[13px] text-ink-soft">{sub}</p> : null}
    </Card>
  );
}

export default function Dashboard() {
  const { state, meta, act, reset, id } = useWedding();
  const [enquiries, setEnquiries] = useState<Enquiry[] | null>(null);
  const [enqError, setEnqError] = useState<string | null>(null);
  useEffect(() => { vendorApi.enquiries(id).then((r) => setEnquiries(r.enquiries)).catch((e: Error) => setEnqError(e.message)); }, [id]);
  const [form, setForm] = useState<{ coupleNames: string; city: string; date: string; guestCount: string; style: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [venueError, setVenueError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state && !form) {
      const p = state.profile;
      setForm({ coupleNames: p.coupleNames, city: p.city, date: p.date ?? '', guestCount: String(p.guestCount), style: p.style });
    }
  }, [state, form]);

  if (!state || !form) return <p className="text-ink-soft">Loading your wedding…</p>;
  const b = summarizeBudget(state);
  const venue = SAMPLE_VENUES.find((v) => v.id === state.venueId);
  const days = daysUntil(state.profile.date);
  const todo = planningChecklist(state, enquiries ?? []);

  async function save() {
    if (!state || !form) return;
    const patch: Partial<WeddingProfile> = {};
    if (form.coupleNames !== state.profile.coupleNames) patch.coupleNames = form.coupleNames;
    if (form.city !== state.profile.city) patch.city = form.city;
    if (form.style !== state.profile.style) patch.style = form.style;
    const guests = Number(form.guestCount);
    if (guests !== state.profile.guestCount) patch.guestCount = guests;
    const date = form.date === '' ? null : form.date;
    if (date !== state.profile.date) patch.date = date;
    if (Object.keys(patch).length === 0) return;
    const err = await act({ type: 'update_profile', patch });
    setFormError(err);
    setSaved(!err);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-extrabold">{state.profile.coupleNames || 'Your wedding'}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-soft">
            <span className="inline-flex items-center gap-1.5"><CalendarHeart size={16} strokeWidth={ICON_STROKE} aria-hidden />{state.profile.date ? `${state.profile.date}${days !== null ? (days >= 0 ? ` · ${days} days to go` : ' · date has passed') : ''}` : 'Date not set'}</span>
            <span className="inline-flex items-center gap-1.5"><MapPin size={16} strokeWidth={ICON_STROKE} aria-hidden />{state.profile.city || 'City not set'}</span>
            <span className="inline-flex items-center gap-1.5"><Users size={16} strokeWidth={ICON_STROKE} aria-hidden />{state.profile.guestCount} guests</span>
          </p>
        </div>
        <Link to="/planner" className={buttonClasses('primary', 'md')}>Plan with the AI planner</Link>
      </header>

      {!state.profile.onboarded ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-ink bg-blue-tint p-5">
          <div><h2 className="flex items-center gap-2 font-display text-xl font-extrabold"><Sparkles size={20} aria-hidden />Start onboarding</h2><p className="text-sm text-ink-soft">Answer a few questions and the planner, budget and vendor search start from your details.</p></div>
          <Link to="/welcome" className={buttonClasses('primary', 'md')}>Start onboarding</Link>
        </Card>
      ) : null}

      {meta ? <Notice tone="info" title="Sample data" body={meta.notice} live="off" /> : null}

      <section aria-label="Budget at a glance" className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total budget" value={b.total > 0 ? formatInr(b.total) : 'Not set'} />
        <Stat label="Planned" value={formatInr(b.allocated)} sub={b.total > 0 ? `${formatInr(b.unallocated)} unallocated` : undefined} />
        <Stat label="Spent" value={formatInr(b.spent)} />
        <Stat label="Remaining" value={formatInr(b.remaining)} sub={b.overBudget ? 'Over budget' : undefined} />
      </section>


      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 font-display text-xl font-extrabold"><ListChecks size={20} aria-hidden />Planning checklist</h2>
          <p className="text-[13px] text-ink-soft">Computed from your plan. This is not a notification service: nothing is sent to anyone.</p>
          {todo.length === 0 ? <p className="text-sm font-semibold text-mint-deep">Nothing outstanding. Nicely done.</p> : (
            <ul className="flex flex-col gap-2">{todo.map((t) => <li key={t.id}><Link to={t.to} className="flex items-start gap-2 rounded-[12px] border-2 border-line p-2.5 text-sm hover:border-ink"><Pill size="sm" tone={t.tone === 'warn' ? 'warn' : t.tone === 'info' ? 'blue' : 'waiting'}>{t.tone === 'todo' ? 'To do' : t.tone === 'warn' ? 'Attention' : 'Heads-up'}</Pill><span>{t.text}</span></Link></li>)}</ul>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between"><h2 className="font-display text-xl font-extrabold">Shortlisted vendors</h2><Link to="/vendors/mine" className="text-sm font-semibold underline">Manage</Link></div>
          {state.vendorShortlist.length === 0 ? <p className="text-sm text-ink-soft">None yet. <Link to="/vendors" className="font-semibold underline">Browse the marketplace</Link>.</p> : (
            <ul className="flex flex-col gap-2">{state.vendorShortlist.map((v) => <li key={v.vendorId} className="flex items-center justify-between gap-2 text-sm"><span><Link to={`/vendors/${v.vendorId}`} className="font-semibold hover:underline">{v.name}</Link> <span className="text-ink-soft">· {VENDOR_CATEGORY_LABELS[v.category]}</span></span>{v.source === 'demo' ? <Pill tone="warn" size="sm">DEMO DATA</Pill> : null}</li>)}</ul>
          )}
          <h3 className="mt-2 text-sm font-bold">Quote requests</h3>
          {enqError ? <p className="text-sm text-coral-deep">Couldn&rsquo;t load quote requests: {enqError}</p> : enquiries === null ? <p className="text-sm text-ink-soft">Loading…</p> : enquiries.length === 0 ? <p className="text-sm text-ink-soft">No quote requests yet.</p> : (
            <ul className="flex flex-col gap-1.5">{enquiries.slice(0, 5).map((e) => <li key={e.id} className="text-sm"><strong>{e.vendorName}</strong> · {e.status.replace(/_/g, ' ')}{e.quotation ? <span className="text-ink-soft"> · {e.quotation.label} {formatInr(e.quotation.amountInr)}</span> : null}</li>)}</ul>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between"><h2 className="font-display text-xl font-extrabold">Saved decoration designs</h2><Link to="/studio" className="text-sm font-semibold underline">Open studio</Link></div>
          {state.designs.length === 0 ? <p className="text-sm text-ink-soft">No saved designs. Save one from the 3D studio or ask the planner.</p> : (
            <ul className="flex flex-col gap-1.5">{state.designs.map((d) => <li key={d.id} className="text-sm"><strong>{d.name}</strong> <span className="text-ink-soft">· {d.objects.length} items · {SAMPLE_VENUES.find((v) => v.id === d.venueId)?.name ?? d.venueId}</span></li>)}</ul>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between"><h2 className="font-display text-xl font-extrabold">Saved outfits</h2><Link to="/tryon" className="text-sm font-semibold underline">Try-on</Link></div>
          <SavedLooks />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="font-display text-xl font-extrabold">Wedding details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Couple" value={form.coupleNames} onChange={(e) => setForm({ ...form, coupleNames: e.target.value })} maxLength={80} />
            <TextField label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={80} />
            <TextField label="Wedding date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <TextField label="Guests" type="number" min={1} max={5000} value={form.guestCount} onChange={(e) => setForm({ ...form, guestCount: e.target.value })} />
            <TextField className="sm:col-span-2" label="Style / theme" value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })} maxLength={80} />
          </div>
          {formError ? <Notice tone="error" title="Couldn't save" body={formError} live="assertive" /> : null}
          {saved && !formError ? <Notice tone="success" title="Saved" live="polite" /> : null}
          <div className="flex gap-2">
            <Button onClick={() => void save()}>Save details</Button>
            <Button variant="ghost" icon={RotateCcw} onClick={() => { void reset().then(() => setForm(null)); }}>Reset to sample</Button>
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-extrabold">Venue</h2>
            <Pill tone="waiting" size="sm">Sample venues</Pill>
          </div>
          {venue ? <p className="text-sm text-ink-soft">Selected: <strong className="text-ink">{venue.name}</strong></p> : <p className="text-sm text-ink-soft">No venue chosen yet.</p>}
          <ul className="flex flex-col gap-2">
            {SAMPLE_VENUES.map((v) => {
              const fits = v.capacity >= state.profile.guestCount;
              return (
                <li key={v.id} className="flex items-center justify-between gap-3 rounded-[14px] border-2 border-line p-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{v.name}</p>
                    <p className="text-[13px] text-ink-soft">{v.city} · up to {v.capacity} guests · about {formatInr(v.pricePerDay)}/day</p>
                    {!fits ? <p className="text-[13px] font-semibold text-coral-deep">Too small for {state.profile.guestCount} guests</p> : null}
                  </div>
                  <Button size="sm" variant={v.id === state.venueId ? 'confirm' : 'secondary'} disabled={!fits || v.id === state.venueId} onClick={async () => setVenueError(await act({ type: 'select_venue', venueId: v.id }))}>
                    {v.id === state.venueId ? 'Selected' : 'Choose'}
                  </Button>
                </li>
              );
            })}
          </ul>
          {venueError ? <Notice tone="error" title="Couldn't choose that venue" body={venueError} live="assertive" /> : null}
        </Card>
      </div>
    </div>
  );
}
