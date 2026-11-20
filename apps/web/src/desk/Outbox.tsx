import { useState } from 'react';
import { ExternalLink, Inbox } from 'lucide-react';
import { DELIVERY_CHANNELS, formatDateTimeIST, type Delivery, type OutboxItem } from '@ave/shared';
import { Button, Chip, EmptyState, ErrorState, ICON_STROKE, LoadingState, Panel, Pill, cn } from '@/ui';
import { CHANNEL_ICON, CHANNEL_NAME, DELIVERY_STATUS, PURPOSE_LABEL, formatAgo } from './display';
import { WhatsAppBubble } from './LeadDetail';

type Filter = 'all' | Delivery['channel'];
const FILTERS: Filter[] = ['all', ...DELIVERY_CHANNELS];

function firstLine(item: OutboxItem): string {
  return item.subject ?? item.text?.split('\n').find((l) => l.trim()) ?? '';
}

/** "Slack · Visit card" when the pipeline named it, else the channel. */
function title(item: OutboxItem): string {
  const parts = [CHANNEL_NAME[item.channel], item.label ?? (item.purpose ? PURPOSE_LABEL[item.purpose] : null)].filter(Boolean);
  return parts.join(' · ');
}

/** Link to the message or issue in the provider, when it gave one. */
function ProviderLink({ item }: { item: OutboxItem }) {
  if (!item.url) return null;
  const text = item.channel === 'jira' && item.ref ? `Open ${item.ref} in Jira` : `Open in ${CHANNEL_NAME[item.channel]}`;
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-[10px] border-2 border-ink bg-canvas px-2.5 py-1 text-sm font-bold shadow-[var(--shadow-pop-sm)] transition-transform hover:-translate-y-px"
    >
      <ExternalLink size={14} strokeWidth={ICON_STROKE} aria-hidden />
      {text}
    </a>
  );
}

/** A Slack post as the channel shows it: plain text with *bold* markers, in a quiet card. */
function SlackPreview({ item }: { item: OutboxItem }) {
  return (
    <div className="rounded-[18px] bg-paper p-4">
      <div className="max-w-[560px] rounded-[14px] border-2 border-ink bg-canvas p-4">
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-ink-soft">{item.to}</p>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{item.text?.replace(/\*([^*\n]+)\*/g, '$1')}</div>
      </div>
    </div>
  );
}

/** A Jira issue: key, summary and description as they were created. */
function JiraPreview({ item }: { item: OutboxItem }) {
  return (
    <div className="rounded-[18px] bg-paper p-4">
      <div className="max-w-[640px] rounded-[14px] border-2 border-ink bg-canvas p-4">
        <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-ink-soft">
          <span>{item.to}</span>
          {item.ref ? <span className="rounded-full border-2 border-ink bg-blue-tint px-2 py-0.5 text-ink">{item.ref}</span> : null}
        </p>
        <p className="font-display text-lg font-bold leading-snug">{item.subject ?? 'Untitled issue'}</p>
        {item.text ? <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{item.text}</p> : null}
      </div>
    </div>
  );
}

function Preview({ item }: { item: OutboxItem }) {
  const st = DELIVERY_STATUS[item.status];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b-2 border-line px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-ink-soft">
              {title(item)} · {item.buyerName}
            </p>
            <p className="truncate font-display text-xl font-bold">{item.subject ?? item.to}</p>
            <p className="text-sm text-ink-soft">
              {item.to} · {formatDateTimeIST(item.at)}
            </p>
          </div>
          <Pill tone={st.tone} busy={item.status === 'queued'}>
            {st.label}
          </Pill>
        </div>
        {item.detail ? <p className={cn('mt-2 rounded-[10px] px-3 py-1.5 text-sm', item.status === 'failed' ? 'bg-coral-tint' : 'bg-paper')}>{item.detail}</p> : null}
        {item.url ? (
          <div className="mt-3">
            <ProviderLink item={item} />
          </div>
        ) : null}
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-auto p-5">
        {item.html ? (
          <iframe title={`Preview of ${item.subject ?? 'email'}`} sandbox="" srcDoc={item.html} className="h-full min-h-[480px] w-full rounded-[14px] border-2 border-line bg-paper" />
        ) : item.channel === 'whatsapp' && item.text ? (
          <WhatsAppBubble text={item.text} />
        ) : item.channel === 'slack' && item.text ? (
          <SlackPreview item={item} />
        ) : item.channel === 'jira' && (item.subject || item.text) ? (
          <JiraPreview item={item} />
        ) : item.text ? (
          <pre className="whitespace-pre-wrap rounded-[14px] bg-paper p-4 font-sans text-sm">{item.text}</pre>
        ) : (
          <p className="text-sm text-ink-soft">No preview was kept for this message.</p>
        )}
      </div>
    </div>
  );
}

export function Outbox({ items, loading, error, onRetry, now }: { items: OutboxItem[] | null; loading: boolean; error: string | null; onRetry: () => void; now: number }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (error && !items) {
    return (
      <ErrorState
        title="Couldn't load the outbox"
        body={error}
        actions={
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }
  if (loading || !items) return <LoadingState title="Loading the outbox" />;
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing sent yet"
        body="Every recap, WhatsApp message, Slack post, Jira task and CRM sync lands here with its real status, whether it was sent, failed, or is not configured."
      />
    );
  }

  const shown = items.filter((i) => filter === 'all' || i.channel === filter);
  const selected = shown.find((i) => i.id === selectedId) ?? shown[0] ?? null;
  const counts = Object.fromEntries(FILTERS.map((f) => [f, f === 'all' ? items.length : items.filter((i) => i.channel === f).length])) as Record<Filter, number>;

  return (
    <div className="grid h-full min-h-0 grid-cols-[440px_minmax(0,1fr)] gap-5">
      <Panel
        title="Outbox"
        subtitle={`${items.length} ${items.length === 1 ? 'message' : 'messages'}, newest first`}
        icon={Inbox}
        accent="blue"
        padded={false}
        actions={null}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex flex-wrap gap-2 border-b-2 border-line px-4 py-3" role="group" aria-label="Filter by channel">
            {FILTERS.map((f) => (
              <Chip
                key={f}
                size="sm"
                label={`${f === 'all' ? 'All' : CHANNEL_NAME[f]} ${counts[f]}`}
                icon={f === 'all' ? undefined : CHANNEL_ICON[f]}
                selected={filter === f}
                onClick={() => setFilter(f)}
              />
            ))}
          </div>
          <ul className="scroll-quiet min-h-0 flex-1 overflow-y-auto" aria-label="Messages">
            {shown.length === 0 ? <li className="p-5 text-sm text-ink-soft">No {filter === 'all' ? '' : CHANNEL_NAME[filter as Delivery['channel']]} messages yet.</li> : null}
            {shown.map((item) => {
              const Icon = CHANNEL_ICON[item.channel];
              const st = DELIVERY_STATUS[item.status];
              const on = selected?.id === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    aria-current={on ? 'true' : undefined}
                    className={cn('flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors', on ? 'bg-blue-tint' : 'hover:bg-paper')}
                  >
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border-2 border-ink bg-canvas">
                      <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-bold">
                          {item.buyerName}
                          {item.label ? <span className="font-semibold text-ink-soft"> · {item.label}</span> : null}
                        </span>
                        <span className="shrink-0 text-xs text-ink-soft">{formatAgo(item.at, now)}</span>
                      </span>
                      <span className="block truncate text-sm text-ink-soft">{firstLine(item)}</span>
                      <span className="mt-1 flex items-center gap-2">
                        <Pill tone={st.tone} size="sm" busy={item.status === 'queued'}>
                          {st.label}
                        </Pill>
                        <span className="truncate text-xs text-ink-soft">{item.ref && item.channel === 'jira' ? `${item.ref} · ${item.to}` : item.to}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </Panel>
      <section aria-label="Message preview" className="min-h-0 overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-canvas shadow-[var(--shadow-pop)]">
        {selected ? <Preview item={selected} /> : <EmptyState title="Pick a message" body="Choose a message to see exactly what went out." mascotSize={88} />}
      </section>
    </div>
  );
}
