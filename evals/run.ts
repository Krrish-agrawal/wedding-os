/**
 * Conversation evals for the simulated advisor.
 *
 *   npx --no-install tsx evals/run.ts                  all scenarios
 *   npx --no-install tsx evals/run.ts --only hinglish  some scenarios (names or prefixes, comma separated)
 *   npx --no-install tsx evals/run.ts --live-routes    use the real live router for unknown places
 *
 * Each scenario runs the real brief and tool definitions against OpenAI on a fresh in-memory session,
 * checks the tools called and their arguments, the session state after each turn, and that every
 * number in the reply is grounded in that turn's tool results. Skips cleanly without an OpenAI key.
 * Report delivery is stubbed (email sent, WhatsApp not configured) so no message leaves the machine.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt } from '../apps/server/src/agent/prompt.js';
import { SimAdvisor, type SimToolCall } from '../apps/server/src/agent/sim.js';
import { features, loadConfig } from '../apps/server/src/config.js';
import { loadContent } from '../apps/server/src/content.js';
import type { AppContext } from '../apps/server/src/context.js';
import { SessionStore } from '../apps/server/src/sessions/store.js';
import type { ToolDeps } from '../apps/server/src/tools/context.js';
import type { Delivery } from '../packages/shared/src/index.js';
import { EVAL_ROUTE, buildScenarios, type CallExpectation, type Scenario, type Turn } from './cases.js';
import { checkGrounding } from './grounding.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONCURRENCY = 3;
const EVAL_BUYER = { name: 'Priya Sharma', phone: '9876543210', email: 'priya@example.com' };

interface TurnReport {
  buyer: string;
  reply: string;
  calls: SimToolCall[];
  failures: string[];
  warnings: string[];
  ms: number;
}
interface ScenarioReport {
  scenario: Scenario;
  turns: TurnReport[];
  error?: string;
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
  if (i < 0) return undefined;
  const a = argv[i]!;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[i + 1];
}

const toolNames = (e: CallExpectation) => (Array.isArray(e.tool) ? e.tool : [e.tool]);
const asRecord = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const callMatches = (e: CallExpectation, c: SimToolCall) =>
  toolNames(e).includes(c.name as never) && (!e.args || e.args(asRecord(c.args))) && (e.ok === undefined || c.result.ok === e.ok);
const describe = (e: CallExpectation) => `${toolNames(e).join(' | ')}${e.describe ? ` (${e.describe})` : ''}${e.ok === undefined ? '' : e.ok ? ' returning ok' : ' returning a refusal'}`;

function judge(turn: Turn, calls: SimToolCall[], reply: string, state: ReturnType<SessionStore['get']>, sources: { turn: string[]; earlier: string[] }) {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const e of turn.expect ?? []) if (!calls.some((c) => callMatches(e, c))) failures.push(`expected a call to ${describe(e)}`);
  for (const e of turn.forbid ?? []) if (calls.some((c) => callMatches(e, c))) failures.push(`must not call ${describe(e)}`);
  for (const e of turn.prefer ?? []) if (!calls.some((c) => callMatches(e, c))) warnings.push(`would rather have called ${describe(e)}`);
  if (turn.after && (!state || !turn.after.check(state))) failures.push(`after the turn: expected ${turn.after.describe}`);
  if (turn.reply && !turn.reply.pattern.test(reply)) failures.push(`reply should ${turn.reply.describe}`);
  if (turn.replyNot && turn.replyNot.pattern.test(reply)) failures.push(`reply should not: ${turn.replyNot.describe}`);
  if (turn.soft && !turn.soft.pattern.test(reply)) warnings.push(`reply did not ${turn.soft.describe}`);
  const g = checkGrounding(reply, sources);
  if (g.ungrounded.length) failures.push(`ungrounded numbers in reply: ${g.ungrounded.join(', ')}`);
  if (g.stale.length) warnings.push(`numbers repeated from an earlier turn without a fresh tool call: ${g.stale.join(', ')}`);
  return { failures, warnings };
}

async function runScenario(base: Omit<AppContext, 'store'>, scenario: Scenario, deps: Partial<ToolDeps>): Promise<ScenarioReport> {
  const store = new SessionStore();
  const ctx: AppContext = { ...base, store };
  const sid = store.create(EVAL_BUYER).id;
  for (const action of scenario.setup ?? []) store.dispatch(sid, action, 'system');
  const sim = new SimAdvisor(ctx, { deps, recordTranscript: true });
  const brief = buildSystemPrompt(ctx, store.get(sid)!);
  const earlier: string[] = [];
  const report: ScenarioReport = { scenario, turns: [] };

  for (const turn of scenario.turns) {
    try {
      const t = await sim.chat(sid, turn.buyer);
      const results = t.toolCalls.map((c) => JSON.stringify(c.result));
      const verdict = judge(turn, t.toolCalls, t.reply, store.get(sid), { turn: [...results, turn.buyer, brief], earlier });
      report.turns.push({ buyer: turn.buyer, reply: t.reply, calls: t.toolCalls, ms: t.ms, ...verdict });
      earlier.push(...results);
    } catch (err) {
      report.error = `model call failed on "${turn.buyer}": ${(err as Error).message}`;
      break;
    }
  }
  return report;
}

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i]!);
      }
    }),
  );
  return out;
}

function print(r: ScenarioReport): { failed: boolean; warnings: number } {
  const failed = Boolean(r.error) || r.turns.some((t) => t.failures.length > 0);
  const warnings = r.turns.reduce((n, t) => n + t.warnings.length, 0);
  console.log(`\n${failed ? 'FAIL' : 'PASS'}  ${r.scenario.name}  ${r.scenario.about}`);
  for (const t of r.turns) {
    const mark = t.failures.length ? '  x' : '  .';
    console.log(`${mark} buyer: ${t.buyer}`);
    console.log(`      tools: ${t.calls.map((c) => `${c.name}(${JSON.stringify(c.args)})${c.result.ok ? '' : ' -> refused'}`).join(', ') || 'none'}  [${t.ms} ms]`);
    console.log(`      advisor: ${t.reply.replace(/\s+/g, ' ')}`);
    for (const f of t.failures) console.log(`      FAIL ${f}`);
    for (const w of t.warnings) console.log(`      warn ${w}`);
  }
  if (r.error) console.log(`      FAIL ${r.error}`);
  return { failed, warnings };
}

async function main() {
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {
    // No .env file: rely on the environment.
  }
  if (!process.env.OPENAI_API_KEY) {
    console.log('Skipping conversation evals: OPENAI_API_KEY is not set. Add it to .env to run them.');
    return;
  }

  const argv = process.argv.slice(2);
  const only = argValue(argv, '--only');
  const concurrency = Number(argValue(argv, '--concurrency') ?? DEFAULT_CONCURRENCY) || DEFAULT_CONCURRENCY;
  const liveRoutes = argv.includes('--live-routes');

  const config = loadConfig(process.env);
  const content = await loadContent();
  const base = { config, features: features(config), content };
  const wanted = only?.split(',').map((x) => x.trim()).filter(Boolean) ?? [];
  const scenarios = buildScenarios(content).filter((s) => wanted.length === 0 || wanted.some((w) => s.name.startsWith(w)));
  if (scenarios.length === 0) {
    console.log(`No scenario matches "${only}".`);
    process.exitCode = 1;
    return;
  }

  const deps: Partial<ToolDeps> = {
    ...(liveRoutes ? {} : { findRoute: async () => EVAL_ROUTE }),
    sendReport: async (_ctx, _sid, channels): Promise<Delivery[]> =>
      channels.map((channel, i) => ({
        id: `eval-${i}`,
        channel,
        to: channel === 'email' ? EVAL_BUYER.email : EVAL_BUYER.phone,
        status: channel === 'email' ? 'sent' : 'not_configured',
        detail: null,
        at: Date.now(),
      })),
  };

  console.log(`Conversation evals: ${scenarios.length} scenarios, model ${config.LLM_MODEL}${liveRoutes ? ', live routes' : ''}`);
  const started = Date.now();
  const reports = await pool(scenarios, concurrency, (s) => runScenario(base, s, deps));
  let failed = 0;
  let warnings = 0;
  for (const r of reports) {
    const p = print(r);
    if (p.failed) failed += 1;
    warnings += p.warnings;
  }
  const turns = reports.reduce((n, r) => n + r.turns.length, 0);
  console.log(`\n${scenarios.length - failed}/${scenarios.length} scenarios passed, ${turns} turns, ${warnings} warnings, ${Math.round((Date.now() - started) / 1000)} s`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
