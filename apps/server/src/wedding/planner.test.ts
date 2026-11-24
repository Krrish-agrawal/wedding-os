import { describe, expect, it } from 'vitest';
import { DECOR_CATALOG, applyWeddingAction, sceneCost, type DecorObject, type WeddingState } from '@ave/shared';
import type { ChatCreate } from '../agent/sim.js';
import { toolTestContext } from '../tools/testkit.js';
import { buildApp } from '../app.js';
import { TOOL_NAMES, runWeddingTool, weddingToolDefinitions } from './orchestrator.js';
import { WeddingPlanner, type PlannerEvent } from './planner.js';
import { splitClauses } from './demo.js';
import { VendorStore } from './vendor-store.js';
import { WeddingStore } from './store.js';
import { ProposalStore } from './proposals.js';
import { newSession, type ToolContext, type ToolResult } from './toolkit.js';

const noKey = { OPENAI_API_KEY: undefined, LLM_MODEL: 'm', LLM_REASONING_EFFORT: undefined } as const;

function setup() {
  const store = new WeddingStore();
  const proposals = new ProposalStore();
  const ctx: ToolContext = { store, vendors: new VendorStore(), proposals, weddingId: 'w', session: newSession() };
  const call = (name: string, input: unknown = {}) => runWeddingTool(ctx, name, input);
  const scene = (): DecorObject[] => store.getOrCreate('w').scene.objects;
  const st = (): WeddingState => store.getOrCreate('w');
  const of = (assetId: string) => scene().filter((o) => o.catalogId === assetId);
  return { store, proposals, ctx, call, scene, st, of };
}
const good = (r: ToolResult) => {
  if (!r.ok) throw new Error(`${r.error} | ${r.hint}`);
  return r.data as Record<string, any>;
};
const demo = () => {
  const store = new WeddingStore();
  const planner = new WeddingPlanner(store, noKey, null);
  const say = (text: string, selectedId?: string | null) => planner.chat('w', text, { selectedId });
  const scene = () => store.getOrCreate('w').scene.objects;
  const of = (assetId: string) => scene().filter((o) => o.catalogId === assetId);
  return { store, planner, say, scene, of, st: () => store.getOrCreate('w') };
};

describe('the tool set', () => {
  it('has every required tool, each with a description and a JSON schema', () => {
    const required = ['listDecorationAssets', 'listSceneDecorations', 'addDecoration', 'moveDecoration', 'rotateDecoration', 'scaleDecoration', 'changeDecorationMaterial', 'duplicateDecoration', 'removeDecoration', 'undoDecorationAction', 'saveWeddingDesign', 'loadWeddingDesign', 'getBudgetSummary', 'allocateBudget', 'estimateDecorationCost', 'addExpense', 'checkBudgetFeasibility'];
    for (const n of required) expect(TOOL_NAMES).toContain(n);
    for (const t of weddingToolDefinitions()) {
      expect(t.description.length).toBeGreaterThan(30);
      expect((t.parameters as { type: string }).type).toBe('object');
    }
  });
  it('every catalogue item carries a sample price', () => {
    for (const e of DECOR_CATALOG) expect(Number.isInteger(e.samplePrice) && e.samplePrice > 0).toBe(true);
    const assets = good(setup().call('listDecorationAssets')) as { assets: { priceIsSample: boolean }[]; note: string };
    expect(assets.assets.every((a) => a.priceIsSample)).toBe(true);
    expect(assets.note).toMatch(/not vendor quotations/i);
  });
  it('rejects unknown tools and invalid input with a hint, never throwing', () => {
    const { call } = setup();
    for (const [n, i] of [['nope', {}], ['addDecoration', { assetId: 5 }], ['addDecoration', null], ['moveDecoration', {}], ['changeDecorationMaterial', { part: 'flowers', color: 'pink' }]] as const) {
      const r = call(n, i);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.hint).toBeTruthy();
    }
  });
});

describe('decoration tools', () => {
  it('1. adds a traditional mandap on the stage (and says to add a stage first when there is none)', () => {
    const { call, of, st } = setup();
    const refused = call('addDecoration', { assetId: 'mandap-traditional', mount: 'stage' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.hint).toMatch(/stage-wedding/);
    call('addDecoration', { assetId: 'stage-wedding' });
    const rev = st().rev;
    const r = good(call('addDecoration', { assetId: 'traditional mandap', mount: 'stage' }));
    expect(r.added).toHaveLength(1);
    expect(of('mandap-traditional')[0]).toMatchObject({ mount: 'stage', position: { y: 0.6 } });
    expect(st().rev).toBe(rev + 1); // one reducer action
  });
  it('2. changes only the flower colour, on every decoration that has flowers', () => {
    const { call, scene } = setup();
    call('addDecoration', { assetId: 'mandap-traditional' });
    call('addDecoration', { assetId: 'flowers-centrepiece', quantity: 2 });
    call('addDecoration', { assetId: 'chair-banquet' });
    const before = JSON.stringify(scene().find((o) => o.catalogId === 'mandap-traditional')!.colors);
    expect(before).toBe('{}');
    const r = good(call('changeDecorationMaterial', { allWithPart: true, part: 'flowers', color: 'pink' }));
    expect(r.changed).toHaveLength(3);
    for (const o of scene()) {
      if (o.catalogId === 'chair-banquet') expect(o.colors).toEqual({});
      else expect(o.colors).toEqual({ flowers: '#ec7aa3' }); // pillars and canopy untouched
    }
  });
  it('2b. one batch colour change is a single undo step; "default" restores the colour', () => {
    const { call, scene, st } = setup();
    call('addDecoration', { assetId: 'flowers-centrepiece', quantity: 3 });
    const past = st().sceneHistory.past.length;
    call('changeDecorationMaterial', { allWithPart: true, part: 'flowers', color: 'white' });
    expect(st().sceneHistory.past.length).toBe(past + 1);
    good(call('undoDecorationAction'));
    expect(scene().every((o) => Object.keys(o.colors).length === 0)).toBe(true);
    call('changeDecorationMaterial', { allWithPart: true, part: 'flowers', color: 'red' });
    call('changeDecorationMaterial', { allWithPart: true, part: 'flowers', color: 'default' });
    expect(scene().every((o) => Object.keys(o.colors).length === 0)).toBe(true);
  });
  it('refuses unknown colours and parts with the valid options', () => {
    const { call } = setup();
    call('addDecoration', { assetId: 'chair-banquet' });
    const c = call('changeDecorationMaterial', { allWithPart: true, part: 'seat', color: 'chartreuse' });
    expect(!c.ok && c.hint).toMatch(/pink/);
    const p = call('changeDecorationMaterial', { allWithPart: true, part: 'flowers', color: 'pink' });
    expect(p.ok).toBe(false);
  });
  it('3. moves a decoration left through the validated move action', () => {
    const { call, of } = setup();
    call('addDecoration', { assetId: 'mandap-traditional', x: 12, z: 8 });
    const id = of('mandap-traditional')[0]!.id;
    good(call('moveDecoration', { id, direction: 'left', distance: 0.5 }));
    expect(of('mandap-traditional')[0]!.position.x).toBeCloseTo(11.5, 3);
    good(call('moveDecoration', { id, x: 6, z: 6 }));
    expect(of('mandap-traditional')[0]!.position).toMatchObject({ x: 6, z: 6 });
  });
  it('4. a missing decoration gets an error that lists the real ids', () => {
    const { call, of } = setup();
    expect(call('moveDecoration', { id: 'ghost', direction: 'left' })).toMatchObject({ ok: false, hint: expect.stringMatching(/empty|Add something/i) });
    call('addDecoration', { assetId: 'chair-banquet' });
    const r = call('removeDecoration', { ids: ['ghost'] });
    expect(!r.ok && r.hint).toContain(of('chair-banquet')[0]!.id);
  });
  it('5. impossible placement is refused with a reason and changes nothing', () => {
    const { call, of, st } = setup();
    call('addDecoration', { assetId: 'chair-banquet', x: 3, z: 3 });
    call('addDecoration', { assetId: 'chair-banquet', x: 5, z: 3 });
    const [a, b] = of('chair-banquet');
    const rev = st().rev;
    expect(call('moveDecoration', { id: a!.id, x: -30, z: 3 })).toMatchObject({ ok: false, error: expect.stringMatching(/fit inside/i) });
    expect(call('moveDecoration', { id: b!.id, x: 3, z: 3 })).toMatchObject({ ok: false, error: expect.stringMatching(/overlap/i) });
    expect(call('rotateDecoration', { id: a!.id, degrees: 400 }).ok).toBe(false); // schema range
    expect(call('scaleDecoration', { id: a!.id, scale: 9 }).ok).toBe(false);
    expect(call('scaleDecoration', { id: a!.id }).ok).toBe(false); // needs scale or factor
    expect(st().rev).toBe(rev);
  });
  it('rotates, scales by factor, duplicates and removes through actions', () => {
    const { call, of, scene } = setup();
    call('addDecoration', { assetId: 'sofa-loveseat', x: 8, z: 8 });
    const id = of('sofa-loveseat')[0]!.id;
    good(call('rotateDecoration', { id, degrees: 90 }));
    expect(of('sofa-loveseat')[0]!.rotationY).toBeCloseTo(Math.PI / 2, 3);
    good(call('rotateDecoration', { id, degrees: 0, mode: 'to' }));
    expect(of('sofa-loveseat')[0]!.rotationY).toBeCloseTo(0, 3);
    good(call('scaleDecoration', { id, factor: 1.2 }));
    expect(of('sofa-loveseat')[0]!.scale).toBeCloseTo(1.2, 3);
    good(call('duplicateDecoration', { id }));
    expect(of('sofa-loveseat')).toHaveLength(2);
    good(call('removeDecoration', { ids: of('sofa-loveseat').map((o) => o.id) }));
    expect(scene()).toHaveLength(0);
  });
  it('6. undoes agent-created changes, singly and as a whole request', () => {
    const { call, scene, ctx, st } = setup();
    call('addDecoration', { assetId: 'chair-banquet' });
    expect(scene()).toHaveLength(1);
    good(call('undoDecorationAction'));
    expect(scene()).toHaveLength(0);
    expect(call('undoDecorationAction').ok).toBe(false); // nothing left
    expect(st().sceneHistory.future).toHaveLength(1); // redo remains available in the studio
    void ctx;
  });
  it('7. saves an agent-generated design by name and reloads it', () => {
    const { call, scene } = setup();
    call('addDecoration', { assetId: 'stage-wedding' });
    call('addDecoration', { assetId: 'mandap-traditional', mount: 'stage' });
    call('changeDecorationMaterial', { allWithPart: true, part: 'flowers', color: 'yellow' });
    const saved = JSON.stringify(scene());
    good(call('saveWeddingDesign', { name: 'South Indian plan' }));
    call('removeDecoration', { ids: scene().map((o) => o.id) });
    expect(scene()).toHaveLength(0);
    good(call('loadWeddingDesign', { name: 'south indian' })); // unique partial name
    expect(JSON.stringify(scene())).toBe(saved);
    const missing = call('loadWeddingDesign', { name: 'nope' });
    expect(!missing.ok && missing.hint).toContain('South Indian plan');
  });
});

describe('budget tools', () => {
  it('8. calculates decoration costs from sample prices, in code', () => {
    const { call, scene } = setup();
    const r = good(call('estimateDecorationCost', { items: [{ assetId: 'mandap-traditional', quantity: 1 }, { assetId: 'flowers-centrepiece', quantity: 2 }, { assetId: 'arch-flower' }] }));
    expect(r.additionalInr).toBe(75000 + 2 * 12000 + 18000);
    expect(r.currentSceneEstimateInr).toBe(0);
    expect(r.priceIsSample).toBe(true);
    call('addDecoration', { assetId: 'stage-wedding' });
    expect(good(call('getBudgetSummary')).decoration.currentSceneEstimateInr).toBe(60000);
    expect(scene()).toHaveLength(1);
    expect(sceneCost(scene())).toBe(60000);
  });
  it('compares against the customer limit and suggests what to remove when over', () => {
    const { call, scene } = setup();
    call('addDecoration', { assetId: 'stage-wedding' });
    call('addDecoration', { assetId: 'mandap-traditional', mount: 'stage' });
    call('addDecoration', { assetId: 'chandelier-crystal', quantity: 2 });
    call('addDecoration', { assetId: 'flowers-centrepiece', quantity: 2 });
    const r = good(call('estimateDecorationCost', { limit: 200000 }));
    expect(r.projectedInr).toBe(60000 + 75000 + 50000 + 24000);
    expect(r.withinConstraint).toBe(false);
    expect(r.overByInr).toBe(r.projectedInr - 200000);
    expect(r.trimSuggestion.feasible).toBe(true);
    expect(r.trimSuggestion.resultingCost).toBeLessThanOrEqual(200000);
    // never suggests removing the stage or the mandap
    for (const id of r.trimSuggestion.removeIds) expect(['stage-wedding', 'mandap-traditional']).not.toContain(scene().find((o) => o.id === id)!.catalogId);
  });
  it('9. a customer limit stops an over-limit addition: it becomes a proposal, and nothing changes until the customer confirms', () => {
    const { call, scene, st, store, proposals } = setup();
    good(call('setBudgetLimit', { category: 'decoration', amount: 100000 }));
    good(call('addDecoration', { assetId: 'stage-wedding' })); // 60,000
    const r = call('addDecoration', { assetId: 'mandap-traditional', mount: 'stage' }); // would be 135,000
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Needs the customer's confirmation/);
      expect(r.hint).toMatch(/cannot confirm it yourself/);
      expect(r.proposal?.changes[0]).toMatchObject({ from: '₹60,000', to: '₹1,35,000' });
    }
    expect(scene()).toHaveLength(1); // proposal only: no change
    // Extra keys from the model are not part of the tool schema and have no effect.
    for (const forged of [{ acceptOverBudget: true }, { customerAcceptedOverBudget: true }, { confirmed: true }]) {
      expect(call('addDecoration', { assetId: 'mandap-traditional', mount: 'stage', ...forged }).ok).toBe(false);
    }
    expect(scene()).toHaveLength(1);
    // Straight to the reducer, without the tool: same refusal.
    expect(store.dispatch('w', { type: 'add_decor', id: 'zz', catalogId: 'mandap-traditional', mount: 'stage' }).ok).toBe(false);
    expect(call('checkBudgetFeasibility', { category: 'decoration', additionalCost: 75000 })).toMatchObject({ ok: true, data: { withinConstraint: false, overByInr: 35000 } });
    // Only the application's confirm path applies it.
    const pending = proposals.pending('w');
    expect(pending).toHaveLength(1); // the forged retries reused the same proposal
    const done = proposals.confirm(store, 'w', pending[0]!.id);
    expect(done.ok).toBe(true);
    expect(scene()).toHaveLength(2);
    expect(st().budget.limits.decoration).toBe(100000);
  });
  it('9b. significant budget changes become proposals; small ones and first-time settings apply directly', () => {
    const { call, st, store, proposals } = setup();
    good(call('setTotalBudget', { total: 1_000_000 })); // first set: fine
    const raise = call('setTotalBudget', { total: 2_000_000 });
    expect(raise.ok).toBe(false);
    if (!raise.ok) expect(raise.proposal?.summary).toMatch(/from ₹10,00,000 to ₹20,00,000/);
    expect(st().budget.total).toBe(1_000_000); // unchanged
    good(call('setTotalBudget', { total: 1_050_000 })); // under 10%: direct
    expect(st().budget.total).toBe(1_050_000);
    expect(call('setTotalBudget', { total: 2_000_000, confirmed: true }).ok).toBe(false); // a forged flag is just ignored
    expect(st().budget.total).toBe(1_050_000);
    const p = proposals.pending('w').find((x) => x.changes[0]!.from === '₹10,00,000')!; // the one written against the old total
    expect(proposals.confirm(store, 'w', p.id).ok).toBe(false); // stale: the total moved from the 1,000,000 it was written against
    good(call('setBudgetLimit', { category: 'decoration', amount: 200000 }));
    const lim = call('setBudgetLimit', { category: 'decoration', amount: 400000 });
    expect(!lim.ok && lim.proposal).toBeTruthy();
    expect(st().budget.limits.decoration).toBe(200000);
    good(call('setBudgetLimit', { category: 'decoration', amount: 150000 })); // lowering never needs approval
  });
  it('allocates by guideline (code) or custom, never beyond the total', () => {
    const { call, st } = setup();
    expect(call('allocateBudget', { mode: 'guideline' }).ok).toBe(false); // no total yet
    call('setTotalBudget', { total: 2_500_000 });
    good(call('allocateBudget', { mode: 'guideline' }));
    expect(Object.values(st().budget.allocations).reduce((a, b) => a + (b ?? 0), 0)).toBe(2_500_000);
    expect(call('allocateBudget', { mode: 'custom', allocations: { venue: 9_000_000 }, confirmed: true }).ok).toBe(false);
    good(call('addExpense', { category: 'venue', label: 'Advance', amount: 100000 }));
    const f = good(call('checkBudgetFeasibility', { category: 'venue', additionalCost: 500000 }));
    expect(f.projectedInr).toBe(600000);
    expect(f.withinConstraint).toBe(false); // venue allocation is 5,00,000
  });
});

describe('demo planner: real tool calls through the shared executor', () => {
  it('A. "Add a traditional mandap on the wedding stage" adds the stage first, then the mandap on it', async () => {
    const { say, of } = demo();
    const t = await say('Add a traditional mandap on the wedding stage.');
    expect(t.toolCalls.map((c) => `${c.name}:${(c.args as { assetId?: string }).assetId}`)).toEqual(['addDecoration:stage-wedding', 'addDecoration:mandap-traditional']);
    expect(t.toolCalls.every((c) => c.result.ok)).toBe(true);
    expect(of('mandap-traditional')[0]!.mount).toBe('stage');
    expect(t.reply).toContain('Added Traditional mandap on the stage');
  });
  it('B. "Make the flowers pink" changes only flower parts and says what it did', async () => {
    const { say, scene } = demo();
    await say('Add a traditional mandap on the wedding stage.');
    await say('Add 2 flower arrangements');
    const t = await say('Make the flowers pink.');
    expect(t.toolCalls.map((c) => c.name)).toEqual(['changeDecorationMaterial']);
    for (const o of scene()) {
      if (o.catalogId === 'stage-wedding') expect(o.colors).toEqual({});
      else expect(o.colors).toEqual({ flowers: '#ec7aa3' });
    }
  });
  it('D. "Move the mandap slightly to the left" moves it half a metre, respecting the rules', async () => {
    const { say, of } = demo();
    await say('Add a traditional mandap on the wedding stage.');
    const x0 = of('mandap-traditional')[0]!.position.x;
    const t = await say('Move the mandap slightly to the left.');
    expect(t.toolCalls[0]).toMatchObject({ name: 'moveDecoration', args: { direction: 'left', distance: 0.5 } });
    expect(of('mandap-traditional')[0]!.position.x).toBeCloseTo(x0 - 0.5, 3);
    const far = await say('Move the mandap 20 metres to the left');
    expect(far.reply).toMatch(/✗/); // would leave the stage
  });
  it('E. "Undo that change" restores the previous scene from shared history', async () => {
    const { say, of, scene } = demo();
    await say('Add a traditional mandap on the wedding stage.');
    const before = JSON.stringify(scene());
    await say('Move the mandap slightly to the left.');
    expect(JSON.stringify(scene())).not.toBe(before);
    const t = await say('Undo that change.');
    expect(t.toolCalls[0]).toMatchObject({ name: 'undoDecorationAction', args: { lastRequest: true } });
    expect(JSON.stringify(scene())).toBe(before);
    expect(of('mandap-traditional')).toHaveLength(1);
  });
  it('undoes a multi-step request as one unit', async () => {
    const { say, scene } = demo();
    await say('Add a traditional mandap on the wedding stage.'); // stage + mandap: 2 steps
    expect(scene()).toHaveLength(2);
    await say('Undo that change');
    expect(scene()).toHaveLength(0);
  });
  it('resolves "it" to what was just changed, and to the studio selection', async () => {
    const { say, of, scene } = demo();
    await say('Add 2 chairs');
    const [a, b] = of('chair-banquet');
    const ambiguous = await say('Move the chair left');
    expect(ambiguous.reply).toMatch(/2 chair/i);
    expect(ambiguous.toolCalls).toHaveLength(0);
    await say('Add a traditional mandap');
    const x0 = of('mandap-traditional')[0]!.position.x;
    await say('Move it right');
    expect(of('mandap-traditional')[0]!.position.x).toBeCloseTo(x0 + 1, 3); // "it" = the mandap just added; no distance word = 1 m
    const rot0 = b!.rotationY;
    await say('Rotate it', b!.id);
    expect(scene().find((o) => o.id === b!.id)!.rotationY).not.toBeCloseTo(rot0, 3);
    expect(scene().find((o) => o.id === a!.id)!.rotationY).toBeCloseTo(0, 3);
    await say('Rotate it', 'not-in-the-scene'); // a stale selection is ignored, "it" falls back to what changed last
  });
  it('"those flowers" only recolours what the planner just touched', async () => {
    const { say, of } = demo();
    await say('Add a traditional mandap');
    await say('Add 2 flower arrangements');
    await say('Make those flowers white');
    for (const o of of('flowers-centrepiece')) expect(o.colors.flowers).toBe('#fffdf2');
    expect(of('mandap-traditional')[0]!.colors).toEqual({});
  });
  it('runs compound requests clause by clause', async () => {
    const { say, of } = demo();
    await say('Add a traditional mandap');
    await say('Add 2 flower arrangements');
    const t = await say('Change the flowers to white and add more arrangements');
    expect(t.toolCalls.map((c) => c.name)).toEqual(['changeDecorationMaterial', 'addDecoration']);
    expect(of('flowers-centrepiece')).toHaveLength(4);
    expect(splitClauses('change the flowers to white and add more arrangements')).toHaveLength(2);
    expect(splitClauses('a red and gold mandap')).toHaveLength(1); // "and" inside a noun phrase is not a split
  });
  it('says plainly when it does not support a request, without calling any tool', async () => {
    const { say, scene } = demo();
    for (const msg of ['Book a photographer for the sangeet', 'Make it rain petals', 'Drape me in a silk saree']) {
      const t = await say(msg);
      expect(t.toolCalls).toHaveLength(0);
      expect(t.reply).toMatch(/does not support|✗/);
    }
    expect(scene()).toHaveLength(0);
  });
  it('reports a refused action honestly instead of pretending', async () => {
    const { say, scene } = demo();
    const t = await say('Move the mandap to the left');
    expect(t.reply).toMatch(/✗ There is no traditional mandap/i);
    expect(scene()).toHaveLength(0);
  });
  it('C. builds a traditional South Indian setup with gold mandap, white jasmine flowers and warm lighting', async () => {
    const { say, of, scene, st } = demo();
    const t = await say('Make this a traditional South Indian wedding with a gold mandap, white jasmine flowers and warm lighting.');
    expect(t.toolCalls.every((c) => c.result.ok)).toBe(true);
    expect(of('stage-wedding')).toHaveLength(1);
    expect(of('mandap-traditional')[0]).toMatchObject({ mount: 'stage', colors: { pillars: '#c9a227', canopy: '#c9a227', flowers: '#fffdf2' } });
    expect(of('flowers-centrepiece')).toHaveLength(2);
    expect(of('flowers-wall-panel')).toHaveLength(1);
    expect(of('chandelier-crystal')).toHaveLength(2);
    for (const o of [...of('chandelier-crystal'), ...of('lantern-floor')]) expect(o.colors.glow).toBe('#ffcf70');
    for (const o of of('arch-flower')) expect(o.colors.flowers).toBe('#fffdf2');
    expect(t.reply).toContain('sample prices');
    expect(t.reply).toMatch(/₹\d{1,3}(,\d\d)*,\d{3}/); // an estimate, in Indian grouping, from the budget tool
    expect(t.reply).toMatch(/global lighting control/);
    // tools of all three specialists were exercised in order: read budget, check assets, estimate, add, verify
    const names = t.toolCalls.map((c) => c.name);
    expect(names.slice(0, 3)).toEqual(['getBudgetSummary', 'listDecorationAssets', 'estimateDecorationCost']);
    expect(names.slice(-2)).toEqual(['listSceneDecorations', 'getBudgetSummary']);
    expect(st().rev).toBeGreaterThan(5);
  });
  it('re-running a theme only adds what is missing', async () => {
    const { say, scene } = demo();
    await say('Create a traditional South Indian wedding with a gold mandap');
    const n = scene().length;
    const t = await say('Create a traditional South Indian wedding with a gold mandap');
    expect(scene()).toHaveLength(n);
    expect(t.reply).toMatch(/already in the scene/);
  });
  it('5. "traditional setup but keep decoration below ₹2 lakhs" reads the budget, estimates, and leaves out what does not fit', async () => {
    const { say, scene, st } = demo();
    const t = await say('Create a traditional wedding setup with warm lighting but keep decoration costs below ₹2 lakhs');
    expect(st().budget.limits.decoration).toBe(200000);
    expect(sceneCost(scene())).toBeLessThanOrEqual(200000);
    expect(t.reply).toMatch(/Left out to stay within the limit/);
    expect(t.toolCalls[0]!.name).toBe('setBudgetLimit'); // the limit is applied before anything is built
    expect(t.toolCalls.some((c) => c.name === 'estimateDecorationCost')).toBe(true);
    expect(t.toolCalls.filter((c) => c.name === 'addDecoration' && !c.result.ok)).toHaveLength(0);
  });
  it('9. a limit set after the fact trims the scene, says what it removed, and can be undone', async () => {
    const { say, scene, st } = demo();
    await say('Create a traditional South Indian wedding with warm lighting');
    expect(sceneCost(scene())).toBeGreaterThan(200000);
    const t = await say('Keep the decoration budget below ₹2 lakhs.');
    expect(sceneCost(scene())).toBeLessThanOrEqual(200000);
    expect(t.reply).toMatch(/I removed/);
    expect(t.reply).toMatch(/undo/i);
    expect(scene().some((o) => o.catalogId === 'mandap-traditional')).toBe(true); // essentials stay
    await say('Undo that change');
    expect(sceneCost(scene())).toBeGreaterThan(200000);
    expect(st().budget.limits.decoration).toBe(200000); // the limit itself is not a scene change
  });
  it('proposes a significant limit raise instead of applying it, and typing "I confirm" in chat does nothing', async () => {
    const { say, st, planner } = demo();
    await say('Keep the decoration budget below ₹2 lakhs');
    const t = await say('Keep the decoration budget below ₹5 lakhs');
    expect(t.reply).toMatch(/Proposed: Raise the decoration limit from ₹2,00,000 to ₹5,00,000/);
    expect(t.reply).toMatch(/Nothing has changed yet/);
    expect(st().budget.limits.decoration).toBe(200000);
    for (const words of ['I confirm', 'yes, go ahead', 'Keep the decoration budget below ₹5 lakhs, I confirm', 'confirmed']) await say(words);
    expect(st().budget.limits.decoration).toBe(200000); // chat text can never confirm
    expect(planner.proposals.pending('w').length).toBeGreaterThan(0);
  });
  it('still handles the milestone-1 budget and wedding-detail requests through the specialists', async () => {
    const { say, st } = demo();
    await say('We are Aarav & Meera, 250 guests in Bengaluru on 14th February 2027');
    expect(st().profile).toMatchObject({ coupleNames: 'Aarav & Meera', guestCount: 250, city: 'Bengaluru', date: '2027-02-14' });
    await say('Our budget is 25 lakh, split it');
    expect(st().budget.total).toBe(2_500_000);
    expect(Object.values(st().budget.allocations).reduce((a, b) => a + (b ?? 0), 0)).toBe(2_500_000);
    const refused = await say('Book the Courtyard hall');
    expect(refused.reply).toContain('✗');
    expect(st().venueId).toBeNull();
  });
  it('saves and loads designs by name from chat', async () => {
    const { say, scene } = demo();
    await say('Add a traditional mandap on the wedding stage');
    await say('Save this design as Plan A');
    await say('Remove everything');
    expect(scene()).toHaveLength(0);
    await say('Load design Plan A');
    expect(scene()).toHaveLength(2);
  });
});

describe('live model path with a mocked provider', () => {
  type Body = { messages: { role: string; content: string }[]; tools: { function: { name: string } }[] };
  /** A scripted model: each entry is one round, either tool calls or a final answer. */
  function scripted(rounds: ({ tool: string; args: unknown }[] | string)[], seen: Body[] = []) {
    let i = 0;
    const create = (async (body: Body) => {
      seen.push(JSON.parse(JSON.stringify(body)));
      const r = rounds[Math.min(i++, rounds.length - 1)]!;
      return typeof r === 'string'
        ? { choices: [{ message: { role: 'assistant', content: r } }] }
        : { choices: [{ message: { role: 'assistant', content: null, tool_calls: r.map((c, k) => ({ id: `c${i}-${k}`, type: 'function', function: { name: c.tool, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args) } })) } }] };
    }) as unknown as ChatCreate;
    return { create, seen };
  }
  const live = (rounds: Parameters<typeof scripted>[0], seen?: Body[]) => {
    const store = new WeddingStore();
    const { create, seen: s } = scripted(rounds, seen);
    return { store, planner: new WeddingPlanner(store, { ...noKey, OPENAI_API_KEY: 'k' }, create), seen: s };
  };

  it('11. gives the model every tool schema and runs its sequential tool calls through the reducer', async () => {
    const { store, planner, seen } = live([
      [{ tool: 'getBudgetSummary', args: {} }],
      [{ tool: 'addDecoration', args: { assetId: 'stage-wedding' } }],
      [{ tool: 'addDecoration', args: { assetId: 'mandap-traditional', mount: 'stage' } }, { tool: 'changeDecorationMaterial', args: { allWithPart: true, part: 'flowers', color: 'pink' } }],
      'Done: a traditional mandap on the stage with pink flowers.',
    ]);
    const events: PlannerEvent[] = [];
    const t = await planner.chat('w', 'Add a traditional mandap on the stage with pink flowers', { onEvent: (e) => events.push(e) });
    expect(t.mode).toBe('llm');
    expect(t.reply).toMatch(/pink flowers/);
    expect(t.toolCalls.map((c) => c.name)).toEqual(['getBudgetSummary', 'addDecoration', 'addDecoration', 'changeDecorationMaterial']);
    const names = seen[0]!.tools.map((x) => x.function.name);
    for (const n of ['listDecorationAssets', 'addDecoration', 'undoDecorationAction', 'estimateDecorationCost', 'checkBudgetFeasibility']) expect(names).toContain(n);
    const scene = store.getOrCreate('w').scene.objects;
    expect(scene.find((o) => o.catalogId === 'mandap-traditional')).toMatchObject({ mount: 'stage', colors: { flowers: '#ec7aa3' } });
    // progress events: a start and an end per call, scene state delivered with each end, then done
    expect(events.filter((e) => e.type === 'tool_start')).toHaveLength(4);
    const ends = events.filter((e): e is Extract<PlannerEvent, { type: 'tool_end' }> => e.type === 'tool_end');
    expect(ends.map((e) => e.state.scene.objects.length)).toEqual([0, 1, 2, 2]);
    expect(events.at(-1)!.type).toBe('done');
  });
  it('the model sees the real scene and selection, and tool failures come back with hints', async () => {
    const { store, planner, seen } = live([[{ tool: 'moveDecoration', args: { id: 'made-up', direction: 'left' } }], 'I could not find that.']);
    store.getOrCreate('w');
    store.dispatch('w', { type: 'add_decor', id: 'real1', catalogId: 'chair-banquet' });
    await planner.chat('w', 'move it left', { selectedId: 'real1' });
    const sys = seen[0]!.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    expect(sys).toContain('SELECTED IN STUDIO: real1');
    expect(sys).toContain('real1: Chair');
    const toolMsg = seen[1]!.messages.find((m) => m.role === 'tool')!.content;
    expect(toolMsg).toContain('"ok":false');
    expect(toolMsg).toContain('real1'); // the hint lists the actual ids
  });
  it('12. cannot bypass the reducer: bad arguments, unknown tools, forged flags and over-limit adds all change nothing', async () => {
    const { store, planner } = live([
      [{ tool: 'addDecoration', args: '{not json' }, { tool: 'set_decor_color', args: { id: 'x' } }, { tool: 'addDecoration', args: { assetId: 'mandap-traditional', mount: 'wall' } }],
      [{ tool: 'setBudgetLimit', args: { category: 'decoration', amount: 50000 } }, { tool: 'addDecoration', args: { assetId: 'stage-wedding', acceptOverBudget: true } }],
      'Nothing changed.',
    ]);
    const t = await planner.chat('w', 'hack it');
    const results = t.toolCalls.map((c) => c.result.ok);
    expect(results).toEqual([false, false, false, true, false]);
    expect(store.getOrCreate('w').scene.objects).toHaveLength(0);
    expect(store.dispatch('w', { type: 'add_decor', id: 'q', catalogId: 'stage-wedding' }).ok).toBe(false);
  });
  it('a refused action does not advance the revision; an accepted one advances it by one per action', async () => {
    const { store, planner } = live([[{ tool: 'addDecoration', args: { assetId: 'chair-banquet' } }], [{ tool: 'moveDecoration', args: { id: 'nope', x: 1, z: 1 } }], 'ok']);
    const t = await planner.chat('w', 'x');
    expect(t.toolCalls.map((c) => c.result.ok)).toEqual([true, false]);
    expect(store.getOrCreate('w').rev).toBe(1);
  });
  it('keeps what it needs between messages: "undo that" in live mode targets the whole previous request', async () => {
    const { store, planner } = live([
      [{ tool: 'addDecoration', args: { assetId: 'stage-wedding' } }, { tool: 'addDecoration', args: { assetId: 'mandap-traditional', mount: 'stage' } }], 'Added.',
      [{ tool: 'undoDecorationAction', args: { lastRequest: true } }], 'Undone.',
    ]);
    await planner.chat('w', 'build it');
    expect(store.getOrCreate('w').scene.objects).toHaveLength(2);
    await planner.chat('w', 'undo that');
    expect(store.getOrCreate('w').scene.objects).toHaveLength(0);
  });
  it('after a hand edit, "undo that" undoes only the latest change and says why', async () => {
    const { store, planner } = live([
      [{ tool: 'addDecoration', args: { assetId: 'stage-wedding' } }, { tool: 'addDecoration', args: { assetId: 'mandap-traditional', mount: 'stage' } }], 'Added.',
      [{ tool: 'undoDecorationAction', args: { lastRequest: true } }], 'Undone.',
    ]);
    await planner.chat('w', 'build it');
    store.dispatch('w', { type: 'add_decor', id: 'byhand', catalogId: 'chair-banquet' }); // customer edits in the studio
    const t = await planner.chat('w', 'undo that');
    expect(store.getOrCreate('w').scene.objects.map((o) => o.id)).not.toContain('byhand');
    expect(store.getOrCreate('w').scene.objects).toHaveLength(2);
    expect(JSON.stringify(t.toolCalls[0]!.result)).toMatch(/only the most recent change/);
  });
  it('a provider failure is reported, not hidden', async () => {
    const store = new WeddingStore();
    const planner = new WeddingPlanner(store, { ...noKey, OPENAI_API_KEY: 'k' }, (async () => { throw new Error('upstream 500'); }) as unknown as ChatCreate);
    await expect(planner.chat('w', 'hi')).rejects.toThrow(/could not reach the AI provider/);
  });
});

describe('chat over http', () => {
  async function app() {
    return buildApp(await toolTestContext(), { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: null, create: null } });
  }
  it('streams tool progress as ndjson, ending with the final scene', async () => {
    const a = await app();
    const r = await a.inject({ method: 'POST', url: '/api/wedding/s1/chat', payload: { message: 'Add a traditional mandap on the wedding stage', stream: true } });
    expect(r.headers['content-type']).toMatch(/ndjson/);
    const lines = r.body.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(['tool_start', 'tool_end', 'tool_start', 'tool_end', 'done']);
    expect(lines[0].label).toMatch(/Adding/);
    expect(lines.at(-1).turn.state.scene.objects).toHaveLength(2);
    expect((await a.inject({ url: '/api/wedding/s1' })).json().state.scene.objects).toHaveLength(2);
    await a.close();
  });
  it('accepts the studio selection, validates it, and still returns plain JSON when not streaming', async () => {
    const a = await app();
    await a.inject({ method: 'POST', url: '/api/wedding/s2/chat', payload: { message: 'Add 2 chairs' } });
    const state = (await a.inject({ url: '/api/wedding/s2' })).json().state;
    const [c1] = state.scene.objects;
    const r = await a.inject({ method: 'POST', url: '/api/wedding/s2/chat', payload: { message: 'Rotate it', selectedId: c1.id } });
    expect(r.json().toolCalls[0].name).toBe('rotateDecoration');
    expect(r.json().state.scene.objects.find((o: { id: string }) => o.id === c1.id).rotationY).not.toBe(0);
    const bad = await a.inject({ method: 'POST', url: '/api/wedding/s2/chat', payload: { message: 'Rotate it', selectedId: 'x'.repeat(80) } });
    expect(bad.statusCode).toBe(400);
    await a.close();
  });
  it('a browser still cannot send server-only actions, and the limit applies to its adds too', async () => {
    const a = await app();
    const post = (payload: object) => a.inject({ method: 'POST', url: '/api/wedding/s3/actions', payload });
    expect((await post({ type: 'reset_to_sample' })).statusCode).toBe(403);
    await post({ type: 'set_budget_limit', category: 'decoration', amount: 50000 });
    const r = await post({ type: 'add_decor', id: 'a1', catalogId: 'stage-wedding' });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toMatch(/limit/);
    await a.close();
  });
});

describe('the four-message acceptance conversation', () => {
  it('builds the setup, recolours and adds, applies the 2 lakh limit, then undoes it', async () => {
    const { say, scene, of, st } = demo();

    const t1 = await say('Create a traditional South Indian wedding with a gold mandap and yellow flowers.');
    expect(t1.toolCalls.every((c) => c.result.ok)).toBe(true);
    expect(of('mandap-traditional')[0]!.colors).toMatchObject({ pillars: '#c9a227', canopy: '#c9a227', flowers: '#ffd23f' });
    expect(of('flowers-centrepiece')).toHaveLength(2);
    const afterFirst = JSON.stringify(scene());

    const t2 = await say('Change the flowers to white and add more arrangements.');
    expect(t2.toolCalls.map((c) => c.name)).toEqual(['changeDecorationMaterial', 'addDecoration']);
    expect(of('flowers-centrepiece')).toHaveLength(4);
    for (const o of scene().filter((x) => ['flowers-centrepiece', 'mandap-traditional', 'arch-flower', 'flowers-wall-panel'].includes(x.catalogId))) expect(o.colors.flowers).toBe('#fffdf2');
    expect(of('mandap-traditional')[0]!.colors.pillars).toBe('#c9a227'); // untouched
    for (const o of of('flowers-centrepiece')) expect(o.colors.flowers).toBe('#fffdf2'); // the new arrangements match
    const afterSecond = JSON.stringify(scene());
    expect(afterSecond).not.toBe(afterFirst);
    const costBefore = sceneCost(scene());
    expect(costBefore).toBeGreaterThan(200000);

    const t3 = await say('Keep the decoration budget below ₹2 lakhs.');
    expect(st().budget.limits.decoration).toBe(200000);
    expect(t3.toolCalls.map((c) => c.name)).toEqual(['setBudgetLimit', 'estimateDecorationCost', 'removeDecoration']);
    expect(sceneCost(scene())).toBeLessThanOrEqual(200000);
    expect(t3.reply).toMatch(/₹2,00,000/);

    const t4 = await say('Undo the last change.');
    expect(t4.toolCalls[0]!.name).toBe('undoDecorationAction');
    expect(JSON.stringify(scene())).toBe(afterSecond); // the previous valid scene, exactly
  });
});

void applyWeddingAction;
