import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Send } from 'lucide-react';
import type { ToolResult } from '@ave/shared';
import { Button, Notice, Spinner, cn } from '@/ui';
import { ToolResultView } from './ToolResultView';

/** Response of POST /api/sim/:sessionId/chat (SimTurn in apps/server/src/agent/sim.ts). */
interface SimTurnResponse {
  reply: string;
  toolCalls: { name: string; args: unknown; result: ToolResult; ms: number }[];
  ms: number;
  model: string;
  greeting?: string;
}

type Entry =
  | { id: number; role: 'buyer'; text: string }
  | { id: number; role: 'advisor'; text: string; toolCalls: SimTurnResponse['toolCalls']; ms?: number };

type SimStatus = { kind: 'checking' } | { kind: 'ready'; model: string } | { kind: 'unavailable'; reason: string };

/**
 * Text chat with the simulated advisor: the real brief and tools against the language model,
 * with tool calls running on this session so the stage updates live. No voice minutes spent.
 */
export function SimChat({ sessionId }: { sessionId: string | undefined }) {
  const [status, setStatus] = useState<SimStatus>({ kind: 'checking' });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/sim/status')
      .then(async (r) => {
        const body = (await r.json()) as { available?: boolean; model?: string; error?: string };
        if (cancelled) return;
        if (r.ok && body.available) setStatus({ kind: 'ready', model: body.model ?? '' });
        else setStatus({ kind: 'unavailable', reason: body.error ?? 'OPENAI_API_KEY is not set on the server. Add it to .env and restart the API.' });
      })
      .catch(() => !cancelled && setStatus({ kind: 'unavailable', reason: 'Could not reach the API. Is the server running?' }));
    return () => {
      cancelled = true;
    };
  }, []);

  // A different session is a different conversation.
  useEffect(() => {
    setEntries([]);
    setError(null);
  }, [sessionId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [entries, busy]);

  const nextId = () => (seq.current += 1);

  const send = async () => {
    const text = draft.trim();
    if (!sessionId || !text || busy) return;
    setDraft('');
    setError(null);
    setEntries((e) => [...e, { id: nextId(), role: 'buyer', text }]);
    setBusy(true);
    try {
      const res = await fetch(`/api/sim/${sessionId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const body = (await res.json()) as SimTurnResponse & { error?: string };
      if (!res.ok) {
        setError(body.error ?? `The server answered ${res.status}.`);
        return;
      }
      setEntries((e) => {
        const greeting: Entry[] = body.greeting ? [{ id: nextId(), role: 'advisor', text: body.greeting, toolCalls: [] }] : [];
        // The greeting was spoken before the buyer's first line.
        const before = e.slice(0, -1);
        const buyer = e.slice(-1);
        return [...before, ...greeting, ...buyer, { id: nextId(), role: 'advisor', text: body.reply, toolCalls: body.toolCalls, ms: body.ms }];
      });
    } catch {
      setError('Could not reach the API. Is the server running?');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!sessionId) return;
    setEntries([]);
    setError(null);
    await fetch(`/api/sim/${sessionId}`, { method: 'DELETE' }).catch(() => undefined);
  };

  if (!sessionId) return <Notice tone="info" title="No session yet" body="Create or pick a session above, then chat with the advisor here." />;
  if (status.kind === 'checking') {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-soft">
        <Spinner /> Checking the simulated advisor
      </p>
    );
  }
  if (status.kind === 'unavailable') return <Notice tone="warn" title="Simulated advisor is off" body={status.reason} />;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-ink-soft">
        <span>
          Model <span className="font-mono">{status.model}</span>
        </span>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => void reset()} disabled={busy || entries.length === 0}>
          New chat
        </Button>
      </div>

      <div ref={logRef} className="flex max-h-[420px] min-h-[120px] flex-col gap-2 overflow-auto rounded-[12px] border-2 border-line bg-paper p-2" aria-live="polite">
        {entries.length === 0 && !busy && <p className="m-auto text-center text-xs text-ink-soft">Type what the buyer would say, for example "Show me what's available".</p>}
        {entries.map((entry) => (
          <div key={entry.id} className={cn('flex flex-col gap-1', entry.role === 'buyer' ? 'items-end' : 'items-start')}>
            <p
              className={cn(
                'max-w-[92%] rounded-[12px] border-2 px-2.5 py-1.5 text-[13px] leading-snug',
                entry.role === 'buyer' ? 'border-ink bg-blue-tint' : 'border-ink bg-canvas',
              )}
            >
              {entry.text || <span className="text-ink-soft">(no words, only tool calls)</span>}
            </p>
            {entry.role === 'advisor' && entry.toolCalls.length > 0 && (
              <div className="flex w-full flex-col gap-1">
                {entry.toolCalls.map((c, i) => (
                  <ToolResultView key={i} name={c.name} result={c.result} ms={c.ms} args={c.args} />
                ))}
              </div>
            )}
            {entry.role === 'advisor' && entry.ms !== undefined && <span className="tabular text-[11px] text-ink-mute">{entry.ms} ms</span>}
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-xs text-ink-soft">
            <Spinner size={14} /> Thinking
          </p>
        )}
      </div>

      {error && <Notice tone="error" title="The advisor did not answer" body={error} />}

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="h-16 min-w-0 flex-1 resize-none rounded-[12px] border-2 border-ink/25 p-2 text-[13px] outline-none focus:border-ink"
          placeholder="Say something as the buyer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button type="submit" size="sm" icon={Send} iconOnly label="Send" busy={busy} disabled={!draft.trim()} />
      </form>
    </div>
  );
}
