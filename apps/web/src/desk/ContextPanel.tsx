import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarCheck, Gauge, Mail, MessageCircle, NotebookPen, Phone, Sparkles, Tag as TagIcon, UserRound } from 'lucide-react';
import { formatSlot, REPORT_REQUEST_NOTE_KIND, type ConsultNextStep, type LeadDetail, type SessionState, type TimelineEvent } from '@ave/shared';
import { ICON_STROKE, Pill, Tag, cn } from '@/ui';
import { content } from '@/content';
import { useAdvisorName as useAiAdvisorName } from '@/call/advisor';
import { CHANNEL_NAME, DELIVERY_STATUS } from './display';
import { ScoreBadge, StageTag } from './LeadsTable';
import { LiveNotes } from './LiveNotes';

const TRANSCRIPT_LINES = 20;
/** Timeline kinds the reducer writes itself; anything else from the AI is a note it recorded. */
const REDUCER_KINDS = new Set(['view', 'property', 'status', 'offer_applied', 'visit_booked', 'lead', 'handoff_requested', 'handoff_joined', 'handoff_returned', 'handoff_none']);

function Block({ title, icon: Icon, children }: { title: string; icon: typeof Gauge; children: ReactNode }) {
  return (
    <section className="border-b-2 border-line px-4 py-3.5 last:border-b-0">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-ink-soft">
        <Icon size={13} strokeWidth={ICON_STROKE} aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  );
}

interface Commitment {
  key: string;
  icon: typeof Gauge;
  text: string;
  tone: 'done' | 'pending' | 'problem';
}

/** What the AI has done or agreed to on this call, from the call record only. */
function commitments(state: SessionState): Commitment[] {
  const out: Commitment[] = [];
  for (const [propertyId, ids] of Object.entries(state.appliedOffers)) {
    const offers = content.offers.properties[propertyId]?.offers ?? [];
    const name = content.byId[propertyId]?.property.name ?? propertyId;
    for (const id of ids) out.push({ key: `offer:${propertyId}:${id}`, icon: TagIcon, text: `Applied “${offers.find((o) => o.id === id)?.title ?? id}” on ${name}`, tone: 'done' });
  }
  const { booking } = state;
  if (booking.status === 'confirmed' && booking.propertyId) {
    const bundle = content.byId[booking.propertyId];
    const slot = bundle?.visits.find((s) => s.id === booking.slotId);
    const when = slot ? formatSlot(slot.start, slot.end) : null;
    out.push({ key: 'visit', icon: CalendarCheck, text: `Booked a site visit${when ? ` on ${when.date}, ${when.time}` : ''} at ${bundle?.property.name ?? booking.propertyId}`, tone: 'done' });
  }
  const latest = new Map<string, SessionState['deliveries'][number]>();
  // Only buyer-facing recaps count here; visit confirmations and team posts (Slack, Jira) are not recaps.
  const isRecap = (d: SessionState['deliveries'][number]) => (d.channel === 'email' || d.channel === 'whatsapp') && (d.purpose === undefined || d.purpose === 'recap');
  for (const d of [...state.deliveries].sort((a, b) => a.at - b.at)) if (isRecap(d)) latest.set(d.channel, d);
  for (const d of latest.values()) {
    out.push({
      key: `delivery:${d.channel}`,
      icon: d.channel === 'email' ? Mail : MessageCircle,
      text: `Recap by ${CHANNEL_NAME[d.channel]}: ${DELIVERY_STATUS[d.status].label.toLowerCase()}${d.status === 'failed' && d.detail ? ` (${d.detail})` : ''}`,
      tone: d.status === 'sent' ? 'done' : d.status === 'queued' ? 'pending' : 'problem',
    });
  }
  if (latest.size === 0 && state.timeline.some((e) => e.kind === REPORT_REQUEST_NOTE_KIND)) {
    out.push({ key: 'recap-promised', icon: Mail, text: 'Promised to send the recap when the call ends', tone: 'pending' });
  }
  const notes = state.timeline.filter((e: TimelineEvent) => e.source === 'agent' && !REDUCER_KINDS.has(e.kind) && e.kind !== REPORT_REQUEST_NOTE_KIND);
  for (const [i, e] of notes.slice(-5).entries()) out.push({ key: `note:${e.at}:${i}`, icon: NotebookPen, text: e.label, tone: 'pending' });
  return out;
}

const TONE_CLASS: Record<Commitment['tone'], string> = {
  done: 'bg-mint-tint',
  pending: 'bg-sun-tint',
  problem: 'bg-coral-tint',
};

export interface ContextPanelProps {
  state: SessionState;
  lead: LeadDetail | null;
  /** One-click action for a live-notes next step; DeskCall routes it to the copilot (preview or screen command). */
  onAction?: (step: ConsultNextStep) => void;
}

type PanelTab = 'context' | 'notes';

/** Context or Live notes. Switches to Live notes by itself when transcription starts for a consult. */
function usePanelTab(consultStatus: SessionState['consult']['status']): [PanelTab, (t: PanelTab) => void] {
  const [tab, setTab] = useState<PanelTab>(consultStatus === 'listening' || consultStatus === 'updating' ? 'notes' : 'context');
  const before = useRef(consultStatus);
  useEffect(() => {
    const was = before.current;
    before.current = consultStatus;
    if (consultStatus === 'listening' && was !== 'listening' && was !== 'updating') setTab('notes');
  }, [consultStatus]);
  return [tab, setTab];
}

export function ContextPanel({ state, lead, onAction }: ContextPanelProps) {
  const aiName = useAiAdvisorName();
  const [tab, setTab] = usePanelTab(state.consult.status);
  const f = state.lead;
  const lines = state.transcript.slice(-TRANSCRIPT_LINES);
  const done = commitments(state);
  const scroller = useRef<HTMLOListElement>(null);
  const tail = lines.at(-1);
  const tailKey = tail ? `${tail.id}:${tail.text.length}` : '';
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tailKey]);

  const names = { buyer: state.buyer.name.split(/\s+/)[0] ?? 'Buyer', agent: aiName, human: state.handoff.humanName ?? 'Advisor' };
  const roleTone = { buyer: 'text-ink', agent: 'text-blue-deep', human: 'text-grape-deep' };

  return (
    <aside aria-label="Buyer context" className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-canvas shadow-[var(--shadow-pop)]">
      <div role="tablist" aria-label="Call panel" className="flex shrink-0 gap-1.5 border-b-2 border-ink bg-paper px-3 py-2">
        {(
          [
            ['context', 'Context', UserRound],
            ['notes', 'Live notes', Sparkles],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`panel-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="panel-body"
            onClick={() => setTab(id)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-[12px] border-2 px-3 text-sm font-bold transition-[transform,box-shadow] active:translate-y-px',
              tab === id ? 'border-ink bg-blue-tint shadow-[var(--shadow-pop-sm)]' : 'border-transparent text-ink-soft hover:border-line hover:text-ink',
            )}
          >
            <Icon size={15} strokeWidth={ICON_STROKE} aria-hidden />
            {label}
            {id === 'notes' && (state.consult.status === 'listening' || state.consult.status === 'updating') ? (
              <span aria-label="live" className="h-2 w-2 rounded-full bg-mint ring-2 ring-ink/10" />
            ) : null}
          </button>
        ))}
      </div>
      <div id="panel-body" role="tabpanel" aria-labelledby={`panel-tab-${tab}`} className="scroll-quiet min-h-0 flex-[1_1_auto] overflow-y-auto">
        {tab === 'notes' ? (
          <LiveNotes state={state} {...(onAction ? { onAction } : {})} />
        ) : (
          <>
            <Block title="Buyer" icon={Phone}>
              <p className="text-sm">
                <a className="font-semibold hover:underline" href={`mailto:${state.buyer.email}`}>
                  {state.buyer.email}
                </a>{' '}
                · <span className="tabular">{state.buyer.phone}</span>
              </p>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                {(
                  [
                    ['Looking for', f.purpose],
                    ['Budget', f.budget],
                    ['Timeline', f.timeline],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-ink-soft">{label}</dt>
                    <dd className={cn('truncate font-semibold', !value && 'font-normal text-ink-soft')} title={value ?? undefined}>
                      {value ?? 'Not stated'}
                    </dd>
                  </div>
                ))}
              </dl>
              {f.needs.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {f.needs.map((n) => (
                    <Tag key={n} accent="blue">
                      {n}
                    </Tag>
                  ))}
                </div>
              ) : null}
              {f.objections.map((o) => (
                <p key={o} className="mt-1.5 rounded-[10px] bg-coral-tint px-2.5 py-1 text-[13px]">
                  <strong>Objection:</strong> {o}
                </p>
              ))}
              {f.concerns.map((c) => (
                <p key={c} className="mt-1.5 rounded-[10px] bg-sun-tint px-2.5 py-1 text-[13px]">
                  <strong>Concern:</strong> {c}
                </p>
              ))}
            </Block>

            <Block title="Score" icon={Gauge}>
              {lead ? (
                <>
                  <div className="mb-2 flex items-center gap-3">
                    <ScoreBadge lead={lead} />
                    <StageTag lead={lead} />
                  </div>
                  {lead.reasons.length ? (
                    <ul className="grid gap-1 text-[13px]">
                      {lead.reasons.map((r) => (
                        <li key={r.label} className="flex gap-2">
                          <span className="tabular w-8 shrink-0 font-bold text-mint-deep">+{r.points}</span>
                          {r.label}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-soft">No scoring signals yet.</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-ink-soft">Working out the score…</p>
              )}
            </Block>

            <Block title="What the AI has committed to" icon={NotebookPen}>
              {done.length ? (
                <ul className="grid gap-1.5">
                  {done.map((c) => {
                    const Icon = c.icon;
                    return (
                      <li key={c.key} className={cn('flex items-start gap-2 rounded-[10px] px-2.5 py-1.5 text-[13px] leading-snug', TONE_CLASS[c.tone])}>
                        <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0" />
                        {c.text}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-ink-soft">Nothing applied, booked or sent yet.</p>
              )}
              {state.handoff.reason ? (
                <p className="mt-2 text-[13px]">
                  <Pill tone="error" size="sm" className="mr-1.5 h-6">
                    Why you were called
                  </Pill>
                  {state.handoff.reason}
                </p>
              ) : null}
            </Block>
          </>
        )}
      </div>

      <section className="flex min-h-[220px] flex-[1_1_40%] flex-col border-t-2 border-ink">
        <h3 className="px-4 pb-1.5 pt-3 text-xs font-bold uppercase tracking-[0.08em] text-ink-soft">Last {TRANSCRIPT_LINES} lines</h3>
        {lines.length ? (
          <ol ref={scroller} className="scroll-quiet min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-3 text-[13px] leading-snug" aria-live="polite">
            {lines.map((l) => (
              <li key={l.id} className={cn(!l.final && 'opacity-60')}>
                <strong className={roleTone[l.role]}>{names[l.role]}:</strong> {l.text}
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-4 pb-3 text-sm text-ink-soft">Captions appear here as the buyer and the advisor speak.</p>
        )}
      </section>
    </aside>
  );
}
