import { describe, expect, it } from 'vitest';
import type { WeddingAction } from '@ave/shared';
import type { ChatCreate } from '../agent/sim.js';
import { toolTestContext } from '../tools/testkit.js';
import { buildApp } from '../app.js';
import { TOOL_NAMES, runWeddingTool } from './orchestrator.js';
import { WeddingPlanner, providerError, redactSecrets } from './planner.js';
import { MAX_PENDING_PER_WEDDING, PROPOSAL_TTL_MS, ProposalStore } from './proposals.js';
import { VendorStore } from './vendor-store.js';
import { WeddingStore } from './store.js';
import { newSession, type ToolContext } from './toolkit.js';

/** A workspace with a controllable clock, so expiry is tested without waiting. */
function rig() {
  let now = 1_000_000;
  const store = new WeddingStore();
  const proposals = new ProposalStore({ now: () => now });
  const mk = (weddingId: string): ToolContext => ({ store, vendors: new VendorStore(), proposals, weddingId, session: newSession() });
  const tool = (weddingId: string, name: string, input: unknown) => runWeddingTool(mk(weddingId), name, input);
  /** A proposal to change the total from 10 lakh to 20 lakh in workspace `w`. */
  const raise = (weddingId = 'w') => {
    tool(weddingId, 'setTotalBudget', { total: 1_000_000 });
    const r = tool(weddingId, 'setTotalBudget', { total: 2_000_000 });
    if (r.ok || !r.proposal) throw new Error('expected a proposal');
    return r.proposal;
  };
  return { store, proposals, tool, raise, tick: (ms: number) => { now += ms; }, total: (w = 'w') => store.getOrCreate(w).budget.total };
}

describe('proposal workflow', () => {
  it('creates a proposal that changes nothing, with the human-readable change and an expiry', () => {
    const { raise, total, proposals } = rig();
    const p = raise();
    expect(total()).toBe(1_000_000);
    expect(p.status).toBe('pending');
    expect(p.changes).toEqual([{ label: 'Total budget', from: '₹10,00,000', to: '₹20,00,000' }]);
    expect(p.expiresAt).toBe(1_000_000 + PROPOSAL_TTL_MS);
    expect(proposals.pending('w').map((x) => x.id)).toEqual([p.id]);
    expect(JSON.stringify(p)).not.toMatch(/set_total_budget/); // the stored action is never exposed
  });

  it('confirming applies exactly the proposed action, once, through the reducer', () => {
    const { raise, total, proposals, store } = rig();
    const p = raise();
    const rev = store.getOrCreate('w').rev;
    const r = proposals.confirm(store, 'w', p.id);
    expect(r.ok).toBe(true);
    expect(total()).toBe(2_000_000);
    expect(store.getOrCreate('w').rev).toBe(rev + 1); // one validated action, revision advanced
    expect(proposals.pending('w')).toHaveLength(0);
  });

  it('REPLAY: a second confirm is refused and changes nothing', () => {
    const { raise, total, proposals, store } = rig();
    const p = raise();
    expect(proposals.confirm(store, 'w', p.id).ok).toBe(true);
    store.dispatch('w', { type: 'set_total_budget', total: 1_500_000 }); // the customer later changes it by hand
    const again = proposals.confirm(store, 'w', p.id);
    expect(again).toMatchObject({ ok: false, status: 409, code: 'already_used' });
    expect(total()).toBe(1_500_000); // not re-applied
  });

  it('CANCELLED: a cancelled proposal can never be confirmed', () => {
    const { raise, total, proposals, store } = rig();
    const p = raise();
    expect(proposals.cancel('w', p.id).ok).toBe(true);
    expect(proposals.confirm(store, 'w', p.id)).toMatchObject({ ok: false, status: 409, code: 'cancelled' });
    expect(proposals.cancel('w', p.id)).toMatchObject({ ok: false, code: 'cancelled' });
    expect(total()).toBe(1_000_000);
    expect(proposals.pending('w')).toHaveLength(0);
  });

  it('WORKSPACE MISMATCH: another workspace cannot confirm or cancel it, and cannot tell it exists', () => {
    const { raise, total, proposals, store } = rig();
    const p = raise('A');
    store.getOrCreate('B');
    expect(proposals.confirm(store, 'B', p.id)).toMatchObject({ ok: false, status: 404, code: 'not_found' });
    expect(proposals.cancel('B', p.id)).toMatchObject({ ok: false, status: 404 });
    expect(proposals.confirm(store, 'B', 'a-made-up-id')).toMatchObject({ ok: false, status: 404 });
    expect(proposals.pending('B')).toHaveLength(0);
    expect(total('A')).toBe(1_000_000);
    expect(total('B')).toBe(0);
    expect(proposals.confirm(store, 'A', p.id).ok).toBe(true); // the owner still can
  });

  it('EXPIRED: a proposal is refused after its time is up, even if never touched', () => {
    const { raise, total, proposals, store, tick } = rig();
    const p = raise();
    tick(PROPOSAL_TTL_MS + 1);
    expect(proposals.pending('w')).toHaveLength(0);
    expect(proposals.confirm(store, 'w', p.id)).toMatchObject({ ok: false, status: 410, code: 'expired' });
    expect(total()).toBe(1_000_000);
  });

  it('is still valid right up to the deadline', () => {
    const { raise, total, proposals, store, tick } = rig();
    const p = raise();
    tick(PROPOSAL_TTL_MS);
    expect(proposals.confirm(store, 'w', p.id).ok).toBe(true);
    expect(total()).toBe(2_000_000);
  });

  it('MODIFIED: a stored action that was altered fails its integrity check and is discarded', () => {
    const { raise, total, proposals, store } = rig();
    const p = raise();
    proposals._tamperForTest(p.id, { type: 'set_total_budget', total: 999_999_999 } as WeddingAction);
    expect(proposals.confirm(store, 'w', p.id)).toMatchObject({ ok: false, status: 409, code: 'tampered' });
    expect(total()).toBe(1_000_000);
    expect(proposals.confirm(store, 'w', p.id)).toMatchObject({ ok: false, code: 'already_used' }); // discarded, not retryable
  });

  it('MODIFIED: if the wedding changed since the proposal was written, it is stale and discarded', () => {
    const { raise, total, proposals, store } = rig();
    const p = raise();
    store.dispatch('w', { type: 'set_total_budget', total: 1_200_000 });
    expect(proposals.confirm(store, 'w', p.id)).toMatchObject({ ok: false, status: 409, code: 'stale' });
    expect(total()).toBe(1_200_000);
  });

  it('the reducer still has the last word: a proposal that has become invalid is rejected, not forced', () => {
    const { tool, proposals, store } = rig();
    tool('w', 'setTotalBudget', { total: 1_000_000 });
    tool('w', 'allocateBudget', { mode: 'custom', allocations: { venue: 900_000 } });
    const lower = tool('w', 'setTotalBudget', { total: 500_000 }); // below what is allocated; also a big change
    expect(!lower.ok && lower.proposal).toBeTruthy();
    const p = !lower.ok ? lower.proposal! : undefined;
    expect(proposals.confirm(store, 'w', p!.id)).toMatchObject({ ok: false, status: 422, code: 'rejected' });
    expect(store.getOrCreate('w').budget.total).toBe(1_000_000);
  });

  it('identical proposals are not duplicated, and the number pending is capped', () => {
    const { tool, proposals } = rig();
    tool('w', 'setTotalBudget', { total: 1_000_000 });
    const a = tool('w', 'setTotalBudget', { total: 3_000_000 });
    const b = tool('w', 'setTotalBudget', { total: 3_000_000 });
    expect(!a.ok && !b.ok && a.proposal!.id === b.proposal!.id).toBe(true);
    expect(proposals.pending('w')).toHaveLength(1);
    for (let k = 0; k < MAX_PENDING_PER_WEDDING + 3; k++) tool('w', 'setTotalBudget', { total: 4_000_000 + k * 100_000 });
    expect(proposals.pending('w').length).toBeLessThanOrEqual(MAX_PENDING_PER_WEDDING);
    const over = tool('w', 'setTotalBudget', { total: 9_000_000 });
    expect(!over.ok && over.error).toMatch(/too many proposals/);
  });

  it('over-limit decoration proposals apply the exact items that were proposed, and can be undone', () => {
    const { tool, proposals, store } = rig();
    tool('w', 'setBudgetLimit', { category: 'decoration', amount: 70_000 });
    tool('w', 'addDecoration', { assetId: 'stage-wedding' });
    const r = tool('w', 'addDecoration', { assetId: 'flowers-centrepiece', quantity: 2, colors: { flowers: 'pink' } });
    expect(!r.ok && r.proposal).toBeTruthy();
    expect(store.getOrCreate('w').scene.objects).toHaveLength(1);
    const p = !r.ok ? r.proposal! : undefined;
    expect(proposals.confirm(store, 'w', p!.id).ok).toBe(true);
    const objs = store.getOrCreate('w').scene.objects;
    expect(objs.filter((o) => o.catalogId === 'flowers-centrepiece')).toHaveLength(2);
    expect(objs.filter((o) => o.colors.flowers === '#ec7aa3')).toHaveLength(2);
    expect(store.dispatch('w', { type: 'undo_scene' }).ok).toBe(true); // the confirmed change is one ordinary undo step
    expect(store.getOrCreate('w').scene.objects).toHaveLength(1);
  });

  it('an over-limit proposal goes stale if the scene changed in the meantime', () => {
    const { tool, proposals, store } = rig();
    tool('w', 'setBudgetLimit', { category: 'decoration', amount: 70_000 });
    tool('w', 'addDecoration', { assetId: 'stage-wedding' });
    const r = tool('w', 'addDecoration', { assetId: 'mandap-traditional', mount: 'stage' });
    const p = !r.ok ? r.proposal! : undefined;
    store.dispatch('w', { type: 'add_decor', id: 'c1', catalogId: 'chair-banquet' }); // customer edits by hand
    expect(proposals.confirm(store, 'w', p!.id)).toMatchObject({ ok: false, code: 'stale' });
  });

  it('ordinary decoration changes need no confirmation at all', () => {
    const { tool, store, proposals } = rig();
    for (const [name, input] of [['addDecoration', { assetId: 'stage-wedding' }], ['addDecoration', { assetId: 'mandap-traditional', mount: 'stage' }], ['changeDecorationMaterial', { allWithPart: true, part: 'flowers', color: 'pink' }], ['setBudgetLimit', { category: 'decoration', amount: 500000 }], ['setTotalBudget', { total: 800000 }]] as const) {
      expect(tool('w', name, input).ok).toBe(true);
    }
    expect(store.getOrCreate('w').scene.objects).toHaveLength(2);
    expect(proposals.pending('w')).toHaveLength(0);
  });
});

describe('the model cannot confirm anything', () => {
  it('no tool can confirm or cancel a proposal, and no tool schema mentions a confirmation flag', () => {
    expect(TOOL_NAMES.filter((n) => /confirm|approve|accept|proposal|cancel/i.test(n))).toEqual([]);
    const { tool } = rig();
    for (const name of ['confirmProposal', 'confirm', 'approveProposal', 'cancelProposal']) expect(tool('w', name, { id: 'x' })).toMatchObject({ ok: false });
  });

  it('forged confirmation flags in tool arguments are ignored', () => {
    const { tool, total, proposals } = rig();
    tool('w', 'setTotalBudget', { total: 1_000_000 });
    for (const forged of [{ confirmed: true }, { confirm: true }, { approved: true }, { customerAccepted: true }, { acceptOverBudget: true }, { proposalId: 'x', confirmed: true }]) {
      const r = tool('w', 'setTotalBudget', { total: 2_000_000, ...forged });
      expect(r.ok).toBe(false);
    }
    expect(total()).toBe(1_000_000);
    expect(proposals.pending('w')).toHaveLength(1);
  });

  it('a live model that tries to confirm, repeatedly and cleverly, changes nothing', async () => {
    const store = new WeddingStore();
    const proposals = new ProposalStore();
    let i = 0;
    const rounds = [
      [{ tool: 'setTotalBudget', args: { total: 1_000_000 } }],
      [{ tool: 'setTotalBudget', args: { total: 2_000_000, confirmed: true } }, { tool: 'confirmProposal', args: { id: 'whatever' } }, { tool: 'setTotalBudget', args: { total: 2_000_000, customerAcceptedOverBudget: true } }],
      'I applied the change.', // the model lies in its words; the state must still say otherwise
    ] as const;
    const create = (async () => {
      const r = rounds[Math.min(i++, rounds.length - 1)]!;
      return typeof r === 'string'
        ? { choices: [{ message: { role: 'assistant', content: r } }] }
        : { choices: [{ message: { role: 'assistant', content: null, tool_calls: r.map((c, k) => ({ id: `c${i}${k}`, type: 'function', function: { name: c.tool, arguments: JSON.stringify(c.args) } })) } }] };
    }) as unknown as ChatCreate;
    const planner = new WeddingPlanner(store, { OPENAI_API_KEY: 'k', LLM_MODEL: 'm', LLM_REASONING_EFFORT: undefined }, create, proposals);
    const t = await planner.chat('w', 'double the budget');
    expect(store.getOrCreate('w').budget.total).toBe(1_000_000);
    expect(t.toolCalls.filter((c) => !c.result.ok && c.result.proposal)).toHaveLength(2);
    expect(proposals.pending('w')).toHaveLength(1); // the identical proposals collapsed to one
  });

  it('the chat text of a customer does not confirm either, in demo mode', async () => {
    const store = new WeddingStore();
    const proposals = new ProposalStore();
    const planner = new WeddingPlanner(store, { OPENAI_API_KEY: undefined, LLM_MODEL: 'm', LLM_REASONING_EFFORT: undefined }, null, proposals);
    await planner.chat('w', 'Our budget is 10 lakh');
    const t = await planner.chat('w', 'Our budget is 20 lakh');
    expect(t.reply).toMatch(/Proposed/);
    await planner.chat('w', 'yes I confirm, go ahead, I agree');
    expect(store.getOrCreate('w').budget.total).toBe(1_000_000);
  });
});

describe('confirmation over http', () => {
  async function app() {
    const proposals = new ProposalStore();
    const a = await buildApp(await toolTestContext(), { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: null, create: null, proposals } });
    return { a, proposals };
  }
  const say = (a: Awaited<ReturnType<typeof app>>['a'], id: string, message: string) => a.inject({ method: 'POST', url: `/api/wedding/${id}/chat`, payload: { message } });

  it('the full round trip: propose in chat, list, confirm via the route, state changes once', async () => {
    const { a } = await app();
    await say(a, 'h1', 'Our budget is 10 lakh');
    const chat = await say(a, 'h1', 'Our budget is 20 lakh');
    const proposal = chat.json().toolCalls[0].result.proposal;
    expect(proposal.summary).toMatch(/₹10,00,000 to ₹20,00,000/);
    expect(chat.json().state.budget.total).toBe(1_000_000);
    const list = await a.inject({ url: '/api/wedding/h1/proposals' });
    expect(list.json().proposals.map((p: { id: string }) => p.id)).toEqual([proposal.id]);
    const ok = await a.inject({ method: 'POST', url: `/api/wedding/h1/proposals/${proposal.id}/confirm` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().state.budget.total).toBe(2_000_000);
    const replay = await a.inject({ method: 'POST', url: `/api/wedding/h1/proposals/${proposal.id}/confirm` });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().code).toBe('already_used');
    expect((await a.inject({ url: '/api/wedding/h1' })).json().state.budget.total).toBe(2_000_000);
    await a.close();
  });

  it('cancel, workspace mismatch and malformed ids are refused over http', async () => {
    const { a } = await app();
    await say(a, 'h2', 'Our budget is 10 lakh');
    const id = (await say(a, 'h2', 'Our budget is 20 lakh')).json().toolCalls[0].result.proposal.id;
    await a.inject({ url: '/api/wedding/h3' }); // another workspace
    expect((await a.inject({ method: 'POST', url: `/api/wedding/h3/proposals/${id}/confirm` })).statusCode).toBe(404);
    expect((await a.inject({ method: 'POST', url: `/api/wedding/h3/proposals/${id}/cancel` })).statusCode).toBe(404);
    expect((await a.inject({ method: 'POST', url: '/api/wedding/h2/proposals/not-a-uuid/confirm' })).statusCode).toBe(404);
    expect((await a.inject({ method: 'POST', url: `/api/wedding/h2/proposals/${id}/cancel` })).statusCode).toBe(200);
    const after = await a.inject({ method: 'POST', url: `/api/wedding/h2/proposals/${id}/confirm` });
    expect(after.statusCode).toBe(409);
    expect(after.json().code).toBe('cancelled');
    expect((await a.inject({ url: '/api/wedding/h2' })).json().state.budget.total).toBe(1_000_000);
    expect((await a.inject({ url: '/api/wedding/h2/proposals' })).json().proposals).toEqual([]);
    await a.close();
  });

  it('expiry is enforced over http', async () => {
    let now = 5_000_000;
    const proposals = new ProposalStore({ now: () => now });
    const a = await buildApp(await toolTestContext(), { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: null, create: null, proposals } });
    await say(a, 'h4', 'Our budget is 10 lakh');
    const id = (await say(a, 'h4', 'Our budget is 20 lakh')).json().toolCalls[0].result.proposal.id;
    now += PROPOSAL_TTL_MS + 1;
    const r = await a.inject({ method: 'POST', url: `/api/wedding/h4/proposals/${id}/confirm` });
    expect(r.statusCode).toBe(410);
    expect(r.json().code).toBe('expired');
    await a.close();
  });

  it('confirmation is not reachable through the generic actions route or any action a browser can post', async () => {
    const { a } = await app();
    const r = await a.inject({ method: 'POST', url: '/api/wedding/h5/actions', payload: { type: 'confirm_proposal', id: 'x' } });
    expect(r.statusCode).toBe(400);
  });
});

describe('provider errors never leak the key', () => {
  it('maps provider failures to safe messages without quoting the provider', () => {
    const leak = Object.assign(new Error('401 Incorrect API key provided: sk-proj-abcdEFGH1234. You can find your API key at ...'), { status: 401 });
    const e = providerError(leak);
    expect(e.message).not.toMatch(/sk-|abcd|1234/);
    expect(e.message).toMatch(/credentials/);
    expect(providerError(Object.assign(new Error('x'), { status: 429 })).status).toBe(503);
    expect(providerError(Object.assign(new Error('x'), { status: 500 })).message).toMatch(/trouble/);
    expect(providerError(Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' })).status).toBe(504);
    expect(providerError(new Error('ECONNREFUSED sk-secret-value-123')).message).not.toMatch(/sk-/);
  });
  it('redacts key-shaped text and bearer tokens', () => {
    expect(redactSecrets('failed with sk-proj-AbC123_xyz-9 and Bearer abc.def-ghi')).toBe('failed with [redacted-key] and Bearer [redacted]');
    expect(redactSecrets('nothing secret here')).toBe('nothing secret here');
  });
  it('a failing provider reaches the customer as a generic message, not the raw error', async () => {
    const create = (async () => { throw Object.assign(new Error('Incorrect API key provided: sk-live-ZZZZZZZZZZ'), { status: 401 }); }) as unknown as ChatCreate;
    const a = await buildApp(await toolTestContext(), { logger: false, desk: { dbPath: ':memory:' }, wedding: { dir: null, create } });
    const r = await a.inject({ method: 'POST', url: '/api/wedding/p1/chat', payload: { message: 'hi' } });
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toMatch(/sk-|ZZZZ/);
    const s = await a.inject({ method: 'POST', url: '/api/wedding/p1/chat', payload: { message: 'hi', stream: true } });
    expect(s.body).not.toMatch(/sk-|ZZZZ/);
    expect(s.body).toMatch(/"type":"error"/);
    await a.close();
  });
});
