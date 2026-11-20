import { Users } from 'lucide-react';
import type { LeadSummary } from '@ave/shared';
import { Avatar, Button, EmptyState, ErrorState, LoadingState, Panel, Pill, Tag, cn } from '@/ui';
import { formatAgo, STAGE_ACCENT, tierTone } from './display';

export function ScoreBadge({ lead, size = 'md' }: { lead: Pick<LeadSummary, 'score' | 'tier' | 'tierRank' | 'tierCount'>; size?: 'md' | 'lg' }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn('tabular font-display font-extrabold leading-none', size === 'lg' ? 'text-4xl' : 'text-xl')}>{lead.score}</span>
      <Pill tone={tierTone(lead.tierRank, lead.tierCount)} size="sm">
        {lead.tier}
      </Pill>
    </span>
  );
}

export function StageTag({ lead }: { lead: Pick<LeadSummary, 'stage' | 'stageLabel'> }) {
  return <Tag accent={STAGE_ACCENT[lead.stage] ?? undefined}>{lead.stageLabel}</Tag>;
}

/** Column widths for a fixed table layout, so long notes truncate instead of pushing columns off. */
const COLUMNS: { label: string; width: string }[] = [
  { label: 'Buyer', width: 'w-[29%]' },
  { label: 'Looking for', width: 'w-[22%]' },
  { label: 'Budget', width: 'w-[13%]' },
  { label: 'Stage', width: 'w-[13%]' },
  { label: 'Score', width: 'w-[12%]' },
  { label: 'Active', width: 'w-[11%]' },
];

export function LeadsTable({
  leads,
  loading,
  error,
  onRetry,
  selectedId,
  onSelect,
  now,
}: {
  leads: LeadSummary[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: number;
}) {
  const body = () => {
    if (error && !leads) {
      return (
        <ErrorState
          title="Couldn't load leads"
          body={error}
          mascotSize={88}
          actions={
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      );
    }
    if (loading || !leads) return <LoadingState title="Loading leads" mascotSize={88} />;
    if (leads.length === 0) {
      return (
        <EmptyState
          title="No leads yet"
          body="Every call becomes a lead here, with its score, transcript and recap. Start a call from the landing page and it appears straight away."
          mascotSize={88}
          actions={
            <a href="/" target="_blank" rel="noreferrer" className="font-semibold text-blue-deep underline decoration-2 underline-offset-4">
              Open the landing page
            </a>
          }
        />
      );
    }
    return (
      <table className="w-full table-fixed border-separate border-spacing-0 text-left text-sm">
        <thead className="sticky top-0 z-10 bg-canvas">
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.label} scope="col" className={cn('border-b-2 border-line px-3 py-2.5 text-xs font-bold uppercase tracking-[0.06em] text-ink-soft first:pl-5', c.width)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => {
            const selected = l.id === selectedId;
            return (
              <tr
                key={l.id}
                onClick={() => onSelect(l.id)}
                aria-selected={selected}
                className={cn('cursor-pointer transition-colors', selected ? 'bg-blue-tint' : 'hover:bg-paper')}
              >
                <td className="border-b border-line py-3 pl-5 pr-3">
                  {/* Clicks (and Enter on the focused button) bubble to the row, which selects the lead. */}
                  <button type="button" className="flex w-full min-w-0 items-center gap-3 text-left outline-offset-4">
                    <Avatar name={l.buyer.name} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-bold">{l.buyer.name}</span>
                        {l.live ? (
                          <Pill tone="live" size="sm" dot className="h-6">
                            Live
                          </Pill>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-ink-soft">{l.buyer.email}</span>
                    </span>
                  </button>
                </td>
                <td className="truncate border-b border-line px-3 py-3" title={l.need ?? undefined}>{l.need ?? <span className="text-ink-soft">Not stated</span>}</td>
                <td className="truncate border-b border-line px-3 py-3" title={l.budget ?? undefined}>{l.budget ?? <span className="text-ink-soft">Not stated</span>}</td>
                <td className="border-b border-line px-3 py-3">
                  <StageTag lead={l} />
                </td>
                <td className="border-b border-line px-3 py-3">
                  <ScoreBadge lead={l} />
                </td>
                <td className="truncate border-b border-line px-3 py-3 text-ink-soft">{formatAgo(l.lastActivityAt, now)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <Panel
      title="Leads"
      subtitle={leads?.length ? `${leads.length} ${leads.length === 1 ? 'lead' : 'leads'}, most recent first` : 'Scored from what happened on each call'}
      icon={Users}
      accent="blue"
      padded={false}
      className="min-h-0 flex-1"
    >
      <div className="scroll-quiet h-full overflow-auto">{body()}</div>
    </Panel>
  );
}
