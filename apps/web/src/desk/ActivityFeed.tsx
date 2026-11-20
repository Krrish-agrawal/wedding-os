import { Activity, ExternalLink } from 'lucide-react';
import type { ActivityItem, DeliveryChannel } from '@ave/shared';
import { ACCENT_TINT, Button, ErrorState, ICON_STROKE, LoadingState, Panel, Pill, cn } from '@/ui';
import type { Accent } from '@/views/types';
import { CHANNEL_ICON, DELIVERY_STATUS, formatAgo } from './display';

/** Integration names as the team knows them (the CRM is HubSpot). */
export const INTEGRATION_NAME: Record<DeliveryChannel, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  crm: 'HubSpot',
  slack: 'Slack',
  jira: 'Jira',
};

export const INTEGRATION_ACCENT: Record<DeliveryChannel, Accent> = {
  email: 'blue',
  whatsapp: 'mint',
  crm: 'tangerine',
  slack: 'grape',
  jira: 'sun',
};

/**
 * Live list of everything the pipeline sent, across leads: what, for whom, when, and whether the
 * provider took it. Links straight to the Jira issue or Slack message when there is one.
 */
export function ActivityFeed({
  items,
  loading,
  error,
  onRetry,
  now,
  onOpenLead,
  className,
}: {
  items: ActivityItem[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  now: number;
  onOpenLead: (id: string) => void;
  className?: string;
}) {
  const body = () => {
    if (error && !items) {
      return (
        <ErrorState
          title="Couldn't load activity"
          body={error}
          mascotSize={72}
          actions={
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      );
    }
    if (loading || !items) return <LoadingState title="Loading activity" mascotSize={72} />;
    if (items.length === 0) {
      return <p className="p-5 text-sm text-ink-soft">Nothing sent yet. WhatsApp, email, Slack, Jira and HubSpot updates appear here the moment they fire, with their real status.</p>;
    }
    return (
      <ol className="scroll-quiet h-full overflow-y-auto" aria-live="polite">
        {items.map((item) => {
          const Icon = CHANNEL_ICON[item.channel];
          const st = DELIVERY_STATUS[item.status];
          return (
            <li key={item.id} className="flex gap-3 border-b border-line px-4 py-3">
              <span aria-hidden className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border-2 border-ink', ACCENT_TINT[INTEGRATION_ACCENT[item.channel]])}>
                <Icon size={15} strokeWidth={ICON_STROKE} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-bold" title={item.title}>
                    {INTEGRATION_NAME[item.channel]}: {item.title}
                  </span>
                  <span className="shrink-0 text-xs text-ink-soft">{formatAgo(item.at, now)}</span>
                </p>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
                  <button type="button" onClick={() => onOpenLead(item.sessionId)} className="font-semibold text-ink hover:underline">
                    {item.buyerName}
                  </button>
                  <Pill tone={st.tone} size="sm" busy={item.status === 'queued'} className="h-6">
                    {st.label}
                  </Pill>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-deep underline decoration-2 underline-offset-2">
                      {item.channel === 'jira' && item.ref ? item.ref : 'Open'}
                      <ExternalLink size={11} strokeWidth={ICON_STROKE} aria-hidden />
                    </a>
                  ) : null}
                </p>
                {item.status !== 'sent' && item.status !== 'queued' && item.detail ? <p className="mt-1 line-clamp-2 text-xs text-coral-deep">{item.detail}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    );
  };

  return (
    <Panel title="Activity" subtitle="Everything the pipeline sent, newest first" icon={Activity} accent="grape" padded={false} className={className}>
      {body()}
    </Panel>
  );
}
