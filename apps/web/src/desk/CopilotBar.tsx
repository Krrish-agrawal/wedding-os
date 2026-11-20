import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, ChevronDown, CornerDownLeft, FileText, History, Image, Link2, Mail, MapPin, MessageCircle, Sparkles, SquareCheckBig, Hash, X as XIcon } from 'lucide-react';
import type { LeadSummary, SessionState } from '@ave/shared';
import { Button, ICON_STROKE, Spinner, cn } from '@/ui';
import { content } from '@/content';
import { CHANNEL_NAME, DELIVERY_STATUS } from './display';
import { copilotApi } from './copilotApi';
import { useResource } from './hooks';
import { useDismiss } from './useDismiss';
import { OutboundPreviewCard } from './OutboundPreviewCard';
import { currentBundle, jiraFollowUpDraft, mapPinDraft, photoDraft, priceSheetDraft, recapDraft, slackNotifyDraft, summaryLinkDraft } from './quickDrafts';
import type { Copilot, LogEntry } from './useCopilot';

/** Example instructions shown in turn in the empty command box. */
export const COPILOT_EXAMPLES = [
  'show the master bathroom plumbing',
  'EMI with 1.5 crore down over 15 years',
  'send her the floor plan on WhatsApp',
  'jira: manager approval for 2% discount',
  'tell the team she wants a Saturday visit',
] as const;
const EXAMPLE_ROTATE_MS = 3500;
const COMMAND_MAX = 500;
/** Log entries shown when the history is open. */
const HISTORY_SHOWN = 12;

function useRotatingExample(paused: boolean): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setI((n) => (n + 1) % COPILOT_EXAMPLES.length), EXAMPLE_ROTATE_MS);
    return () => clearInterval(t);
  }, [paused]);
  return COPILOT_EXAMPLES[i]!;
}

function MenuItem({ icon: Icon, label, hint, disabled, onClick }: { icon: typeof Mail; label: string; hint?: string | null; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      title={disabled && hint ? hint : undefined}
      className="flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0 text-mint-deep" />
      <span className="min-w-0">
        <span className="block font-semibold">{label}</span>
        {hint ? <span className="block text-xs text-ink-soft">{hint}</span> : null}
      </span>
    </button>
  );
}

/** "WhatsApp ▾": summary link, a photo of the property on screen, a map pin, the price sheet. */
function WhatsAppMenu({ copilot, state }: { copilot: Copilot; state: SessionState }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const bundle = currentBundle(content, state);
  const media = useResource(open && bundle ? `media:${bundle.property.id}` : null, () => copilotApi.media(bundle?.property.id ?? ''));
  const needsProperty = bundle ? null : 'Open a property first';
  const pick = (make: () => Parameters<Copilot['draft']>[0]) => {
    close();
    void copilot.draft(make());
  };

  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" size="sm" icon={MessageCircle} trailingIcon={ChevronDown} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        WhatsApp
      </Button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            aria-label="Send on WhatsApp"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full left-0 z-30 mb-2 w-72 rounded-[14px] border-2 border-ink bg-canvas p-1.5 shadow-[var(--shadow-pop)]"
          >
            <MenuItem icon={Link2} label="Call summary link" hint="Her page with everything from this call" onClick={() => pick(() => summaryLinkDraft(state, location.origin))} />
            {bundle ? (
              media.loading ? (
                <p className="flex items-center gap-2 px-2.5 py-2 text-sm text-ink-soft">
                  <Spinner size={14} /> Finding photos
                </p>
              ) : media.error ? (
                <MenuItem icon={Image} label="Photo" hint={media.error} disabled onClick={() => undefined} />
              ) : (
                (media.data?.items ?? []).map((m) => (
                  <MenuItem
                    key={m.path}
                    icon={Image}
                    label={`${m.label}: ${bundle.property.name}`}
                    hint={m.url ? null : media.data?.unavailable}
                    disabled={!m.url}
                    onClick={() => pick(() => photoDraft(state, bundle, { label: m.label, url: m.url! }))}
                  />
                ))
              )
            ) : (
              <MenuItem icon={Image} label="Property photo" hint={needsProperty} disabled onClick={() => undefined} />
            )}
            <MenuItem icon={MapPin} label="Location pin" hint={needsProperty ?? 'Google Maps link with the address'} disabled={!bundle} onClick={() => bundle && pick(() => mapPinDraft(state, bundle))} />
            <MenuItem icon={FileText} label="Price sheet" hint={needsProperty ?? 'Price breakup with any offers applied'} disabled={!bundle} onClick={() => bundle && pick(() => priceSheetDraft(content, state, bundle))} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function StepChips({ entry }: { entry: Extract<LogEntry, { kind: 'reply' }> }) {
  if (!entry.steps.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {entry.steps.map((s, i) => (
        <span key={i} className={cn('inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]', s.ok ? 'border-mint/50 bg-mint-tint' : 'border-coral/50 bg-coral-tint')}>
          {s.ok ? <Check size={11} strokeWidth={ICON_STROKE} aria-hidden /> : <XIcon size={11} strokeWidth={ICON_STROKE} aria-hidden />}
          <span className="truncate">{s.summary}</span>
        </span>
      ))}
    </span>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  switch (entry.kind) {
    case 'command':
      return (
        <p className="truncate text-ink-soft">
          <span aria-hidden className="mr-1 font-bold text-grape-deep">
            ›
          </span>
          {entry.text}
        </p>
      );
    case 'reply':
      return (
        <div>
          <p className="font-semibold">{entry.text}</p>
          <StepChips entry={entry} />
        </div>
      );
    case 'error':
      return <p className="font-semibold text-coral-deep">{entry.text}</p>;
    case 'delivery': {
      const d = entry.delivery;
      return (
        <p>
          <span className="font-semibold">
            {CHANNEL_NAME[d.channel]} to {d.to}:
          </span>{' '}
          {DELIVERY_STATUS[d.status].label}
          {d.status !== 'sent' && d.detail ? ` (${d.detail})` : ''}
          {d.url ? (
            <a href={d.url} target="_blank" rel="noreferrer" className="ml-1.5 font-semibold text-blue-deep underline decoration-2 underline-offset-2">
              {d.ref ?? 'Open'}
            </a>
          ) : null}
        </p>
      );
    }
  }
}

function QuickButton({ icon, label, onClick, disabled, title }: { icon: typeof Mail; label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <Button variant="secondary" size="sm" icon={icon} onClick={onClick} disabled={disabled} title={title}>
      {label}
    </Button>
  );
}

/**
 * The admin's copilot during a consult: type an instruction (the buyer never hears it), or use a quick
 * action. Anything that would leave the app shows up as a preview card first.
 */
export function CopilotBar({ copilot, state, lead }: { copilot: Copilot; state: SessionState; lead: Pick<LeadSummary, 'score' | 'tier' | 'stageLabel'> | null }) {
  const [command, setCommand] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const reduce = useReducedMotion();
  const example = useRotatingExample(command.length > 0 || copilot.busy);
  const ended = state.status === 'ended';
  const bundle = currentBundle(content, state);
  const latest = copilot.log.at(-1);
  const lastReply = [...copilot.log].reverse().find((e) => e.kind !== 'command');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = command.trim();
    if (!text || copilot.busy) return;
    setCommand('');
    void copilot.run(text);
  };

  return (
    <section aria-label="Copilot" className="shrink-0 rounded-[var(--radius-card)] border-2 border-ink bg-canvas shadow-[var(--shadow-pop-sm)]">
      <AnimatePresence initial={false}>
        {copilot.cards.length ? (
          <motion.div
            key="cards"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            className="overflow-hidden border-b-2 border-line"
          >
            <div className="scroll-quiet flex gap-3 overflow-x-auto p-3" aria-label="Messages waiting to be sent">
              {copilot.cards.map((card) => (
                <OutboundPreviewCard key={card.preview.id} card={card} onSend={(edits) => void copilot.send(card.preview.id, edits)} onDismiss={() => copilot.dismiss(card.preview.id)} />
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <form onSubmit={submit} className="flex min-w-[320px] flex-1 items-center gap-2" noValidate>
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border-2 border-ink bg-grape-tint">
            {copilot.busy ? <Spinner size={16} /> : <Sparkles size={16} strokeWidth={ICON_STROKE} />}
          </span>
          <label htmlFor="copilot-command" className="sr-only">
            Instruction for the copilot (the buyer does not hear it)
          </label>
          <input
            id="copilot-command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setCommand('');
            }}
            maxLength={COMMAND_MAX}
            disabled={ended}
            placeholder={ended ? 'The call has ended' : `Try “${example}”`}
            autoComplete="off"
            className="h-10 min-w-0 flex-1 rounded-[12px] border-2 border-ink/25 bg-canvas px-3 text-[14px] outline-none placeholder:text-ink-mute hover:border-ink/50 focus:border-ink focus:shadow-[var(--shadow-pop-blue)] disabled:bg-paper"
          />
          <Button type="submit" variant="primary" size="sm" icon={CornerDownLeft} busy={copilot.busy} disabled={ended || !command.trim()}>
            Run
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick actions">
          <WhatsAppMenu copilot={copilot} state={state} />
          <QuickButton icon={Mail} label="Email recap" onClick={() => void copilot.draft(recapDraft())} />
          <QuickButton icon={SquareCheckBig} label="Jira task" onClick={() => void copilot.draft(jiraFollowUpDraft(content, state, bundle))} />
          <QuickButton icon={Hash} label="Notify Slack" onClick={() => void copilot.draft(slackNotifyDraft(content, state, bundle, lead, location.origin))} />
        </div>
      </div>

      {latest ? (
        <div className="border-t-2 border-line px-3 py-2 text-[13px]" aria-live="polite">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {historyOpen ? (
                <ol className="scroll-quiet max-h-40 space-y-1.5 overflow-y-auto pr-1">
                  {copilot.log.slice(-HISTORY_SHOWN).map((e) => (
                    <li key={e.id}>
                      <LogLine entry={e} />
                    </li>
                  ))}
                </ol>
              ) : copilot.busy && latest.kind === 'command' ? (
                <p className="truncate text-ink-soft">Working on “{latest.text}”…</p>
              ) : lastReply ? (
                <LogLine entry={lastReply} />
              ) : null}
            </div>
            {copilot.log.length > 1 ? (
              <button
                type="button"
                onClick={() => setHistoryOpen((o) => !o)}
                aria-expanded={historyOpen}
                className="inline-flex shrink-0 items-center gap-1 rounded-[8px] px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-paper hover:text-ink"
              >
                <History size={13} strokeWidth={ICON_STROKE} aria-hidden />
                {historyOpen ? 'Latest' : `History ${copilot.log.length}`}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
