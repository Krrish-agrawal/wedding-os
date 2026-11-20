import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bot, Headset, VideoOff } from 'lucide-react';
import type { SessionState } from '@ave/shared';
import { Avatar, ICON_STROKE, Pill, cn } from '@/ui';
import { useCallControls } from './controls';
import { useCallUi } from './callUi';
import { PresenceSlot } from './PresenceSlot';
import { agentStatus } from './agentState';
import { HUMAN_ADVISOR_FALLBACK_NAME, HUMAN_ADVISOR_ROLE, useAdvisorName } from './advisor';

const TILE = 'relative overflow-hidden rounded-[var(--radius-tile)] border-2 border-ink';
const TILE_SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const;

/** Plays a single MediaStreamTrack in a <video>. Muted: audio is played by the call layer. */
function TrackVideo({ track, mirror = false, className }: { track: MediaStreamTrack; mirror?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = new MediaStream([track]);
    void el.play().catch(() => undefined);
    return () => {
      el.srcObject = null;
    };
  }, [track]);
  return (
    <video
      ref={ref}
      autoPlay
      muted
      playsInline
      className={cn('absolute inset-0 h-full w-full object-cover', mirror && '-scale-x-100', className)}
    />
  );
}

/** Name plate along the bottom edge of a tile. */
function NamePlate({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <div className="absolute inset-x-3 bottom-3 flex items-center gap-2">
      <span className="truncate rounded-[10px] border-2 border-ink bg-canvas px-2.5 py-1 text-sm font-bold">{name}</span>
      {children}
    </div>
  );
}

function AdvisorTile({ state, compact }: { state: SessionState; compact: boolean }) {
  const name = useAdvisorName();
  const voice = useCallControls((s) => s.voice);
  const localState = useCallControls((s) => s.agentState);
  const voiceIssue = useCallUi((s) => s.voiceIssue);
  const status = agentStatus(state, voice, localState, voiceIssue);
  const standingBy = status.label === 'Standing by';
  return (
    <motion.div layout transition={TILE_SPRING} style={{ gridArea: 'ai' }} className={cn(TILE, standingBy ? 'bg-paper' : 'bg-blue-tint')}>
      {!compact && <RoleTag icon={Bot}>AI advisor</RoleTag>}
      <div className={cn('absolute inset-0 transition-opacity', compact ? 'pb-9 pt-2' : 'pb-12 pt-6', standingBy && 'opacity-60')}>
        <PresenceSlot />
      </div>
      {compact ? (
        <NamePlate name={name}>
          <span className="sr-only">{status.label}</span>
        </NamePlate>
      ) : (
        <NamePlate name={name}>
          <Pill tone={status.tone} dot size="sm">
            {status.label}
          </Pill>
        </NamePlate>
      )}
    </motion.div>
  );
}

function RoleTag({ icon: Icon, children }: { icon: typeof Bot; children: ReactNode }) {
  return (
    <span className="absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-[8px] bg-canvas/90 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-soft">
      <Icon size={12} strokeWidth={ICON_STROKE} aria-hidden />
      {children}
    </span>
  );
}

function HumanTile({ name }: { name: string }) {
  const video = useCallControls((s) => s.humanVideoTrack);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={TILE_SPRING}
      style={{ gridArea: 'human' }}
      className={cn(TILE, 'bg-grape-tint')}
      aria-label={`${name}, ${HUMAN_ADVISOR_ROLE}`}
    >
      {video ? (
        <TrackVideo track={video} />
      ) : (
        <div className="absolute inset-0 grid place-items-center pb-10">
          <Avatar name={name} size={88} accent="grape" />
        </div>
      )}
      <RoleTag icon={Headset}>{HUMAN_ADVISOR_ROLE}</RoleTag>
      <NamePlate name={name} />
    </motion.div>
  );
}

/**
 * The buyer's own camera. A picture-in-picture corner over the advisor while it is just the two
 * of you; a tile of its own once a human advisor joins. Initials when the camera is off or blocked.
 */
function SelfView({ buyerName, asTile }: { buyerName: string; asTile: boolean }) {
  const track = useCallControls((s) => s.cameraTrack);
  const camera = useCallControls((s) => s.camera);
  const showVideo = Boolean(track) && camera === 'on';
  return (
    <motion.div
      layout
      transition={TILE_SPRING}
      style={asTile ? { gridArea: 'self' } : undefined}
      className={cn(
        'overflow-hidden border-2 border-ink bg-sun-tint',
        asTile ? 'relative rounded-[var(--radius-tile)]' : 'absolute bottom-3 right-3 z-20 h-[78px] w-[104px] rounded-[14px] shadow-[var(--shadow-pop-sm)]',
      )}
      aria-label={showVideo ? 'Your camera' : camera === 'denied' ? 'Your camera is blocked' : 'Your camera is off'}
      role="img"
    >
      {showVideo && track ? (
        <TrackVideo track={track} mirror />
      ) : (
        <div className={cn('grid h-full place-items-center', asTile && 'pb-8')}>
          <Avatar name={buyerName} size={asTile ? 48 : 36} accent="sun" />
        </div>
      )}
      <span
        className={cn(
          'absolute inline-flex items-center gap-1 bg-canvas/90 font-bold',
          asTile ? 'bottom-3 left-3 rounded-[10px] border-2 border-ink px-2.5 py-1 text-sm' : 'bottom-1.5 left-1.5 rounded-[7px] px-1.5 text-[11px]',
        )}
      >
        {!showVideo && <VideoOff size={asTile ? 13 : 11} strokeWidth={ICON_STROKE} aria-hidden />}
        {camera === 'denied' ? 'Blocked' : 'You'}
      </span>
    </motion.div>
  );
}

/**
 * Advisor tile with the buyer's self-view in its corner. When a human advisor joins they take the
 * large tile and the AI advisor (standing by) and the self-view stack beside them.
 * The block keeps one height so the captions below never jump.
 */
export function PresenceTiles({ state }: { state: SessionState }) {
  const human = state.handoff.status === 'joined';
  const humanName = state.handoff.humanName?.trim() || HUMAN_ADVISOR_FALLBACK_NAME;
  return (
    <div
      className="relative grid h-[min(34vh,300px)] shrink-0 gap-2.5"
      style={
        human
          ? { gridTemplateColumns: '1fr 1.15fr', gridTemplateRows: '1fr 1fr', gridTemplateAreas: '"ai human" "self human"' }
          : { gridTemplateColumns: '1fr', gridTemplateRows: '1fr', gridTemplateAreas: '"ai"' }
      }
    >
      <AdvisorTile state={state} compact={human} />
      <AnimatePresence>{human && <HumanTile key="human" name={humanName} />}</AnimatePresence>
      <SelfView buyerName={state.buyer.name} asTile={human} />
    </div>
  );
}
