import { describe, expect, it } from 'vitest';
import { applyWeddingAction, createSampleWedding, type WeddingAction, type WeddingState } from '../index.js';
import { DECOR_CATALOG, PRICE_NOTE, costLines, resolveColor, sceneCost, suggestTrim, validateCatalog, COLOR_NAMES } from './index.js';

const act = (s: WeddingState, a: WeddingAction | Record<string, unknown>) => {
  const r = applyWeddingAction(s, a);
  if (!r.ok) throw new Error(`${r.error} ${r.hint}`);
  return r.state;
};
const fresh = () => createSampleWedding('w');
const build = (s = fresh()) => {
  s = act(s, { type: 'add_decors', items: [{ id: 'stage', catalogId: 'stage-wedding', x: 12, z: 4 }] });
  s = act(s, { type: 'add_decors', items: [{ id: 'm', catalogId: 'mandap-traditional', mount: 'stage' }, { id: 'e1', catalogId: 'flowers-centrepiece', x: 4, z: 12 }, { id: 'e2', catalogId: 'flowers-centrepiece', x: 6, z: 12 }, { id: 'ch', catalogId: 'chandelier-crystal', x: 12, z: 8 }] });
  return s;
};

describe('sample prices and costing', () => {
  it('every catalogue item has a sample price and the catalogue is valid', () => {
    expect(validateCatalog(DECOR_CATALOG)).toBeNull();
    expect(PRICE_NOTE).toMatch(/not vendor quotations/);
    expect(DECOR_CATALOG.find((e) => e.id === 'mandap-traditional')!.samplePrice).toBe(75000);
    expect(DECOR_CATALOG.find((e) => e.id === 'flowers-centrepiece')!.samplePrice).toBe(12000);
    expect(DECOR_CATALOG.find((e) => e.id === 'arch-flower')!.samplePrice).toBe(18000);
  });
  it('rejects a catalogue with a bad price', () => {
    expect(validateCatalog([{ ...DECOR_CATALOG[0]!, samplePrice: -1 }])).toMatch(/price/);
    expect(validateCatalog([{ ...DECOR_CATALOG[0]!, samplePrice: 1.5 }])).toMatch(/price/);
  });
  it('adds a scene up exactly, by line', () => {
    const s = build();
    expect(sceneCost(s.scene.objects)).toBe(60000 + 75000 + 2 * 12000 + 25000);
    const lines = costLines(s.scene.objects);
    expect(lines.find((l) => l.catalogId === 'flowers-centrepiece')).toMatchObject({ quantity: 2, unitPrice: 12000, subtotal: 24000 });
    expect(sceneCost([])).toBe(0);
  });
  it('suggests trimming least-essential first, never the stage or a mandap', () => {
    const s = build();
    const t = suggestTrim(s.scene.objects, 170000); // scene is 184,000
    expect(t.feasible).toBe(true);
    expect(t.resultingCost).toBeLessThanOrEqual(170000);
    expect(t.removeIds).toEqual(['ch']); // lighting goes first
    expect(suggestTrim(s.scene.objects, 1_000_000)).toMatchObject({ removeIds: [], savings: 0, feasible: true });
    const impossible = suggestTrim(s.scene.objects, 100000); // stage + mandap alone are 135,000
    expect(impossible.feasible).toBe(false);
    for (const id of impossible.removeIds) expect(['stage', 'm']).not.toContain(id);
  });
});

describe('colour names', () => {
  it('resolves names, hex and multi-word phrases; refuses unknowns', () => {
    expect(resolveColor('pink')).toBe('#ec7aa3');
    expect(resolveColor('  GOLD ')).toBe('#c9a227');
    expect(resolveColor('jasmine white')).toBe('#fffdf2');
    expect(resolveColor('#ABCDEF')).toBe('#abcdef');
    expect(resolveColor('chartreuse')).toBeNull();
    expect(resolveColor('#12345')).toBeNull();
    expect(COLOR_NAMES).toContain('warm');
  });
});

describe('batch scene actions are single, atomic history steps', () => {
  it('add_decors adds together or not at all', () => {
    const s = act(fresh(), { type: 'add_decors', items: [{ id: 'a', catalogId: 'chair-banquet', x: 5, z: 5 }, { id: 'b', catalogId: 'chair-banquet', x: 5, z: 5 }] });
    expect(s.scene.objects).toHaveLength(2);
    expect(s.sceneHistory.past).toHaveLength(1);
    const before = JSON.stringify(s);
    const r = applyWeddingAction(s, { type: 'add_decors', items: [{ id: 'c', catalogId: 'chair-banquet' }, { id: 'd', catalogId: 'mandap-traditional', mount: 'stage' }] }); // no stage for the second
    expect(r.ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('add_decors can set starting colours, and rejects unknown parts', () => {
    const s = act(fresh(), { type: 'add_decors', items: [{ id: 'm', catalogId: 'mandap-traditional', colors: { flowers: '#FFD23F' } }] });
    expect(s.scene.objects[0]!.colors).toEqual({ flowers: '#ffd23f' });
    expect(applyWeddingAction(fresh(), { type: 'add_decors', items: [{ id: 'm', catalogId: 'chair-banquet', colors: { flowers: '#ffffff' } }] }).ok).toBe(false);
  });
  it('set_decor_colors recolours many objects in one undoable step and touches only that part', () => {
    let s = build();
    const past = s.sceneHistory.past.length;
    s = act(s, { type: 'set_decor_colors', ids: ['m', 'e1', 'e2'], part: 'flowers', color: '#ec7aa3' });
    expect(s.sceneHistory.past).toHaveLength(past + 1);
    expect(s.scene.objects.find((o) => o.id === 'm')!.colors).toEqual({ flowers: '#ec7aa3' });
    expect(s.scene.objects.find((o) => o.id === 'stage')!.colors).toEqual({});
    expect(applyWeddingAction(s, { type: 'set_decor_colors', ids: ['m', 'ch'], part: 'flowers', color: '#ffffff' }).ok).toBe(false); // chandelier has no flowers
    expect(applyWeddingAction(s, { type: 'set_decor_colors', ids: ['m', 'nope'], part: 'flowers', color: '#ffffff' }).ok).toBe(false);
    s = act(s, { type: 'undo_scene' });
    expect(s.scene.objects.find((o) => o.id === 'm')!.colors).toEqual({});
  });
  it('remove_decors removes together; a stage goes only with what is on it', () => {
    const s = build();
    expect(applyWeddingAction(s, { type: 'remove_decors', ids: ['stage'] }).ok).toBe(false);
    const both = act(s, { type: 'remove_decors', ids: ['stage', 'm'] });
    expect(both.scene.objects.map((o) => o.id).sort()).toEqual(['ch', 'e1', 'e2']);
    expect(applyWeddingAction(s, { type: 'remove_decors', ids: ['e1', 'nope'] }).ok).toBe(false);
  });
});

describe('the customer decoration limit is enforced by the reducer', () => {
  it('refuses additions that go over, allows ones that fit, and honours an explicit acceptance', () => {
    let s = act(fresh(), { type: 'set_budget_limit', category: 'decoration', amount: 100000 });
    s = act(s, { type: 'add_decor', id: 'stage', catalogId: 'stage-wedding', x: 12, z: 4 }); // 60,000
    const over = applyWeddingAction(s, { type: 'add_decor', id: 'm', catalogId: 'mandap-traditional', mount: 'stage' });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/above the ₹1,00,000 limit/);
    expect(applyWeddingAction(s, { type: 'add_decors', items: [{ id: 'm', catalogId: 'mandap-traditional', mount: 'stage' }] }).ok).toBe(false);
    s = act(s, { type: 'add_decor', id: 'c', catalogId: 'chair-banquet', x: 3, z: 12 }); // fits
    expect(applyWeddingAction(s, { type: 'duplicate_decor', id: 'stage', newId: 'dup' }).ok).toBe(false); // another stage: over
    s = act(s, { type: 'add_decor', id: 'm', catalogId: 'mandap-traditional', mount: 'stage', acceptOverBudget: true });
    expect(s.scene.objects).toHaveLength(3);
  });
  it('does not stand in the way of removing, moving, recolouring, undoing, or clearing the limit', () => {
    let s = act(build(), { type: 'set_budget_limit', category: 'decoration', amount: 50000 }); // already far over
    s = act(s, { type: 'move_decor', id: 'e1', x: 8, z: 12 });
    s = act(s, { type: 'set_decor_color', id: 'e1', part: 'flowers', color: '#ffffff' });
    s = act(s, { type: 'remove_decors', ids: ['ch'] });
    s = act(s, { type: 'undo_scene' });
    s = act(s, { type: 'set_budget_limit', category: 'decoration', amount: null });
    expect(s.budget.limits.decoration).toBeUndefined();
    s = act(s, { type: 'add_decor', id: 'z', catalogId: 'chair-banquet' });
    expect(s.scene.objects.some((o) => o.id === 'z')).toBe(true);
  });
  it('limits are validated and older saved workspaces without them still load', () => {
    expect(applyWeddingAction(fresh(), { type: 'set_budget_limit', category: 'decoration', amount: -1 }).ok).toBe(false);
    expect(applyWeddingAction(fresh(), { type: 'set_budget_limit', category: 'nonsense', amount: 5 }).ok).toBe(false);
    const old = JSON.parse(JSON.stringify(fresh()));
    delete old.budget.limits;
    expect(applyWeddingAction(old, { type: 'set_total_budget', total: 5 }).ok).toBe(true);
  });
});
