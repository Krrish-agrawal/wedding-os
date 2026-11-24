import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { Flag, RefreshCw } from 'lucide-react';
import { Button, Card, Notice, Pill } from '@/ui';
import { useWedding } from './useWedding';

/** Shows a "switched off" panel instead of a page whose feature flag is off. The server enforces the flag too; this is only the friendly face. */
export function FeatureGate({ flag, title, children }: { flag: string; title: string; children: React.ReactNode }) {
  const { flags } = useWedding();
  if (flags && flags.flags[flag] === false) {
    return (
      <div className="mx-auto max-w-xl"><Notice tone="warn" title={`${title} is switched off`} body={`The feature flag "${flag}" is currently off. An administrator can turn it back on in Flagsmith; this page updates within seconds.`} live="polite" /></div>
    );
  }
  return <>{children}</>;
}

export function GatedOutlet({ flag, title }: { flag: string; title: string }) {
  return <FeatureGate flag={flag} title={title}><Outlet /></FeatureGate>;
}

const SOURCE: Record<string, string> = { 'flagsmith-local': 'Flagsmith (local evaluation)', 'flagsmith-remote': 'Flagsmith (remote evaluation)', defaults: 'Built-in defaults (Flagsmith not configured)' };

/** Live view of the server's feature flags: toggle one in the Flagsmith dashboard and watch it change here. */
export default function FlagsPage() {
  const { flags, loadFlags } = useWedding();
  useEffect(() => { void loadFlags(); const t = setInterval(() => void loadFlags(), 5000); return () => clearInterval(t); }, [loadFlags]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-4xl font-extrabold">Feature flags</h1><p className="mt-1 text-ink-soft">Evaluated on the server. Disabled features lose their pages, their API routes and their planner tools.</p></div>
        <Button variant="secondary" icon={RefreshCw} onClick={() => void loadFlags()}>Refresh now</Button>
      </header>
      {!flags ? <p className="text-ink-soft">Loading flags…</p> : (
        <>
          <Notice tone={flags.configured ? (flags.degraded ? 'warn' : 'success') : 'waiting'} title={SOURCE[flags.source]} body={flags.configured ? (flags.degraded ? (flags.error ?? 'Flagsmith is unreachable; showing last known values.') : 'Toggle a flag in the Flagsmith dashboard; this list refreshes every few seconds.') : 'Set FLAGSMITH_ENVIRONMENT_KEY on the server to control these from Flagsmith. Until then every flag is on and cannot be toggled.'} live="polite" />
          <Card className="divide-y-2 divide-line">
            {flags.names.map((n) => (
              <div key={n} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div><p className="flex items-center gap-2 font-mono text-sm font-semibold"><Flag size={14} aria-hidden />{n}</p><p className="text-sm text-ink-soft">{flags.descriptions[n]}</p></div>
                <div className="flex items-center gap-2">{flags.defaulted.includes(n) && flags.configured ? <Pill size="sm" tone="muted">not in Flagsmith: default</Pill> : null}<Pill tone={flags.flags[n] ? 'live' : 'error'} dot size="sm">{flags.flags[n] ? 'ON' : 'OFF'}</Pill></div>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
