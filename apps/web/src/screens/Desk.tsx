import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Inbox, KanbanSquare, Plug, Users } from 'lucide-react';
import { BrandMark, ICON_STROKE, StatusPill, Toaster, buttonClasses, cn, useOnline } from '@/ui';
import { deskApi } from '@/desk/api';
import { useDeskFeed, useNow, useResource, useThrottledEffect } from '@/desk/hooks';
import { LiveCalls } from '@/desk/LiveCalls';
import { IncomingCall } from '@/desk/IncomingCall';
import { LeadsTable } from '@/desk/LeadsTable';
import { LeadDetailPanel } from '@/desk/LeadDetail';
import { Outbox } from '@/desk/Outbox';
import { copilotApi } from '@/desk/copilotApi';
import { PipelineBoard } from '@/desk/Pipeline';

/** Lists refresh at most this often while the live feed is busy. */
const FEED_REFRESH_MS = 1000;
/** Scores and "last activity" move with time even when nothing is said. */
const LEADS_POLL_MS = 15_000;
/** A live lead's transcript is not on the desk feed, so its detail is polled. */
const LIVE_DETAIL_POLL_MS = 4000;
const OUTBOX_POLL_MS = 10_000;
/** The board's funnel and activity feed also refresh on every desk feed message. */
const PIPELINE_POLL_MS = 10_000;
const CLOCK_TICK_MS = 1000;
const RELATIVE_TICK_MS = 30_000;

type Tab = 'leads' | 'pipeline' | 'outbox';
const TABS: readonly Tab[] = ['leads', 'pipeline', 'outbox'];

/**
 * Lead Desk (/desk): live calls with a Join button that pulses when a buyer asks for a person,
 * every lead with its score and stage, the lead's full detail, and the outbox of recaps.
 */
export default function Desk() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t === params.get('tab')) ?? 'leads';
  const selectedId = params.get('lead');
  const online = useOnline();
  const [reasons, setReasons] = useState<Record<string, string | null>>({});

  const feed = useDeskFeed(
    useCallback((msg) => {
      // The incoming-call alert announces the request; a toast as well would say it twice.
      setReasons((r) => ({ ...r, [msg.sessionId]: msg.reason }));
    }, []),
  );
  const clock = useNow(CLOCK_TICK_MS);
  const relativeNow = useNow(RELATIVE_TICK_MS);

  const leads = useResource('leads', deskApi.leads, LEADS_POLL_MS);
  const selectedLive = leads.data?.find((l) => l.id === selectedId)?.live ?? false;
  const detail = useResource(selectedId, () => deskApi.lead(selectedId ?? ''), selectedLive ? LIVE_DETAIL_POLL_MS : 0);
  const outbox = useResource(tab === 'outbox' ? 'outbox' : null, deskApi.outbox, OUTBOX_POLL_MS);
  const pipeline = useResource(tab === 'pipeline' ? 'pipeline' : null, copilotApi.pipeline, PIPELINE_POLL_MS);

  useThrottledEffect(
    () => {
      leads.refresh();
      if (selectedId) detail.refresh();
      if (tab === 'outbox') outbox.refresh();
      if (tab === 'pipeline') pipeline.refresh();
    },
    feed.version,
    FEED_REFRESH_MS,
  );

  // Select the newest lead on first load so the detail panel is never empty without reason.
  useEffect(() => {
    const first = leads.data?.[0];
    if (!selectedId && first && tab === 'leads') setParams((p) => ({ ...Object.fromEntries(p), lead: first.id }), { replace: true });
  }, [leads.data, selectedId, tab, setParams]);

  // Reasons come with the lead list; a request that just arrived on the feed fills in first.
  const handoffReasons: Record<string, string | null> = {
    ...Object.fromEntries((leads.data ?? []).map((l) => [l.id, l.handoffReason])),
    ...Object.fromEntries(Object.entries(reasons).filter(([, r]) => r)),
  };

  const setTab = (t: Tab) => setParams((p) => ({ ...Object.fromEntries(p), tab: t }));
  const select = (id: string) => setParams((p) => ({ ...Object.fromEntries(p), lead: id }));
  const join = (id: string) => navigate(`/desk/call/${id}?join=1`);

  const feedStatus = !online
    ? { label: 'Offline', tone: 'error' as const }
    : feed.connection === 'open'
      ? { label: 'Live feed', tone: 'live' as const }
      : { label: 'Reconnecting', tone: 'waiting' as const, busy: true };

  const tabButton = (t: Tab, label: string, Icon: typeof Users, count: number | null) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      aria-current={tab === t ? 'page' : undefined}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-[12px] border-2 px-3.5 text-sm font-bold transition-[transform,box-shadow] active:translate-y-px',
        tab === t ? 'border-ink bg-blue-tint shadow-[var(--shadow-pop-sm)]' : 'border-transparent text-ink-soft hover:border-line hover:text-ink',
      )}
    >
      <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden />
      {label}
      {count !== null ? <span className="tabular rounded-full bg-canvas px-1.5 text-xs">{count}</span> : null}
    </button>
  );

  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="flex h-[68px] shrink-0 items-center gap-6 border-b-2 border-ink bg-canvas px-6">
        <div className="flex items-center gap-3">
          <BrandMark size="sm" />
          <span aria-hidden className="h-6 w-0.5 bg-line" />
          <h1 className="font-display text-xl font-bold">Lead Desk</h1>
        </div>
        <nav className="flex items-center gap-1.5" aria-label="Desk sections">
          {tabButton('leads', 'Leads', Users, leads.data?.length ?? null)}
          {tabButton('pipeline', 'Pipeline', KanbanSquare, null)}
          {tabButton('outbox', 'Outbox', Inbox, outbox.data?.length ?? null)}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Link to="/desk/integrations" className={buttonClasses('ghost', 'sm')}>
            <Plug size={16} strokeWidth={ICON_STROKE} aria-hidden />
            Integrations
          </Link>
          <StatusPill tone={feedStatus.tone} busy={'busy' in feedStatus ? feedStatus.busy : false} size="sm">
            {feedStatus.label}
          </StatusPill>
        </div>
      </header>

      <main className="min-h-0 flex-1 p-5">
        {tab === 'leads' ? (
          <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(480px,0.7fr)] gap-5">
            <div className="flex min-h-0 flex-col gap-5">
              <LiveCalls sessions={feed.sessions} connection={feed.connection} now={clock} reasons={handoffReasons} onJoin={join} />
              <LeadsTable
                leads={leads.data}
                loading={leads.loading}
                error={leads.error}
                onRetry={leads.refresh}
                selectedId={selectedId}
                onSelect={select}
                now={relativeNow}
              />
            </div>
            <LeadDetailPanel
              lead={detail.data}
              loading={detail.loading}
              error={detail.error}
              onRetry={() => {
                detail.refresh();
                leads.refresh();
              }}
              now={relativeNow}
              hasSelection={Boolean(selectedId)}
            />
          </div>
        ) : tab === 'pipeline' ? (
          <PipelineBoard
            data={pipeline.data}
            loading={pipeline.loading}
            error={pipeline.error}
            onRetry={pipeline.refresh}
            now={relativeNow}
            onOpenLead={(id) => setParams((p) => ({ ...Object.fromEntries(p), tab: 'leads', lead: id }))}
            onOpenCall={(id) => navigate(`/desk/call/${id}`)}
          />
        ) : (
          <Outbox items={outbox.data} loading={outbox.loading} error={outbox.error} onRetry={outbox.refresh} now={relativeNow} />
        )}
      </main>
      <IncomingCall />
      <Toaster />
    </div>
  );
}
