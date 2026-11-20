import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ToolResult } from '@ave/shared';
import { ICON_STROKE, Pill } from '@/ui';
import { prettyJson } from './examples';

/** One tool result: ok or refused, the error and hint the advisor would act on, and the raw JSON. */
export function ToolResultView({ name, result, ms, args, defaultOpen = false }: { name: string; result: ToolResult; ms?: number; args?: unknown; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const Toggle = open ? ChevronDown : ChevronRight;
  return (
    <div className="rounded-[12px] border-2 border-line bg-canvas p-2">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Toggle size={14} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-ink-soft" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold">{name}</span>
        {ms !== undefined && <span className="tabular text-[11px] text-ink-soft">{ms} ms</span>}
        <Pill size="sm" tone={result.ok ? 'live' : 'error'} dot>
          {result.ok ? 'ok' : 'refused'}
        </Pill>
      </button>
      {!result.ok && (
        <p className="mt-1.5 text-xs leading-snug text-ink">
          {result.error}
          {result.hint ? <span className="block text-ink-soft">Hint: {result.hint}</span> : null}
        </p>
      )}
      {open && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-[8px] bg-paper p-2 font-mono text-[11px] leading-snug">
          {args !== undefined ? `args ${prettyJson(args)}\n\n` : ''}
          {prettyJson(result)}
        </pre>
      )}
    </div>
  );
}
