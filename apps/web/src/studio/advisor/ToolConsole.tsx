import { useState } from 'react';
import { Play, RotateCcw } from 'lucide-react';
import { TOOL_DESCRIPTIONS, TOOL_NAMES, type ToolName, type ToolResult } from '@ave/shared';
import { useSessionState } from '@/session/useSession';
import { Button, Chip, Notice } from '@/ui';
import { prettyJson, toolExample } from './examples';
import { ToolResultView } from './ToolResultView';

type Outcome = { kind: 'result'; name: ToolName; result: ToolResult; ms: number } | { kind: 'error'; message: string };

/**
 * Director tool console: runs any advisor tool against the session exactly as the voice agent would,
 * through POST /api/sessions/:id/tools/:name (development only).
 */
export function ToolConsole({ sessionId }: { sessionId: string | undefined }) {
  const state = useSessionState();
  const [name, setName] = useState<ToolName>('showShortlist');
  const [json, setJson] = useState(() => prettyJson(toolExample('showShortlist', state)));
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const pick = (next: ToolName) => {
    setName(next);
    setJson(prettyJson(toolExample(next, state)));
    setParseError(null);
  };

  const run = async () => {
    if (!sessionId || busy) return;
    let input: unknown;
    try {
      input = json.trim() ? JSON.parse(json) : {};
    } catch {
      setParseError('That is not valid JSON.');
      return;
    }
    setParseError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/tools/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = (await res.json()) as { result?: ToolResult; ms?: number; error?: string };
      setOutcome(res.ok && body.result ? { kind: 'result', name, result: body.result, ms: body.ms ?? 0 } : { kind: 'error', message: body.error ?? `The server answered ${res.status}.` });
    } catch {
      setOutcome({ kind: 'error', message: 'Could not reach the API. Is the server running?' });
    } finally {
      setBusy(false);
    }
  };

  if (!sessionId) return <Notice tone="info" title="No session yet" body="Create or pick a session above to run tools against it." />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tools">
        {TOOL_NAMES.map((n) => (
          <Chip key={n} size="sm" label={n} selected={n === name} onClick={() => pick(n)} className="font-mono text-[11px]" />
        ))}
      </div>
      <p className="text-[13px] leading-snug text-ink-soft">{TOOL_DESCRIPTIONS[name]}</p>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold">Input</span>
        <textarea
          className="h-32 rounded-[12px] border-2 border-ink/25 p-2 font-mono text-xs outline-none focus:border-ink"
          value={json}
          spellCheck={false}
          onChange={(e) => setJson(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void run();
            }
          }}
        />
      </label>
      {parseError && <p className="text-xs font-semibold text-coral-deep">{parseError}</p>}
      <div className="flex gap-2">
        <Button size="sm" icon={Play} busy={busy} onClick={() => void run()}>
          Run {name}
        </Button>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => pick(name)}>
          Example
        </Button>
      </div>
      {outcome?.kind === 'error' && <Notice tone="error" title="The tool did not run" body={outcome.message} />}
      {outcome?.kind === 'result' && <ToolResultView name={outcome.name} result={outcome.result} ms={outcome.ms} defaultOpen />}
    </div>
  );
}
