import { Link } from 'react-router';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { BrandMark, Button, Toaster, buttonClasses } from '@/ui';
import { deskApi } from '@/desk/api';
import { useNow, useResource } from '@/desk/hooks';
import { IntegrationsBoard } from '@/desk/Integrations';

/** Status changes only when something is sent, so a slow poll is enough. */
const STATUS_POLL_MS = 15_000;
const RELATIVE_TICK_MS = 30_000;

/**
 * Integrations (/desk/integrations): every channel the pipeline sends to, whether it is set up,
 * its last success and last error, a labelled test send, and the voice agent's MCP link.
 */
export default function Integrations() {
  const status = useResource('integrations', deskApi.integrations, STATUS_POLL_MS);
  const now = useNow(RELATIVE_TICK_MS);

  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="flex h-[68px] shrink-0 items-center gap-6 border-b-2 border-ink bg-canvas px-6">
        <div className="flex items-center gap-3">
          <BrandMark size="sm" />
          <span aria-hidden className="h-6 w-0.5 bg-line" />
          <h1 className="font-display text-xl font-bold">Integrations</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={status.refresh}>
            Refresh
          </Button>
          <Link to="/desk" className={buttonClasses('secondary', 'sm')}>
            <ArrowLeft size={16} aria-hidden />
            Lead Desk
          </Link>
        </div>
      </header>
      <main className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-5">
        <IntegrationsBoard data={status.data} loading={status.loading} error={status.error} onRetry={status.refresh} now={now} />
      </main>
      <Toaster />
    </div>
  );
}
