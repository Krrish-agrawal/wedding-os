import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BellOff, BellRing, Clock, Headset, House, Sparkles } from 'lucide-react';
import { formatDuration, type SessionSummary } from '@ave/shared';
import { Avatar, Button, ICON_STROKE, Pill, Spinner, cn } from '@/ui';
import { getBundle } from '@/content';
import { consultApi, type CallBrief } from './consultApi';
import { useDeskFeed, useNow } from './hooks';
import { RING_INTERVAL_MS, Ringer, loadRingMuted, pageCanPlaySound, saveRingMuted } from './ring';

const CLOCK_TICK_MS = 1000;
/** The brief changes as the AI keeps talking with the buyer; refresh it while the card is up. */
const BRIEF_REFRESH_MS = 15_000;
const PULSE_DURATION_S = 1.4;
const ENTER_DURATION_S = 0.22;
/** Other waiting buyers listed under the current one. */
const MAX_QUEUE_CHIPS = 3;

const SNOOZE_KEY = 'ave.desk.snoozedCalls';
/** Snoozes older than this are forgotten (a new request after it rings again anyway). */
const SNOOZE_MEMORY_MS = 12 * 60 * 60 * 1000;

type Snoozes = Record<string, number>;

function loadSnoozes(): Snoozes {
  try {
    const raw = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const cutoff = Date.now() - SNOOZE_MEMORY_MS;
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > cutoff));
  } catch {
    return {};
  }
}

function saveSnoozes(s: Snoozes): void {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: the snooze still holds for this visit.
  }
}

interface Waiting {
  summary: SessionSummary;
  brief: CallBrief | null;
  /** When the buyer asked (from the server), else when this screen first saw the request. */
  since: number;
}

function RingPulse() {
  const reduce = useReducedMotion();
  if (reduce) return <span aria-hidden className="pointer-events-none absolute -inset-1.5 rounded-[22px] border-2 border-coral" />;
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[18px] border-[3px] border-coral"
      initial={{ opacity: 0.9, scale: 1 }}
      animate={{ opacity: 0, scale: 1.45 }}
      transition={{ duration: PULSE_DURATION_S, repeat: Infinity, ease: 'easeOut' }}
    />
  );
}

export interface IncomingCallProps {
  /** The call this screen already shows: never announced here. */
  currentSessionId?: string | null;
  /** `modal` covers the Lead Desk; `card` sits in a corner so an open call screen stays usable. */
  variant?: 'modal' | 'card';
  /** True while this advisor is on another call: accepting would strand that buyer, so it is disabled. */
  busy?: boolean;
}

/**
 * The incoming-call alert for every Desk screen: who is waiting, on which property, why they asked, how long
 * they have waited, and the AI's brief. Accept opens the call and joins; Not now snoozes that request in this
 * browser. A soft ring repeats while it is up (once the page has had a click, and unless muted).
 */
export function IncomingCall({ currentSessionId = null, variant = 'modal', busy = false }: IncomingCallProps) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [reasons, setReasons] = useState<Record<string, string | null>>({});
  const feed = useDeskFeed(useCallback((msg) => setReasons((r) => ({ ...r, [msg.sessionId]: msg.reason })), []));
  const now = useNow(CLOCK_TICK_MS);
  const [briefs, setBriefs] = useState<Record<string, CallBrief>>({});
  const [snoozes, setSnoozes] = useState<Snoozes>(loadSnoozes);
  const [muted, setMuted] = useState(loadRingMuted);
  const [front, setFront] = useState<string | null>(null);
  const firstSeen = useRef(new Map<string, number>());

  const requested = useMemo(
    () => feed.sessions.filter((s) => s.status !== 'ended' && s.handoff === 'requested' && s.id !== currentSessionId),
    [feed.sessions, currentSessionId],
  );
  const requestedKey = requested.map((s) => s.id).join(',');

  // Fetch each waiting buyer's brief now and every BRIEF_REFRESH_MS while they wait.
  useEffect(() => {
    if (!requestedKey) return;
    let cancelled = false;
    const load = () => {
      for (const id of requestedKey.split(',')) {
        consultApi.brief(id).then(
          (b) => {
            if (!cancelled) setBriefs((all) => ({ ...all, [id]: b }));
          },
          () => undefined,
        );
      }
    };
    load();
    const t = setInterval(load, BRIEF_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [requestedKey]);

  const queue: Waiting[] = requested
    .map((summary) => {
      const brief = briefs[summary.id] ?? null;
      if (!firstSeen.current.has(summary.id)) firstSeen.current.set(summary.id, Date.now());
      return { summary, brief, since: brief?.requestedAt ?? firstSeen.current.get(summary.id) ?? Date.now() };
    })
    // A snooze covers the request it was made for; a newer request from the same buyer shows again.
    .filter((w) => {
      const snoozedAt = snoozes[w.summary.id];
      return snoozedAt === undefined || (w.brief?.requestedAt ?? 0) > snoozedAt;
    })
    .sort((a, b) => Number(b.summary.id === front) - Number(a.summary.id === front) || a.since - b.since);
  const current = queue[0] ?? null;
  const ringing = Boolean(current) && !muted;

  // Ring now and every few seconds while a call waits.
  useEffect(() => {
    if (!ringing) return;
    const ringer = new Ringer();
    ringer.ring();
    const t = setInterval(() => ringer.ring(), RING_INTERVAL_MS);
    return () => {
      clearInterval(t);
      ringer.close();
    };
  }, [ringing]);

  const snooze = useCallback((id: string) => {
    setSnoozes((s) => {
      const next = { ...s, [id]: Date.now() };
      saveSnoozes(next);
      return next;
    });
    setFront(null);
  }, []);

  const toggleMute = () => {
    setMuted((m) => {
      saveRingMuted(!m);
      return !m;
    });
  };

  const accept = (id: string) => navigate(`/desk/call/${encodeURIComponent(id)}?join=1`);

  // Escape is "Not now" for the call on top.
  useEffect(() => {
    if (!current || variant !== 'modal') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') snooze(current.summary.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, variant, snooze]);

  const card = current ? (
    <IncomingCard
      key={current.summary.id}
      waiting={current}
      reason={current.brief?.reason ?? reasons[current.summary.id] ?? null}
      now={now}
      others={queue.slice(1)}
      busy={busy}
      muted={muted}
      onToggleMute={toggleMute}
      onAccept={() => accept(current.summary.id)}
      onSnooze={() => snooze(current.summary.id)}
      onPick={setFront}
      autoFocus={variant === 'modal'}
    />
  ) : null;

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 16, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 12, scale: 0.97 }, transition: { duration: ENTER_DURATION_S } };

  if (variant === 'card') {
    return (
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 w-[400px] max-w-[calc(100vw-2rem)]">
        <AnimatePresence>{card ? <motion.div key={current?.summary.id} className="pointer-events-auto" {...motionProps}>{card}</motion.div> : null}</AnimatePresence>
      </div>
    );
  }
  return (
    <AnimatePresence>
      {card ? (
        <motion.div
          key="incoming-backdrop"
          className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0 }}
        >
          <motion.div key={current?.summary.id} className="w-[460px] max-w-full" {...motionProps}>
            {card}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

interface IncomingCardProps {
  waiting: Waiting;
  reason: string | null;
  now: number;
  others: Waiting[];
  busy: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onAccept: () => void;
  onSnooze: () => void;
  onPick: (id: string) => void;
  autoFocus: boolean;
}

function IncomingCard({ waiting, reason, now, others, busy, muted, onToggleMute, onAccept, onSnooze, onPick, autoFocus }: IncomingCardProps) {
  const { summary, brief } = waiting;
  const property = brief?.propertyName ?? getBundle(summary.propertyId)?.property.name ?? null;
  const titleId = `incoming-${summary.id}-title`;
  const bodyId = `incoming-${summary.id}-body`;
  const soundBlocked = !muted && !pageCanPlaySound();

  return (
    <section
      role="alertdialog"
      aria-modal={autoFocus || undefined}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-canvas shadow-[var(--shadow-pop-lg)]"
    >
      <header className="flex items-center gap-2 border-b-2 border-ink bg-coral-tint px-4 py-2.5">
        <BellRing size={16} strokeWidth={ICON_STROKE} aria-hidden className="text-coral-deep" />
        <p className="text-xs font-bold uppercase tracking-[0.08em]">Incoming call for a person</p>
        <span className="ml-auto inline-flex items-center gap-1 text-sm font-semibold" aria-label="Waiting for">
          <Clock size={14} strokeWidth={ICON_STROKE} aria-hidden />
          <span className="tabular">{formatDuration(Math.max(0, now - waiting.since))}</span>
        </span>
        <Button variant="ghost" size="sm" iconOnly icon={muted ? BellOff : BellRing} label={muted ? 'Turn the ring on' : 'Mute the ring'} onClick={onToggleMute} />
      </header>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex">
            <RingPulse />
            <Avatar name={summary.buyerName} size={52} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate font-display text-xl font-bold leading-tight">
              {summary.buyerName} wants to talk to you
            </h2>
            <p className="flex items-center gap-1.5 truncate text-[13px] text-ink-soft">
              <House size={13} strokeWidth={ICON_STROKE} aria-hidden />
              {property ?? 'No property open yet'}
            </p>
          </div>
        </div>

        {reason ? <p className="rounded-[12px] bg-sun-tint px-3 py-2 text-[14px] font-semibold leading-snug">“{reason}”</p> : null}

        <div id={bodyId} className="rounded-[14px] border-2 border-line bg-paper px-3 py-2.5">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-blue-deep">
            <Sparkles size={13} strokeWidth={ICON_STROKE} aria-hidden />
            What the AI knows
          </p>
          {brief ? (
            <ul className="grid gap-1 text-[13px] leading-snug">
              {brief.brief.split('\n').map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-ink-soft">
              <Spinner size={12} /> Getting the brief…
            </p>
          )}
        </div>

        {busy ? <p className="text-[13px] font-semibold text-coral-deep">Hand back your current call before you take this one.</p> : null}

        <div className="flex items-center gap-2">
          <Button variant="confirm" icon={Headset} onClick={onAccept} disabled={busy} autoFocus={autoFocus && !busy} className="flex-1">
            Accept
          </Button>
          <Button variant="secondary" onClick={onSnooze}>
            Not now
          </Button>
        </div>

        {soundBlocked ? <p className="text-xs text-ink-soft">The ring starts after your first click on this page.</p> : null}

        {others.length ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t-2 border-line pt-3">
            <span className="text-xs font-semibold text-ink-soft">Also waiting:</span>
            {others.slice(0, MAX_QUEUE_CHIPS).map((w) => (
              <button
                key={w.summary.id}
                type="button"
                onClick={() => onPick(w.summary.id)}
                className={cn('rounded-[var(--radius-chip)] border-2 border-ink bg-canvas px-2.5 py-0.5 text-xs font-semibold hover:bg-coral-tint')}
              >
                {w.summary.buyerName} · <span className="tabular">{formatDuration(Math.max(0, now - w.since))}</span>
              </button>
            ))}
            {others.length > MAX_QUEUE_CHIPS ? (
              <Pill tone="muted" size="sm">
                +{others.length - MAX_QUEUE_CHIPS} more
              </Pill>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
