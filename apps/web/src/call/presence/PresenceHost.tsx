import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Expression } from '@ave/shared';
import { Footprints } from 'lucide-react';
import { ICON_STROKE, cn } from '@/ui';
import type { AvatarSource } from './human3d/avatars';
import { OfficeBackdrop } from './human3d/OfficeBackdrop';
import { TalkingHeadPresence, type Human3dDiagnostics } from './human3d/TalkingHeadPresence';
import { useTileBleed } from './useTileBleed';
import { MascotPresence } from './mascot/MascotPresence';
import { PresenceDisposedError, PresenceUnavailableError, type AgentPresence, type FallbackReason, type PresenceMode, type PresenceState } from './types';

/** Imperative moments. State and audio are props; moments are events. */
export interface PresenceHandle {
  express(expression: Expression): void;
  interrupt(): void;
}

export type PresenceStatus =
  | { phase: 'loading' }
  | { phase: 'ready'; mode: PresenceMode; diagnostics: Human3dDiagnostics | null }
  | { phase: 'fallback'; reason: FallbackReason; detail: string };

export interface PresenceHostProps {
  /** Requested mode. `human3d` falls back to the mascot on its own when it cannot run. */
  mode: PresenceMode;
  /** The advisor's voice (analysed only; never played here). */
  track: MediaStreamTrack | null;
  state: PresenceState;
  /** Accessible name for the advisor's face. */
  title?: string;
  /** Avatar files to try (the Studio lab uses this to compare files or force a fallback). Default: human3d/avatars.ts. */
  avatarSources?: readonly AvatarSource[];
  onStatus?: (status: PresenceStatus) => void;
  /**
   * Set while the advisor appears somewhere else (walking the 3D tour): the tile releases its own
   * avatar (freeing the graphics card for the tour) and says where the advisor is instead. A fresh
   * avatar is built when the advisor comes back, so the face never carries state from before.
   */
  away?: string | null;
  className?: string;
}

/** The mascot appears only if the 3D avatar is not ready by then, so a fast load never flashes it. */
const MASCOT_REVEAL_DELAY_MS = 400;
/** Matches the layer's `duration-300`: the mascot is released once it has faded out under the avatar. */
const FADE_MS = 300;
const LAYER = 'absolute inset-0 transition-opacity duration-300 ease-out';

type Shown = PresenceMode | 'loading';

/**
 * Mounts the advisor's presence in the space it is given and keeps it in step with the call.
 *
 * In `human3d` mode the mascot carries the tile (lip-synced from the same audio) while the avatar
 * loads behind it; the avatar fades in when ready. If the avatar cannot load (no WebGL, missing
 * file, timeout, lip-sync failure) the mascot simply stays. No error reaches the buyer.
 */
export const PresenceHost = forwardRef<PresenceHandle, PresenceHostProps>(function PresenceHost(
  { mode, track, state, title, avatarSources, onStatus, away = null, className },
  ref,
) {
  const hostEl = useRef<HTMLDivElement>(null);
  const mascotEl = useRef<HTMLDivElement>(null);
  const avatarEl = useRef<HTMLDivElement>(null);
  const active = useRef<AgentPresence | null>(null);
  const latest = useRef({ track, state, onStatus });
  latest.current = { track, state, onStatus };
  const [shown, setShown] = useState<Shown>(mode === 'human3d' ? 'loading' : 'mascot');
  const [mascotRevealed, setMascotRevealed] = useState(false);
  const sourcesKey = JSON.stringify(avatarSources ?? null);
  const isAway = away !== null;
  const bleed = useTileBleed(hostEl);

  useEffect(() => {
    if (shown !== 'loading') return;
    setMascotRevealed(false);
    const timer = setTimeout(() => setMascotRevealed(true), MASCOT_REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  useEffect(() => {
    const mascotNode = mascotEl.current;
    const avatarNode = avatarEl.current;
    if (!mascotNode || !avatarNode || isAway) return;
    let cancelled = false;
    let retireTimer: ReturnType<typeof setTimeout> | undefined;
    let retiring: MascotPresence | null = null;
    const report = (s: PresenceStatus) => {
      if (!cancelled) latest.current.onStatus?.(s);
    };
    const activate = (presence: AgentPresence) => {
      active.current = presence;
      presence.setState(latest.current.state);
      presence.attachAudio(latest.current.track);
    };

    let mascot: MascotPresence | null = new MascotPresence();
    void mascot.mount(mascotNode);
    activate(mascot);

    let avatar: TalkingHeadPresence | null = null;
    if (mode === 'human3d') {
      setShown('loading');
      report({ phase: 'loading' });
      const sources = JSON.parse(sourcesKey) as AvatarSource[] | null;
      const human = new TalkingHeadPresence(sources ? { avatarSources: sources } : {});
      avatar = human;
      human.mount(avatarNode).then(
        () => {
          if (cancelled) return;
          mascot?.attachAudio(null);
          activate(human);
          setShown('human3d');
          report({ phase: 'ready', mode: 'human3d', diagnostics: { ...human.diagnostics } });
          // Let the mascot fade out under the avatar, then release it.
          retiring = mascot;
          mascot = null;
          retireTimer = setTimeout(() => retiring?.dispose(), FADE_MS);
        },
        (err: unknown) => {
          if (cancelled || err instanceof PresenceDisposedError) return;
          human.dispose();
          avatar = null;
          setShown('mascot');
          report({
            phase: 'fallback',
            reason: err instanceof PresenceUnavailableError ? err.reason : 'load',
            detail: err instanceof Error ? err.message : 'The 3D avatar could not start',
          });
        },
      );
    } else {
      setShown('mascot');
      report({ phase: 'fallback', reason: 'mode', detail: 'Mascot mode is configured' });
    }

    return () => {
      cancelled = true;
      clearTimeout(retireTimer);
      active.current = null;
      retiring?.dispose();
      mascot?.dispose();
      avatar?.dispose();
    };
  }, [mode, sourcesKey, isAway]);

  useEffect(() => {
    active.current?.attachAudio(track);
  }, [track]);

  useEffect(() => {
    active.current?.setState(state);
  }, [state]);


  useImperativeHandle(
    ref,
    () => ({
      express: (expression) => active.current?.express(expression),
      interrupt: () => active.current?.interrupt(),
    }),
    [],
  );

  // Plain CSS transitions: they complete even in a background tab, where rAF-driven animation
  // would leave the face invisible until the buyer looks again.
  const mascotVisible = shown === 'mascot' || (shown === 'loading' && mascotRevealed);
  // The 3D view and its room fill the whole tile, under the tile's labels, like a video feed.
  const fill = { top: -bleed.top, right: -bleed.right, bottom: -bleed.bottom, left: -bleed.left };
  return (
    <div ref={hostEl} className={cn('relative h-full w-full', className)} role="img" aria-label={title} data-presence={shown}>
      <div className={cn(LAYER, shown === 'human3d' ? 'opacity-100' : 'opacity-0')} style={fill} aria-hidden>
        {shown === 'human3d' ? <OfficeBackdrop /> : null}
      </div>
      <div ref={mascotEl} className={cn(LAYER, mascotVisible ? 'opacity-100' : 'opacity-0')} aria-hidden />
      <div ref={avatarEl} className={cn(LAYER, shown === 'human3d' && !isAway ? 'opacity-100' : 'opacity-0')} style={fill} aria-hidden />
      {away ? (
        <div className="absolute inset-0 grid place-items-center p-4 text-center">
          <p className="flex max-w-[220px] flex-col items-center gap-2 rounded-[16px] border-2 border-ink bg-canvas/95 px-4 py-3 text-sm font-bold leading-snug shadow-[var(--shadow-pop-sm)]">
            <Footprints size={20} strokeWidth={ICON_STROKE} aria-hidden className="text-blue-deep" />
            {away}
          </p>
        </div>
      ) : null}
    </div>
  );
});
