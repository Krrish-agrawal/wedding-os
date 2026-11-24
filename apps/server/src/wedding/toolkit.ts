import { z } from 'zod';
import { DECOR_CATALOG, findEntry, sceneCost, type ApplyResult, type CatalogEntry, type DecorObject, type WeddingAction, type WeddingState } from '@ave/shared';
import type { ProposalChange, ProposalStore, ProposalView, FingerprintKind } from './proposals.js';
import type { WeddingStore } from './store.js';
import type { VendorStore } from './vendor-store.js';
import type { FlagService } from './flags.js';
import type { DesignService } from './design/jobs.js';

/**
 * Shared plumbing for the specialist tool modules. A tool is a name, a description the model reads, a zod input,
 * a progress label for the chat, and a `run` that changes the wedding ONLY by dispatching validated actions
 * through the store (and so the shared reducer). Tools never touch Three.js and never throw.
 */

/** What the planner remembers between messages, so "it" and "those flowers" can be resolved to real objects. */
export interface PlannerSession {
  /** The object selected in the studio, sent by the browser with each message and checked against the scene. */
  selectedId: string | null;
  /** Objects the planner added or changed most recently, newest last. */
  lastTouched: string[];
  /** Scene-changing tool calls made so far in the request being handled. */
  requestSteps: number;
  /** What the latest request that changed the scene did, and the scene it left behind (to detect later edits). */
  lastRequest: { steps: number; after: string } | null;
  /** Vendor ids from the most recent search/comparison, newest search first, so "shortlist the first one" resolves. */
  lastVendors: string[];
}

export const newSession = (): PlannerSession => ({ selectedId: null, lastTouched: [], requestSteps: 0, lastRequest: null, lastVendors: [] });

export interface ToolContext {
  store: WeddingStore;
  vendors: VendorStore;
  /** AI design service (generation jobs, planning, versions). Absent in tests that do not need it. */
  design?: DesignService;
  /** Feature flags. Absent in tests = everything enabled. */
  flags?: FlagService;
  proposals: ProposalStore;
  weddingId: string;
  session: PlannerSession;
}

export type ToolResult =
  | { ok: true; summary: string; data: unknown }
  /** `proposal` is set when the action needs the customer's confirmation: nothing changed, and only the browser can confirm. */
  | { ok: false; error: string; hint: string; proposal?: ProposalView };

export interface AnyTool {
  name: string;
  description: string;
  input: z.ZodType;
  /** Present-tense progress text for the chat ("Adding Traditional mandap…"). */
  label: (input: never) => string;
  run: (input: never, ctx: ToolContext) => ToolResult;
}

export function defineTool<S extends z.ZodType>(spec: {
  name: string;
  description: string;
  input: S;
  label: (input: z.infer<S>) => string;
  run: (input: z.infer<S>, ctx: ToolContext) => ToolResult;
}): AnyTool {
  return spec as unknown as AnyTool;
}

export interface Specialist {
  id: 'venue' | 'decoration' | 'budget' | 'vendor' | 'fashion' | 'design';
  title: string;
  /** What this module is responsible for. */
  summary: string;
  tools: AnyTool[];
}

export const ok = (summary: string, data: unknown): ToolResult => ({ ok: true, summary, data });
export const fail = (error: string, hint: string): ToolResult => ({ ok: false, error, hint });

export const state = (ctx: ToolContext): WeddingState => ctx.store.getOrCreate(ctx.weddingId);

/** Applies one action through the reducer; the only write path tools have. */
export function apply(ctx: ToolContext, action: WeddingAction): ApplyResult {
  return ctx.store.dispatch(ctx.weddingId, action);
}

export const toFail = (r: Extract<ApplyResult, { ok: false }>): ToolResult => fail(r.error, r.hint);

export const entryName = (catalogId: string) => findEntry(DECOR_CATALOG, catalogId)?.name ?? catalogId;

export const shortId = () => Math.random().toString(36).slice(2, 10);

/** The catalogue entry the model meant: exact id, exact name, or a unique partial match on either. */
export function resolveAsset(input: string): { entry: CatalogEntry } | { error: string; hint: string } {
  const t = input.trim().toLowerCase();
  const exact = DECOR_CATALOG.find((e) => e.id === t || e.name.toLowerCase() === t);
  if (exact) return { entry: exact };
  const words = t.split(/[\s-]+/).filter((w) => w.length > 2);
  const partial = DECOR_CATALOG.filter((e) => words.length > 0 && words.every((w) => `${e.id} ${e.name}`.toLowerCase().includes(w)));
  if (partial.length === 1) return { entry: partial[0]! };
  return {
    error: partial.length > 1 ? `"${input}" matches several assets.` : `No decoration asset matches "${input}".`,
    hint: `Call listDecorationAssets, then use one of: ${(partial.length > 1 ? partial : DECOR_CATALOG).map((e) => e.id).join(', ')}.`,
  };
}

/** The part of `entry` the model meant ("flowers", "flower", "Pillars"), or undefined. */
export function resolvePart(entry: CatalogEntry, input: string) {
  const t = input.trim().toLowerCase();
  const singular = t.endsWith('s') ? t.slice(0, -1) : t;
  return entry.parts.find((p) => [p.id, p.label.toLowerCase()].some((x) => x === t || x === singular || x === `${t}s`));
}

export const effectiveColors = (o: DecorObject, entry: CatalogEntry) => Object.fromEntries(entry.parts.map((p) => [p.id, o.colors[p.id] ?? p.color]));

export const estimate = (objects: readonly DecorObject[]) => sceneCost(objects);

export const significantChange = (previous: number, next: number) => previous > 0 && Math.abs(next - previous) / previous > 0.1;

/**
 * Records a proposal for something the customer must approve, and returns a result the model can only relay.
 * Nothing has changed. The model cannot confirm: confirmation is an application route, not a tool or a flag.
 */
export function propose(ctx: ToolContext, input: { tool: string; summary: string; changes: ProposalChange[]; action: WeddingAction; kind: FingerprintKind }): ToolResult {
  const view = ctx.proposals.create(ctx.weddingId, { ...input, state: state(ctx) });
  if (!view) return fail('There are already too many proposals waiting for the customer.', 'Ask the customer to confirm or cancel the pending proposals in the chat first.');
  return {
    ok: false,
    error: `Needs the customer's confirmation: ${input.summary}`,
    hint: 'This is only a proposal; NOTHING has changed. Tell the customer exactly what you proposed and that they must press Confirm in the chat. You cannot confirm it yourself. Do not retry it and do not say it was applied.',
    proposal: view,
  };
}
