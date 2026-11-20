import { z } from 'zod';

/**
 * The one language a call runs in. The buyer picks it (ringing screen or the call's top bar); speech
 * recognition, the advisor's replies and the voice all follow it, and nothing else is recognised.
 */
export const CALL_LANGUAGES = ['en', 'hi', 'kn'] as const;
export const CallLanguageSchema = z.enum(CALL_LANGUAGES);
export type CallLanguage = z.infer<typeof CallLanguageSchema>;
export const DEFAULT_CALL_LANGUAGE: CallLanguage = 'en';

export interface CallLanguageInfo {
  /** English name, for the Lead Desk and logs. */
  label: string;
  /** Name in its own script, for the picker. */
  native: string;
  /** Agora ARES recognition language (one tag: the call recognises only this language). */
  asr: string;
  /** Murf Falcon locale; numbers are read correctly only in the matching locale. */
  ttsLocale: string;
  /** Short phrases the voice plays while a slow reply is on its way. */
  fillers: readonly string[];
}

export const CALL_LANGUAGE_INFO: Record<CallLanguage, CallLanguageInfo> = {
  en: {
    label: 'English',
    native: 'English',
    asr: 'en-IN',
    ttsLocale: 'en-IN',
    fillers: ['One moment.', 'Let me pull that up.', 'Just a second.', 'Let me check that for you.'],
  },
  hi: {
    label: 'Hindi',
    native: 'हिन्दी',
    asr: 'hi-IN',
    ttsLocale: 'hi-IN',
    fillers: ['एक पल।', 'बस एक सेकंड।', 'अभी देखकर बताते हैं।'],
  },
  kn: {
    label: 'Kannada',
    native: 'ಕನ್ನಡ',
    asr: 'kn-IN',
    ttsLocale: 'kn-IN',
    fillers: ['ಒಂದು ಕ್ಷಣ.', 'ಒಂದು ಸೆಕೆಂಡ್.'],
  },
};
