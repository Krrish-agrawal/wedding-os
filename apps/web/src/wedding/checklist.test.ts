import { describe, expect, it } from 'vitest';
import { applyWeddingAction, createSampleWedding } from '@ave/shared';
import { daysUntil, planningChecklist } from './checklist';

const NOW = new Date(2026, 10, 22);
const ids = (s = createSampleWedding('w'), e: never[] = []) => planningChecklist(s, e, NOW).map((i) => i.id);

describe('planning checklist', () => {
  it('computes days to go', () => {
    expect(daysUntil('2026-12-22', NOW)).toBe(30);
    expect(daysUntil(null, NOW)).toBeNull();
  });
  it('flags a fresh plan', () => {
    expect(ids()).toEqual(expect.arrayContaining(['onboard', 'date', 'budget', 'venue', 'decorator']));
  });
  it('reacts to the plan and a near date', () => {
    let s = createSampleWedding('w');
    for (const a of [{ type: 'set_total_budget', total: 100000 }, { type: 'update_profile', patch: { date: '2026-12-10', onboarded: true } }, { type: 'select_venue', venueId: 'venue-grand-ballroom' }]) {
      const r = applyWeddingAction(s, a); if (r.ok) s = r.state;
    }
    const got = ids(s);
    expect(got).toContain('soon');
    expect(got).toContain('alloc');
    expect(got).not.toContain('budget');
    expect(got).not.toContain('venue');
    expect(got).not.toContain('onboard');
  });
});
