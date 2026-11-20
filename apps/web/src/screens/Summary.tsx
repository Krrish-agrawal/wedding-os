import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { MotionConfig, motion } from 'motion/react';
import {
  ArrowRight,
  BadgePercent,
  CalendarCheck,
  CalendarPlus,
  CircleCheck,
  CircleX,
  Clock3,
  Eye,
  Info,
  Mail,
  MapPin,
  MessageCircle,
  NotebookPen,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { VIEW_LABELS, formatINR, formatINRShort, type Delivery, type PropertyBundle, type SessionState, type VisitSlot } from '@ave/shared';
import { getBundle } from '@/content';
import { VIEWS } from '@/views/registry';
import { keyFigures, saleTotals } from '@/views/shortlist/figures';
import {
  ACCENT_BG,
  BrandMark,
  Button,
  Card,
  CountUp,
  ErrorState,
  HeaderMark,
  ICON_STROKE,
  LoadingState,
  Mascot,
  Spinner,
  Sticker,
  Tag,
  buttonClasses,
  cn,
  propertyTypeIcon,
} from '@/ui';
import { firstName, useAdvisorName } from '@/call/advisor';
import { buyerDeliveries, callWindow, deliveryWording, formatDuration, propertiesDiscussed, recapPending, viewTimes, type DeliveryTone } from '@/call/recap';

const POLL_MS = 4000;
/** Visits are at the property, so times read in the property's time zone. */
const PROPERTY_TIME_ZONE = 'Asia/Kolkata';
const dayFormat = new Intl.DateTimeFormat('en-IN', { timeZone: PROPERTY_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' });
const timeFormat = new Intl.DateTimeFormat('en-IN', { timeZone: PROPERTY_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true });
const callDateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

type Load = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready'; state: SessionState };

/** Fetches the session once, then keeps polling while the recap delivery is still settling. */
function useSessionSnapshot(sessionId: string | undefined): [Load, () => void] {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setLoad({ status: 'missing' });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
        if (cancelled) return;
        if (res.status === 404) return setLoad({ status: 'missing' });
        if (!res.ok) throw new Error(`The server answered ${res.status}.`);
        const { state } = (await res.json()) as { state: SessionState };
        if (cancelled) return;
        setLoad({ status: 'ready', state });
        if (recapPending(state, Date.now())) timer = setTimeout(fetchOnce, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        const offline = err instanceof TypeError || !navigator.onLine;
        setLoad((prev) =>
          prev.status === 'ready' ? prev : { status: 'error', message: offline ? "We can't reach our server right now." : (err as Error).message },
        );
      }
    };
    void fetchOnce();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, attempt]);

  return [load, () => setAttempt((a) => a + 1)];
}

export default function Summary() {
  const { sessionId } = useParams();
  const [load, retry] = useSessionSnapshot(sessionId);

  let body: ReactNode;
  if (load.status === 'loading') body = <LoadingState layout="page" title="Putting your recap together" body="One moment." />;
  else if (load.status === 'missing')
    body = (
      <ErrorState
        layout="page"
        title="We couldn't find this call"
        body="The recap may have been cleared, or the link is incomplete. You can start a new call any time."
        actions={<NewCallLink />}
      />
    );
  else if (load.status === 'error')
    body = (
      <ErrorState
        layout="page"
        title="Your recap didn't load"
        body={`${load.message} Check your connection and try again.`}
        actions={
          <>
            <Button size="lg" icon={RotateCcw} onClick={retry}>
              Try again
            </Button>
            <NewCallLink variant="secondary" />
          </>
        }
      />
    );
  else body = <Recap state={load.state} />;

  return <MotionConfig reducedMotion="user">{body}</MotionConfig>;
}

function NewCallLink({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  return (
    <Link to="/" className={buttonClasses(variant, 'lg')}>
      Start a new call <ArrowRight size={18} strokeWidth={ICON_STROKE} aria-hidden />
    </Link>
  );
}

function Recap({ state }: { state: SessionState }) {
  const advisor = useAdvisorName();
  const [now] = useState(() => Date.now());
  const call = callWindow(state);
  const duration = (call.end ?? now) - call.start;
  const views = viewTimes(state, now);
  const properties = propertiesDiscussed(state)
    .map((id) => getBundle(id))
    .filter((b): b is PropertyBundle => Boolean(b));
  const bookedBundle = state.booking.status === 'confirmed' ? getBundle(state.booking.propertyId) : null;
  const slot = bookedBundle?.visits.find((v) => v.id === state.booking.slotId) ?? null;

  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-[1240px] items-center justify-between px-10 pt-7">
        <BrandMark size="sm" />
        <Link to="/" className={buttonClasses('ghost', 'sm')}>
          <RotateCcw size={16} strokeWidth={ICON_STROKE} aria-hidden />
          Start a new call
        </Link>
      </header>

      <main className="mx-auto max-w-[1240px] px-10 pb-14 pt-8">
        <section className="flex items-center gap-8" aria-labelledby="recap-title">
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 360, damping: 20 }}
            className="grid h-[150px] w-[150px] shrink-0 place-items-center rounded-full border-2 border-ink bg-sun shadow-[var(--shadow-pop)]"
          >
            <Mascot state="happy" size={118} shadow={false} />
          </motion.div>
          <div className="min-w-0">
            <p className="text-sm font-bold uppercase tracking-[0.08em] text-ink-soft">Call recap</p>
            <h1 id="recap-title" className="mt-1 text-[46px] font-extrabold leading-[1.04] tracking-[-0.03em]">
              Thanks, {firstName(state.buyer.name)}. Here's what we covered.
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-ink-soft">
              <span className="inline-flex items-center gap-1.5">
                <CalendarCheck size={15} strokeWidth={ICON_STROKE} aria-hidden />
                {callDateFormat.format(call.start)}
              </span>
              {call.wasLive && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={15} strokeWidth={ICON_STROKE} aria-hidden />
                  {formatDuration(duration)} with {advisor}
                </span>
              )}
              {state.handoff.status === 'joined' || state.handoff.status === 'returned' ? (
                <span>Joined by {state.handoff.humanName ?? 'a senior advisor'}</span>
              ) : null}
            </p>
          </div>
        </section>

        <div className="mt-10 grid grid-cols-12 gap-6">
          <div className="col-span-7 flex flex-col gap-6">
            <NextStep bundle={bookedBundle} slot={slot} advisor={advisor} />
            <PropertiesDiscussed bundles={properties} state={state} />
          </div>
          <div className="col-span-5 flex flex-col gap-6">
            <RecapDelivery state={state} />
            <ViewsSeen views={views} />
            <YourBrief state={state} />
          </div>
        </div>

        <p className="mt-10 flex items-start gap-2 text-[13px] text-ink-soft">
          <Info size={15} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0" />
          Sample listings for a demo. Prices are estimates computed from the listing's line items and current rates.
        </p>
      </main>
    </div>
  );
}

function SectionTitle({ icon, accent, children, aside }: { icon: LucideIcon; accent: Parameters<typeof HeaderMark>[0]['accent']; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <HeaderMark accent={accent} icon={icon} size="sm" />
      <h2 className="flex-1 text-lg font-bold">{children}</h2>
      {aside}
    </div>
  );
}

function NextStep({ bundle, slot, advisor }: { bundle: PropertyBundle | null; slot: VisitSlot | null; advisor: string }) {
  if (bundle && slot) {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    return (
      <Card tint="mint" className="relative overflow-hidden p-6" elevation="lifted">
        <Sticker tone="mint" tilt="right" icon={CalendarCheck} className="absolute right-5 top-5">
          Booked
        </Sticker>
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-mint-deep">Next step</p>
        <h2 className="mt-1 text-[30px] font-extrabold leading-tight">See you at the site visit</h2>
        <p className="mt-3 font-display text-2xl font-bold">
          {dayFormat.format(start)}, {timeFormat.format(start)} to {timeFormat.format(end)}
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-[15px]">
          <MapPin size={16} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0 text-tangerine" />
          <span>
            <strong>{bundle.property.name}</strong>, {bundle.property.address}
          </span>
        </p>
        <p className="mt-4 text-sm text-ink-soft">Need a different time? Start a new call and ask {advisor} to move it.</p>
      </Card>
    );
  }
  return (
    <Card tint="blue" className="p-6" elevation="lifted">
      <p className="text-sm font-bold uppercase tracking-[0.08em] text-blue-deep">Next step</p>
      <h2 className="mt-1 text-[30px] font-extrabold leading-tight">Book a site visit</h2>
      <p className="mt-2 max-w-[520px] text-[15px]">
        Seeing the place in person is the best way to decide. Start a new call and ask {advisor} for a visit slot that suits you.
      </p>
      <Link to="/" className={cn(buttonClasses('primary', 'lg'), 'mt-5')}>
        <CalendarPlus size={18} strokeWidth={ICON_STROKE} aria-hidden />
        Start a new call
      </Link>
    </Card>
  );
}

function PropertiesDiscussed({ bundles, state }: { bundles: PropertyBundle[]; state: SessionState }) {
  return (
    <section className="flex flex-col gap-3" aria-label="Properties discussed">
      <SectionTitle icon={Eye} accent="blue">
        Properties you looked at
      </SectionTitle>
      {bundles.length === 0 ? (
        <Card quiet className="p-5 text-[15px] text-ink-soft">
          You didn't open a property on this call. The shortlist will be waiting next time.
        </Card>
      ) : (
        bundles.map((b) => <PropertyRecap key={b.property.id} bundle={b} applied={state.appliedOffers[b.property.id] ?? []} />)
      )}
    </section>
  );
}

function PropertyRecap({ bundle, applied }: { bundle: PropertyBundle; applied: string[] }) {
  const { property } = bundle;
  const Icon = propertyTypeIcon(property);
  const figures = keyFigures(bundle, applied);
  const totals = saleTotals(bundle, applied);
  const hasOffers = Boolean(totals && totals.discounts.length > 0);

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border-2 border-ink bg-blue-tint">
          <Icon size={22} strokeWidth={ICON_STROKE} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag accent={property.kind === 'sale' ? 'blue' : 'grape'}>{property.kind === 'sale' ? 'For sale' : 'For lease'}</Tag>
            <Tag>{property.configuration}</Tag>
            <Tag>Sample listing</Tag>
          </div>
          <h3 className="mt-1.5 text-xl font-extrabold leading-tight">{property.name}</h3>
          <p className="text-sm text-ink-soft">
            {property.localityName}, {property.city} · {figures.area.text} carpet
          </p>
        </div>
        {figures.price && (
          <div className="shrink-0 text-right">
            <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-soft">{hasOffers ? 'Your price' : figures.price.label}</p>
            <p className="font-display text-[28px] font-extrabold leading-none">
              <CountUp value={figures.price.value} format={formatINRShort} />
              {figures.price.suffix && <span className="ml-0.5 font-sans text-sm font-semibold text-ink-soft">{figures.price.suffix}</span>}
            </p>
            {figures.price.note && <p className="mt-1 text-xs text-ink-soft">{figures.price.note}</p>}
          </div>
        )}
      </div>

      {totals && hasOffers && (
        <div className="mt-4 rounded-[14px] border-2 border-ink bg-coral-tint p-4">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <BadgePercent size={16} strokeWidth={ICON_STROKE} aria-hidden />
            Offers applied
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-[14.5px]">
            {totals.discounts.map((d) => (
              <li key={d.offerId} className="flex justify-between gap-4">
                <span>{d.title}</span>
                <span className="tabular font-semibold">−{formatINR(d.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between gap-4 border-t-2 border-dashed border-ink/25 pt-3">
            <span className="text-sm text-ink-soft">
              Was <span className="tabular line-through">{formatINR(totals.subtotal)}</span>
            </span>
            <span className="tabular font-display text-xl font-extrabold">{formatINR(totals.total)}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

const DELIVERY_ICON: Record<Delivery['channel'], LucideIcon> = { email: Mail, whatsapp: MessageCircle, crm: Mail, slack: Mail, jira: Mail };
const DELIVERY_TONE: Record<DeliveryTone, { mark: string; icon: LucideIcon | null }> = {
  success: { mark: 'bg-mint', icon: CircleCheck },
  waiting: { mark: 'bg-sun', icon: null },
  error: { mark: 'bg-coral', icon: CircleX },
  muted: { mark: 'bg-paper', icon: Info },
};

function RecapDelivery({ state }: { state: SessionState }) {
  const deliveries = buyerDeliveries(state);
  const pending = recapPending(state, Date.now());
  return (
    <Card className="p-5">
      <SectionTitle icon={Mail} accent="mint" aside={pending ? <Spinner size={16} label="Checking for updates" /> : undefined}>
        Your recap
      </SectionTitle>
      {deliveries.length === 0 ? (
        <p className="mt-3 text-[15px] text-ink-soft">
          {pending ? 'Preparing your recap. This page updates when it goes out.' : "No recap has been sent for this call. Ask for one on your next call and we'll send it."}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {deliveries.map((d) => {
            const w = deliveryWording(d);
            const tone = DELIVERY_TONE[w.tone];
            const ChannelIcon = DELIVERY_ICON[d.channel];
            const StatusIcon = tone.icon;
            return (
              <li key={d.id} className="flex items-start gap-3">
                <span aria-hidden className={cn('relative grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border-2 border-ink', tone.mark)}>
                  <ChannelIcon size={18} strokeWidth={ICON_STROKE} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[15px] font-bold">
                    {w.tone === 'waiting' ? <Spinner size={14} /> : StatusIcon ? <StatusIcon size={15} strokeWidth={ICON_STROKE} aria-hidden /> : null}
                    <span className="truncate">{w.title}</span>
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-[0.07em] text-ink-soft">{d.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</p>
                  {w.body && <p className="mt-1 text-sm text-ink-soft">{w.body}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ViewsSeen({ views }: { views: { view: keyof typeof VIEW_LABELS; ms: number }[] }) {
  return (
    <Card className="p-5">
      <SectionTitle icon={Eye} accent="tangerine">
        What you looked at
      </SectionTitle>
      {views.length === 0 ? (
        <p className="mt-3 text-[15px] text-ink-soft">Nothing was opened on screen during this call.</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-2">
          {views.map(({ view, ms }) => {
            const mod = VIEWS[view];
            const Icon = mod.icon;
            return (
              <li key={view} className="inline-flex items-center gap-2 rounded-[var(--radius-chip)] border-2 border-ink bg-canvas py-1 pl-1 pr-3 text-sm font-semibold">
                <span aria-hidden className={cn('grid h-7 w-7 place-items-center rounded-full border-2 border-ink', ACCENT_BG[mod.accent])}>
                  <Icon size={14} strokeWidth={ICON_STROKE} />
                </span>
                {VIEW_LABELS[view]}
                <span className="tabular font-normal text-ink-soft">{formatDuration(ms)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function YourBrief({ state }: { state: SessionState }) {
  const { lead } = state;
  const rows: { label: string; value: string }[] = [];
  if (lead.purpose) rows.push({ label: 'Looking for', value: lead.purpose });
  if (lead.budget) rows.push({ label: 'Budget', value: lead.budget });
  if (lead.timeline) rows.push({ label: 'Timeline', value: lead.timeline });
  if (lead.needs.length) rows.push({ label: 'Must-haves', value: lead.needs.join(', ') });
  if (lead.concerns.length) rows.push({ label: 'Questions to follow up', value: lead.concerns.join(', ') });
  if (rows.length === 0) return null;
  return (
    <Card className="p-5">
      <SectionTitle icon={NotebookPen} accent="sun">
        What you told us
      </SectionTitle>
      <dl className="mt-4 flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.label}>
            <dt className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-soft">{r.label}</dt>
            <dd className="text-[15px]">{r.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

