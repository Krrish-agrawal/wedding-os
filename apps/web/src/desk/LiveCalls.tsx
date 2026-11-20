import { motion, useReducedMotion } from 'motion/react';
import { Clock, Headset, PhoneCall, RefreshCw } from 'lucide-react';
import { formatDuration, VIEW_LABELS, type SessionSummary } from '@ave/shared';
import { Avatar, Button, ICON_STROKE, Mascot, Notice, Panel, Pill, cn } from '@/ui';
import { getBundle } from '@/content';
import { callStatus } from './display';
import type { FeedConnection } from './hooks';

const PULSE_DURATION_S = 1.4;

/** A ring that grows out of the Join button while the buyer waits for a human. No sound. */
function Pulse() {
  const reduce = useReducedMotion();
  if (reduce) return <span aria-hidden className="pointer-events-none absolute -inset-1.5 rounded-[16px] border-2 border-coral" />;
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[12px] border-[3px] border-coral"
      initial={{ opacity: 0.9, scale: 1 }}
      animate={{ opacity: 0, scale: 1.35 }}
      transition={{ duration: PULSE_DURATION_S, repeat: Infinity, ease: 'easeOut' }}
    />
  );
}

function CallCard({ s, now, onJoin, reason }: { s: SessionSummary; now: number; onJoin: (id: string) => void; reason: string | null }) {
  const bundle = getBundle(s.propertyId);
  const status = callStatus(s);
  const wantsHuman = s.handoff === 'requested';
  return (
    <motion.li
      layout
      className={cn(
        'flex w-[300px] shrink-0 flex-col gap-3 rounded-[18px] border-2 border-ink p-4',
        wantsHuman ? 'bg-coral-tint shadow-[var(--shadow-pop)]' : 'bg-canvas',
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar name={s.buyerName} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[17px] font-bold leading-tight">{s.buyerName}</p>
          <p className="truncate text-[13px] text-ink-soft">
            {bundle ? bundle.property.name : 'No property open yet'} · {VIEW_LABELS[s.view]}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink-soft" aria-label="Call length">
          <Clock size={14} strokeWidth={ICON_STROKE} aria-hidden />
          <span className="tabular">{formatDuration(now - s.startedAt)}</span>
        </span>
      </div>
      {wantsHuman && reason ? <p className="line-clamp-2 text-[13px] font-semibold leading-snug">“{reason}”</p> : null}
      <div className="mt-auto flex items-center justify-between gap-2">
        <Pill tone={status.tone} size="sm" dot>
          {status.label}
        </Pill>
        <span className="relative inline-flex">
          {wantsHuman ? <Pulse /> : null}
          <Button size="sm" variant={wantsHuman ? 'danger' : 'secondary'} icon={Headset} onClick={() => onJoin(s.id)}>
            {s.handoff === 'joined' ? 'Open call' : 'Join call'}
          </Button>
        </span>
      </div>
    </motion.li>
  );
}

export function LiveCalls({
  sessions,
  connection,
  now,
  reasons,
  onJoin,
}: {
  sessions: SessionSummary[];
  connection: FeedConnection;
  now: number;
  reasons: Record<string, string | null>;
  onJoin: (id: string) => void;
}) {
  const live = sessions
    .filter((s) => s.status !== 'ended')
    .sort((a, b) => Number(b.handoff === 'requested') - Number(a.handoff === 'requested') || b.startedAt - a.startedAt);
  const waiting = live.filter((s) => s.handoff === 'requested').length;

  return (
    <Panel
      title="Live calls"
      subtitle={live.length ? `${live.length} in progress${waiting ? ` · ${waiting} waiting for an advisor` : ''}` : 'Calls show up here the moment they start'}
      icon={PhoneCall}
      accent={waiting ? 'coral' : 'mint'}
      padded={false}
      className="shrink-0"
    >
      {connection !== 'open' ? (
        <div className="p-4">
          <Notice
            tone="waiting"
            title={connection === 'connecting' ? 'Connecting to live calls' : 'Reconnecting to live calls'}
            body="The list fills in as soon as the connection is back."
            icon={RefreshCw}
          />
        </div>
      ) : live.length === 0 ? (
        <div className="flex items-center gap-4 px-5 py-4">
          <Mascot state="idle" size={56} shadow={false} />
          <div>
            <p className="font-display text-lg font-bold leading-tight">No live calls right now</p>
            <p className="text-sm text-ink-soft">When a buyer starts a call it appears here, and the Join button lights up if they ask for a person.</p>
          </div>
        </div>
      ) : (
        <ul className="scroll-quiet flex gap-4 overflow-x-auto px-4 pb-5 pt-4" aria-label="Live calls">
          {live.map((s) => (
            <CallCard key={s.id} s={s} now={now} onJoin={onJoin} reason={reasons[s.id] ?? null} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
