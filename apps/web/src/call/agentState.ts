import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '@ave/shared';
import type { MascotState, PillTone } from '@/ui';
import { useCallControls, type VoiceStatus } from './controls';

type AgentState = SessionState['agent']['state'];

/** How long a celebratory or greeting expression holds before returning to the live state. */
const MOMENT_MS = 2600;

/** Timeline kinds that earn a short expression on the advisor's face (BUILD_PLAN.md section 5). */
const MOMENTS: Record<string, MascotState> = {
  offer_applied: 'happy',
  visit_booked: 'happy',
  handoff_joined: 'happy',
};

/** Short label and tone for the advisor tile and the top bar. */
export function agentStatus(
  state: SessionState | null,
  voice: VoiceStatus,
  localState?: AgentState | null,
  voiceIssue?: string | null,
): { label: string; tone: PillTone } {
  if (!state) return { label: 'Connecting', tone: 'waiting' };
  const { agent } = state;
  const conversational = localState ?? agent.state;
  if (agent.status === 'standby' || state.handoff.status === 'joined') return { label: 'Standing by', tone: 'muted' };
  if (agent.status === 'error' || voice === 'reconnecting') return { label: 'Reconnecting', tone: 'waiting' };
  if (voice === 'failed' || voice === 'unavailable' || (voiceIssue && voice !== 'connected')) return { label: 'Typing only', tone: 'muted' };
  if (agent.status === 'starting' || voice === 'connecting') return { label: 'Joining', tone: 'waiting' };
  switch (conversational) {
    case 'listening':
      return { label: 'Listening', tone: 'live' };
    case 'thinking':
      return { label: 'Thinking', tone: 'waiting' };
    case 'speaking':
      return { label: 'Speaking', tone: 'blue' };
    default:
      return agent.status === 'live' ? { label: 'Listening', tone: 'live' } : { label: 'Ready', tone: 'muted' };
  }
}

/** The mascot expression for the advisor, derived only from session state (no extra model calls). */
export function useAdvisorMascotState(state: SessionState | null): MascotState {
  const moment = useMoment(state);
  const localState = useCallControls((s) => s.agentState);
  if (!state) return 'idle';
  if (moment) return moment;
  if (state.agent.status === 'error') return 'apologetic';
  if (state.agent.status === 'standby' || state.handoff.status === 'joined') return 'idle';
  switch (localState ?? state.agent.state) {
    case 'listening':
      return 'listening';
    case 'thinking':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    default:
      return 'idle';
  }
}

/** Timeline label the shared reducer writes when the call goes live. */
const LIVE_LABEL = 'Call live';

/** Watches the timeline and returns a short-lived expression for moments worth reacting to. */
function useMoment(state: SessionState | null): MascotState | null {
  const [moment, setMoment] = useState<MascotState | null>(null);
  const seen = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const timeline = state?.timeline;

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!timeline) return;
    // On first sight, only react to events from the last few seconds (e.g. the call just went live).
    const since = seen.current ?? Date.now() - MOMENT_MS;
    seen.current = Math.max(since, timeline.at(-1)?.at ?? since);
    let next: MascotState | null = null;
    for (const e of timeline) {
      if (e.at <= since) continue;
      if (e.kind === 'status' && e.label === LIVE_LABEL) next = 'wave';
      else next = MOMENTS[e.kind] ?? next;
    }
    if (!next) return;
    setMoment(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMoment(null), MOMENT_MS);
  }, [timeline]);

  return moment;
}
