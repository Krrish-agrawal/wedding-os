import type { SessionAction } from '@ave/shared';
import { useCallControls } from './controls';
import { errorMessage, useCallUi } from './callUi';

/**
 * Starts the call: marks it live for everyone, then asks the Voice layer to connect.
 * If voice cannot start, the call still opens in typed mode with a calm reason.
 */
export async function acceptCall(dispatch: (a: SessionAction) => void): Promise<void> {
  dispatch({ type: 'set_status', status: 'live' });
  await startVoice();
}

let inFlight: Promise<void> | null = null;

/**
 * Connects voice for a call that is live, on accept or after the buyer reloads mid-call.
 * Concurrent calls share one attempt. Never throws: a failure becomes the calm typed-input notice.
 */
export function startVoice(): Promise<void> {
  inFlight ??= connectVoice().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function connectVoice(): Promise<void> {
  const ui = useCallUi.getState();
  ui.setVoiceIssue(null);
  try {
    await useCallControls.getState().startCall();
    const { voice, voiceDetail } = useCallControls.getState();
    if (voice === 'unavailable' || voice === 'failed') {
      ui.setVoiceIssue(voiceDetail ?? 'Voice could not start');
      ui.setTyping(true);
    }
  } catch (err) {
    ui.setVoiceIssue(errorMessage(err, 'Voice could not start'));
    ui.setTyping(true);
  }
}
