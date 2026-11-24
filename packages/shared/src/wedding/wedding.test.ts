import { describe, expect, it } from 'vitest';
import { SAMPLE_SPLIT_PERCENT, applyWeddingAction, createSampleWedding, formatInr, summarizeBudget, suggestAllocation, WeddingStateSchema } from './index.js';

const fresh = () => createSampleWedding('w1');
const apply = (s: ReturnType<typeof fresh>, a: unknown) => applyWeddingAction(s, a);

describe('sample wedding', () => {
  it('is valid and labelled as sample', () => {
    const s = fresh();
    expect(WeddingStateSchema.safeParse(s).success).toBe(true);
    expect(s.profile.coupleNames).toContain('sample');
  });
});

describe('applyWeddingAction', () => {
  it('increments rev and does not mutate the input', () => {
    const s = fresh();
    const r = apply(s, { type: 'update_profile', patch: { city: 'Mysuru' } });
    expect(r.ok && r.state.rev).toBe(1);
    expect(r.ok && r.state.profile.city).toBe('Mysuru');
    expect(s.rev).toBe(0);
    expect(s.profile.city).toBe('Bengaluru');
  });
  it('rejects malformed actions with a hint instead of throwing', () => {
    for (const bad of [null, { type: 'nope' }, { type: 'set_total_budget', total: -5 }, { type: 'set_total_budget', total: 1.5 }, { type: 'update_profile', patch: {} }, { type: 'update_profile', patch: { date: '2026-02-30' } }]) {
      const r = apply(fresh(), bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.hint.length).toBeGreaterThan(0);
    }
  });
  it('rejects a guest count above the limit and accepts a real date', () => {
    expect(apply(fresh(), { type: 'update_profile', patch: { guestCount: 99999 } }).ok).toBe(false);
    expect(apply(fresh(), { type: 'update_profile', patch: { date: '2027-02-14' } }).ok).toBe(true);
  });
  it('refuses a venue that cannot hold the guests, accepts one that can', () => {
    const s = fresh(); // 250 guests
    const small = apply(s, { type: 'select_venue', venueId: 'venue-courtyard-hall' });
    expect(small.ok).toBe(false);
    const big = apply(s, { type: 'select_venue', venueId: 'venue-grand-ballroom' });
    expect(big.ok && big.state.venueId).toBe('venue-grand-ballroom');
    expect(apply(s, { type: 'select_venue', venueId: 'made-up' }).ok).toBe(false);
  });
  it('keeps allocations within the total, both ways', () => {
    let s = fresh();
    const over = apply(s, { type: 'set_allocations', allocations: { venue: 100 } });
    expect(over.ok).toBe(false); // total is 0
    s = (apply(s, { type: 'set_total_budget', total: 1000 }) as { state: typeof s }).state;
    s = (apply(s, { type: 'set_allocations', allocations: { venue: 600, catering: 300 } }) as { state: typeof s }).state;
    expect(apply(s, { type: 'set_allocations', allocations: { decoration: 200 } }).ok).toBe(false);
    expect(apply(s, { type: 'set_total_budget', total: 800 }).ok).toBe(false);
    expect(apply(s, { type: 'set_total_budget', total: 900 }).ok).toBe(true);
  });
  it('rejects duplicate and unknown expense ids', () => {
    let s = fresh();
    const exp = { id: 'e1', category: 'venue', label: 'Advance', amount: 50000 };
    s = (apply(s, { type: 'add_expense', expense: exp }) as { state: typeof s }).state;
    expect(apply(s, { type: 'add_expense', expense: exp }).ok).toBe(false);
    expect(apply(s, { type: 'remove_expense', expenseId: 'zzz' }).ok).toBe(false);
    const gone = apply(s, { type: 'remove_expense', expenseId: 'e1' });
    expect(gone.ok && gone.state.budget.expenses).toHaveLength(0);
  });
});

describe('budget arithmetic', () => {
  it('split percentages sum to 100', () => {
    expect(Object.values(SAMPLE_SPLIT_PERCENT).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('suggestAllocation always sums exactly to the total', () => {
    for (const t of [0, 1, 7, 99, 100, 12345, 1_000_001, 2_500_000, 999_999_999]) {
      const a = suggestAllocation(t);
      expect(Object.values(a).reduce((x, y) => x + y, 0)).toBe(t);
      expect(Object.values(a).every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
    }
  });
  it('summarises spend, remaining and overspent categories', () => {
    let s = fresh();
    s = (apply(s, { type: 'set_total_budget', total: 1_000_000 }) as { state: typeof s }).state;
    s = (apply(s, { type: 'set_allocations', allocations: suggestAllocation(1_000_000) }) as { state: typeof s }).state;
    s = (apply(s, { type: 'add_expense', expense: { id: 'a', category: 'decoration', label: 'Stage', amount: 200_000 } }) as { state: typeof s }).state;
    const sum = summarizeBudget(s);
    expect(sum.allocated).toBe(1_000_000);
    expect(sum.unallocated).toBe(0);
    expect(sum.spent).toBe(200_000);
    expect(sum.remaining).toBe(800_000);
    expect(sum.overspent).toEqual(['decoration']); // allocated 150,000 < spent 200,000
    expect(sum.overBudget).toBe(false);
  });
  it('formats rupees in Indian grouping', () => {
    expect(formatInr(0)).toBe('₹0');
    expect(formatInr(999)).toBe('₹999');
    expect(formatInr(1000)).toBe('₹1,000');
    expect(formatInr(1234567)).toBe('₹12,34,567');
    expect(formatInr(-150000)).toBe('-₹1,50,000');
  });
});

describe('profile events and onboarded', () => {
  it('loads an old saved profile without the new fields, with defaults', () => {
    const s = createSampleWedding('old') as unknown as { profile: Record<string, unknown> };
    delete s.profile.events; delete s.profile.onboarded;
    const r = WeddingStateSchema.safeParse(s);
    expect(r.success && r.data.profile).toMatchObject({ events: [], onboarded: false });
  });
  it('a partial update never resets events', () => {
    let s = createSampleWedding('e');
    const a = applyWeddingAction(s, { type: 'update_profile', patch: { events: ['Haldi', 'Sangeet'], onboarded: true } });
    expect(a.ok).toBe(true); if (a.ok) s = a.state;
    const b = applyWeddingAction(s, { type: 'update_profile', patch: { city: 'Mysuru' } });
    expect(b.ok && b.state.profile).toMatchObject({ city: 'Mysuru', events: ['Haldi', 'Sangeet'], onboarded: true });
    expect(applyWeddingAction(s, { type: 'update_profile', patch: { events: Array(13).fill('x') } }).ok).toBe(false);
  });
});
