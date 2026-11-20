import { describe, expect, it } from 'vitest';
import { CALL_LANGUAGES, CALL_LANGUAGE_INFO } from './language.js';

/** Agora rejects the whole agent start when a non-Latin filler phrase is longer than this. */
const AGORA_NON_LATIN_FILLER_MAX = 20;

describe('call languages', () => {
  it('keeps every filler phrase within Agora limits', () => {
    for (const id of CALL_LANGUAGES) {
      for (const phrase of CALL_LANGUAGE_INFO[id].fillers) {
        if (/[^\u0000-ɏ]/.test(phrase)) expect(phrase.length, `${id}: ${phrase}`).toBeLessThanOrEqual(AGORA_NON_LATIN_FILLER_MAX);
        expect(phrase.split(/\s+/).length).toBeLessThanOrEqual(20);
      }
    }
  });

  it('runs each language as exactly one recognition language', () => {
    for (const id of CALL_LANGUAGES) expect(CALL_LANGUAGE_INFO[id].asr).toMatch(/^[a-z]{2}-IN$/);
  });
});
