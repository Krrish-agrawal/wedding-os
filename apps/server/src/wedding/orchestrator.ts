import { z } from 'zod';
import type { DecorObject } from '@ave/shared';
import { budgetSpecialist } from './specialists/budget.js';
import { decorationSpecialist } from './specialists/decoration.js';
import { venueSpecialist } from './specialists/venue.js';
import { vendorSpecialist } from './specialists/vendor.js';
import { designSpecialist } from './specialists/design.js';
import { fashionSpecialist } from './specialists/fashion.js';
import { SPECIALIST_FLAGS, type FlagService } from './flags.js';
import { fail, state, type AnyTool, type PlannerSession, type Specialist, type ToolContext, type ToolResult } from './toolkit.js';

/**
 * The orchestrator is a dispatcher with memory, not an agent: it owns the list of specialist modules, runs the
 * tool calls the planner (a model, or the demo router) asks for, and records what each one changed so later
 * messages can say "it" or "undo that". Every change still goes through the shared reducer inside the tools.
 */

export const SPECIALISTS: readonly Specialist[] = [venueSpecialist, decorationSpecialist, budgetSpecialist, vendorSpecialist, fashionSpecialist, designSpecialist];

const ALL_TOOLS: ReadonlyMap<string, { tool: AnyTool; specialist: Specialist }> = new Map(SPECIALISTS.flatMap((sp) => sp.tools.map((tool) => [tool.name, { tool, specialist: sp }] as const)));

export const TOOL_NAMES = [...ALL_TOOLS.keys()];

const specialistOn = (flags: FlagService | undefined, id: string) => !flags || (SPECIALIST_FLAGS[id] ?? []).every((f) => flags.isEnabled(f));

/** Specialists whose feature flag is currently on. */
export const enabledSpecialists = (flags?: FlagService) => SPECIALISTS.filter((sp) => specialistOn(flags, sp.id));

/** Tool schemas for the model. A disabled specialist's tools are not listed at all. */
export function weddingToolDefinitions(flags?: FlagService) {
  return [...ALL_TOOLS.values()].filter(({ specialist }) => specialistOn(flags, specialist.id)).map(({ tool, specialist }) => {
    const { $schema: _drop, ...parameters } = z.toJSONSchema(tool.input, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
    return { name: tool.name, specialist: specialist.id, description: tool.description, parameters: { properties: {}, ...parameters, type: 'object' } };
  });
}

/** Progress text for a call, without running it. Never throws. */
export function labelFor(name: string, raw: unknown): string {
  const t = ALL_TOOLS.get(name)?.tool;
  if (!t) return `Calling ${name}`;
  const parsed = t.input.safeParse(raw ?? {});
  try {
    return parsed.success ? t.label(parsed.data as never) : `Calling ${name}`;
  } catch {
    return `Calling ${name}`;
  }
}

export const specialistOf = (name: string) => ALL_TOOLS.get(name)?.specialist.id;

const sig = (o: DecorObject) => JSON.stringify(o);

export function beginRequest(session: PlannerSession): void {
  session.requestSteps = 0;
}

/** Remembers what the request just finished changed in the scene, so "undo that" can reverse all of it. */
export function endRequest(ctx: ToolContext): void {
  if (ctx.session.requestSteps > 0) ctx.session.lastRequest = { steps: ctx.session.requestSteps, after: JSON.stringify(state(ctx).scene.objects) };
  ctx.session.requestSteps = 0;
}

/** Sets the object the customer has selected in the studio, ignoring ids that are not in the scene. */
export function setSelection(ctx: ToolContext, id: string | null | undefined): void {
  ctx.session.selectedId = id && state(ctx).scene.objects.some((o) => o.id === id) ? id : null;
}

/** Validates the input and runs one tool. Never throws; never changes anything the reducer would refuse. */
export function runWeddingTool(ctx: ToolContext, name: string, raw: unknown): ToolResult {
  const found = ALL_TOOLS.get(name);
  if (!found) return fail(`Unknown tool "${name}".`, `Use one of: ${TOOL_NAMES.join(', ')}.`);
  // Defence in depth: even if a model (or a stale tool list) names a disabled tool, it does not run (checked before anything else).
  if (!specialistOn(ctx.flags, found.specialist.id)) return fail(`The ${found.specialist.title} feature is switched off right now.`, 'Tell the customer plainly that this feature is currently disabled. Do not try a workaround.');
  const parsed = found.tool.input.safeParse(raw ?? {});
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail(`Invalid input${i ? ` (${i.path.join('.') || 'arguments'}: ${i.message})` : ''}.`, 'Fix the arguments and call the tool again.');
  }
  const before = state(ctx);
  try {
    const result = found.tool.run(parsed.data as never, ctx);
    if (result.ok) trackScene(ctx, before.scene.objects, before.sceneHistory.past.length);
    return result;
  } catch (err) {
    return fail(`The tool failed unexpectedly: ${(err as Error).message}`, 'Tell the customer something went wrong and try a different approach.');
  }
}

function trackScene(ctx: ToolContext, before: readonly DecorObject[], pastBefore: number): void {
  const after = state(ctx);
  const was = new Map(before.map((o) => [o.id, sig(o)]));
  const touched = after.scene.objects.filter((o) => was.get(o.id) !== sig(o)).map((o) => o.id);
  const grew = after.sceneHistory.past.length - pastBefore;
  if (touched.length > 0) ctx.session.lastTouched = touched.slice(-20);
  else ctx.session.lastTouched = ctx.session.lastTouched.filter((id) => after.scene.objects.some((o) => o.id === id));
  if (grew > 0) ctx.session.requestSteps += grew;
}
