import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import {
  AudioLines,
  CircleCheck,
  CircleQuestionMark,
  Handshake,
  Hash,
  ListTodo,
  Mail,
  MessageCircle,
  MessageSquareExclamationPoint,
  MonitorPlay,
  Send,
  ShieldExclamationPoint,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import { formatTimeIST, type ConsultAction, type ConsultNextStep, type SessionState } from '@ave/shared';
import { Button, ICON_STROKE, Mascot, Pill, cn } from '@/ui';
import { useDispatch } from '@/session/useSession';
import { useAdvisorName } from './hooks';

/** New items glow for this long, so the admin sees what just changed without reading everything again. */
const FLASH_MS = 2400;
const MAX_ADMIN_NOTE_CHARS = 1000;

export const ACTION_BUTTONS: Record<ConsultAction['kind'], { label: string; icon: LucideIcon }> = {
  whatsapp: { label: 'Send WhatsApp', icon: MessageCircle },
  email: { label: 'Draft email', icon: Mail },
  jira: { label: 'Create Jira task', icon: ListTodo },
  slack: { label: 'Post to Slack', icon: Hash },
  view: { label: 'Show on screen', icon: MonitorPlay },
};

/** Ids that appeared since the last render, for a short highlight. Nothing flashes on first mount. */
function useFreshIds(ids: string[]): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const key = ids.join('\u0000');

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const known = seen.current;
    const added = ids.filter((id) => !known.has(id));
    for (const id of added) known.add(id);
    if (!added.length) return;
    setFresh((prev) => new Set([...prev, ...added]));
    timers.current.push(
      setTimeout(() => {
        setFresh((prev) => {
          const next = new Set(prev);
          for (const id of added) next.delete(id);
          return next;
        });
      }, FLASH_MS),
    );
    // `key` stands for `ids`.
  }, [key]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return fresh;
}

function Flash({ on }: { on: boolean }) {
  const reduce = useReducedMotion();
  if (!on) return null;
  if (reduce) return <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[10px] bg-sun-tint" />;
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[10px] bg-sun-tint"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: FLASH_MS / 1000, ease: 'easeIn' }}
    />
  );
}

function Item({ fresh, className, children }: { fresh: boolean; className?: string; children: ReactNode }) {
  return (
    <li className={cn('relative rounded-[10px] px-2.5 py-1.5 text-[13px] leading-snug', className)}>
      <Flash on={fresh} />
      <div className="relative">{children}</div>
    </li>
  );
}

function Section({ title, icon: Icon, count, children }: { title: string; icon: LucideIcon; count?: number; children: ReactNode }) {
  return (
    <section className="border-b-2 border-line px-4 py-3 last:border-b-0">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-ink-soft">
        <Icon size={13} strokeWidth={ICON_STROKE} aria-hidden />
        {title}
        {count ? <span className="tabular rounded-full bg-paper px-1.5 text-[11px] text-ink">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function Quote({ text }: { text: string | null }) {
  if (!text) return null;
  return <span className="mt-0.5 block text-[12px] italic text-ink-soft">“{text}”</span>;
}

function SourcePill({ state }: { state: SessionState }) {
  const { consult, handoff } = state;
  const pills: ReactNode[] = [];
  if (consult.transcriptSource === 'agora_stt') {
    pills.push(
      <Pill key="src" tone="live" size="sm" icon={AudioLines}>
        Transcribing with Agora Real-Time STT
      </Pill>,
    );
  } else if (consult.transcriptSource === 'openai') {
    pills.push(
      <Pill key="src" tone="blue" size="sm" icon={AudioLines}>
        Transcribing with OpenAI
      </Pill>,
    );
  } else if (handoff.status !== 'joined') {
    pills.push(
      <Pill key="src" tone="muted" size="sm">
        Not transcribing
      </Pill>,
    );
  }
  if (consult.status === 'updating') {
    pills.push(
      <Pill key="busy" tone="waiting" size="sm" busy>
        Updating notes
      </Pill>,
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b-2 border-line px-4 py-2.5" role="status" aria-live="polite">
      {pills}
      {consult.updatedAt ? <span className="ml-auto text-xs text-ink-soft">Updated {formatTimeIST(consult.updatedAt)}</span> : null}
      {consult.error ? <p className="w-full rounded-[10px] bg-tangerine-tint px-2.5 py-1.5 text-[12px] leading-snug">{consult.error}</p> : null}
    </div>
  );
}

function DoneBadge({ step, state }: { step: ConsultNextStep; state: SessionState }) {
  const delivery = state.deliveries.find((d) => d.id === step.doneRef);
  const ref = delivery?.ref ?? delivery?.label ?? (step.doneRef && step.doneRef !== 'done' ? step.doneRef : null);
  return (
    <span className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-mint-deep">
      <CircleCheck size={13} strokeWidth={ICON_STROKE} aria-hidden />
      Done
      {ref ? (
        delivery?.url ? (
          <a href={delivery.url} target="_blank" rel="noreferrer" className="text-ink underline">
            {ref}
          </a>
        ) : (
          <span className="text-ink">{ref}</span>
        )
      ) : null}
    </span>
  );
}

/** randomUUID exists only in secure contexts (https, localhost); a LAN address over http still works. */
function noteId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function AdminNotes({ state }: { state: SessionState }) {
  const dispatch = useDispatch();
  const [name] = useAdvisorName();
  const [draft, setDraft] = useState('');
  const notes = state.consult.adminNotes;

  const add = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim().slice(0, MAX_ADMIN_NOTE_CHARS);
    if (!text) return;
    dispatch({ type: 'add_admin_note', note: { id: noteId(), text, at: Date.now(), by: name.trim() || null } });
    setDraft('');
  };

  return (
    <Section title="Your notes" icon={StickyNote} count={notes.length}>
      {notes.length ? (
        <ul className="mb-2 grid gap-1">
          {notes.map((n) => (
            <li key={n.id} className="rounded-[10px] bg-grape-tint px-2.5 py-1.5 text-[13px] leading-snug">
              {n.text}
              <span className="mt-0.5 block text-[11px] text-ink-soft">
                {n.by ? `${n.by} · ` : ''}
                {formatTimeIST(n.at)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={add} className="flex items-center gap-2">
        <label className="sr-only" htmlFor="admin-note">
          Add a note
        </label>
        <input
          id="admin-note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_ADMIN_NOTE_CHARS}
          placeholder="Add a note (the AI reads it too)"
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded-[12px] border-2 border-ink/25 bg-canvas px-3 text-[13px] outline-none placeholder:text-ink-mute hover:border-ink/50 focus:border-ink focus:shadow-[var(--shadow-pop-blue)]"
        />
        <Button type="submit" size="sm" variant="secondary" icon={Send} iconOnly label="Add note" disabled={!draft.trim()} />
      </form>
    </Section>
  );
}

export interface LiveNotesProps {
  state: SessionState;
  /** Runs a next step's action (preview and send live with the caller). Without it the buttons are disabled. */
  onAction?: (step: ConsultNextStep) => void;
}

/**
 * The AI's live notes while a human advisor talks with the buyer (desk/consult.ts on the server writes them):
 * summary, what the buyer asked, what the advisor promised, objections, and next steps with one-click actions.
 * Only the Desk sees this; the buyer never does.
 */
export function LiveNotes({ state, onAction }: LiveNotesProps) {
  const notes = state.consult.notes;
  const first = state.buyer.name.trim().split(/\s+/)[0] ?? 'the buyer';
  const asks = notes?.buyerAsks ?? [];
  const promises = notes?.promises ?? [];
  const objections = notes?.objections ?? [];
  const steps = notes?.nextSteps ?? [];
  const fresh = useFreshIds([...asks.map((a) => a.id), ...promises.map((p) => p.id), ...objections.map((o) => `o:${o}`), ...steps.map((s) => s.id)]);
  const freshSummary = useFreshIds(notes?.summary ? [notes.summary] : []);
  const onCall = state.handoff.status === 'joined' && state.status !== 'ended';

  return (
    <div className="flex flex-col">
      <SourcePill state={state} />
      {!notes ? (
        <div className="flex items-center gap-3 px-4 py-5">
          <Mascot state={onCall ? 'listening' : 'idle'} size={52} shadow={false} />
          <p className="text-sm text-ink-soft">
            {onCall ? `Notes appear here a few seconds after you and ${first} start talking.` : 'Live notes start when you join the call.'}
          </p>
        </div>
      ) : (
        <>
          <Section title="Summary" icon={Sparkles}>
            <ul>
              <Item fresh={freshSummary.has(notes.summary)} className="px-0 py-0 text-sm">
                {notes.summary || 'Nothing to summarise yet.'}
              </Item>
            </ul>
          </Section>

          <Section title={`${first} asked`} icon={CircleQuestionMark} count={asks.length}>
            {asks.length ? (
              <ul className="grid gap-1">
                {asks.map((a) => (
                  <Item key={a.id} fresh={fresh.has(a.id)} className="bg-blue-tint">
                    {a.text}
                    <Quote text={a.quote} />
                  </Item>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-soft">No questions noted yet.</p>
            )}
          </Section>

          <Section title="You promised" icon={Handshake} count={promises.length}>
            {promises.length ? (
              <ul className="grid gap-1">
                {promises.map((p) => (
                  <Item key={p.id} fresh={fresh.has(p.id)} className={p.needsApproval ? 'bg-coral-tint' : 'bg-mint-tint'}>
                    {p.needsApproval ? (
                      <Pill tone="error" size="sm" icon={ShieldExclamationPoint} className="mb-1 h-6">
                        Needs approval
                      </Pill>
                    ) : null}
                    <span className="block">{p.text}</span>
                    <Quote text={p.quote} />
                  </Item>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-soft">No commitments yet.</p>
            )}
          </Section>

          {objections.length ? (
            <Section title="Objections" icon={MessageSquareExclamationPoint} count={objections.length}>
              <ul className="grid gap-1">
                {objections.map((o) => (
                  <Item key={o} fresh={fresh.has(`o:${o}`)} className="bg-sun-tint">
                    {o}
                  </Item>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title="Next steps" icon={ListTodo} count={steps.length}>
            {steps.length ? (
              <ul className="grid gap-1.5">
                {steps.map((s) => {
                  const button = s.action ? ACTION_BUTTONS[s.action.kind] : null;
                  return (
                    <Item key={s.id} fresh={fresh.has(s.id)} className={cn('border-2', s.doneRef ? 'border-mint/60 bg-mint-tint' : 'border-line bg-canvas')}>
                      <span className={cn('block', s.doneRef && 'text-ink-soft')}>{s.text}</span>
                      {s.doneRef ? (
                        <DoneBadge step={s} state={state} />
                      ) : button ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={button.icon}
                          className="mt-1.5 h-8"
                          disabled={!onAction}
                          title={onAction ? undefined : 'Actions are not available on this screen yet'}
                          onClick={() => onAction?.(s)}
                        >
                          {button.label}
                        </Button>
                      ) : null}
                    </Item>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-soft">No next steps yet.</p>
            )}
          </Section>
        </>
      )}
      <AdminNotes state={state} />
    </div>
  );
}
