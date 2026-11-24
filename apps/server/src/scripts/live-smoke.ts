/**
 * Live-model smoke test for the wedding planner.
 *
 *   pnpm --filter @ave/server wedding:smoke            real provider; needs OPENAI_API_KEY (server-side, from .env or the shell)
 *   pnpm --filter @ave/server wedding:smoke --mock     scripted provider; checks this harness only. NEVER a live result.
 *
 * It runs five requests in order against a dedicated, seeded in-memory workspace, checks the real WeddingState after each,
 * and writes a report (no secrets) to apps/server/var/live-smoke-<time>.json. Exit codes: 0 all checks passed,
 * 1 a check failed, 2 not run (no key). A run is "live" only when a real provider call was actually made.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DECOR_CATALOG, findEntry, formatInr, sceneCost, type DecorObject, type WeddingState } from '@ave/shared';
import { openAiChat, type ChatCreate } from '../agent/sim.js';
import { VAR_DIR, loadConfig } from '../config.js';
import { WeddingPlanner, redactSecrets, type PlannerTurn } from '../wedding/planner.js';
import { ProposalStore } from '../wedding/proposals.js';
import { WeddingStore } from '../wedding/store.js';

const mock = process.argv.includes('--mock');
const config = loadConfig();
const hasKey = Boolean(config.OPENAI_API_KEY);

if (!mock && !hasKey) {
  console.log('LIVE TEST NOT RUN: OPENAI_API_KEY is not set on the server (.env or shell).\nNothing was sent to any provider. Use --mock to check this harness with a scripted provider (that is not a live test).');
  process.exit(2);
}

// ---- the provider, wrapped to record what a live call really did ---------------------------------------------------

interface CallRecord { ms: number; promptTokens?: number; completionTokens?: number; totalTokens?: number; model?: string; toolCallsReturned: number; error?: string }
const calls: CallRecord[] = [];

function scripted(): ChatCreate {
  // Scripted answers for the five requests, in order. This exists only to test the harness.
  const script: ({ tool: string; args: unknown }[] | string | (() => string))[] = [
    [{ tool: 'listDecorationAssets', args: {} }], 'You can add a traditional or modern mandap, a wedding stage, a flower arch, chairs, sofas, chandeliers and more.',
    [{ tool: 'changeDecorationMaterial', args: { allWithPart: true, part: 'flowers', color: 'white' } }], 'Flowers are white.',
    [{ tool: 'addDecoration', args: { assetId: 'mandap-modern' } }, { tool: 'addDecoration', args: { assetId: 'flowers-centrepiece', quantity: 2 } }], 'Added.',
    [{ tool: 'estimateDecorationCost', args: { limit: 200000 } }], () => `The decoration estimate is ${formatInr(sceneCost(scene()))}, which is ${sceneCost(scene()) <= 200000 ? 'within' : 'over'} the ₹2,00,000 limit.`,
    [{ tool: 'undoDecorationAction', args: { lastRequest: true } }], 'Undone.',
  ];
  let i = 0;
  return (async () => {
    const r = script[Math.min(i++, script.length - 1)]!;
    return typeof r === 'string' || typeof r === 'function'
      ? { model: 'mock', usage: undefined, choices: [{ message: { role: 'assistant', content: typeof r === 'function' ? r() : r } }] }
      : { model: 'mock', usage: undefined, choices: [{ message: { role: 'assistant', content: null, tool_calls: r.map((c, k) => ({ id: `m${i}${k}`, type: 'function', function: { name: c.tool, arguments: JSON.stringify(c.args) } })) } }] };
  }) as unknown as ChatCreate;
}

const real = mock ? null : openAiChat(config);
const base: ChatCreate = mock ? scripted() : real!;
const recording: ChatCreate = async (body, opts) => {
  const t0 = performance.now();
  try {
    const res = await base(body, opts);
    const u = (res as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage;
    calls.push({ ms: Math.round(performance.now() - t0), promptTokens: u?.prompt_tokens, completionTokens: u?.completion_tokens, totalTokens: u?.total_tokens, model: (res as { model?: string }).model, toolCallsReturned: res.choices[0]?.message?.tool_calls?.length ?? 0 });
    return res;
  } catch (err) {
    calls.push({ ms: Math.round(performance.now() - t0), toolCallsReturned: 0, error: redactSecrets(`${(err as { status?: number }).status ?? ''} ${(err as Error).message}`.trim()) });
    throw err;
  }
};

// ---- the workspace and the five requests -----------------------------------------------------------------------------

const store = new WeddingStore(); // in memory: nothing is written to any real wedding
const proposals = new ProposalStore();
const planner = new WeddingPlanner(store, config, recording, proposals);
const ID = 'live-smoke';
const st = (): WeddingState => store.getOrCreate(ID);
const scene = (): DecorObject[] => st().scene.objects;

// Fixture: a small, known starting scene, so "change the flowers" has flowers to change.
store.getOrCreate(ID);
for (const a of [
  { type: 'add_decors', items: [{ id: 'fx-stage', catalogId: 'stage-wedding', x: 12, z: 4 }] },
  { type: 'add_decors', items: [{ id: 'fx-mandap', catalogId: 'mandap-traditional', mount: 'stage' }, { id: 'fx-arr', catalogId: 'flowers-centrepiece', x: 6, z: 12 }] },
] as const) if (!store.dispatch(ID, a).ok) throw new Error('fixture failed');

interface Check { name: string; pass: boolean; detail?: string }
interface Step { request: string; expect: string; run: (before: DecorObject[], beforeRev: number, turn: PlannerTurn) => Check[] }

const isWhite = (hex?: string) => !!hex && /^#[0-9a-f]{6}$/i.test(hex) && [1, 3, 5].every((i) => parseInt(hex.slice(i, i + 2), 16) >= 0xe8);
const has = (t: PlannerTurn, name: string) => t.toolCalls.some((c) => c.name === name);
const order = (t: PlannerTurn) => t.toolCalls.map((c) => c.name);
const digits = (s: string) => s.replace(/[^0-9]/g, '');
const sameScene = (a: DecorObject[], b: DecorObject[]) => JSON.stringify(a) === JSON.stringify(b);
const flowerObjs = (o: DecorObject[]) => o.filter((x) => findEntry(DECOR_CATALOG, x.catalogId)?.parts.some((p) => p.id === 'flowers'));

let afterRequest2: DecorObject[] = [];
const steps: Step[] = [
  {
    request: 'What decorations can I add?',
    expect: 'calls listDecorationAssets; changes nothing; reply names real catalogue items',
    run: (before, rev, t) => [
      { name: 'selected listDecorationAssets', pass: has(t, 'listDecorationAssets'), detail: order(t).join(' → ') },
      { name: 'scene unchanged', pass: sameScene(before, scene()) },
      { name: 'revision unchanged (nothing written)', pass: st().rev === rev },
      { name: 'reply mentions real catalogue items', pass: ['mandap', 'chair', 'stage'].filter((w) => t.reply.toLowerCase().includes(w)).length >= 2, detail: t.reply.slice(0, 120) },
    ],
  },
  {
    request: 'Change the flowers to white.',
    expect: 'recolours only the flower part on every object that has flowers; frame and other parts untouched',
    run: (before, _rev, t) => {
      afterRequest2 = JSON.parse(JSON.stringify(scene()));
      const withFlowers = flowerObjs(scene());
      const otherPartsSame = scene().every((o) => { const b = before.find((x) => x.id === o.id)!; const { flowers: _a, ...oc } = o.colors; const { flowers: _b, ...bc } = b.colors; return JSON.stringify(oc) === JSON.stringify(bc) && JSON.stringify({ ...o, colors: {} }) === JSON.stringify({ ...b, colors: {} }); });
      return [
        { name: 'selected changeDecorationMaterial', pass: has(t, 'changeDecorationMaterial'), detail: order(t).join(' → ') },
        { name: 'every flower part is now white', pass: withFlowers.length > 0 && withFlowers.every((o) => isWhite(o.colors.flowers)), detail: withFlowers.map((o) => o.colors.flowers ?? 'default').join(',') },
        { name: 'nothing else changed (other parts, positions, objects)', pass: otherPartsSame && scene().length === before.length },
      ];
    },
  },
  {
    request: 'Add a mandap and two floral arrangements.',
    expect: 'one more mandap and two more flower arrangements, placed validly (a refusal must be reported, not hidden)',
    run: (before, _rev, t) => {
      const n = (o: DecorObject[], p: (c: string) => boolean) => o.filter((x) => p(x.catalogId)).length;
      const mandaps = n(scene(), (c) => c.startsWith('mandap')) - n(before, (c) => c.startsWith('mandap'));
      const arrs = n(scene(), (c) => c === 'flowers-centrepiece') - n(before, (c) => c === 'flowers-centrepiece');
      const refused = t.toolCalls.filter((c) => !c.result.ok);
      return [
        { name: 'selected addDecoration', pass: has(t, 'addDecoration'), detail: order(t).join(' → ') },
        { name: '+1 mandap in the scene', pass: mandaps === 1, detail: `delta ${mandaps}` },
        { name: '+2 flower arrangements in the scene', pass: arrs === 2, detail: `delta ${arrs}` },
        { name: 'every refused call (if any) was recovered from or reported', pass: refused.length === 0 || (mandaps === 1 && arrs === 2) || /could not|couldn.t|unable|no room|not enough|didn.t|failed|refus/i.test(t.reply), detail: refused.map((c) => `${c.name}: ${c.result.ok ? '' : c.result.error}`).join(' | ') },
        { name: 'no invalid object in the scene (all pass validation)', pass: scene().every((o) => !!findEntry(DECOR_CATALOG, o.catalogId)) },
      ];
    },
  },
  {
    request: 'Check the decoration budget against ₹2 lakhs.',
    expect: 'uses a budget tool (not mental arithmetic); reports the code-computed estimate; does not change the scene',
    run: (before, _rev, t) => {
      const estimate = sceneCost(scene());
      const budgetTools = ['estimateDecorationCost', 'checkBudgetFeasibility', 'getBudgetSummary'];
      return [
        { name: 'selected a budget tool', pass: budgetTools.some((b) => has(t, b)), detail: order(t).join(' → ') },
        { name: 'scene unchanged', pass: sameScene(before, scene()) },
        { name: `reply states the code-computed estimate (${formatInr(estimate)})`, pass: digits(t.reply).includes(String(estimate)), detail: t.reply.slice(0, 200) },
        { name: 'a limit of 2,00,000 was used in a tool call', pass: t.toolCalls.some((c) => JSON.stringify(c.args).includes('200000')) || /2,00,000|200,000|2 lakh/i.test(t.reply) },
        { name: 'reply says whether it is within or over the limit', pass: /within|over|exceed|below|under|fits?|above|less than|more than/i.test(t.reply) },
      ];
    },
  },
  {
    request: 'Undo the previous decoration request.',
    expect: 'uses undoDecorationAction and restores the scene as it was before "add a mandap and two arrangements"',
    run: (_before, _rev, t) => [
      { name: 'selected undoDecorationAction', pass: has(t, 'undoDecorationAction'), detail: order(t).join(' → ') },
      { name: 'scene equals the state after request 2 (the add was undone, the recolour kept)', pass: sameScene(afterRequest2, scene()) },
    ],
  },
];

interface Report { request: string; expect: string; ms: number; rounds: number; promptTokens: number; completionTokens: number; toolCalls: { order: number; name: string; args: unknown; ok: boolean; error?: string; hint?: string; proposal?: boolean }[]; reply: string; checks: Check[]; sceneAfter: string[]; error?: string }
const reports: Report[] = [];

console.log(mock ? '\n=== MOCK PROVIDER (scripted): this checks the harness only and is NOT a live model test ===' : `\n=== LIVE TEST: provider OpenAI, model ${config.LLM_MODEL}${config.LLM_REASONING_EFFORT ? `, reasoning_effort ${config.LLM_REASONING_EFFORT}` : ''} ===`);

for (const [i, step] of steps.entries()) {
  const before = JSON.parse(JSON.stringify(scene())) as DecorObject[];
  const rev = st().rev;
  const firstCall = calls.length;
  const t0 = performance.now();
  let turn: PlannerTurn | null = null;
  let error: string | undefined;
  try {
    turn = await planner.chat(ID, step.request);
  } catch (err) {
    error = redactSecrets((err as Error).message);
  }
  const mine = calls.slice(firstCall);
  const checks = turn ? step.run(before, rev, turn) : [{ name: 'request completed', pass: false, detail: error }];
  const r: Report = {
    request: step.request, expect: step.expect, ms: Math.round(performance.now() - t0), rounds: mine.length,
    promptTokens: mine.reduce((a, c) => a + (c.promptTokens ?? 0), 0), completionTokens: mine.reduce((a, c) => a + (c.completionTokens ?? 0), 0),
    toolCalls: (turn?.toolCalls ?? []).map((c) => ({ order: c.id, name: c.name, args: c.args, ok: c.result.ok, ...(c.result.ok ? {} : { error: redactSecrets(c.result.error), hint: redactSecrets(c.result.hint), proposal: !!c.result.proposal }) })),
    reply: redactSecrets(turn?.reply ?? ''), checks, sceneAfter: scene().map((o) => `${o.catalogId}:${o.mount}`), ...(error ? { error } : {}),
  };
  reports.push(r);
  console.log(`\n[${i + 1}] "${step.request}"  ${r.ms} ms, ${r.rounds} model round(s)${r.promptTokens ? `, ${r.promptTokens}+${r.completionTokens} tokens` : ''}`);
  console.log(`    tools: ${r.toolCalls.map((c) => `${c.name}${c.ok ? '' : ' ✗'}`).join(' → ') || '(none)'}`);
  for (const c of checks) console.log(`    ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail && !c.pass ? `  — ${c.detail}` : ''}`);
  if (error) console.log(`    ERROR: ${error}`);
}

const passed = reports.every((r) => r.checks.every((c) => c.pass));
const out = {
  live: !mock && hasKey,
  provider: mock ? 'mock (scripted)' : 'openai',
  modelConfigured: config.LLM_MODEL,
  modelsReportedByProvider: [...new Set(calls.map((c) => c.model).filter(Boolean))],
  reasoningEffort: config.LLM_REASONING_EFFORT ?? null,
  retries: mock ? null : 'SDK maxRetries 1, timeout 30 s per call',
  at: new Date().toISOString(),
  totals: { modelCalls: calls.length, ms: reports.reduce((a, r) => a + r.ms, 0), promptTokens: reports.reduce((a, r) => a + r.promptTokens, 0), completionTokens: reports.reduce((a, r) => a + r.completionTokens, 0), apiErrors: calls.filter((c) => c.error).map((c) => c.error) },
  passed,
  reports,
};
fs.mkdirSync(VAR_DIR, { recursive: true });
const file = path.join(VAR_DIR, `live-smoke-${mock ? 'MOCK-' : ''}${Date.now()}.json`);
fs.writeFileSync(file, redactSecrets(JSON.stringify(out, null, 2)));
console.log(`\n${mock ? 'MOCK RUN' : 'LIVE RUN'}: ${passed ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}\nreport: ${path.relative(process.cwd(), file)}`);
process.exit(passed ? 0 : 1);
