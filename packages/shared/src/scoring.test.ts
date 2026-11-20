import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ScoringSchema, type Scoring } from './data.js';
import { reduceSession } from './reducer.js';
import { createSessionState, type ActionSource, type SessionAction, type SessionState } from './session.js';
import { leadStage, propertiesViewed, scoreLead, tierFor, timeOnViews, viewSegments } from './scoring.js';

const T0 = Date.UTC(2026, 10, 20, 5, 0, 0);
const SEC = 1000;

function play(steps: [atSec: number, action: SessionAction, source?: ActionSource][]): SessionState {
  let s = createSessionState('s1', { name: 'Priya Sharma', phone: '9876543210', email: 'priya@example.com' }, T0);
  for (const [at, action, source] of steps) s = reduceSession(s, { action, source: source ?? 'agent', at: T0 + at * SEC });
  return s;
}

const policy: Scoring = ScoringSchema.parse(
  JSON.parse(readFileSync(new URL('../../../data/policy/scoring.json', import.meta.url), 'utf8')),
);

describe('viewSegments', () => {
  it('times each view from consecutive view events, starting when the call goes live', () => {
    const s = play([
      [10, { type: 'set_status', status: 'live' }],
      [40, { type: 'set_property', propertyId: 'apt' }],
      [40, { type: 'set_view', view: 'tour' }],
      [160, { type: 'set_view', view: 'money' }],
      [250, { type: 'set_view', view: 'legal' }],
      [280, { type: 'set_status', status: 'ended' }],
    ]);
    const segs = viewSegments(s, T0 + 9999 * SEC);
    expect(segs.map((x) => [x.view, x.propertyId, (x.end - x.start) / SEC])).toEqual([
      ['shortlist', null, 30],
      ['shortlist', 'apt', 0],
      ['tour', 'apt', 120],
      ['money', 'apt', 90],
      ['legal', 'apt', 30],
    ]);
    expect(timeOnViews(segs)).toEqual({ shortlist: 30 * SEC, tour: 120 * SEC, money: 90 * SEC, legal: 30 * SEC });
  });

  it('splits a view when the property changes and runs the last stretch to now while live', () => {
    const s = play([
      [0, { type: 'set_status', status: 'live' }],
      [5, { type: 'set_property', propertyId: 'apt' }],
      [5, { type: 'set_view', view: 'money' }],
      [65, { type: 'set_property', propertyId: 'office' }],
    ]);
    const segs = viewSegments(s, T0 + 95 * SEC);
    expect(segs.filter((x) => x.view === 'money').map((x) => [x.propertyId, (x.end - x.start) / SEC])).toEqual([
      ['apt', 60],
      ['office', 30],
    ]);
    expect(propertiesViewed(s)).toEqual(['apt', 'office']);
  });

  it('counts nothing before the call is live unless a view was opened', () => {
    const s = play([]);
    expect(viewSegments(s, T0 + 60 * SEC)).toEqual([]);
  });
});

describe('scoreLead', () => {
  it('gives no points to a call that only rang', () => {
    const r = scoreLead(play([]), policy, T0);
    expect(r).toEqual({ score: 0, tier: 'Cold', reasons: [] });
  });

  it('explains every point for an engaged buyer', () => {
    const s = play([
      [0, { type: 'set_status', status: 'live' }],
      [20, { type: 'update_lead', patch: { purpose: 'Home for family', budget: '1.3 crore', timeline: 'Within 3 months' } }],
      [30, { type: 'set_property', propertyId: 'apt' }],
      [30, { type: 'set_view', view: 'tour' }],
      [100, { type: 'set_view', view: 'money' }],
      [200, { type: 'apply_offer', propertyId: 'apt', offerId: 'festive' }],
      [230, { type: 'set_view', view: 'legal' }],
      [260, { type: 'set_handoff', patch: { status: 'requested', reason: 'Wants a bigger discount' } }],
      [300, { type: 'set_property', propertyId: 'office' }],
      [320, { type: 'confirm_booking', propertyId: 'apt', slotId: 's1' }],
    ]);
    const r = scoreLead(s, policy, T0 + 400 * SEC);
    expect(r.reasons.map((x) => x.label)).toEqual([
      'Booked a site visit',
      'Spent over a minute on pricing',
      'Applied an offer',
      'Shared a budget',
      'Shared a timeline',
      'Looked at both properties',
      'Said what they are looking for',
      'Checked the legal papers',
      'Took the 3D tour',
      'Asked for a human advisor',
    ]);
    expect(r.score).toBe(100);
    expect(r.tier).toBe('Hot');
  });

  it('does not count time on pricing below the threshold', () => {
    const s = play([
      [0, { type: 'set_status', status: 'live' }],
      [0, { type: 'set_property', propertyId: 'apt' }],
      [0, { type: 'set_view', view: 'money' }],
      [59, { type: 'set_view', view: 'tour' }],
    ]);
    const labels = scoreLead(s, policy, T0 + 120 * SEC).reasons.map((x) => x.label);
    expect(labels).not.toContain('Spent over a minute on pricing');
    expect(labels).toContain('Took the 3D tour');
  });

  it('ignores blank lead fields and removed offers', () => {
    const s = play([
      [0, { type: 'update_lead', patch: { budget: '  ' } }],
      [1, { type: 'apply_offer', propertyId: 'apt', offerId: 'x' }],
      [2, { type: 'remove_offer', propertyId: 'apt', offerId: 'x' }],
    ]);
    expect(scoreLead(s, policy, T0 + 10 * SEC).reasons).toEqual([]);
  });

  it('never goes below zero with negative rules', () => {
    const negative: Scoring = { rules: [{ id: 'n', label: 'Raised an objection', points: -10, when: { type: 'lead_field', field: 'purpose' } }], tiers: [{ min: 0, label: 'Cold' }] };
    const s = play([[0, { type: 'update_lead', patch: { purpose: 'Office' } }]]);
    expect(scoreLead(s, negative, T0).score).toBe(0);
  });
});

describe('tierFor', () => {
  it('picks the highest tier reached regardless of order in the file', () => {
    const tiers = [{ min: 65, label: 'Hot' }, { min: 0, label: 'Cold' }, { min: 35, label: 'Warm' }];
    expect(tierFor(34, tiers)).toEqual({ label: 'Cold', rank: 0 });
    expect(tierFor(35, tiers)).toEqual({ label: 'Warm', rank: 1 });
    expect(tierFor(90, tiers)).toEqual({ label: 'Hot', rank: 2 });
  });
});

describe('leadStage', () => {
  it('moves from new to visit booked as the call progresses', () => {
    expect(leadStage(play([]))).toBe('new');
    expect(leadStage(play([[0, { type: 'set_property', propertyId: 'apt' }]]))).toBe('exploring');
    expect(leadStage(play([[0, { type: 'set_property', propertyId: 'apt' }], [1, { type: 'set_view', view: 'money' }]]))).toBe('evaluating');
    expect(leadStage(play([[0, { type: 'update_lead', patch: { objections: ['Price is high'] } }]]))).toBe('negotiating');
    expect(leadStage(play([[0, { type: 'confirm_booking', propertyId: 'apt', slotId: 's1' }]]))).toBe('visit_booked');
  });
});
