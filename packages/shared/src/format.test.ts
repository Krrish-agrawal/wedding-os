import { describe, expect, it } from 'vitest';
import { parseINRAmount } from './format.js';

describe('parseINRAmount', () => {
  it('reads crore and lakh the way buyers say them', () => {
    expect(parseINRAmount('2 crore')).toBe(20_000_000);
    expect(parseINRAmount('2.5 cr')).toBe(25_000_000);
    expect(parseINRAmount('1.75 crores')).toBe(17_500_000);
    expect(parseINRAmount('30 lakh')).toBe(3_000_000);
    expect(parseINRAmount('30L')).toBe(3_000_000);
    expect(parseINRAmount('45 lakhs')).toBe(4_500_000);
    expect(parseINRAmount('2 करोड़')).toBe(20_000_000);
  });
  it('reads plain and formatted rupee amounts', () => {
    expect(parseINRAmount('₹2,00,00,000')).toBe(20_000_000);
    expect(parseINRAmount('20000000')).toBe(20_000_000);
    expect(parseINRAmount('Rs. 50,000')).toBe(50_000);
  });
  it('returns null for text that is not an amount', () => {
    expect(parseINRAmount('a lot')).toBeNull();
    expect(parseINRAmount('2 apples')).toBeNull();
    expect(parseINRAmount('')).toBeNull();
  });
});
