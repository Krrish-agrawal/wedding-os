import { SCREEN_EVENT_MARKER } from '@ave/shared';

/**
 * Everything the voice layer itself says or injects. The advisor's brief, greeting, screen line and
 * failure line come from the Tools workstream (agent/prompt.ts); these are the few lines the call
 * machinery needs.
 * Written for Murf: plain sentences, no markdown or symbols that would be read aloud.
 */

/** Played by the engine while a reply is slow (at most one per turn). Each phrase stays short. */
export const FILLER_PHRASES = [
  'One moment.',
  'Let me pull that up.',
  'Just a second.',
  'Let me check that for you.',
  'Sure, give me a moment.',
] as const;

/** The AI advisor's last line before a human advisor takes over. */
export function handoverLine(humanName: string | null): string {
  const who = humanName ? `${humanName}, one of our senior advisors` : 'one of our senior advisors';
  return `I'll hand you over now to ${who}. They can see everything we have looked at.`;
}

/** Nudge after the agent restarts because the human advisor handed the call back. */
export const HAND_BACK_EVENT = `${SCREEN_EVENT_MARKER} The senior advisor has handed the call back to you. Welcome the buyer back in one short sentence and continue from where things stand.`;

/** Nudge after the agent restarts because the previous one stopped responding. */
export const RESUME_EVENT = `${SCREEN_EVENT_MARKER} The call dropped for a moment and you are back. Say so in a few words and continue from where things stand.`;

/** Nudge after the buyer switched the call language; the new agent already runs in that language. */
export function languageSwitchEvent(language: string): string {
  return `${SCREEN_EVENT_MARKER} The buyer switched the call language to ${language}. Speak only ${language} from now on. Greet them again in one short ${language} sentence and continue from where things stand.`;
}

/**
 * Nudge when nobody from the team joined a requested handoff in time. Goes through the model (not `say`) so
 * the buyer hears it in the call language.
 */
export function handoffTimeoutEvent(language: string): string {
  return `${SCREEN_EVENT_MARKER} No senior advisor could join right now. In one or two short ${language} sentences, tell the buyer the team will call them back shortly on the number they gave, without naming a time, then keep helping with anything else.`;
}

/** Status messages the buyer's screen and the Desk may show. */
export const VOICE_MESSAGES = {
  startFailed: 'The advisor could not join the call. Please try again.',
  briefMissing: 'The advisor brief is not available on this server yet.',
  callEnded: 'This call has ended.',
  humanOnCall: 'A senior advisor is on the call and will read your message.',
  advisorAway: 'The advisor is not connected right now.',
  textFailed: 'Your message could not reach the advisor. Please try again.',
} as const;

/** Header for the recent-conversation note given to an agent that replaces one that failed. */
export const RESUME_CONTEXT_HEADER = 'You are resuming this call after a short technical interruption. The conversation so far, most recent last:';
