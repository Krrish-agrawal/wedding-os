import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeftRight, Clock } from 'lucide-react';
import type { SessionAction, SessionState } from '@ave/shared';
import { BRAND_NAME, ICON_STROKE, Mascot, Spinner, StatusPill, propertyTypeIcon, useOnline, type PillTone } from '@/ui';
import { content, getBundle, otherPropertyId } from '@/content';
import { useSessionStore } from '@/session/useSession';
import { useCallControls, type VoiceStatus } from './controls';
import { useCallUi } from './callUi';
import { formatElapsed, liveSince } from './callClock';
import { LanguagePicker } from './LanguagePicker';

const CLOCK_TICK_MS = 1000;

function CallClock({ since }: { since: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(t);
  }, []);
  if (since === null) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft" aria-label="Call length">
      <Clock size={15} strokeWidth={ICON_STROKE} aria-hidden />
      <span className="tabular">{formatElapsed(now - since)}</span>
    </span>
  );
}

function statusFor(voice: VoiceStatus, voiceIssue: string | null, connection: string, online: boolean): { label: string; tone: PillTone; busy?: boolean } {
  if (!online) return { label: 'Offline', tone: 'error' };
  if (connection === 'reconnecting' || connection === 'connecting') return { label: 'Reconnecting', tone: 'waiting', busy: true };
  switch (voice) {
    case 'connected':
      return { label: 'Live', tone: 'live' };
    case 'connecting':
      return { label: 'Connecting voice', tone: 'waiting', busy: true };
    case 'reconnecting':
      return { label: 'Reconnecting voice', tone: 'waiting', busy: true };
    case 'failed':
    case 'unavailable':
      return { label: 'Typing only', tone: 'muted' };
    case 'idle':
      return voiceIssue ? { label: 'Typing only', tone: 'muted' } : { label: 'Starting', tone: 'waiting', busy: true };
  }
}

/** Active property with a one-click switch to the other one. */
function PropertySwitcher({ state, dispatch }: { state: SessionState; dispatch: (a: SessionAction) => void }) {
  const bundle = getBundle(state.propertyId);
  const otherId = otherPropertyId(state.propertyId);
  const other = state.propertyId ? getBundle(otherId) : null;

  if (!bundle) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-sm font-semibold text-ink-soft">Open a property:</span>
        {content.properties.map((b) => {
          const Icon = propertyTypeIcon(b.property);
          return (
            <button
              key={b.property.id}
              type="button"
              onClick={() => dispatch({ type: 'set_property', propertyId: b.property.id })}
              className="inline-flex h-9 max-w-[220px] items-center gap-1.5 rounded-[var(--radius-chip)] border-2 border-line bg-canvas px-3 text-sm font-semibold hover:border-ink"
            >
              <Icon size={15} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-blue" />
              <span className="truncate">{b.property.name}</span>
            </button>
          );
        })}
      </div>
    );
  }

  const Icon = propertyTypeIcon(bundle.property);
  return (
    <div className="flex h-11 min-w-0 items-center rounded-[var(--radius-chip)] border-2 border-ink bg-canvas pl-1.5 shadow-[var(--shadow-pop-sm)]">
      <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-blue text-ink">
        <Icon size={14} strokeWidth={ICON_STROKE} />
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={bundle.property.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.16, ease: [0.2, 0.9, 0.25, 1] }}
          className="flex min-w-0 max-w-[230px] flex-col px-2.5 leading-tight"
        >
          <span className="truncate text-sm font-bold">{bundle.property.name}</span>
          <span className="truncate text-xs text-ink-soft">
            {bundle.property.configuration} · {bundle.property.localityName}
          </span>
        </motion.span>
      </AnimatePresence>
      {other && otherId && (
        <button
          type="button"
          onClick={() => dispatch({ type: 'set_property', propertyId: otherId })}
          title={`Switch to ${other.property.name}`}
          className="ml-1 inline-flex h-full shrink-0 items-center gap-1.5 rounded-r-[var(--radius-chip)] border-l-2 border-ink px-3.5 text-sm font-semibold hover:bg-blue-tint"
        >
          <ArrowLeftRight size={15} strokeWidth={ICON_STROKE} aria-hidden />
          <span className="max-w-[140px] truncate">{other.property.name}</span>
        </button>
      )}
    </div>
  );
}

/** Short honest status while a tool runs ("Calculating EMI"). Present only while it is true. */
function ActivityStrip({ state }: { state: SessionState }) {
  const label = state.activity?.label ?? null;
  return (
    <div className="flex min-w-0 items-center" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {label && (
          <motion.span
            key={label}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 6 }}
            transition={{ duration: 0.14 }}
            className="inline-flex h-9 min-w-0 items-center gap-2 rounded-[var(--radius-chip)] bg-sun-tint px-3 text-sm font-semibold"
          >
            <Spinner size={14} className="text-sun-deep" />
            <span className="truncate">{label}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Brand, property switcher, activity strip, call status and length. */
export function CallTopBar({ state, dispatch }: { state: SessionState; dispatch: (a: SessionAction) => void }) {
  const online = useOnline();
  const connection = useSessionStore((s) => s.connection);
  const voice = useCallControls((s) => s.voice);
  const voiceIssue = useCallUi((s) => s.voiceIssue);
  const status = statusFor(voice, voiceIssue, connection, online);

  return (
    <header className="flex h-12 shrink-0 items-center gap-4">
      <span title={BRAND_NAME} className="shrink-0">
        <Mascot size={34} shadow={false} title={BRAND_NAME} />
      </span>
      <PropertySwitcher state={state} dispatch={dispatch} />
      <div className="min-w-0 flex-1">
        <ActivityStrip state={state} />
      </div>
      <LanguagePicker language={state.language} dispatch={dispatch} disabled={state.agent.status === 'starting'} />
      <CallClock since={liveSince(state)} />
      <StatusPill tone={status.tone} busy={status.busy} size="md">
        {status.label}
      </StatusPill>
    </header>
  );
}
