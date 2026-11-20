import { useSessionStore } from '@/session/useSession';
import { useCallControls } from '../controls';
import { voiceApi } from './api';
import { BuyerCall } from './buyerCall';

/**
 * The buyer's call controls (see `../controls.ts`). Loaded on first use, so the Agora SDKs are only
 * downloaded once a call starts. One call per tab.
 */

/** Same wording the call controls use when they ring the Desk themselves. */
const HUMAN_REQUEST_REASON = 'Buyer asked to talk to a human advisor';
const NO_SESSION = 'The call is not connected yet. Please wait a moment.';
/** Typed input still reaches a human advisor who is on the call; that is not a failure. */
const DELIVERED_TO_HUMAN = 'A senior advisor is on the call and will read your message.';

let call: BuyerCall | null = null;

function currentSessionId(): string {
  const id = useSessionStore.getState().state?.id;
  if (!id) throw new Error(NO_SESSION);
  return id;
}

/** The call for the open session, created on first use (the camera preview can start before voice). */
function callForSession(): BuyerCall {
  const sessionId = currentSessionId();
  if (!call || call.sessionId !== sessionId || call.isEnded) call = new BuyerCall(sessionId);
  return call;
}

export async function startCall(): Promise<void> {
  const active = callForSession();
  const { voice } = useCallControls.getState();
  if (voice === 'connecting' || voice === 'connected' || voice === 'reconnecting') return;
  await active.start();
}

export async function endCall(): Promise<void> {
  const active = call;
  call = null;
  if (active) await active.end({ notifyServer: true });
}

export function toggleMute(): void {
  call?.toggleMute();
}

export function toggleCamera(): void {
  void callForSession().toggleCamera();
}

export async function sendText(text: string): Promise<void> {
  const sessionId = currentSessionId();
  call?.noteTyped(text);
  const res = await voiceApi.text(sessionId, text);
  if (!res.delivered && res.reason !== DELIVERED_TO_HUMAN) throw new Error(res.reason);
}

/** Rings the Lead Desk; the server tells the advisor so it can say a senior advisor is on the way. */
export async function requestHuman(): Promise<void> {
  const state = useSessionStore.getState().state;
  if (!state) throw new Error(NO_SESSION);
  if (state.handoff.status === 'requested' || state.handoff.status === 'joined') return;
  useSessionStore.getState().dispatch({ type: 'set_handoff', patch: { status: 'requested', reason: HUMAN_REQUEST_REASON, requestedAt: Date.now() } });
}

// Leaving the page ends the call cleanly: the agent stops (and its history is saved) instead of idling out.
window.addEventListener('pagehide', () => {
  if (call && !call.isEnded) void voiceApi.stop(call.sessionId);
});
