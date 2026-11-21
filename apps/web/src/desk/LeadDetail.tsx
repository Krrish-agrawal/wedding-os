import { useState, type ReactNode } from 'react';
import {
  CalendarCheck,
  Headset,
  IndianRupee,
  Mail,
  MessageCircle,
  Phone,
  Send,
  Sparkles,
  UserRound,
} from 'lucide-react';
import {
  formatDateTimeIST,
  formatINR,
  formatINRShort,
  formatSlot,
  formatSpan,
  formatTimeIST,
  VIEW_LABELS,
  type LeadDetail as Lead,
  type ReportChannel,
  type TimelineEvent,
} from '@ave/shared';
import { Link } from 'react-router';
import { Avatar, Button, EmptyState, ErrorState, ICON_STROKE, LoadingState, Pill, Tag, buttonClasses, cn, toast, ACCENT_BG } from '@/ui';
import { content } from '@/content';
import { VIEWS } from '@/views/registry';
import { useAdvisorName as useAiAdvisorName } from '@/call/advisor';
import { deskApi, errorText } from './api';
import { CHANNEL_ICON, CHANNEL_NAME, DELIVERY_STATUS, SOURCE_LABEL, formatAgo } from './display';
import { ScoreBadge, StageTag } from './LeadsTable';
import { useResource } from './hooks';
import { WhatsAppPhone } from './WhatsAppPhone';

const TABS = ['overview', 'transcript', 'timeline', 'recap'] as const;
/** The phone preview refreshes while it is open, so messages from a live call appear as they are composed. */
const LEAD_OUTBOX_POLL_MS = 5000;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { overview: 'Overview', transcript: 'Transcript', timeline: 'Timeline', recap: 'Recap & delivery' };

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b-2 border-line px-5 py-4 last:border-b-0">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-ink-soft">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-soft">{children}</p>;
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-ink-soft">{label}</dt>
      <dd className={cn('truncate text-[15px] font-semibold', !value && 'font-normal text-ink-soft')}>{value ?? 'Not stated'}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function Overview({ lead }: { lead: Lead }) {
  const maxSeconds = Math.max(1, ...lead.visits.flatMap((v) => v.views.map((x) => x.seconds)));
  const { lead: f } = lead;
  return (
    <>
      <Section title="Why this score">
        {lead.reasons.length ? (
          <ul className="grid gap-1.5">
            {lead.reasons.map((r) => (
              <li key={r.label} className="flex items-center gap-3 text-sm">
                <span className="tabular w-10 shrink-0 rounded-[8px] bg-mint-tint px-1.5 py-0.5 text-center text-xs font-bold">+{r.points}</span>
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Quiet>No scoring signals yet. Points come from things like a booked visit, time on pricing, or a stated budget.</Quiet>
        )}
      </Section>

      <Section title="What they told us">
        <dl className="mb-3 grid grid-cols-3 gap-3">
          <Field label="Looking for" value={f.purpose} />
          <Field label="Budget" value={f.budget} />
          <Field label="Timeline" value={f.timeline} />
        </dl>
        {f.needs.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {f.needs.map((n) => (
              <Tag key={n} accent="blue">
                {n}
              </Tag>
            ))}
          </div>
        ) : null}
        {f.concerns.length || f.objections.length ? (
          <div className="mt-2 grid gap-1.5">
            {f.objections.map((o) => (
              <p key={o} className="rounded-[10px] bg-coral-tint px-3 py-1.5 text-sm">
                <strong>Objection:</strong> {o}
              </p>
            ))}
            {f.concerns.map((c) => (
              <p key={c} className="rounded-[10px] bg-sun-tint px-3 py-1.5 text-sm">
                <strong>Concern:</strong> {c}
              </p>
            ))}
          </div>
        ) : null}
        {f.notes.length ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">
            {f.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Properties and views">
        {lead.visits.length ? (
          <div className="grid gap-4">
            {lead.visits.map((v) => (
              <div key={v.propertyId}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <p className="truncate font-display text-[17px] font-bold">{v.propertyName}</p>
                  <span className="tabular shrink-0 text-sm font-semibold text-ink-soft">{formatSpan(v.seconds)}</span>
                </div>
                {v.views.length ? (
                  <ul className="grid gap-1">
                    {v.views.map((x) => {
                      const mod = VIEWS[x.view];
                      const Icon = mod.icon;
                      return (
                        <li key={x.view} className="grid grid-cols-[120px_1fr_56px] items-center gap-3 text-sm">
                          <span className="inline-flex items-center gap-1.5 truncate">
                            <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden />
                            {VIEW_LABELS[x.view]}
                          </span>
                          <span className="h-2.5 overflow-hidden rounded-full bg-paper">
                            <span className={cn('block h-full rounded-full', ACCENT_BG[mod.accent])} style={{ width: `${Math.max(4, (x.seconds / maxSeconds) * 100)}%` }} />
                          </span>
                          <span className="tabular text-right text-ink-soft">{formatSpan(x.seconds)}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <Quiet>Opened, but no views yet.</Quiet>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Quiet>No property opened yet.</Quiet>
        )}
      </Section>

      {lead.offers.length || lead.emi.length ? (
        <Section title="Offers and EMI">
          {lead.offers.length ? (
            <ul className="mb-3 grid gap-1.5">
              {lead.offers.map((o) => (
                <li key={`${o.propertyId}:${o.offerId}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{o.title}</span>
                    <span className="block truncate text-xs text-ink-soft">{o.propertyName}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {o.saving !== null ? <span className="tabular text-ink-soft">{formatINR(o.saving)}</span> : null}
                    <Pill tone={o.applied ? 'live' : 'muted'} size="sm">
                      {o.applied ? 'Applied' : 'Available'}
                    </Pill>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {lead.emi.map((e) => (
            <div key={e.propertyId} className="flex items-center gap-3 rounded-[14px] bg-blue-tint px-3 py-2.5 text-sm">
              <IndianRupee size={18} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
              <p>
                <strong className="tabular">{formatINR(e.monthlyEmi)}</strong> a month on {formatINRShort(e.loanAmount)} over {e.inputs.tenureYears} years at {e.inputs.ratePct}%, with{' '}
                {formatINRShort(e.inputs.downPayment)} down. <span className="text-ink-soft">{e.propertyName}</span>
              </p>
            </div>
          ))}
        </Section>
      ) : null}

      <Section title="Site visit and handoff">
        <div className="grid gap-2">
          {lead.booking ? (
            <div className="flex items-start gap-3 rounded-[14px] border-2 border-ink bg-mint-tint px-3 py-2.5 text-sm">
              <CalendarCheck size={18} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">
                  {lead.booking.start && lead.booking.end
                    ? (() => {
                        const s = formatSlot(lead.booking.start, lead.booking.end);
                        return `${s.date}, ${s.time}`;
                      })()
                    : 'Booked'}
                </p>
                <p className="text-ink-soft">
                  {lead.booking.propertyName} · {lead.booking.address}
                </p>
              </div>
            </div>
          ) : (
            <Quiet>No site visit booked.</Quiet>
          )}
          {lead.handoffDetail.status !== 'none' ? (
            <div className="flex items-start gap-3 rounded-[14px] bg-paper px-3 py-2.5 text-sm">
              <Headset size={18} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0" />
              <p>
                <strong>
                  {lead.handoffDetail.status === 'requested'
                    ? 'Asked for a human advisor'
                    : lead.handoffDetail.status === 'joined'
                      ? `${lead.handoffDetail.humanName ?? 'An advisor'} is on the call`
                      : `${lead.handoffDetail.humanName ?? 'An advisor'} joined, then handed back to the AI`}
                </strong>
                {lead.handoffDetail.reason ? <span className="text-ink-soft"> · {lead.handoffDetail.reason}</span> : null}
              </p>
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="AI summary" aside={lead.aiSummaryAt ? <span className="text-xs text-ink-soft">Written {formatDateTimeIST(lead.aiSummaryAt)}</span> : null}>
        {lead.aiSummary ? (
          <div className="rounded-[14px] bg-blue-tint p-3.5">
            <p className="mb-1 flex items-center gap-1.5 font-display text-[17px] font-bold">
              <Sparkles size={16} strokeWidth={ICON_STROKE} aria-hidden />
              {lead.aiSummary.headline}
            </p>
            <p className="text-sm">{lead.aiSummary.summary}</p>
            {lead.aiSummary.priorities.length ? (
              <p className="mt-2 text-sm">
                <strong>Priorities:</strong> {lead.aiSummary.priorities.join(' · ')}
              </p>
            ) : null}
            {lead.aiSummary.openQuestions.length ? (
              <p className="mt-1 text-sm">
                <strong>Still open:</strong> {lead.aiSummary.openQuestions.join(' · ')}
              </p>
            ) : null}
          </div>
        ) : (
          <Quiet>The AI summary is written when the recap is sent, from the transcript and the facts of the call. It needs an OpenAI key on the server.</Quiet>
        )}
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Transcript and timeline                                             */
/* ------------------------------------------------------------------ */

function Transcript({ lead }: { lead: Lead }) {
  const aiName = useAiAdvisorName();
  const names = { buyer: lead.buyer.name.split(/\s+/)[0] ?? lead.buyer.name, agent: aiName, human: lead.handoffDetail.humanName ?? 'Advisor' };
  const tone = { buyer: 'text-ink', agent: 'text-blue-deep', human: 'text-grape-deep' };
  if (!lead.transcript.length) return <EmptyState title="No transcript yet" body="Captions from the call are saved here as both sides speak." mascotSize={72} />;
  return (
    <ol className="grid gap-2.5 px-5 py-4">
      {lead.transcript.map((l) => (
        <li key={l.id} className={cn('grid grid-cols-[72px_1fr] gap-3 text-sm', !l.final && 'opacity-60')}>
          <span className="tabular pt-px text-xs text-ink-soft">{formatTimeIST(l.at)}</span>
          <p>
            <strong className={tone[l.role]}>{names[l.role]}</strong> <span>{l.text}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}

function eventLabel(e: TimelineEvent): string {
  if (e.kind === 'offer_applied') {
    const id = e.label.replace(/^Applied offer /, '');
    const offer = e.propertyId ? content.offers.properties[e.propertyId]?.offers.find((o) => o.id === id) : undefined;
    return offer ? `Applied offer: ${offer.title}` : e.label;
  }
  if (e.kind === 'property' && e.propertyId) return `Opened ${content.byId[e.propertyId]?.property.name ?? 'a property'}`;
  return e.label;
}

function Timeline({ lead }: { lead: Lead }) {
  if (!lead.timeline.length) return <EmptyState title="Nothing on the timeline yet" body="Every view change, offer, booking and handoff is logged here with who did it." mascotSize={72} />;
  return (
    <ol className="grid gap-2 px-5 py-4">
      {[...lead.timeline].reverse().map((e, i) => (
        <li key={`${e.at}-${i}`} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 text-sm">
          <span className="tabular text-xs text-ink-soft">{formatTimeIST(e.at)}</span>
          <span className="truncate">{eventLabel(e)}</span>
          <Tag>{SOURCE_LABEL[e.source] ?? e.source}</Tag>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Recap and delivery                                                  */
/* ------------------------------------------------------------------ */

function Recap({ lead, onSent, now }: { lead: Lead; onSent: () => void; now: number }) {
  const [busy, setBusy] = useState<ReportChannel[] | null>(null);
  const [preview, setPreview] = useState<'email' | 'whatsapp'>('email');

  const send = async (channels: ReportChannel[]) => {
    setBusy(channels);
    try {
      const deliveries = await deskApi.sendReport(lead.id, channels);
      const sent = deliveries.filter((d) => d.status === 'sent').map((d) => CHANNEL_NAME[d.channel]);
      const notSent = deliveries.filter((d) => d.status !== 'sent');
      if (notSent.length === 0) toast(`Recap sent by ${sent.join(' and ')}`, { tone: 'success' });
      else
        toast(sent.length ? `Sent by ${sent.join(' and ')}, not by ${notSent.map((d) => CHANNEL_NAME[d.channel]).join(' or ')}` : 'Recap not sent', {
          tone: 'error',
          body: notSent.map((d) => `${CHANNEL_NAME[d.channel]}: ${d.detail ?? DELIVERY_STATUS[d.status].label}`).join(' · '),
        });
    } catch (err) {
      toast('Could not send the recap', { tone: 'error', body: errorText(err) });
    } finally {
      setBusy(null);
      onSent();
    }
  };
  const isBusy = (c: ReportChannel[]) => busy !== null && busy.length === c.length && c.every((x) => busy.includes(x));
  const deliveries = [...lead.deliveries].sort((a, b) => b.at - a.at);

  return (
    <>
      <Section title="Send the recap">
        <p className="mb-3 text-sm text-ink-soft">
          Goes to {lead.buyer.email} and {lead.buyer.phone}. Each attempt is logged below with what the provider actually said.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={Send} busy={isBusy(['email', 'whatsapp'])} disabled={busy !== null} onClick={() => void send(['email', 'whatsapp'])}>
            Email and WhatsApp
          </Button>
          <Button size="sm" variant="secondary" icon={Mail} busy={isBusy(['email'])} disabled={busy !== null} onClick={() => void send(['email'])}>
            Email only
          </Button>
          <Button size="sm" variant="secondary" icon={MessageCircle} busy={isBusy(['whatsapp'])} disabled={busy !== null} onClick={() => void send(['whatsapp'])}>
            WhatsApp only
          </Button>
        </div>
      </Section>
      <Section title="Delivery log">
        {deliveries.length ? (
          <ul className="grid gap-2">
            {deliveries.map((d) => {
              const Icon = CHANNEL_ICON[d.channel];
              const st = DELIVERY_STATUS[d.status];
              return (
                <li key={d.id} className="flex items-start gap-3 rounded-[14px] border-2 border-line px-3 py-2.5 text-sm">
                  <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {d.label ? `${CHANNEL_NAME[d.channel]}: ${d.label}` : CHANNEL_NAME[d.channel]} <span className="font-normal text-ink-soft">to {d.to}</span>
                    </p>
                    {d.detail ? <p className="text-[13px] text-ink-soft">{d.detail}</p> : null}
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer" className="text-[13px] font-bold text-blue-deep underline-offset-2 hover:underline">
                        Open {d.ref && d.channel === 'jira' ? d.ref : `in ${CHANNEL_NAME[d.channel]}`}
                      </a>
                    ) : null}
                  </div>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Pill tone={st.tone} size="sm" busy={d.status === 'queued'}>
                      {st.label}
                    </Pill>
                    <span className="text-xs text-ink-soft">{formatAgo(d.at, now)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Quiet>Nothing sent yet. The recap goes out when the buyer agrees on the call, or when you send it here.</Quiet>
        )}
      </Section>
      <Section
        title="Preview"
        aside={
          <span className="flex gap-1.5" role="group" aria-label="Preview channel">
            {(['email', 'whatsapp'] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={preview === c}
                onClick={() => setPreview(c)}
                className={cn('rounded-full border-2 px-2.5 py-0.5 text-xs font-bold', preview === c ? 'border-ink bg-blue-tint' : 'border-line text-ink-soft hover:border-ink')}
              >
                {CHANNEL_NAME[c]}
              </button>
            ))}
          </span>
        }
      >
        {preview === 'email' ? (
          <>
            <p className="mb-2 text-sm">
              <span className="text-ink-soft">Subject:</span> <strong>{lead.reportSubject}</strong>
            </p>
            <iframe title="Recap email preview" sandbox="" srcDoc={lead.reportHtml} className="h-[520px] w-full rounded-[14px] border-2 border-line bg-paper" />
          </>
        ) : (
          <LeadWhatsApp lead={lead} />
        )}
      </Section>
    </>
  );
}

/** The lead's WhatsApp conversation in a phone mock-up (every message composed for it, or the recap draft). */
function LeadWhatsApp({ lead }: { lead: Lead }) {
  const outbox = useResource(lead.id, () => deskApi.leadOutbox(lead.id), LEAD_OUTBOX_POLL_MS);
  return <WhatsAppPhone items={outbox.data ?? []} draft={lead.reportWhatsApp} buyerName={lead.buyer.name} />;
}

/** WhatsApp text with its *bold* and _italic_ markers shown as they would render. */
export function WhatsAppText({ text }: { text: string }) {
  const render = (line: string) =>
    line.split(/(\*[^*]+\*|_[^_]+_)/g).map((part, i) =>
      part.startsWith('*') && part.endsWith('*') ? (
        <strong key={i}>{part.slice(1, -1)}</strong>
      ) : part.startsWith('_') && part.endsWith('_') ? (
        <em key={i} className="text-ink-soft">
          {part.slice(1, -1)}
        </em>
      ) : (
        part
      ),
    );
  return (
    <>
      {text.split('\n').map((line, i) => (
        <span key={i}>
          {render(line)}
          {'\n'}
        </span>
      ))}
    </>
  );
}

export function WhatsAppBubble({ text }: { text: string }) {
  return (
    <div className="rounded-[18px] bg-paper p-4">
      <div className="max-w-[440px] whitespace-pre-wrap rounded-[16px] rounded-tl-[4px] border-2 border-ink bg-mint-tint px-4 py-3 text-sm leading-relaxed">
        <WhatsAppText text={text} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function LeadDetailPanel({
  lead,
  loading,
  error,
  onRetry,
  now,
  hasSelection,
}: {
  lead: Lead | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  now: number;
  hasSelection: boolean;
}) {
  const [tab, setTab] = useState<Tab>('overview');

  const shell = (children: ReactNode) => (
    <section aria-label="Lead detail" className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-canvas shadow-[var(--shadow-pop)]">
      {children}
    </section>
  );

  if (!hasSelection) return shell(<EmptyState title="Pick a lead" body="Choose a lead from the list to see what happened on the call, its score, and the recap." mascotSize={96} />);
  if (error && !lead)
    return shell(
      <ErrorState
        title="Couldn't load this lead"
        body={error}
        mascotSize={96}
        actions={
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        }
      />,
    );
  if (loading || !lead) return shell(<LoadingState title="Loading the lead" mascotSize={96} />);

  return shell(
    <>
      <header className="border-b-2 border-line px-5 pb-0 pt-4">
        <div className="flex items-start gap-3">
          <Avatar name={lead.buyer.name} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-display text-2xl font-bold leading-tight">{lead.buyer.name}</h2>
              {lead.live ? (
                <Pill tone="live" size="sm" dot>
                  Live
                </Pill>
              ) : null}
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-ink-soft">
              <a href={`mailto:${lead.buyer.email}`} className="inline-flex items-center gap-1 hover:text-ink">
                <Mail size={14} strokeWidth={ICON_STROKE} aria-hidden />
                {lead.buyer.email}
              </a>
              <a href={`tel:${lead.buyer.phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1 hover:text-ink">
                <Phone size={14} strokeWidth={ICON_STROKE} aria-hidden />
                {lead.buyer.phone}
              </a>
              <span className="inline-flex items-center gap-1">
                <UserRound size={14} strokeWidth={ICON_STROKE} aria-hidden />
                Called {formatDateTimeIST(lead.createdAt)}
              </span>
            </p>
          </div>
          {lead.live ? (
            <Link to={`/desk/call/${lead.id}`} className={buttonClasses('primary', 'sm')}>
              <Headset size={16} strokeWidth={ICON_STROKE} aria-hidden />
              Open call
            </Link>
          ) : null}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <ScoreBadge lead={lead} size="lg" />
          <StageTag lead={lead} />
        </div>
        <nav className="-mb-0.5 mt-3 flex gap-1" aria-label="Lead sections">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-current={tab === t ? 'page' : undefined}
              className={cn(
                'border-b-[3px] px-3 py-2 text-sm font-bold transition-colors',
                tab === t ? 'border-blue text-ink' : 'border-transparent text-ink-soft hover:text-ink',
              )}
            >
              {TAB_LABELS[t]}
              {t === 'transcript' && lead.transcript.length ? <span className="ml-1 text-xs text-ink-soft">{lead.transcript.length}</span> : null}
            </button>
          ))}
        </nav>
      </header>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' ? <Overview lead={lead} /> : null}
        {tab === 'transcript' ? <Transcript lead={lead} /> : null}
        {tab === 'timeline' ? <Timeline lead={lead} /> : null}
        {tab === 'recap' ? <Recap lead={lead} onSent={onRetry} now={now} /> : null}
      </div>
    </>,
  );
}
