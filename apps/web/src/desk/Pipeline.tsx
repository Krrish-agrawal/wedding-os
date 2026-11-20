import { useCallback, useState } from 'react';
import { ArrowRight, CalendarCheck, Check, Headset, Minus, MoreHorizontal, Trophy, X as XIcon } from 'lucide-react';
import {
  PIPELINE_STAGE_LABELS,
  formatSlotDayShort,
  formatSlotTime,
  type PipelineBadge,
  type PipelineCard,
  type PipelineOutcome,
  type PipelineResponse,
  type PipelineStage,
} from '@ave/shared';
import { ACCENT_BG, Button, ErrorState, ICON_STROKE, LoadingState, Pill, Spinner, cn, toast } from '@/ui';
import type { Accent } from '@/views/types';
import { ActivityFeed, INTEGRATION_NAME } from './ActivityFeed';
import { errorText } from './api';
import { copilotApi } from './copilotApi';
import { DELIVERY_STATUS, tierTone } from './display';
import { useDismiss } from './useDismiss';

interface Column {
  id: string;
  label: string;
  stages: readonly PipelineStage[];
  accent: Accent;
}

/** Left to right, the way a deal moves. Won and Lost share the last column. */
const COLUMNS: readonly Column[] = [
  { id: 'new', label: PIPELINE_STAGE_LABELS.new, stages: ['new'], accent: 'blue' },
  { id: 'qualified', label: PIPELINE_STAGE_LABELS.qualified, stages: ['qualified'], accent: 'tangerine' },
  { id: 'visit_booked', label: PIPELINE_STAGE_LABELS.visit_booked, stages: ['visit_booked'], accent: 'mint' },
  { id: 'consult', label: PIPELINE_STAGE_LABELS.consult, stages: ['consult'], accent: 'coral' },
  { id: 'follow_up', label: PIPELINE_STAGE_LABELS.follow_up, stages: ['follow_up'], accent: 'sun' },
  { id: 'closed', label: `${PIPELINE_STAGE_LABELS.won} / ${PIPELINE_STAGE_LABELS.lost}`, stages: ['won', 'lost'], accent: 'grape' },
];

function BadgeMark({ status }: { status: PipelineBadge['status'] }) {
  switch (status) {
    case 'sent':
      return <Check size={12} strokeWidth={3} aria-hidden className="text-mint-deep" />;
    case 'failed':
      return <XIcon size={12} strokeWidth={3} aria-hidden className="text-coral-deep" />;
    case 'not_configured':
      return <Minus size={12} strokeWidth={3} aria-hidden className="text-ink-mute" />;
    case 'queued':
      return <Spinner size={10} />;
  }
}

/** One integration on a card: ✓ sent, ✗ failed, – not configured. The Jira key links to the issue. */
function Badge({ badge }: { badge: PipelineBadge }) {
  const status = DELIVERY_STATUS[badge.status].label;
  const label = badge.channel === 'jira' && badge.ref ? badge.ref : INTEGRATION_NAME[badge.channel];
  const title = [`${INTEGRATION_NAME[badge.channel]}: ${status}`, badge.sent > 1 ? `${badge.sent} sent` : null, badge.status !== 'sent' ? badge.detail : null].filter(Boolean).join(' · ');
  const cls = cn(
    'inline-flex h-6 items-center gap-1 rounded-full border px-1.5 text-[11px] font-semibold',
    badge.status === 'sent' ? 'border-mint/60 bg-mint-tint' : badge.status === 'failed' ? 'border-coral/60 bg-coral-tint' : 'border-line bg-paper text-ink-soft',
  );
  const inner = (
    <>
      {label}
      <BadgeMark status={badge.status} />
    </>
  );
  return badge.url ? (
    <a href={badge.url} target="_blank" rel="noreferrer" title={title} className={cn(cls, 'hover:border-ink')} onClick={(e) => e.stopPropagation()}>
      {inner}
    </a>
  ) : (
    <span title={title} className={cls}>
      {inner}
    </span>
  );
}

function CardMenu({ card, onOutcome, onOpenLead, onOpenCall }: { card: PipelineCard; onOutcome: (o: PipelineOutcome) => void; onOpenLead: () => void; onOpenCall: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const closed = card.stage === 'won' || card.stage === 'lost';
  const item = (label: string, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        close();
        run();
      }}
      className="block w-full rounded-[8px] px-2.5 py-1.5 text-left text-sm font-semibold hover:bg-paper"
    >
      {label}
    </button>
  );
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Actions for ${card.buyerName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="grid h-7 w-7 place-items-center rounded-[8px] text-ink-soft hover:bg-paper hover:text-ink"
      >
        <MoreHorizontal size={16} strokeWidth={ICON_STROKE} aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-40 rounded-[12px] border-2 border-ink bg-canvas p-1 shadow-[var(--shadow-pop)]">
          {card.stage !== 'won' ? item('Mark won', () => onOutcome('won')) : null}
          {card.stage !== 'lost' ? item('Mark lost', () => onOutcome('lost')) : null}
          {closed ? item('Reopen', () => onOutcome('open')) : null}
          {item('Open lead', onOpenLead)}
          {card.live ? item('Open call', onOpenCall) : null}
        </div>
      ) : null}
    </div>
  );
}

function Card({ card, busy, onOutcome, onOpenLead, onOpenCall }: { card: PipelineCard; busy: boolean; onOutcome: (o: PipelineOutcome) => void; onOpenLead: () => void; onOpenCall: () => void }) {
  return (
    <li>
      <article
        onClick={onOpenLead}
        className={cn(
          'cursor-pointer rounded-[14px] border-2 border-ink bg-canvas p-2.5 shadow-[var(--shadow-pop-sm)] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-pop)]',
          card.stage === 'lost' && 'opacity-70',
        )}
      >
        <header className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5">
              {card.live ? <span aria-label="Live call" className="h-2 w-2 shrink-0 rounded-full bg-mint ring-2 ring-mint/30" /> : null}
              <span className="truncate font-bold leading-tight">{card.buyerName}</span>
            </p>
            <p className="truncate text-xs text-ink-soft">{card.propertyName ?? 'No property opened yet'}</p>
          </div>
          {busy ? <Spinner size={14} /> : <CardMenu card={card} onOutcome={onOutcome} onOpenLead={onOpenLead} onOpenCall={onOpenCall} />}
        </header>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="tabular font-display text-lg font-extrabold leading-none">{card.score}</span>
          <Pill tone={tierTone(card.tierRank, card.tierCount)} size="sm" className="h-6">
            {card.tier}
          </Pill>
          {card.stage === 'won' ? (
            <Pill tone="live" size="sm" icon={Trophy} className="h-6">
              Won
            </Pill>
          ) : card.stage === 'lost' ? (
            <Pill tone="muted" size="sm" className="h-6">
              Lost
            </Pill>
          ) : null}
          {card.handoff === 'requested' ? (
            <Pill tone="error" size="sm" icon={Headset} className="h-6">
              Wants a human
            </Pill>
          ) : null}
        </div>
        {card.visitStart ? (
          <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold">
            <CalendarCheck size={12} strokeWidth={ICON_STROKE} aria-hidden className="text-mint-deep" />
            {formatSlotDayShort(card.visitStart)}, {formatSlotTime(card.visitStart)}
          </p>
        ) : null}
        {card.badges.length ? (
          <div className="mt-2 flex flex-wrap gap-1" aria-label="Integrations">
            {card.badges.map((b) => (
              <Badge key={b.channel} badge={b} />
            ))}
          </div>
        ) : null}
      </article>
    </li>
  );
}

function Funnel({ data }: { data: PipelineResponse }) {
  return (
    <ol className="flex shrink-0 items-stretch gap-2" aria-label="Funnel">
      {data.funnel.map((step, i) => (
        <li key={step.stage} className="flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0 flex-1 rounded-[14px] border-2 border-ink bg-canvas px-3 py-2 shadow-[var(--shadow-pop-sm)]">
            <p className="truncate text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">{step.label}</p>
            <p className="flex items-baseline gap-2">
              <span className="tabular font-display text-2xl font-extrabold leading-tight">{step.reached}</span>
              <span className="tabular text-xs font-semibold text-ink-soft">{i === 0 ? 'leads' : `${step.pct}%`}</span>
            </p>
          </div>
          {i < data.funnel.length - 1 ? <ArrowRight size={16} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-ink-mute" /> : null}
        </li>
      ))}
      <li className="w-28 shrink-0 rounded-[14px] border-2 border-ink bg-grape-tint px-3 py-2 shadow-[var(--shadow-pop-sm)]">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Win rate</p>
        <p className="tabular font-display text-2xl font-extrabold leading-tight">{data.winRate === null ? '–' : `${data.winRate}%`}</p>
      </li>
    </ol>
  );
}

/**
 * Pipeline board (/desk?tab=pipeline): every lead in the column its call record puts it in, the
 * funnel across the top, and the live activity feed on the right.
 */
export function PipelineBoard({
  data,
  loading,
  error,
  onRetry,
  now,
  onOpenLead,
  onOpenCall,
}: {
  data: PipelineResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  now: number;
  onOpenLead: (id: string) => void;
  onOpenCall: (id: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const setOutcome = async (card: PipelineCard, outcome: PipelineOutcome) => {
    setBusyId(card.id);
    try {
      await copilotApi.setOutcome(card.id, outcome);
      onRetry();
    } catch (err) {
      toast(`Could not update ${card.buyerName}`, { tone: 'error', body: errorText(err) });
    } finally {
      setBusyId(null);
    }
  };

  const board = () => {
    if (error && !data) {
      return (
        <ErrorState
          title="Couldn't load the pipeline"
          body={error}
          actions={
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      );
    }
    if (loading || !data) return <LoadingState title="Loading the pipeline" />;
    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
        <Funnel data={data} />
        <div className="scroll-quiet grid min-h-0 flex-1 auto-cols-[minmax(170px,1fr)] grid-flow-col gap-3 overflow-x-auto">
          {COLUMNS.map((col) => {
            const cards = data.cards.filter((c) => col.stages.includes(c.stage));
            return (
              <section key={col.id} aria-label={col.label} className="flex min-h-0 flex-col rounded-[16px] border-2 border-line bg-canvas/60">
                <header className="flex items-center gap-2 border-b-2 border-line px-3 py-2">
                  <span aria-hidden className={cn('h-3 w-3 rounded-full border-2 border-ink', ACCENT_BG[col.accent])} />
                  <h3 className="truncate text-sm font-bold">{col.label}</h3>
                  <span className="tabular ml-auto rounded-full bg-paper px-2 text-xs font-bold">{cards.length}</span>
                </header>
                {cards.length ? (
                  <ul className="scroll-quiet min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
                    {cards.map((card) => (
                      <Card
                        key={card.id}
                        card={card}
                        busy={busyId === card.id}
                        onOutcome={(o) => void setOutcome(card, o)}
                        onOpenLead={() => onOpenLead(card.id)}
                        onOpenCall={() => onOpenCall(card.id)}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="p-3 text-xs text-ink-soft">No leads here.</p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-5">
      <div className="min-h-0">{board()}</div>
      <ActivityFeed items={data?.activity ?? null} loading={loading} error={error} onRetry={onRetry} now={now} onOpenLead={onOpenLead} className="min-h-0" />
    </div>
  );
}

