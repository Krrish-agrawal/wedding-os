import { beforeEach, describe, expect, it } from 'vitest';
import {
  TOOL_INPUTS,
  TOOL_NAMES,
  checkOfferApplication,
  computeEmi,
  computeSaleTotals,
  type CustomRoute,
  type Delivery,
  type SessionAction,
  type ToolName,
  type ToolResult,
} from '@ave/shared';
import type { AppContext } from '../context.js';
import { parseClock } from './format.js';
import { TOOL_IMPLS } from './impl/index.js';
import { matchPreset } from './impl/commute.js';
import { ACTIVITY_DELAY_MS, runTool } from './runner.js';
import { TEST_NOW, caller, dataOf, leaseBundle, newSession, offlineDeps, saleBundle, toolTestContext } from './testkit.js';

/** In-memory tools must answer well inside the 100 ms budget. */
const TOOL_BUDGET_MS = 100;
/** Results go back into the model's context; keep them small. */
const MAX_RESULT_CHARS = 4000;

let ctx: AppContext;
let sid: string;
let call: ReturnType<typeof caller>;
const state = () => ctx.store.get(sid)!;

beforeEach(async () => {
  ctx = await toolTestContext();
  sid = newSession(ctx);
  call = caller(ctx, sid);
});

function expectFail(r: ToolResult): Extract<ToolResult, { ok: false }> {
  if (r.ok) throw new Error(`Expected a refusal, got ok: ${JSON.stringify(r.data)}`);
  expect(r.error.length).toBeGreaterThan(0);
  return r;
}

/** A valid input for every tool, built from whatever content exists. */
function exampleInputs(): Record<ToolName, unknown> {
  const sale = saleBundle(ctx);
  return {
    showShortlist: {},
    openProperty: { propertyId: sale.property.id },
    tourGoTo: { stop: sale.tour.stops[0]!.label },
    tourWalkthrough: { action: 'start' },
    showBlueprint: { layer: 'electrical' },
    showLocality: {},
    showCommute: { destination: sale.commute.routes[0]!.id },
    showCompass: { overlay: 'sun', time: '07:30' },
    showMoney: { tab: 'breakup' },
    applyOffer: { offerId: 'not-an-offer', confirmed: false },
    requestDiscount: { percent: 1 },
    showLegal: {},
    getVisitSlots: {},
    bookSiteVisit: { slotId: 'not-a-slot', confirmed: false },
    updateLead: { purpose: 'Relocating for work' },
    sendReport: { channels: ['email'], confirmed: false },
    requestHuman: { reason: 'Buyer asked for a person' },
  };
}

describe('tool contract', () => {
  it('implements every tool in the shared contract and nothing else', () => {
    expect(Object.keys(TOOL_IMPLS).sort()).toEqual([...TOOL_NAMES].sort());
    for (const name of TOOL_NAMES) expect(name).toMatch(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/);
  });

  it('returns a small result with a screen snapshot, fast, for every tool', async () => {
    const examples = exampleInputs();
    for (const name of TOOL_NAMES) {
      expect(TOOL_INPUTS[name].safeParse(examples[name]).success, name).toBe(true);
      const t0 = performance.now();
      const r = await call(name, examples[name]);
      const ms = performance.now() - t0;
      expect(typeof r.ok, name).toBe('boolean');
      expect(r.screen.view, name).toBeTruthy();
      expect(JSON.stringify(r).length, name).toBeLessThan(MAX_RESULT_CHARS);
      expect(ms, name).toBeLessThan(TOOL_BUDGET_MS);
    }
  });

  it('never throws, whatever the input', async () => {
    const junk: unknown[] = [undefined, null, {}, [], 'text', 42, { stop: 7 }, { layer: 'roof' }, { channels: [] }, { percent: -5 }];
    for (const name of TOOL_NAMES) {
      for (const input of junk) {
        const r = await call(name, input);
        expect(typeof r.ok).toBe('boolean');
        if (!r.ok) expect(r.error).toBeTruthy();
      }
    }
  });

  it('answers an unknown tool, a bad argument and a missing session with a speakable refusal', async () => {
    const unknown = expectFail(await call('flyToMoon', {}));
    expect(unknown.hint).toContain('showShortlist');
    const bad = expectFail(await call('tourGoTo', { stop: 12 }));
    expect(bad.hint).toMatch(/arguments/i);
    const gone = expectFail(await runTool(ctx, 'no-such-session', 'showShortlist', {}, { deps: offlineDeps }));
    expect(gone.screen.view).toBe('shortlist');
  });

  it('shows the activity strip only while a slow tool runs', async () => {
    const labels: (string | null)[] = [];
    ctx.store.on('change', (s, action: SessionAction) => {
      if (action.type === 'set_activity') labels.push(s.activity?.label ?? null);
    });
    const slowReport = async (): Promise<Delivery[]> => {
      await new Promise((r) => setTimeout(r, ACTIVITY_DELAY_MS * 2));
      return [{ id: 'd1', channel: 'email', to: 'b***@example.com', status: 'sent', detail: null, at: TEST_NOW }];
    };
    await caller(ctx, sid, { sendReport: slowReport })('sendReport', { channels: ['email'], confirmed: true });
    expect(labels).toEqual(['Sending your recap', null]);
    labels.length = 0;
    await call('showShortlist');
    expect(labels).toEqual([]);
  });
});

describe('shortlist and property', () => {
  it('shows every property with a headline price', async () => {
    const d = dataOf<{ properties: { id: string; total?: { rupees: number; text: string }; monthlyTotal?: unknown }[] }>(await call('showShortlist'));
    expect(d.properties.map((p) => p.id).sort()).toEqual(ctx.content.properties.map((b) => b.property.id).sort());
    for (const p of d.properties) expect(p.total ?? p.monthlyTotal).toBeTruthy();
    expect(state().view).toBe('shortlist');
  });

  it('opens a property by id or by plain words, landing on the tour overview', async () => {
    const sale = saleBundle(ctx);
    const lease = leaseBundle(ctx);
    dataOf(await call('openProperty', { propertyId: sale.property.id }));
    expect(state().propertyId).toBe(sale.property.id);
    expect(state().view).toBe('tour');
    expect(state().params.tour.stopId).toBeNull();
    dataOf(await call('openProperty', { propertyId: 'the office' }));
    expect(state().propertyId).toBe(lease.property.id);
  });

  it('refuses an unknown property and lists the real ones', async () => {
    const r = expectFail(await call('openProperty', { propertyId: 'villa-on-the-moon' }));
    for (const b of ctx.content.properties) expect(r.hint).toContain(b.property.id);
    expect(state().propertyId).toBeNull();
  });
});

describe('tour', () => {
  it('opens the property whose room was named when none is open, and moves the camera', async () => {
    const sale = saleBundle(ctx);
    const others = ctx.content.properties.filter((b) => b !== sale);
    const unique = sale.tour.stops.find((s) => !others.some((o) => o.tour.stops.some((x) => x.label === s.label) || o.rooms.some((r) => r.name === s.label)));
    // When every room name also exists in the other property the tool must ask which one; open it first then.
    if (!unique) {
      expect(expectFail(await call('tourGoTo', { stop: sale.tour.stops[0]!.label })).hint).toMatch(/openProperty/);
      await call('openProperty', { propertyId: sale.property.id });
    }
    const stop = unique ?? sale.tour.stops[sale.tour.stops.length - 1]!;
    const d = dataOf<{ stop: string; facts: string[] }>(await call('tourGoTo', { stop: `take me to the ${stop.label}` }));
    expect(d.stop).toBe(stop.label);
    expect(d.facts).toEqual(stop.facts);
    expect(state().view).toBe('tour');
    expect(state().params.tour.stopId).toBe(stop.id);
    expect(state().propertyId).not.toBeNull();
  });

  it('finds a stop by room name and goes to the overview', async () => {
    const sale = saleBundle(ctx);
    await call('openProperty', { propertyId: sale.property.id });
    const stop = sale.tour.stops[0]!;
    const room = sale.rooms.find((r) => r.id === stop.roomId)!;
    dataOf(await call('tourGoTo', { stop: room.name }));
    expect(state().params.tour.stopId).toBe(stop.id);
    const o = dataOf<{ stop: string }>(await call('tourGoTo', { stop: 'show me the whole place' }));
    expect(o.stop).toBe('Overview');
    expect(state().params.tour.stopId).toBeNull();
  });

  it('refuses an unknown room without moving, and offers real ones', async () => {
    const sale = saleBundle(ctx);
    await call('openProperty', { propertyId: sale.property.id });
    await call('tourGoTo', { stop: sale.tour.stops[0]!.id });
    const before = state().params.tour.stopId;
    const r = expectFail(await call('tourGoTo', { stop: 'swimming pool' }));
    expect(r.hint).toContain(sale.tour.stops[0]!.label);
    expect(state().params.tour.stopId).toBe(before);
  });

  it('starts and stops the walkthrough', async () => {
    await call('openProperty', { propertyId: saleBundle(ctx).property.id });
    dataOf(await call('tourWalkthrough', { action: 'start' }));
    expect(state().params.tour.mode).toBe('walkthrough');
    dataOf(await call('tourWalkthrough', { action: 'stop' }));
    expect(state().params.tour.mode).toBe('step');
  });
});

describe('blueprint', () => {
  it('switches layers and counts what the plan holds', async () => {
    const sale = saleBundle(ctx);
    await call('openProperty', { propertyId: sale.property.id });
    for (const layer of ['layout', 'electrical', 'plumbing'] as const) {
      const d = dataOf<{ layer: string; note: string }>(await call('showBlueprint', { layer }));
      expect(d.note).toBe('Indicative layout');
      expect(state().view).toBe('blueprint');
      expect(state().params.blueprint.layer).toBe(layer);
    }
    const room = sale.rooms[0]!;
    const focused = dataOf<{ room: string; summary: string }>(await call('showBlueprint', { layer: 'electrical', room: room.name }));
    expect(focused.room).toBe(room.name);
    expect(focused.summary).toContain(room.name);
    expect(state().params.blueprint.roomId).toBe(room.id);
  });

  it('shows the whole layer and says so when the room is unknown', async () => {
    await call('openProperty', { propertyId: saleBundle(ctx).property.id });
    const r = expectFail(await call('showBlueprint', { layer: 'plumbing', room: 'helipad' }));
    expect(r.screen.view).toBe('blueprint');
    expect(state().params.blueprint).toEqual({ layer: 'plumbing', roomId: null });
  });
});

describe('locality', () => {
  it('gives the area profile, or the nearest places in a category, nearest first', async () => {
    const sale = saleBundle(ctx);
    await call('openProperty', { propertyId: sale.property.id });
    const profile = dataOf<{ summary: string }>(await call('showLocality'));
    expect(profile.summary).toBe(sale.locality.profile.summary);
    for (const category of ['schools', 'hospitals', 'transit', 'groceries', 'parks', 'dining'] as const) {
      const r = await call('showLocality', { category });
      expect(state().params.locality.category).toBe(category);
      const listed = sale.locality.places.filter((p) => p.category === category);
      if (listed.length === 0) {
        expect(expectFail(r).hint).toMatch(/senior advisor/);
        continue;
      }
      const d = dataOf<{ nearest: { name: string; distance: string }[]; totalListed: number }>(r);
      expect(d.totalListed).toBe(listed.length);
      expect(d.nearest.length).toBeGreaterThan(0);
      expect(d.nearest.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('commute', () => {
  it('matches presets by id, label and category', async () => {
    const sale = saleBundle(ctx);
    await call('openProperty', { propertyId: sale.property.id });
    const route = sale.commute.routes[0]!;
    for (const destination of [route.id, route.label]) {
      const d = dataOf<{ destination: string }>(await call('showCommute', { destination }));
      expect(d.destination).toBe(route.label);
      expect(state().params.commute).toEqual({ destinationId: route.id, custom: null });
    }
    const airport = sale.commute.routes.find((r) => r.category === 'airport');
    if (airport) expect(matchPreset(sale, [leaseBundle(ctx)], 'Kempegowda airport')?.route?.id).toBe(airport.id);
  });

  it('treats "my office" from the home as the route to the other property', () => {
    const sale = saleBundle(ctx);
    const m = matchPreset(sale, [leaseBundle(ctx)], 'my office');
    expect(m).not.toBeNull();
    if (m?.route) expect(m.toOtherProperty).toBe(true);
    else expect(m).toEqual({ wantsOtherProperty: true, route: null });
  });

  it('routes a place that is not a preset live, and stores the route for the map', async () => {
    const sale = saleBundle(ctx);
    await call('openProperty', { propertyId: sale.property.id });
    const seen: { origin: unknown; query: string }[] = [];
    const custom: CustomRoute = { name: 'Whitefield', destination: { lat: 12.97, lng: 77.75 }, distanceKm: 14.2, durationMin: 41, geometry: [[77.64, 12.97], [77.75, 12.97]] };
    const live = caller(ctx, sid, {
      findRoute: async (origin, query) => {
        seen.push({ origin, query });
        return custom;
      },
    });
    const d = dataOf<{ destination: string; distance: string; time: string }>(await live('showCommute', { destination: 'Whitefield' }));
    expect(seen).toEqual([{ origin: sale.commute.origin, query: 'Whitefield' }]);
    expect(d).toMatchObject({ destination: 'Whitefield', distance: '14.2 km', time: '41 minutes' });
    expect(state().params.commute).toEqual({ destinationId: null, custom });
  });

  it('falls back to the presets when a live route fails', async () => {
    await call('openProperty', { propertyId: saleBundle(ctx).property.id });
    for (const findRoute of [async () => null, async () => Promise.reject(new Error('down')), null]) {
      const r = expectFail(await caller(ctx, sid, { findRoute })('showCommute', { destination: 'Nandi Hills' }));
      expect(r.error).toContain("couldn't work out a route");
      expect(state().view).toBe('commute');
      expect(state().params.commute.custom).toBeNull();
    }
  });
});

describe('compass', () => {
  it('reads spoken and written times', () => {
    expect(parseClock('7:30')).toBe(7 * 60 + 30);
    expect(parseClock('07:30')).toBe(7 * 60 + 30);
    expect(parseClock('5 pm')).toBe(17 * 60);
    expect(parseClock('5:30PM')).toBe(17 * 60 + 30);
    expect(parseClock('17:00')).toBe(17 * 60);
    expect(parseClock('7 in the morning')).toBe(7 * 60);
    expect(parseClock('6 in the evening')).toBe(18 * 60);
    expect(parseClock('12 am')).toBe(0);
    expect(parseClock('morning')).toBe(8 * 60);
    expect(parseClock('late morning')).toBe(10 * 60 + 30);
    expect(parseClock('evening')).toBe(17 * 60 + 30);
    expect(parseClock('sunrise', { sunrise: 371 })).toBe(371);
    expect(parseClock('teatime')).toBeNull();
    expect(parseClock('25:00')).toBeNull();
  });

  it('sets the time, says which rooms get sun, and gives a room its sun window', async () => {
    const sale = saleBundle(ctx);
    await call('openProperty', { propertyId: sale.property.id });
    const room = sale.rooms[0]!;
    const d = dataOf<{ time: string; roomsInDirectSun: string[]; room: { name: string; directSun: unknown; sunPeriods: string[] } }>(
      await call('showCompass', { overlay: 'sun', time: '7:30 am', room: room.name }),
    );
    expect(d.time).toBe('7:30 AM');
    expect(Array.isArray(d.roomsInDirectSun)).toBe(true);
    expect(d.room.name).toBe(room.name);
    expect(state().params.compass).toEqual({ minutes: 450, overlay: 'sun', roomId: room.id });
  });

  it('words Vastu as traditional guidance for the home, and shows seating instead for the office', async () => {
    await call('openProperty', { propertyId: saleBundle(ctx).property.id });
    const v = dataOf<{ overlay: string; note: string }>(await call('showCompass', { overlay: 'vastu' }));
    expect(v.overlay).toBe('Vastu');
    expect(v.note).toMatch(/traditional/i);
    await call('openProperty', { propertyId: leaseBundle(ctx).property.id });
    const s = dataOf<{ overlay: string; swapped: string; totalSeats: number | null }>(await call('showCompass', { overlay: 'vastu' }));
    expect(s.overlay).toBe('Seating');
    expect(s.swapped).toBeTruthy();
    expect(state().params.compass.overlay).toBe('seating');
  });

  it('asks which property when nothing says, and asks again for a time it cannot read', async () => {
    if (ctx.content.properties.length > 1) expect(expectFail(await call('showCompass', { time: '9 am' })).hint).toMatch(/openProperty/);
    await call('openProperty', { propertyId: saleBundle(ctx).property.id });
    const r = expectFail(await call('showCompass', { time: 'whenever' }));
    expect(r.hint).toMatch(/7:30/);
  });
});

describe('money', () => {
  it('prices the sale from the money engine, with the applied offers', async () => {
    const sale = saleBundle(ctx);
    if (sale.money.kind !== 'sale') throw new Error('unreachable');
    const expected = computeSaleTotals(sale.money, sale.property.areas, ctx.content.offers.properties[sale.property.id]!.offers, []);
    const d = dataOf<{ total: { rupees: number; text: string }; items: unknown[] }>(await call('showMoney', { tab: 'breakup' }));
    expect(d.total.rupees).toBe(expected.total);
    expect(d.total.text).toMatch(/^₹/);
    expect(d.items).toHaveLength(expected.items.length);
    expect(state().propertyId).toBe(sale.property.id);
    expect(state().params.money.tab).toBe('breakup');
  });

  it('computes EMI from what the buyer said and keeps the inputs on screen', async () => {
    const sale = saleBundle(ctx);
    if (sale.money.kind !== 'sale') throw new Error('unreachable');
    const d = dataOf<{ total: { rupees: number }; emi: { monthly: { rupees: number }; tenureYears: number; downPayment: { text: string } } }>(
      await call('showMoney', { downPayment: 3_000_000, tenureYears: 20 }),
    );
    const emi = state().params.money.emi!;
    expect(emi).toMatchObject({ downPayment: 3_000_000, tenureYears: 20, ratePct: sale.money.emiDefaults.ratePct });
    expect(state().params.money.tab).toBe('emi');
    expect(d.emi.monthly.rupees).toBe(computeEmi(d.total.rupees, emi).monthlyEmi);
    expect(d.emi.downPayment.text).toBe('₹30 lakh');
    const r = expectFail(await call('showMoney', { downPayment: d.total.rupees * 2 }));
    expect(r.hint).toMatch(/down payment/);
  });

  it('gives lease terms for the office and refuses EMI there', async () => {
    const lease = leaseBundle(ctx);
    await call('openProperty', { propertyId: lease.property.id });
    const d = dataOf<{ rentMonthly: { rupees: number }; perSeatMonthly: unknown; deposit: unknown }>(await call('showMoney'));
    if (lease.money.kind === 'lease') expect(d.rentMonthly.rupees).toBe(lease.money.rentMonthly);
    expect(state().params.money.tab).toBe('lease');
    expectFail(await call('showMoney', { tenureYears: 20 }));
  });

  it('applies an offer only after a clear yes', async () => {
    const sale = saleBundle(ctx);
    await call('openProperty', { propertyId: sale.property.id });
    const policy = ctx.content.offers.properties[sale.property.id]!;
    if (sale.money.kind !== 'sale') throw new Error('unreachable');
    const totals = computeSaleTotals(sale.money, sale.property.areas, policy.offers, []);
    const offer = policy.offers.find((o) => checkOfferApplication(policy, totals, o.id).allowed);
    if (!offer) {
      expect(expectFail(await call('applyOffer', { offerId: 'anything', confirmed: true })).error).toBeTruthy();
      return;
    }
    const ask = expectFail(await call('applyOffer', { offerId: offer.id, confirmed: false }));
    expect(ask.hint).toMatch(/clear yes/);
    expect(state().appliedOffers[sale.property.id] ?? []).toEqual([]);
    expect(state().params.money.tab).toBe('offers');

    const d = dataOf<{ offer: string; total: { rupees: number }; previousTotal: { rupees: number } }>(await call('applyOffer', { offerId: offer.title, confirmed: true }));
    expect(d.offer).toBe(offer.title);
    expect(state().appliedOffers[sale.property.id]).toEqual([offer.id]);
    expect(d.previousTotal.rupees - d.total.rupees).toBe(totals.offerValues[offer.id]);
    expect(dataOf<{ alreadyApplied: boolean }>(await call('applyOffer', { offerId: offer.id, confirmed: true })).alreadyApplied).toBe(true);
    expect(expectFail(await call('applyOffer', { offerId: 'no-such-offer', confirmed: true })).hint).toContain(offer.id);
  });

  it('checks discounts against policy and recommends a handoff past the limit', async () => {
    const sale = saleBundle(ctx);
    await call('openProperty', { propertyId: sale.property.id });
    const policy = ctx.content.offers.properties[sale.property.id]!;

    if (policy.maxDiscountPct > 0) {
      const within = dataOf<{ allowed: boolean; handoffRecommended: boolean }>(await call('requestDiscount', { percent: policy.maxDiscountPct / 2 }));
      expect(within.allowed).toBe(true);
    }
    const above = dataOf<{ allowed: boolean; handoffRecommended: boolean; guidance: string }>(
      await call('requestDiscount', { percent: Math.max(policy.maxDiscountPct, policy.handoffAbovePct) + 5 }),
    );
    expect(above.allowed).toBe(false);
    expect(above.handoffRecommended).toBe(true);
    expect(above.guidance).toMatch(/senior advisor/);
    expect(state().timeline.some((e) => e.kind === 'discount_request')).toBe(true);

    const open = dataOf<{ allowed: boolean; guidance: string }>(await call('requestDiscount', {}));
    expect(open.allowed).toBe(false);
    expect(open.guidance).toMatch(/Ask what they have in mind/);
  });
});

describe('legal', () => {
  it('lists the documents, explains one, and refuses an unknown one', async () => {
    const sale = saleBundle(ctx);
    await call('openProperty', { propertyId: sale.property.id });
    const all = dataOf<{ documents: { id: string }[]; note: string }>(await call('showLegal'));
    expect(all.documents.map((d) => d.id)).toEqual(sale.legal.documents.map((d) => d.id));
    expect(all.note).toMatch(/Sample/);
    const doc = sale.legal.documents[0]!;
    const one = dataOf<{ title: string; explanation: string }>(await call('showLegal', { document: doc.title }));
    expect(one).toMatchObject({ title: doc.title, explanation: doc.explanation });
    expect(state().params.legal.docId).toBe(doc.id);
    expectFail(await call('showLegal', { document: 'moon landing permit' }));
  });
});

describe('site visits', () => {
  it('lists only open future slots, and books one only after a clear yes', async () => {
    const sale = saleBundle(ctx);
    await call('openProperty', { propertyId: sale.property.id });
    const open = sale.visits.filter((s) => s.available && Date.parse(s.start) > TEST_NOW);
    const r = await call('getVisitSlots');
    if (open.length === 0) {
      expectFail(r);
      return;
    }
    const d = dataOf<{ slots: { id: string; when: string }[] }>(r);
    expect(d.slots[0]!.id).toBe(open[0]!.id);
    expect(state().view).toBe('booking');

    const slot = open[0]!;
    const ask = expectFail(await call('bookSiteVisit', { slotId: slot.id, confirmed: false }));
    expect(ask.hint).toMatch(/clear yes/);
    expect(state().booking.status).toBe('none');
    expect(state().params.booking.slotId).toBe(slot.id);

    const booked = dataOf<{ booked: string }>(await call('bookSiteVisit', { slotId: slot.id, confirmed: true }));
    expect(booked.booked).toBe(d.slots[0]!.when);
    expect(state().booking).toEqual({ propertyId: sale.property.id, slotId: slot.id, status: 'confirmed' });
  });

  it('refuses an unknown slot and a slot in the past', async () => {
    const sale = saleBundle(ctx);
    await call('openProperty', { propertyId: sale.property.id });
    expectFail(await call('bookSiteVisit', { slotId: 'tuesday-midnight', confirmed: true }));
    const later = caller(ctx, sid, { now: () => Date.UTC(2100, 0, 1) });
    const slot = sale.visits[0]!;
    expect(expectFail(await later('bookSiteVisit', { slotId: slot.id, confirmed: true })).error).toMatch(/no longer available/);
    expect(state().booking.status).toBe('none');
  });
});

describe('lead, report and handoff', () => {
  it('records lead details quietly and refuses an empty update', async () => {
    const d = dataOf<{ recorded: string[] }>(
      await call('updateLead', { purpose: ' Relocating ', budget: 'About 2 crore', needs: ['2 BHK', ' ', 'near metro'], concerns: [] }),
    );
    expect(d.recorded.sort()).toEqual(['budget', 'needs', 'purpose']);
    expect(state().lead).toMatchObject({ purpose: 'Relocating', budget: 'About 2 crore', needs: ['2 BHK', 'near metro'] });
    expect(state().view).toBe('shortlist');
    expectFail(await call('updateLead', { needs: ['  '] }));
  });

  it('sends the recap only after agreement, and reports each channel honestly', async () => {
    const calls: unknown[] = [];
    const send = caller(ctx, sid, {
      sendReport: async (_ctx, sessionId, channels) => {
        calls.push({ sessionId, channels });
        return [
          { id: 'e', channel: 'email', to: 'b***', status: 'sent', detail: null, at: TEST_NOW },
          { id: 'w', channel: 'whatsapp', to: '+91***', status: 'not_configured', detail: null, at: TEST_NOW },
        ];
      },
    });
    expectFail(await send('sendReport', { channels: ['email', 'whatsapp'], confirmed: false }));
    expect(calls).toEqual([]);
    const r = await send('sendReport', { channels: ['email', 'whatsapp'], confirmed: true });
    expect(calls).toEqual([{ sessionId: sid, channels: ['email', 'whatsapp'] }]);
    expect(dataOf<{ deliveries: unknown[] }>(r).deliveries).toEqual([
      { channel: 'email', status: 'sent' },
      { channel: 'WhatsApp', status: 'not set up on this demo' },
    ]);
    expect(r.expression).toBe('apologetic');

    expectFail(await caller(ctx, sid, { sendReport: async () => Promise.reject(new Error('smtp down')) })('sendReport', { channels: ['email'], confirmed: true }));
    expectFail(await caller(ctx, sid, { sendReport: null })('sendReport', { channels: ['email'], confirmed: true }));
  });

  it('answers "on its way" when delivery outlasts the wait, without losing the send', async () => {
    let finished = false;
    const slow = caller(ctx, sid, {
      reportWaitMs: 20,
      sendReport: async () => {
        await new Promise((r) => setTimeout(r, 80));
        finished = true;
        return [];
      },
    });
    const d = dataOf<{ deliveries: { status: string }[] }>(await slow('sendReport', { channels: ['email'], confirmed: true }));
    expect(d.deliveries).toEqual([{ channel: 'email', status: 'on its way' }]);
    expect(finished).toBe(false);
    await new Promise((r) => setTimeout(r, 120));
    expect(finished).toBe(true);
  });

  it('rings the Lead Desk once with the reason and time', async () => {
    dataOf(await call('requestHuman', { reason: 'Wants 10% off' }));
    expect(state().handoff).toMatchObject({ status: 'requested', reason: 'Wants 10% off', requestedAt: TEST_NOW });
    const again = dataOf<{ alreadyRequested: boolean }>(await call('requestHuman', { reason: 'Again' }));
    expect(again.alreadyRequested).toBe(true);
    expect(state().handoff.reason).toBe('Wants 10% off');
  });
});
