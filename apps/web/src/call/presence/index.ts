/**
 * Advisor presence (BUILD_PLAN.md section 5): the 3D talking head with audio-driven lip-sync,
 * the mascot behind the same interface, and the automatic fallback between them.
 *
 * Call screen: render <AdvisorPresence /> inside the advisor tile.
 * Studio: render <PresenceLab /> (exported from ./PresenceLab).
 */
export { AdvisorPresence } from './AdvisorPresence';
export { useAdvisorPresenceDriver } from './useAdvisorPresenceDriver';
export { PresenceHost, type PresenceHandle, type PresenceHostProps, type PresenceStatus } from './PresenceHost';
export { unlockPresenceAudio } from './audio';
export { configuredPresenceMode } from './config';
export { TalkingHeadPresence } from './human3d/TalkingHeadPresence';
export { MascotPresence } from './mascot/MascotPresence';
export * from './types';
