import { useEffect, useRef, type RefObject } from 'react';
import { useSessionState } from '@/session/useSession';
import { useCallControls } from '../controls';
import { derivePresenceState, stepDriver, type DriverMemory } from './cues';
import type { PresenceHandle } from './PresenceHost';
import type { PresenceState } from './types';

/**
 * Feeds the presence from the live call: presence state from session + local agent state, and
 * one-shot moments (greeting, offer applied, visit booked, hand-over, interruption) as they land.
 * With `enabled` false it only reports the state (the Studio lab uses that for manual control).
 */
export function useAdvisorPresenceDriver(handle: RefObject<PresenceHandle | null>, enabled = true): PresenceState {
  const session = useSessionState();
  const localAgentState = useCallControls((s) => s.agentState ?? null);
  const interruptedAt = useCallControls((s) => s.agentInterruptedAt ?? null);
  const state = derivePresenceState(session, localAgentState);
  const memory = useRef<DriverMemory | null>(null);

  useEffect(() => {
    if (!enabled) {
      memory.current = null;
      return;
    }
    const step = stepDriver(memory.current, { session, state, interruptedAt });
    memory.current = step.memory;
    if (step.interrupt) handle.current?.interrupt();
    if (step.expression) handle.current?.express(step.expression);
  }, [enabled, handle, session, state, interruptedAt]);

  return state;
}
