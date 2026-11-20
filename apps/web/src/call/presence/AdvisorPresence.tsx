import { useRef } from 'react';
import { useCallControls } from '../controls';
import { useCallUi } from '../callUi';
import { useAdvisorName } from '../advisor';
import { configuredPresenceMode } from './config';
import { PresenceHost, type PresenceHandle } from './PresenceHost';
import { registerAvatarPreloader } from './preload';
import { useAdvisorPresenceDriver } from './useAdvisorPresenceDriver';

// The call screen imports this module at startup, so the avatar warms up while the call rings.
registerAvatarPreloader();

/**
 * The advisor's face for the call screen's advisor tile. No props: it reads the session and the
 * call controls itself, and fills its parent. Mode comes from `VITE_AVATAR_MODE`.
 */
export function AdvisorPresence() {
  const handle = useRef<PresenceHandle>(null);
  const track = useCallControls((s) => s.agentAudioTrack);
  const state = useAdvisorPresenceDriver(handle);
  const name = useAdvisorName();
  const inTour = useCallUi((s) => s.guideInTour);
  return <PresenceHost ref={handle} mode={configuredPresenceMode()} track={track} state={state} title={`${name}, your advisor`} away={inTour ? `${name} is walking the home with you` : null} />;
}
