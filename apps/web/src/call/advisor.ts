import { useCallControls } from './controls';

/**
 * Who the buyer is talking to. The server's ADVISOR_NAME is the source of truth; the Voice
 * workstream copies it into `useCallControls` (`advisorName`). Until then the UI uses
 * VITE_ADVISOR_NAME, then this default, which mirrors the server's default.
 */
export const DEFAULT_ADVISOR_NAME = 'Asha';
export const ADVISOR_ROLE = 'AI property advisor';
export const HUMAN_ADVISOR_ROLE = 'Senior advisor';
/** Shown for a human advisor whose name has not arrived yet. */
export const HUMAN_ADVISOR_FALLBACK_NAME = 'Senior advisor';

export function useAdvisorName(): string {
  const fromVoice = useCallControls((s) => s.advisorName);
  const fromEnv = (import.meta.env.VITE_ADVISOR_NAME as string | undefined)?.trim();
  return fromVoice?.trim() || fromEnv || DEFAULT_ADVISOR_NAME;
}

/** "Priya Raman" -> "Priya" */
export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}
