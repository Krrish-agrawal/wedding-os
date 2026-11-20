import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, Clock, Headset, Mic, MicOff, Undo2 } from 'lucide-react';
import { callLiveSince, formatDuration, type SessionState } from '@ave/shared';
import {
  Avatar,
  Button,
  Chip,
  ErrorState,
  ICON_STROKE,
  LoadingState,
  Notice,
  Pill,
  StatusPill,
  Toaster,
  buttonClasses,
  cn,
  propertyTypeIcon,
  toast,
} from '@/ui';
import { content } from '@/content';
import { useDispatch, useSessionConnection, useSessionStore, useSessionState } from '@/session/useSession';
import { Stage } from '@/call/Stage';
import { ViewDock } from '@/call/ViewDock';
import { useAdvisorAudio, type AdvisorAudio } from '@/call/voice/advisor';
import { deskApi, errorText } from '@/desk/api';
import { callStatus } from '@/desk/display';
import { ContextPanel } from '@/desk/ContextPanel';
import { IncomingCall } from '@/desk/IncomingCall';
import { useAdvisorName, useNow, useResource } from '@/desk/hooks';
import { CopilotBar } from '@/desk/CopilotBar';
import { useCopilot } from '@/desk/useCopilot';

const CLOCK_TICK_MS = 1000;
const LEAD_POLL_MS = 5000;
const PULSE_DURATION_S = 1.4;
const MAX_NAME_LENGTH = 60;
/** The session socket's error when the call is not on the server. */
const SESSION_NOT_FOUND = 'Session not found';

function JoinPulse() {
  const reduce = useReducedMotion();
  if (reduce) return <span aria-hidden className="pointer-events-none absolute -inset-1.5 rounded-[18px] border-2 border-coral" />;
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[var(--radius-control)] border-[3px] border-coral"
      initial={{ opacity: 0.9, scale: 1 }}
      animate={{ opacity: 0, scale: 1.3 }}
      transition={{ duration: PULSE_DURATION_S, repeat: Infinity, ease: 'easeOut' }}
    />
  );
}

interface HandoffControlsProps {
  state: SessionState;
  sessionId: string;
  savedName: string;
  saveName: (name: string) => void;
  audio: AdvisorAudio;
}

/** True when this browser's advisor is the human on the call. */
function isMeOnCall(state: SessionState | null, savedName: string): boolean {
  return Boolean(state && state.handoff.status === 'joined' && savedName.trim() && state.handoff.humanName === savedName.trim());
}

function HandoffControls({ state, sessionId, savedName, saveName, audio }: HandoffControlsProps) {
  const [draft, setDraft] = useState(savedName);
  const [busy, setBusy] = useState<'join' | 'return' | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const autoJoinTried = useRef(false);

  const { handoff } = state;
  const meOnCall = isMeOnCall(state, savedName);
  const someoneElse = handoff.status === 'joined' && !meOnCall;

  const join = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Add your name so the buyer knows who joined.');
      return;
    }
    setNameError(null);
    saveName(trimmed);
    setBusy('join');
    try {
      await deskApi.join(sessionId, trimmed);
      toast(`You're on the call with ${state.buyer.name}`, { tone: 'success', body: 'Views you open here change on their screen too.' });
    } catch (err) {
      toast('Could not join the call', { tone: 'error', body: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const handBack = async () => {
    setBusy('return');
    try {
      await deskApi.handBack(sessionId);
      toast('Handed back to the AI advisor', { tone: 'success', body: 'It picks up with a short summary of where things stand.' });
    } catch (err) {
      toast('Could not hand back', { tone: 'error', body: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  // "Join call" on the Lead Desk lands here with ?join=1: join straight away if we know the name.
  useEffect(() => {
    if (autoJoinTried.current || params.get('join') !== '1') return;
    autoJoinTried.current = true;
    setParams({}, { replace: true });
    if (savedName.trim() && state.status !== 'ended' && handoff.status !== 'joined') void join(savedName);
    // Runs once per visit; `join` is stable enough for that.
  }, [params]);

  if (state.status === 'ended') return <Pill tone="muted">Call ended</Pill>;
  if (someoneElse) {
    return (
      <Pill tone="neutral" icon={Headset}>
        {handoff.humanName ?? 'Another advisor'} is on this call
      </Pill>
    );
  }
  if (meOnCall) {
    return (
      <div className="flex items-center gap-2">
        <StatusPill tone="live" size="sm">
          On the call as {handoff.humanName}
        </StatusPill>
        <Button
          variant="secondary"
          size="md"
          iconOnly
          icon={audio.muted ? MicOff : Mic}
          label={audio.muted ? 'Unmute your microphone' : 'Mute your microphone'}
          disabled={audio.status !== 'connected'}
          onClick={audio.toggleMute}
        />
        <Button variant="confirm" icon={Undo2} busy={busy === 'return'} onClick={() => void handBack()}>
          Hand back to AI
        </Button>
      </div>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void join(draft);
  };
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2" noValidate>
      <label className="sr-only" htmlFor="advisor-name">
        Your name
      </label>
      <input
        id="advisor-name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={MAX_NAME_LENGTH}
        placeholder="Your name"
        autoComplete="name"
        aria-invalid={nameError ? true : undefined}
        title={nameError ?? undefined}
        className={cn(
          'h-11 w-44 rounded-[var(--radius-control)] border-2 bg-canvas px-3 text-[15px] outline-none placeholder:text-ink-mute focus:border-ink focus:shadow-[var(--shadow-pop-blue)]',
          nameError ? 'border-coral-deep' : 'border-ink/25 hover:border-ink/50',
        )}
      />
      <span className="relative inline-flex">
        {handoff.status === 'requested' ? <JoinPulse /> : null}
        <Button type="submit" variant={handoff.status === 'requested' ? 'danger' : 'primary'} icon={Headset} busy={busy === 'join'}>
          Join call
        </Button>
      </span>
    </form>
  );
}

/**
 * Advisor call screen (/desk/call/:sessionId): the same stage and view dock the buyer sees,
 * the buyer's context, and the handoff controls (join, mute, hand back to the AI).
 */
export default function DeskCall() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  useSessionConnection(sessionId, 'advisor');
  const state = useSessionState();
  const dispatch = useDispatch();
  const error = useSessionStore((s) => s.error);
  const connection = useSessionStore((s) => s.connection);
  const now = useNow(CLOCK_TICK_MS);
  const lead = useResource(sessionId ?? null, () => deskApi.lead(sessionId ?? ''), LEAD_POLL_MS);
  const [savedName, saveName] = useAdvisorName();
  // The one place the advisor's audio is connected: live while this advisor is the human on the call.
  const meOnCall = isMeOnCall(state, savedName);
  const audio = useAdvisorAudio(sessionId, meOnCall ? savedName.trim() : null);
  const copilot = useCopilot(sessionId);

  // After a server restart the socket reconnects to a session that no longer exists.
  if (!sessionId || error === SESSION_NOT_FOUND || (!state && error)) {
    return (
      <ErrorState
        layout="page"
        title="This call isn't running"
        body={error === SESSION_NOT_FOUND ? 'It may have ended, or the server restarted. The lead and its recap are still on the Lead Desk.' : (error ?? 'The call link is incomplete.')}
        actions={
          <Link to="/desk" className={buttonClasses('primary')}>
            Back to the Lead Desk
          </Link>
        }
      />
    );
  }
  if (!state) return <LoadingState layout="page" title="Connecting to the call" />;

  const since = callLiveSince(state);
  const status = callStatus({ status: state.status, handoff: state.handoff.status, agentStatus: state.agent.status });

  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="flex h-[68px] shrink-0 items-center gap-4 border-b-2 border-ink bg-canvas px-5">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/desk')}>
          Lead Desk
        </Button>
        <span aria-hidden className="h-6 w-0.5 bg-line" />
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={state.buyer.name} size={38} />
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold leading-tight">{state.buyer.name}</h1>
            <p className="flex items-center gap-2 text-[13px] text-ink-soft">
              <span className="inline-flex items-center gap-1">
                <Clock size={13} strokeWidth={ICON_STROKE} aria-hidden />
                <span className="tabular">{since ? formatDuration(now - since) : state.status === 'ringing' ? 'Ringing' : 'Not started'}</span>
              </span>
              <Pill tone={status.tone} size="sm" dot className="h-6">
                {status.label}
              </Pill>
              {connection !== 'open' ? (
                <Pill tone="waiting" size="sm" busy className="h-6">
                  Reconnecting
                </Pill>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Property on screen">
          {content.properties.map((b) => (
            <Chip
              key={b.property.id}
              size="sm"
              label={b.property.name}
              icon={propertyTypeIcon(b.property)}
              selected={state.propertyId === b.property.id}
              onClick={() => dispatch({ type: 'set_property', propertyId: b.property.id })}
            />
          ))}
        </div>
        <div className="ml-auto">
          <HandoffControls key={sessionId} state={state} sessionId={sessionId} savedName={savedName} saveName={saveName} audio={audio} />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px] gap-5 p-5">
        <div className="flex min-h-0 flex-col gap-3">
          {state.status === 'ended' ? (
            <Notice tone="info" title="This call has ended" body="The lead, transcript and recap are on the Lead Desk." />
          ) : state.handoff.status === 'requested' ? (
            <Notice tone="error" mascot="wave" title={`${state.buyer.name} asked for a person`} body={state.handoff.reason ?? 'Join to talk to them; the AI keeps the conversation going until you do.'} />
          ) : null}
          {meOnCall && (audio.status === 'unavailable' || audio.status === 'failed') ? (
            <Notice tone="warn" icon={MicOff} title="Your voice isn't on the call yet" body={audio.detail} />
          ) : null}
          <div className="min-h-0 flex-1">
            <Stage state={state} dispatch={dispatch} role="advisor" />
          </div>
          <CopilotBar copilot={copilot} state={state} lead={lead.data} />
          <ViewDock state={state} dispatch={dispatch} />
        </div>
        <ContextPanel state={state} lead={lead.data} onAction={copilot.runAction} />
      </main>
      <IncomingCall currentSessionId={sessionId} variant="card" busy={meOnCall} />
      <Toaster />
    </div>
  );
}
