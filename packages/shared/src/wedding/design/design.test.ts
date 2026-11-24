import { describe, expect, it } from 'vitest';
import { applyWeddingAction } from '../actions.js';
import { createSampleWedding } from '../sample.js';
import { STUDIO_ROOMS } from '../scene/rooms.js';
import { DECOR_CATALOG, findEntry } from '../scene/catalog.js';
import { validateAll } from '../scene/placement.js';
import { sceneCost } from '../scene/cost.js';
import { WeddingDesignBriefSchema, DesignFormSchema, type DesignForm, type WeddingDesignBrief } from './brief.js';
import { demoBriefFromForm } from './demo-brief.js';
import { planScene } from './plan.js';
import { refineBrief } from './refine.js';
import { zonesFor } from './zones.js';

const form: DesignForm = { description: 'Grand south indian wedding with jasmine and marigold, chandeliers and brass lamps', style: 'Traditional South Indian', guestCount: 250, decorationBudgetInr: null, palette: ['marigold', 'maroon', 'gold'] };
const brief = (): WeddingDesignBrief => demoBriefFromForm(form);
const room = (id: string) => STUDIO_ROOMS[id]!;
const VENUES = ['venue-grand-ballroom', 'venue-courtyard-hall', 'venue-lakeside-lawn'];

describe('design brief', () => {
  it('accepts a valid brief and rejects malformed or oversized ones', () => {
    expect(WeddingDesignBriefSchema.safeParse(brief()).success).toBe(true);
    const b = brief();
    expect(WeddingDesignBriefSchema.safeParse({ ...b, grandness: 9 }).success).toBe(false);
    expect(WeddingDesignBriefSchema.safeParse({ ...b, flowers: Array(20).fill(b.flowers[0]) }).success).toBe(false);
    expect(WeddingDesignBriefSchema.safeParse({ ...b, provenance: [{ element: 'x', imageIndex: 7 }] }).success).toBe(false);
    expect(WeddingDesignBriefSchema.safeParse({ ...b, ceiling: { treatment: 'lasers', description: '' } }).success).toBe(false);
    expect(DesignFormSchema.safeParse({ ...form, guestCount: 0 }).success).toBe(false);
  });
  it('the demo brief says no photographs were analysed', () => {
    const b = brief();
    expect(b.summary).toMatch(/NOT analysed/);
    expect(b.limitations.join(' ')).toMatch(/NOT analysed/);
    expect(b.provenance).toEqual([]);
  });
});

describe('zones', () => {
  it('are derived from each real room and lie inside it', () => {
    for (const id of VENUES) {
      const z = zonesFor(room(id));
      expect(z.stage.minZ).toBeGreaterThan(z.room.minZ);
      expect(z.stage.maxZ).toBeLessThan(z.entrance.z);
      expect(z.seating.left.maxX).toBeLessThan(z.aisle.minX + 0.4);
      expect(z.seating.right.minX).toBeGreaterThan(z.aisle.maxX - 0.4);
      expect(z.seatingDepth).toBeGreaterThan(2);
    }
  });
});

describe('scene planner', () => {
  it('produces a complete, valid design in every sample venue', () => {
    for (const id of VENUES) {
      const r = planScene({ brief: brief(), room: room(id), guests: 250, budgetInr: null });
      expect(r.ok, id).toBe(true);
      if (!r.ok) continue;
      const cats = new Set(r.plan.objects.map((o) => findEntry(DECOR_CATALOG, o.catalogId)!.category));
      for (const c of ['stage', 'mandap', 'floral', 'seating', 'arch']) expect(cats.has(c as never), `${id} has ${c}`).toBe(true);
      expect(validateAll({ room: room(id), catalog: DECOR_CATALOG }, r.plan.objects).ok).toBe(true);
      expect(r.plan.costInr).toBe(sceneCost(r.plan.objects));
      expect(r.plan.objects.length).toBeGreaterThan(15);
    }
  });
  it('is deterministic, and another variant differs but stays valid', () => {
    const a = planScene({ brief: brief(), room: room(VENUES[0]!), guests: 250, budgetInr: null, variant: 0 });
    const b = planScene({ brief: brief(), room: room(VENUES[0]!), guests: 250, budgetInr: null, variant: 0 });
    const c = planScene({ brief: brief(), room: room(VENUES[0]!), guests: 250, budgetInr: null, variant: 1 });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(JSON.stringify(a.plan.objects)).toBe(JSON.stringify(b.plan.objects));
      expect(JSON.stringify(c.plan.objects)).not.toBe(JSON.stringify(a.plan.objects));
    }
  });
  it('uses the palette on the right parts', () => {
    const r = planScene({ brief: brief(), room: room(VENUES[0]!), guests: 100, budgetInr: null });
    if (!r.ok) throw new Error(r.error);
    const mandap = r.plan.objects.find((o) => o.catalogId === 'mandap-traditional')!;
    expect(mandap.colors.pillars).toBe('#c9a227'); // accent gold
    expect(mandap.colors.canopy).toBe('#7a1230'); // secondary maroon
  });
  it('respects the budget, explains what was dropped, and refuses an impossible one', () => {
    const r = planScene({ brief: brief(), room: room(VENUES[0]!), guests: 250, budgetInr: 200_000 });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.plan.costInr).toBeLessThanOrEqual(200_000); expect(r.plan.notes.join(' ')).toMatch(/left out/); }
    const tiny = planScene({ brief: brief(), room: room(VENUES[0]!), guests: 250, budgetInr: 50_000 });
    expect(tiny.ok).toBe(false);
  });
  it('explains substitutions: unknown flowers, ceilings outdoors, unknown colours', () => {
    const b = brief();
    b.flowers = [{ name: 'orchid', color: 'purple', use: 'arrangements' }];
    b.palette = [{ color: 'dusty teal', role: 'primary' }, { color: 'maroon', role: 'secondary' }];
    b.ceiling = { treatment: 'chandeliers', description: '' };
    b.lighting = { ...b.lighting, features: ['chandelier'] };
    const r = planScene({ brief: b, room: room('venue-lakeside-lawn'), guests: 100, budgetInr: null });
    if (!r.ok) throw new Error(r.error);
    const s = r.plan.substitutions.join(' | ');
    expect(s).toMatch(/orchid/);
    expect(s).toMatch(/dusty teal/);
    expect(s).toMatch(/open-air/);
    expect(r.plan.objects.some((o) => o.mount === 'ceiling')).toBe(false);
  });
  it('shows a representative number of chairs and says so', () => {
    const r = planScene({ brief: brief(), room: room(VENUES[0]!), guests: 400, budgetInr: null });
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.seatsShown).toBeLessThan(400);
    expect(r.plan.notes.join(' ')).toMatch(/representative/);
  });
});

describe('props from the real-asset pack', () => {
  it('a grand traditional design has palms, urns and elephants in every venue, all valid', () => {
    for (const id of VENUES) {
      const b = brief(); b.grandness = 4; b.tradition = 'traditional';
      const r = planScene({ brief: b, room: room(id), guests: 150, budgetInr: null });
      if (!r.ok) throw new Error(`${id}: ${r.error}`);
      const ids = r.plan.objects.map((o) => o.catalogId);
      for (const c of ['plant-potted', 'urn-brass-flowers', 'elephant-carved']) expect(ids, `${id} ${c}`).toContain(c);
    }
  });
  it('a simple modern design stays free of elephants', () => {
    const b = brief(); b.grandness = 2; b.tradition = 'modern';
    const r = planScene({ brief: b, room: room(VENUES[0]!), guests: 80, budgetInr: null });
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.objects.some((o) => o.catalogId === 'elephant-carved')).toBe(false);
  });
});

describe('refinement', () => {
  it('recolours flowers, grows and shrinks, adds jasmine, and reports unsupported requests', () => {
    const b = brief();
    const w = refineBrief(b, 'Make the flowers white');
    expect(w.supported).toBe(true);
    expect(w.brief.flowers.every((f) => f.color === 'white')).toBe(true);
    expect(refineBrief(b, 'Make the mandap grander').brief.grandness).toBe(Math.min(5, b.grandness + 1));
    expect(refineBrief(b, 'Use more jasmine').brief.flowers.some((f) => f.name === 'jasmine')).toBe(true);
    expect(refineBrief(b, 'Make the decoration more modern').brief.tradition).toBe('modern');
    expect(refineBrief(b, 'Reduce the decoration budget').budgetScale).toBe(0.8);
    expect(refineBrief(b, 'I prefer the second inspiration image').emphasiseImage).toBe(1);
    expect(refineBrief(b, 'sing me a song').supported).toBe(false);
  });
});

describe('reducer: design actions', () => {
  const planned = (venueId = VENUES[0]!) => {
    const r = planScene({ brief: brief(), room: room(venueId), guests: 250, budgetInr: null });
    if (!r.ok) throw new Error(r.error);
    return r.plan;
  };
  const withVenue = () => { const s = applyWeddingAction(createSampleWedding('w'), { type: 'select_venue', venueId: VENUES[0] }); if (!s.ok) throw new Error(s.error); return s.state; };
  const apply = (state = withVenue(), id = 'v1', plan = planned()) => applyWeddingAction(state, { type: 'apply_design_plan', versionId: id, label: 'Version 1', createdAt: '2026-11-23T00:00:00.000Z', source: 'demo', venueId: VENUES[0], brief: brief(), form, objects: plan.objects, summary: plan.description, substitutions: plan.substitutions });

  it('replaces the scene atomically as ONE undo step and records a version', () => {
    const r = apply();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.scene.objects.length).toBeGreaterThan(15);
    expect(r.state.design.versions).toHaveLength(1);
    expect(r.state.design.activeVersionId).toBe('v1');
    const u = applyWeddingAction(r.state, { type: 'undo_scene' });
    expect(u.ok && u.state.scene.objects.length).toBe(0);
  });
  it('rejects a stale plan, an invalid layout and over-limit plans without changing anything', () => {
    const s = withVenue();
    const lawn = applyWeddingAction(s, { type: 'select_venue', venueId: VENUES[2] });
    if (!lawn.ok) throw new Error(lawn.error);
    expect(apply(lawn.state).ok).toBe(false); // plan was for the ballroom
    const bad = planned();
    bad.objects[1] = { ...bad.objects[1]!, position: { ...bad.objects[1]!.position, x: 999 } };
    expect(apply(s, 'v2', bad).ok).toBe(false);
    const limited = applyWeddingAction(s, { type: 'set_budget_limit', category: 'decoration', amount: 100_000 });
    if (!limited.ok) throw new Error(limited.error);
    const over = apply(limited.state);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('over_limit');
    expect(limited.state.scene.objects).toHaveLength(0);
  });
  it('keeps versions separate, restores one, snapshots hand edits, and the browser cannot apply plans', () => {
    const first = apply();
    if (!first.ok) throw new Error(first.error);
    const cleared = applyWeddingAction(first.state, { type: 'clear_scene' });
    if (!cleared.ok) throw new Error(cleared.error);
    const restored = applyWeddingAction(cleared.state, { type: 'restore_design_version', id: 'v1' });
    expect(restored.ok && restored.state.scene.objects.length).toBe(first.state.scene.objects.length);
    const snap = applyWeddingAction(first.state, { type: 'snapshot_design_version', id: 's1', label: 'My edit', createdAt: '2026-11-23T01:00:00.000Z' });
    expect(snap.ok && snap.state.design.versions.map((v) => v.source)).toEqual(['demo', 'manual']);
    const del = applyWeddingAction(first.state, { type: 'delete_design_version', id: 'v1' });
    expect(del.ok && del.state.design.versions).toHaveLength(0);
    expect(applyWeddingAction(first.state, { type: 'restore_design_version', id: 'nope' }).ok).toBe(false);
  });
  it('caps versions at 10 instead of silently dropping an old one', () => {
    let s = withVenue();
    for (let i = 0; i < 10; i++) { const r = apply(s, `v${i}`); if (!r.ok) throw new Error(r.error); s = r.state; }
    const r = apply(s, 'v10');
    expect(r.ok).toBe(false);
    expect(s.design.versions).toHaveLength(10);
  });
  it('old saved states without a design section still load', () => {
    const raw = JSON.parse(JSON.stringify(createSampleWedding('w'))) as Record<string, unknown>;
    delete raw.design;
    const r = applyWeddingAction(raw as never, { type: 'set_total_budget', total: 1000 });
    expect(r.ok).toBe(true);
  });
});
