import { useCallback, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { MotionConfig } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import type { SessionState } from '@ave/shared';
import { useDispatch, useSessionConnection, useSessionState, useSessionStore } from '@/session/useSession';
import { Stage } from '@/call/Stage';
import { ViewDock } from '@/call/ViewDock';
import { usePresenterKeys } from '@/call/usePresenterKeys';
import { useCallControls } from '@/call/controls';
import { useCallUi } from '@/call/callUi';
import { startVoice } from '@/call/callFlow';
import { CallTopBar } from '@/call/CallTopBar';
import { liveSince } from '@/call/callClock';
import { PresenceTiles } from '@/call/PresenceTiles';
import { RailNotices } from '@/call/RailNotices';
import { Captions } from '@/call/Captions';
import { CallControlsBar } from '@/call/CallControlsBar';
import { Declined, Ringing } from '@/call/Ringing';
import { ErrorState, ICON_STROKE, LoadingState, Toaster, buttonClasses, cn } from '@/ui';

/** If the server is slow to confirm the end, move on to the summary anyway. */
const END_FALLBACK_MS = 1500;
/** The server's WebSocket error when it does not know the session (apps/server/src/sessions/ws.ts). */
const SESSION_NOT_FOUND = 'Session not found';

/**
 * Buyer call screen (BUILD_PLAN.md section 4.1): stage with the view dock under it, and a
 * presence rail on the right with the advisor, captions and controls. Before the call is live
 * it shows the ringing screen; after it ends it moves to the summary.
 */
export default function CallScreen() {
  const { sessionId } = useParams();
  useSessionConnection(sessionId, 'buyer');
  const state = useSessionState();
  // Errors only count on an open socket: a new connection clears any left over from a previous call.
  const error = useSessionStore((s) => (s.connection === 'open' ? s.error : null));
  const dispatch = useDispatch();
  usePresenterKeys(state?.status === 'live' ? state : null, dispatch);

  return (
    <MotionConfig reducedMotion="user">
      <CallBody sessionId={sessionId} state={state} error={error} />
      <Toaster />
    </MotionConfig>
  );
}

function CallBody({ sessionId, state, error }: { sessionId: string | undefined; state: SessionState | null; error: string | null }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const ending = useRef(false);

  const toSummary = useCallback(() => {
    if (sessionId) navigate(`/call/${sessionId}/summary`, { replace: true });
  }, [navigate, sessionId]);

  const wasLive = state ? liveSince(state) !== null : false;
  const ended = state?.status === 'ended';

  // The call can end from this tab, the advisor, or the Lead Desk: follow it to the summary.
  useEffect(() => {
    if (ended && wasLive) toSummary();
  }, [ended, wasLive, toSummary]);

  // Voice connected after an earlier failure: clear the notice.
  const voice = useCallControls((s) => s.voice);
  const immersive = useCallUi((s) => s.immersive);
  useEffect(() => {
    if (voice === 'connected') useCallUi.getState().setVoiceIssue(null);
  }, [voice]);

  // Opened (or reloaded) on a call that is already live: reconnect voice once.
  const resumed = useRef(false);
  const live = state?.status === 'live';
  useEffect(() => {
    if (!live || resumed.current) return;
    resumed.current = true;
    const { voice: current } = useCallControls.getState();
    if (current === 'idle' && !useCallUi.getState().voiceIssue) void startVoice();
  }, [live]);

  const endCall = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    try {
      await useCallControls.getState().endCall();
    } catch {
      // Voice may never have connected; ending the session below is what matters.
    }
    dispatch({ type: 'set_status', status: 'ended' });
    setTimeout(toSummary, END_FALLBACK_MS);
  }, [dispatch, toSummary]);

  // The server no longer knows this call (never existed, or it was reset). Never show a frozen call.
  if (error === SESSION_NOT_FOUND || (!state && error)) {
    const lost = Boolean(state);
    return (
      <ErrorState
        layout="page"
        title={lost ? 'This call was disconnected' : "We couldn't find this call"}
        body={
          lost
            ? 'Our side of the call was reset, so it cannot pick up where it left off. Start a new call and an advisor will ring you straight away.'
            : 'It may have ended, or the link is incomplete. Start a new call and an advisor will ring you straight away.'
        }
        actions={
          <Link to="/" className={buttonClasses('primary', 'lg')}>
            Start a new call <ArrowRight size={18} strokeWidth={ICON_STROKE} aria-hidden />
          </Link>
        }
      />
    );
  }
  if (!state) return <LoadingState layout="page" title="Connecting your call" body="This takes a second." />;

  if (state.status === 'ringing') return <Ringing state={state} dispatch={dispatch} />;
  if (state.status === 'ended') {
    return wasLive ? <LoadingState layout="page" title="Wrapping up your call" body="Your recap is on its way." /> : <Declined dispatch={dispatch} />;
  }

  // Immersive tour: the stage takes the window; the side column stays mounted (hidden) so the
  // advisor tile and captions keep their state, and the call controls sit beside the dock.
  const immersiveTour = immersive && state.view === 'tour';
  return (
    <div className={cn('grid h-full gap-5 p-4 pl-5', immersiveTour ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_clamp(340px,26vw,400px)]')}>
      <main className="flex min-h-0 min-w-0 flex-col gap-3">
        <div className={immersiveTour ? 'hidden' : 'contents'}>
          <CallTopBar state={state} dispatch={dispatch} />
        </div>
        <div className="min-h-0 flex-1 pb-1 pr-1">
          <Stage state={state} dispatch={dispatch} role="buyer" />
        </div>
        <div className="flex items-end gap-4">
          <div className="min-w-0 flex-1">
            <ViewDock state={state} dispatch={dispatch} />
          </div>
          {immersiveTour ? (
            <div className="w-[clamp(340px,26vw,400px)] shrink-0">
              <CallControlsBar state={state} dispatch={dispatch} onEnd={endCall} />
            </div>
          ) : null}
        </div>
      </main>
      <aside className={immersiveTour ? 'hidden' : 'flex min-h-0 flex-col gap-3'} aria-label="Call">
        <PresenceTiles state={state} />
        <RailNotices state={state} />
        <Captions state={state} />
        {immersiveTour ? null : <CallControlsBar state={state} dispatch={dispatch} onEnd={endCall} />}
      </aside>
    </div>
  );
}
