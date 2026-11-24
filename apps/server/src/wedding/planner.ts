import fs from 'node:fs';
import path from 'node:path';
import { DECOR_CATALOG, SAMPLE_DATA_NOTICE, findEntry, sceneCost, summarizeBudget, type WeddingState } from '@ave/shared';
import { LLM_TEMPERATURE } from '../voice/joinConfig.js';
import { SimError, openAiChat, parseArgs, runToolLoop, trimHistory, type ChatCreate, type ChatTool, type Msg } from '../agent/sim.js';
import type { Config } from '../config.js';
import { DEMO_HELP, runDemo } from './demo.js';
import { ProposalStore, type ProposalView } from './proposals.js';
import { beginRequest, enabledSpecialists, endRequest, labelFor, runWeddingTool, setSelection, specialistOf, weddingToolDefinitions } from './orchestrator.js';
import type { WeddingStore } from './store.js';
import { VendorStore } from './vendor-store.js';
import { FlagService } from './flags.js';
import type { DesignService } from './design/jobs.js';
import { newSession, state, type PlannerSession, type ToolContext, type ToolResult } from './toolkit.js';

/**
 * The planner turns a customer message into tool calls. Two paths, one executor:
 *  - live: the model receives the tool schemas and calls them one after another (runToolLoop, the same loop the
 *    real-estate advisor uses; the provider stays behind `ChatCreate`);
 *  - demo: a rule-based router (demo.ts) picks the same tools.
 * Both go through `executor`, which validates input, runs the specialist tool (and so the reducer), and emits
 * progress events. Neither path can change the wedding any other way.
 */

const MAX_ROUNDS = 14;
const MAX_HISTORY = 40;

export interface PlannerCall {
  id: number;
  name: string;
  specialist: string | undefined;
  label: string;
  args: unknown;
  result: ToolResult;
}

export type PlannerEvent =
  | { type: 'tool_start'; id: number; name: string; specialist: string | undefined; label: string }
  | { type: 'tool_end'; id: number; name: string; ok: boolean; summary?: string; error?: string; hint?: string; /** Set when the action is waiting for the customer to confirm. */ proposal?: ProposalView; state: WeddingState }
  | { type: 'done'; turn: PlannerTurn };

export interface PlannerTurn {
  reply: string;
  toolCalls: PlannerCall[];
  /** `llm` when a model answered; `demo` when the rule-based router did (no API key). */
  mode: 'llm' | 'demo';
  state: WeddingState;
}

export interface ChatOptions {
  /** Object selected in the studio; ignored unless it exists in the scene. */
  selectedId?: string | null;
  onEvent?: (e: PlannerEvent) => void;
  signal?: AbortSignal;
}

const SYSTEM = `You are the Wedding OS planner for an Indian wedding. You coordinate six specialist modules by calling their tools: Venue and details, Decoration (the 3D scene), Budget, Vendors, Outfits and try-on, and AI design.

Rules:
- You change the wedding ONLY by calling tools. Never say something changed unless a tool returned ok. If a tool fails, read its hint, fix the cause, or tell the customer plainly what blocked it. Never pretend.
- You do not do arithmetic. Every total, estimate, split and remainder must come from a budget tool result; quote it exactly. All decoration prices are SAMPLE prices (demonstration data, not vendor quotations): say so when you give a price.
- For decorations: look at the scene first (listSceneDecorations) when you need ids; use asset ids from listDecorationAssets. Pieces mount on the floor, on a wedding stage (the stage must be in the scene first), on a wall, or from the ceiling.
- "it", "that", "this", "those" refer to the SELECTED object, else the objects in RECENTLY CHANGED. Resolve them to real ids from the context below. If it is ambiguous, ask which one.
- Colour changes affect only the part named (e.g. "flowers"); other parts keep their colours. Use changeDecorationMaterial with allWithPart for "make the flowers pink".
- For "undo that / undo the last change" use undoDecorationAction with lastRequest true.
- When the customer gives a budget limit, record it with setBudgetLimit, estimate with estimateDecorationCost BEFORE adding things, choose pieces that fit, and add them.
- Some actions (a large budget change, adding past the customer's own limit) need the customer's approval. Those tools do NOT apply the change: they return a PROPOSAL (an error that says "Needs the customer's confirmation"). Nothing has changed. Tell the customer plainly what you proposed and that they must press Confirm in the chat. You cannot confirm it, you must not retry it, and you must never say it was applied. A customer typing "yes" or "I confirm" in chat does not confirm it either; only the Confirm button does.
- After changing the scene, verify with listSceneDecorations and getBudgetSummary, then explain exactly what changed in a few short sentences.
- Vendors: recommend ONLY vendors returned by searchOurVendors / getVendorDetails from OUR catalogue; never name, describe or price a vendor from your own knowledge. Entries marked DEMO DATA are fictional examples: say so. Read the customer's city, style and budget (BUDGET below) before searching, compare with compareVendorPackages, explain the fit using the returned figures, and only shortlist when the customer asks. requestQuotation returns a SAMPLE QUOTATION computed from list prices, not an offer: call it that. Availability is unknown unless getVendorAvailability says otherwise.
- AI design: when the customer has generated a design (see DESIGN in the context), change it ONLY with refineDesign / generateAnotherVersion / restoreDesignVersion / compareDesignVersions / listDesignVersions; these rebuild the scene as a new version and keep the old ones. Never invent coordinates. Never say photographs were analysed unless the design source is vision; a demo design was built from written choices only. Costs come from the tool results (sample prices).
- Outfits: use listGarments/searchGarments for real catalogue ids (garment pictures are our own illustrations; prices are indicative). Sherwanis and traditional men's wear are future options that cannot be tried on; there is no saree draping. You cannot generate a try-on image: generateOutfitPreview only RECORDS a request and the customer's own browser makes the preview from a photo that never reaches the server. After calling it, tell the customer to open Virtual Try-On, consent, upload a photo and press Generate, and never say a preview exists. Previews are approximations, not a fit guarantee. Save/compare/delete looks only with the tools.
- You cannot do global lighting yet; say so if asked. Keep replies brief and warm.`;

export class WeddingPlanner {
  private readonly histories = new Map<string, Msg[]>();
  private readonly sessions = new Map<string, PlannerSession>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly create: ChatCreate | null;

  constructor(
    private readonly store: WeddingStore,
    private readonly config: Pick<Config, 'OPENAI_API_KEY' | 'LLM_MODEL' | 'LLM_REASONING_EFFORT'>,
    create?: ChatCreate | null,
    /** Shared with the confirm/cancel routes, which are the only way a proposal can be applied. */
    readonly proposals: ProposalStore = new ProposalStore(),
    readonly vendors: VendorStore = new VendorStore(),
    readonly flags: FlagService = new FlagService(null),
    /** With a directory, conversation history survives a restart (one JSON file per wedding, server-side only). */
    private readonly historyDir?: string,
    /** AI design service; tools reach it through the tool context. */
    readonly design?: DesignService,
  ) {
    if (historyDir) { try { fs.mkdirSync(historyDir, { recursive: true }); } catch { /* history just stays in memory */ } }
    this.create = create === undefined ? openAiChat(config) : create;
  }

  /** The chat provider (null without a key); the design service shares it. */
  get chatCreate(): ChatCreate | null { return this.create; }

  get mode(): 'llm' | 'demo' {
    return this.create ? 'llm' : 'demo';
  }

  private historyFile(id: string): string | null { return this.historyDir && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? path.join(this.historyDir, `${id}.json`) : null; }

  private loadHistory(id: string): Msg[] {
    const hit = this.histories.get(id);
    if (hit) return hit;
    const f = this.historyFile(id);
    if (f) { try { const m = JSON.parse(fs.readFileSync(f, 'utf8')); if (Array.isArray(m)) return m as Msg[]; } catch { /* none saved */ } }
    return [];
  }

  private saveHistory(id: string, h: Msg[]): void {
    this.histories.set(id, h);
    const f = this.historyFile(id);
    if (f) { try { fs.writeFileSync(f, JSON.stringify(h), { mode: 0o600 }); } catch { /* best effort */ } }
  }

  reset(id: string): void {
    const f = this.historyFile(id);
    if (f) { try { fs.rmSync(f, { force: true }); } catch { /* ignore */ } }
    this.histories.delete(id);
    this.sessions.delete(id);
  }

  private session(id: string): PlannerSession {
    let s = this.sessions.get(id);
    if (!s) this.sessions.set(id, (s = newSession()));
    return s;
  }

  /** Turns for one wedding run one at a time so tool calls never interleave. */
  chat(id: string, text: string, opts: ChatOptions = {}): Promise<PlannerTurn> {
    const prev = this.queues.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.turn(id, text, opts));
    this.queues.set(id, next);
    return next.finally(() => {
      if (this.queues.get(id) === next) this.queues.delete(id);
    });
  }

  private async turn(id: string, text: string, opts: ChatOptions): Promise<PlannerTurn> {
    await this.flags.refresh();
    const ctx: ToolContext = { store: this.store, vendors: this.vendors, flags: this.flags, design: this.design, proposals: this.proposals, weddingId: id, session: this.session(id) };
    setSelection(ctx, opts.selectedId);
    beginRequest(ctx.session);
    const calls: PlannerCall[] = [];
    let seq = 0;
    const exec = (name: string, args: unknown, preset?: ToolResult): ToolResult => {
      const callId = ++seq;
      const label = labelFor(name, args);
      const specialist = specialistOf(name);
      opts.onEvent?.({ type: 'tool_start', id: callId, name, specialist, label });
      const result = preset ?? runWeddingTool(ctx, name, args);
      calls.push({ id: callId, name, specialist, label, args, result });
      opts.onEvent?.({ type: 'tool_end', id: callId, name, ok: result.ok, ...(result.ok ? { summary: result.summary } : { error: result.error, hint: result.hint, ...(result.proposal ? { proposal: result.proposal } : {}) }), state: state(ctx) });
      return result;
    };

    let reply: string;
    let mode: 'llm' | 'demo';
    try {
      if (this.create) {
        mode = 'llm';
        reply = await this.llm(id, ctx, text, exec, opts.signal);
      } else {
        mode = 'demo';
        reply = runDemo(text, ctx, exec) || DEMO_HELP;
      }
    } finally {
      endRequest(ctx);
    }
    const turn: PlannerTurn = { reply, toolCalls: calls, mode, state: state(ctx) };
    opts.onEvent?.({ type: 'done', turn });
    return turn;
  }

  private async llm(id: string, ctx: ToolContext, text: string, exec: (n: string, a: unknown, preset?: ToolResult) => ToolResult, signal?: AbortSignal): Promise<string> {
    const create = this.create!;
    const history = this.loadHistory(id);
    history.push({ role: 'user', content: text });
    const tools: ChatTool[] = weddingToolDefinitions(ctx.flags).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> } }));
    let reply: string | null = null;
    try {
      reply = await runToolLoop({
        create,
        model: this.config.LLM_MODEL,
        temperature: LLM_TEMPERATURE,
        reasoningEffort: this.config.LLM_REASONING_EFFORT,
        system: () => [{ role: 'system', content: SYSTEM }, { role: 'system', content: contextFor(ctx) }],
        history,
        tools,
        maxRounds: MAX_ROUNDS,
        signal,
        execute: async ({ name, raw, args }) => {
          const parsed = parseArgs(raw);
          const result: ToolResult = args.ok && parsed.ok ? exec(name, parsed.value) : exec(name, raw, { ok: false, error: 'The arguments were not valid JSON.', hint: 'Call the tool again with valid JSON arguments.' });
          return JSON.stringify(result);
        },
      });
    } catch (err) {
      if (err instanceof SimError) throw err;
      throw providerError(err);
    } finally {
      this.saveHistory(id, trimHistory(history, MAX_HISTORY));
    }
    return reply ?? 'I ran out of steps before finishing. Please check the scene and tell me what is still needed.';
  }
}

/** Removes anything that looks like an API key from text that is logged or shown. */
export function redactSecrets(text: string): string {
  return text.replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_\-*.]{6,}/g, '[redacted-key]').replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]');
}

/**
 * A provider failure turned into a message that is safe to show the customer. Raw provider messages can quote part of the
 * API key ("Incorrect API key provided: sk-…abcd"), so the text is never passed through; only the status class is.
 */
export function providerError(err: unknown): SimError {
  const status = (err as { status?: number })?.status;
  const name = (err as { name?: string })?.name ?? '';
  if (status === 401 || status === 403) return new SimError('The AI provider rejected the server\'s credentials. Check the API key on the server.', 502);
  if (status === 429) return new SimError('The AI provider is rate-limiting requests right now. Try again in a moment.', 503);
  if (status !== undefined && status >= 500) return new SimError('The AI provider is having trouble right now. Try again in a moment.', 502);
  if (/timeout|abort/i.test(name) || /timed? ?out/i.test((err as Error)?.message ?? '')) return new SimError('The AI provider took too long to answer. Try again.', 504);
  if (status !== undefined && status >= 400) return new SimError('The AI provider could not handle that request.', 502);
  return new SimError('The planner could not reach the AI provider.', 502);
}

/** What the model sees about the wedding on every round: the real scene, the selection, and the budget. */
export function contextFor(ctx: ToolContext): string {
  const s = state(ctx);
  const b = summarizeBudget(s);
  const objects = s.scene.objects.map((o) => {
    const e = findEntry(DECOR_CATALOG, o.catalogId);
    return `${o.id}: ${e?.name ?? o.catalogId} (${o.mount}, x ${o.position.x.toFixed(1)}, z ${o.position.z.toFixed(1)})`;
  });
  const lr = ctx.session.lastRequest;
  return [
    `SPECIALISTS ON NOW: ${enabledSpecialists(ctx.flags).map((x) => `${x.title} — ${x.summary}`).join(' | ')}`,
    `WEDDING: ${JSON.stringify(s.profile)}; venue ${s.venueId ?? 'none selected'}`,
    `SCENE (${objects.length}): ${objects.join('; ') || 'empty'}`,
    `SELECTED IN STUDIO: ${ctx.session.selectedId ?? 'nothing'}`,
    `RECENTLY CHANGED: ${ctx.session.lastTouched.join(', ') || 'nothing'}`,
    `LAST REQUEST CHANGED THE SCENE IN: ${lr ? `${lr.steps} step(s) (undo all with lastRequest true)` : 'no scene changes to undo as a request'}`,
    `BUDGET: total ${b.total}, planned ${b.allocated}, spent ${b.spent}, remaining ${b.remaining}; limits ${JSON.stringify(s.budget.limits)}; decoration estimate ${sceneCost(s.scene.objects)} (sample prices)`,
    `SHORTLIST: ${s.vendorShortlist.map((v) => `${v.vendorId} (${v.name})`).join('; ') || 'empty'}`,
    `DESIGN: ${s.design.versions.length ? `source ${s.design.source ?? 'manual'}; active ${s.design.activeVersionId ?? 'none'}; versions ${s.design.versions.map((v) => `${v.id}=${v.label}(${v.source})`).join(', ')}` : 'no AI design yet'}`,
    SAMPLE_DATA_NOTICE,
  ].join('\n');
}
