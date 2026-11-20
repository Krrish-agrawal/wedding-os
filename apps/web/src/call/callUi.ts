import { create } from 'zustand';

/** Local, per-tab UI state for the call screen. Not shared with other participants. */
interface CallUiStore {
  /** Why voice could not start (startCall threw). Cleared when voice connects. */
  voiceIssue: string | null;
  /** Whether the type-instead-of-talk box is open. */
  typing: boolean;
  /** The AI advisor is standing in the 3D tour, so the call tile steps aside. */
  guideInTour: boolean;
  /** Immersive tour: the 3D tour takes the whole window (and the screen, when the browser allows). */
  immersive: boolean;
  setVoiceIssue: (reason: string | null) => void;
  setTyping: (open: boolean) => void;
  setGuideInTour: (inTour: boolean) => void;
  setImmersive: (on: boolean) => void;
}

export const useCallUi = create<CallUiStore>((set) => ({
  voiceIssue: null,
  typing: false,
  guideInTour: false,
  immersive: false,
  setVoiceIssue: (voiceIssue) => set({ voiceIssue }),
  setTyping: (typing) => set({ typing }),
  setGuideInTour: (guideInTour) => set({ guideInTour }),
  setImmersive: (immersive) => set({ immersive }),
}));

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}
