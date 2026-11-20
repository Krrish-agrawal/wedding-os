import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildContent } from './content.js';
import { callSummaryPath, mapsPinUrl, priceSheetText } from './outbound.js';
import { deliveryTitle, isQualified, pipelineOutcome, pipelineStage, PIPELINE_OUTCOME_NOTE_KINDS, reachedStage } from './pipeline.js';
import { reduceSession } from './reducer.js';
import { createSessionState, type SessionAction, type SessionState } from './session.js';

const T0 = Date.UTC(2026, 10, 20, 5, 0, 0);

function play(actions: SessionAction[]): SessionState {
  let s = createSessionState('s1', { name: 'Priya Sharma', phone: '9876543210', email: 'priya@example.com' }, T0);
  actions.forEach((action, i) => (s = reduceSession(s, { action, source: 'agent', at: T0 + i * 1000 })));
  return s;
}

const outcome = (o: keyof typeof PIPELINE_OUTCOME_NOTE_KINDS): SessionAction => ({ type: 'note', kind: PIPELINE_OUTCOME_NOTE_KINDS[o], label: o });

describe('pipeline stage', () => {
  it('moves right as the call books a visit and brings in a human, then waits for follow-up', () => {
    expect(pipelineStage(play([]), true)).toBe('new');
    const qualified = play([{ type: 'update_lead', patch: { purpose: 'Home', budget: '2 crore' } }]);
    expect(isQualified(qualified)).toBe(true);
    expect(pipelineStage(qualified, true)).toBe('qualified');
    const booked = play([{ type: 'confirm_booking', propertyId: 'p', slotId: 's' }]);
    expect(pipelineStage(booked, true)).toBe('visit_booked');
    const consult = play([{ type: 'confirm_booking', propertyId: 'p', slotId: 's' }, { type: 'set_handoff', patch: { status: 'joined' } }]);
    expect(pipelineStage(consult, true)).toBe('consult');
    expect(pipelineStage(consult, false)).toBe('follow_up');
    // A call that ended before anything happened stays a new lead.
    expect(pipelineStage(play([]), false)).toBe('new');
  });

  it('takes the latest won, lost or reopen note', () => {
    expect(pipelineOutcome(play([outcome('won')]))).toBe('won');
    expect(pipelineOutcome(play([outcome('won'), outcome('lost')]))).toBe('lost');
    expect(pipelineOutcome(play([outcome('lost'), outcome('open')]))).toBeNull();
    const won = play([outcome('won')]);
    expect(pipelineStage(won, true)).toBe('won');
    expect(reachedStage(won, 'qualified')).toBe(true);
    expect(reachedStage(won, 'visit_booked')).toBe(false);
  });

  it('titles deliveries by label, then purpose, then channel', () => {
    expect(deliveryTitle({ channel: 'slack', label: 'Visit card posted', purpose: 'visit_confirmed' })).toBe('Visit card posted');
    expect(deliveryTitle({ channel: 'email', purpose: 'recap' })).toBe('Call recap');
    expect(deliveryTitle({ channel: 'crm', purpose: 'recap' })).toBe('HubSpot sync');
    expect(deliveryTitle({ channel: 'jira' })).toBe('Jira task');
  });
});

describe('outbound message helpers', () => {
  const dataRoot = new URL('../../../data/', import.meta.url);
  const files: Record<string, unknown> = {};
  const walk = (dir: URL, rel: string) => {
    for (const name of readdirSync(dir)) {
      const url = new URL(name, dir);
      if (statSync(url).isDirectory()) walk(new URL(`${name}/`, dir), `${rel}${name}/`);
      else if (name.endsWith('.json')) files[`${rel}${name}`] = JSON.parse(readFileSync(url, 'utf8'));
    }
  };
  walk(dataRoot, '');
  const content = buildContent(files);

  it('writes a price sheet for every property, with applied offers taken off', () => {
    for (const b of content.properties) {
      const text = priceSheetText(b, content.offers, []);
      expect(text.split('\n')[0]).toContain(b.property.name);
      expect(text).toMatch(/₹[\d,]+/);
      const offer = content.offers.properties[b.property.id]?.offers[0];
      if (offer) expect(priceSheetText(b, content.offers, [offer.id])).toContain(offer.title);
    }
  });

  it('links to a map pin and the buyer summary page', () => {
    expect(mapsPinUrl({ lat: 12.9, lng: 77.6 })).toBe('https://www.google.com/maps/search/?api=1&query=12.9,77.6');
    expect(callSummaryPath('a b')).toBe('/call/a%20b/summary');
  });
});
