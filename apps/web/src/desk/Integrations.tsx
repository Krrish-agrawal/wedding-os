import { useState, type FormEvent } from 'react';
import { ArrowRight, Bot, ExternalLink, Plug, Send, ServerCog, TriangleAlert } from 'lucide-react';
import type { Delivery, DeliveryChannel, IntegrationStatus, IntegrationsResponse, McpLinkStatus } from '@ave/shared';
import { Button, Card, ErrorState, HeaderMark, ICON_STROKE, LoadingState, Notice, Pill, TextField, cn, toast } from '@/ui';
import type { Accent } from '@/views/types';
import { deskApi, errorText } from './api';
import { CHANNEL_ICON, DELIVERY_STATUS, formatAgo } from './display';

/** Accent per channel, so each card reads at a glance. */
const CHANNEL_ACCENT: Record<DeliveryChannel, Accent> = { whatsapp: 'mint', email: 'blue', slack: 'grape', jira: 'sun', crm: 'tangerine' };

/** What to add to .env when a channel is not set up (names only; values stay in .env). */
const SETUP_HINT: Record<DeliveryChannel, string> = {
  email: 'Set EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM in .env.',
  whatsapp: 'Set WHATSAPP_PROVIDER=twilio with TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM in .env.',
  crm: 'Set HUBSPOT_TOKEN in .env.',
  slack: 'Set SLACK_BOT_TOKEN and SLACK_CHANNEL_ID (or SLACK_WEBHOOK_URL) in .env.',
  jira: 'Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and JIRA_PROJECT_KEY in .env.',
};

const TEST_BUTTON: Record<DeliveryChannel, string> = {
  slack: 'Post a test message',
  jira: 'Create a test issue',
  email: 'Send a test email',
  whatsapp: 'Send a test message',
  crm: '',
};

/** The voice agent's link to the app's tools, and why it cannot post to the team's tools itself. */
function McpCard({ mcp }: { mcp: McpLinkStatus }) {
  const node = (Icon: typeof Bot, title: string, sub: string, accent: Accent) => (
    <div className="flex items-center gap-3 rounded-[16px] border-2 border-ink bg-canvas px-4 py-3 shadow-[var(--shadow-pop-sm)]">
      <HeaderMark accent={accent} icon={Icon} />
      <div>
        <p className="font-display text-base font-bold leading-tight">{title}</p>
        <p className="text-sm text-ink-soft">{sub}</p>
      </div>
    </div>
  );
  return (
    <Card tint="blue" className="flex flex-wrap items-center gap-5 px-6 py-5">
      <div className="flex items-center gap-3">
        {node(Bot, 'Agora voice agent', 'Conversational AI Engine', 'blue')}
        <span className="flex flex-col items-center gap-0.5 text-xs font-bold uppercase tracking-[0.08em] text-ink-soft">
          <ArrowRight size={22} strokeWidth={ICON_STROKE} aria-hidden className="text-ink" />
          {mcp.transport === 'mcp' ? 'MCP' : 'HTTP'}
        </span>
        {node(ServerCog, `${mcp.server} MCP`, `${mcp.tools} tools`, 'mint')}
      </div>
      <div className="min-w-[280px] flex-1">
        <p className="font-display text-lg font-bold">
          Agora voice agent → {mcp.server} MCP: {mcp.tools} tools
        </p>
        <p className="text-sm text-ink-soft">
          The agent drives the buyer's screen through these tools. It has no tool that posts to Slack, Jira, email or WhatsApp: those go out from the fixed rules below, or from
          previews an advisor confirms.
        </p>
      </div>
      <Pill tone={mcp.reachable ? 'live' : 'waiting'} dot>
        {mcp.reachable ? 'Public URL set' : 'PUBLIC_BASE_URL not set'}
      </Pill>
    </Card>
  );
}

function lastErrorIsCurrent(i: IntegrationStatus): boolean {
  return Boolean(i.lastError && (i.lastSentAt === null || i.lastError.at > i.lastSentAt));
}

function TestResult({ delivery }: { delivery: Delivery }) {
  const st = DELIVERY_STATUS[delivery.status];
  return (
    <div className={cn('mt-3 rounded-[12px] border-2 px-3 py-2 text-sm', delivery.status === 'failed' ? 'border-coral-deep bg-coral-tint' : 'border-line bg-paper')}>
      <div className="flex items-center gap-2">
        <Pill tone={st.tone} size="sm">
          {st.label}
        </Pill>
        <span className="truncate text-ink-soft">to {delivery.to}</span>
      </div>
      {delivery.detail ? <p className="mt-1 text-[13px]">{delivery.detail}</p> : null}
      {delivery.url ? (
        <a href={delivery.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[13px] font-bold text-blue-deep hover:underline">
          <ExternalLink size={13} strokeWidth={ICON_STROKE} aria-hidden />
          Open {delivery.ref ?? 'it'}
        </a>
      ) : null}
    </div>
  );
}

function TestControls({ integration, onDone }: { integration: IntegrationStatus; onDone: () => void }) {
  const [to, setTo] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Delivery | null>(null);
  const { channel, test, configured } = integration;

  if (test === 'unsupported') {
    return <p className="text-sm text-ink-soft">No test send: this syncs real leads only, after a booking or a recap.</p>;
  }

  const run = async (confirm: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const delivery = await deskApi.testIntegration(channel, { to: test === 'email' || test === 'phone' ? to : undefined, confirm });
      setResult(delivery);
      setConfirming(false);
      const st = DELIVERY_STATUS[delivery.status];
      toast(`${integration.name} test: ${st.label.toLowerCase()}`, { tone: delivery.status === 'sent' ? 'success' : 'error', body: delivery.detail ?? undefined });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (test === 'confirm') setConfirming(true);
    else void run(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {test === 'email' || test === 'phone' ? (
        <TextField
          label={test === 'email' ? 'Send the test to' : 'WhatsApp number'}
          type={test === 'email' ? 'email' : 'tel'}
          placeholder={test === 'email' ? 'you@example.com' : '+91 98765 43210'}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          hint={test === 'phone' ? 'With the country code. Sandbox numbers must have joined first.' : undefined}
          disabled={!configured}
          required
        />
      ) : null}
      {confirming ? (
        <Notice
          tone="warn"
          icon={TriangleAlert}
          title={`This creates a real issue in ${integration.destination}.`}
          body="It is labelled as a test and safe to close."
          actions={
            <>
              <Button size="sm" variant="danger" busy={busy} onClick={() => void run(true)}>
                Create it
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          }
        />
      ) : (
        <div>
          <Button type="submit" size="sm" variant="secondary" icon={Send} busy={busy} disabled={!configured}>
            {TEST_BUTTON[channel]}
          </Button>
        </div>
      )}
      {error ? <p className="text-[13px] font-semibold text-coral-deep">{error}</p> : null}
      {result ? <TestResult delivery={result} /> : null}
    </form>
  );
}

function IntegrationCard({ integration, now, onChanged }: { integration: IntegrationStatus; now: number; onChanged: () => void }) {
  const i = integration;
  const Icon = CHANNEL_ICON[i.channel];
  const showError = lastErrorIsCurrent(i);
  return (
    <Card as="article" className="flex flex-col" aria-label={`${i.name} integration`}>
      <header className="flex items-center gap-3 border-b-2 border-line px-5 py-3.5">
        <HeaderMark accent={CHANNEL_ACCENT[i.channel]} icon={Icon} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-bold leading-tight">{i.name}</h2>
          <p className="truncate text-sm text-ink-soft">{i.provider ?? 'Not set up'}</p>
        </div>
        <Pill tone={i.configured ? 'live' : 'muted'} size="sm" dot>
          {i.configured ? 'Connected' : 'Not configured'}
        </Pill>
      </header>
      <div className="flex flex-1 flex-col gap-3 px-5 py-4">
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-ink-soft">Goes to</dt>
          <dd className="font-semibold">{i.destination}</dd>
          <dt className="text-ink-soft">Automatic</dt>
          <dd>{i.automated ? i.sends : <span className="text-ink-soft">Off (not in AUTOMATIONS)</span>}</dd>
          <dt className="text-ink-soft">Last sent</dt>
          <dd>{i.lastSentAt ? formatAgo(i.lastSentAt, now) : <span className="text-ink-soft">Never</span>}</dd>
          {i.webhookUrl ? (
            <>
              <dt className="text-ink-soft">Replies</dt>
              <dd className="break-all font-mono text-[12px]">{i.webhookUrl}</dd>
            </>
          ) : null}
        </dl>
        {!i.configured ? <p className="rounded-[10px] bg-paper px-3 py-2 text-[13px] text-ink-soft">{SETUP_HINT[i.channel]}</p> : null}
        {showError && i.lastError ? (
          <p className="rounded-[10px] bg-coral-tint px-3 py-2 text-[13px]">
            <span className="font-bold">Last error, {formatAgo(i.lastError.at, now)}:</span> {i.lastError.detail ?? 'No reason given'}
          </p>
        ) : null}
        <div className="mt-auto border-t-2 border-line pt-3">
          <TestControls integration={i} onDone={onChanged} />
        </div>
      </div>
    </Card>
  );
}

export function IntegrationsBoard({ data, loading, error, onRetry, now }: { data: IntegrationsResponse | null; loading: boolean; error: string | null; onRetry: () => void; now: number }) {
  if (error && !data) {
    return (
      <ErrorState
        title="Couldn't load the integrations"
        body={error}
        actions={
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }
  if (loading || !data) return <LoadingState title="Checking the integrations" />;
  const connected = data.integrations.filter((i) => i.configured).length;
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5">
      <McpCard mcp={data.mcp} />
      <div className="flex items-baseline gap-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          <Plug size={20} strokeWidth={ICON_STROKE} aria-hidden />
          Where the pipeline sends
        </h2>
        <p className="text-sm text-ink-soft">
          {connected} of {data.integrations.length} connected. Tests are labelled and kept in the Outbox, never on a lead.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-5">
        {data.integrations.map((i) => (
          <IntegrationCard key={i.channel} integration={i} now={now} onChanged={onRetry} />
        ))}
      </div>
    </div>
  );
}
