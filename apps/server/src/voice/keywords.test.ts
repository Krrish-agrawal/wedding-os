import { describe, expect, it } from 'vitest';
import { MAX_ASR_KEYWORDS, plainKeyword } from './keywords.js';

describe('ASR keywords', () => {
  it('reduces terms to plain ASCII words, because punctuation and other scripts made ARES return empty transcripts', () => {
    expect(plainKeyword('super built-up')).toBe('super built up');
    expect(plainKeyword("St. John's Hospital")).toBe('St Johns Hospital');
    expect(plainKeyword('Café Coffee Day')).toBe('Cafe Coffee Day');
    expect(plainKeyword('Kempegowda Bus Station (Majestic)')).toBe('Kempegowda Bus Station Majestic');
    expect(plainKeyword('Brindle Oak & Co')).toBe('Brindle Oak Co');
    expect(plainKeyword('ಇಂದಿರಾನಗರ')).toBe('');
  });

  it('keeps the list short', () => {
    expect(MAX_ASR_KEYWORDS).toBeLessThanOrEqual(40);
  });
});
