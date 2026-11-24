import { z } from 'zod';
import { DECOR_CATALOG, PRICE_NOTE, findEntry, formatInr, refineBrief, type DesignVersion, type WeddingState } from '@ave/shared';
import { apply, defineTool, fail, ok, state, toFail, type Specialist, type ToolContext, type ToolResult } from '../toolkit.js';

/**
 * Design specialist: changes the AI-generated design by editing its stored brief and re-planning deterministically
 * (shared `refineBrief` + `planScene`). The model never supplies coordinates; every result is a NEW version applied through
 * the reducer, so earlier versions stay available. Costs and comparisons are computed here, never by the model.
 */

const SUPPORTED = 'Supported changes: recolour the flowers ("make the flowers white"), "grander" or "simpler", "more jasmine / marigold / roses", "more traditional" or "more modern", add chandeliers, fairy lights or lanterns, "reduce the decoration budget", or ask for another version.';
const sourceNote = (v: Pick<DesignVersion, 'source'>) => (v.source === 'vision' ? 'from your analysed inspiration photographs' : v.source === 'demo' ? 'SAMPLE design built from written choices only (photographs were NOT analysed)' : 'saved from hand edits');

const service = (ctx: ToolContext) => ctx.design ?? null;
const unavailable = () => fail('The design service is not available.', 'Tell the customer AI design is unavailable right now.');

const versionCard = (v: DesignVersion, active: string | null) => ({ id: v.id, label: v.label, source: v.source, sourceNote: sourceNote(v), pieces: v.objects.length, estimateInr: v.costInr, active: v.id === active, summary: v.summary });

function findVersion(s: WeddingState, ref: string): DesignVersion | null {
  const t = ref.trim().toLowerCase();
  return s.design.versions.find((v) => v.id === ref || v.label.toLowerCase() === t || v.label.toLowerCase() === `version ${t}`) ?? null;
}

const counts = (v: DesignVersion) => {
  const c: Record<string, number> = {};
  for (const o of v.objects) { const cat = findEntry(DECOR_CATALOG, o.catalogId)?.category ?? 'other'; c[cat] = (c[cat] ?? 0) + 1; }
  return c;
};

const noDesign = () => fail('There is no AI design yet.', 'Ask the customer to create one on the Studio page ("Create your dream wedding"), then refine it here.');

function result(summary: string, r: Extract<ReturnType<NonNullable<ToolContext['design']>['replan']>, { ok: true }>, extra: Record<string, unknown> = {}): ToolResult {
  const v = r.state.design.versions.find((x) => x.id === r.versionId)!;
  return ok(`${summary} Saved as ${v.label}: ${v.objects.length} pieces, estimated ${formatInr(v.costInr)} (sample prices).`, {
    version: versionCard(v, r.state.design.activeVersionId), notes: r.plan.notes, substitutions: r.plan.substitutions, palette: r.plan.palette, priceNote: PRICE_NOTE, ...extra,
  });
}

export const designSpecialist: Specialist = {
  id: 'design',
  title: 'AI design',
  summary: 'Refine the AI-generated wedding design by instruction, make another version, restore or compare versions. Always re-plans through validated code; previous versions are kept.',
  tools: [
    defineTool({
      name: 'refineDesign',
      description: `Change the current AI design from a plain instruction. It edits the design brief and rebuilds the scene as a NEW version (old versions are kept). ${SUPPORTED} Pass the customer's words as instruction. Never invent positions.`,
      input: z.object({ instruction: z.string().trim().min(2).max(300) }),
      label: () => 'Refining the design',
      run: (i, ctx) => {
        const d = service(ctx);
        if (!d) return unavailable();
        const s = state(ctx);
        if (!s.design.brief) return noDesign();
        const ref = refineBrief(s.design.brief, i.instruction);
        if (!ref.supported) return fail('I could not turn that into a design change.', SUPPORTED);
        const notApplied: string[] = [];
        if (ref.emphasiseImage !== null) notApplied.push(`Giving more weight to photograph ${ref.emphasiseImage + 1} needs a new image analysis, which chat cannot run. Use the Studio page to generate again with that photograph.`);
        const real = ref.changes.filter((c) => !/^Giving more weight/.test(c));
        if (real.length === 0 && ref.budgetScale === null) return fail(notApplied[0] ?? 'Nothing to change.', 'Use the Studio page to generate again with that photograph emphasised, or ask for a different change.');
        let budget: number | undefined;
        if (ref.budgetScale !== null) {
          const base = s.budget.limits.decoration ?? s.design.form?.decorationBudgetInr ?? s.design.versions.find((v) => v.id === s.design.activeVersionId)?.costInr;
          if (!base) return fail('There is no decoration budget or design cost to reduce.', 'Ask the customer for a decoration budget first.');
          budget = Math.max(1, Math.round(base * ref.budgetScale));
        }
        const r = d.replan(ctx.weddingId, { brief: ref.brief, variant: s.design.variantCounter, ...(budget !== undefined ? { budgetInr: budget } : {}) });
        if (!r.ok) return fail(r.error, r.hint);
        // Lowering an existing customer limit needs no confirmation (only raising does), and it is done only after the new design applied.
        if (budget !== undefined && s.budget.limits.decoration !== undefined) { const l = apply(ctx, { type: 'set_budget_limit', category: 'decoration', amount: budget }); if (!l.ok) return toFail(l); }
        return result(`${real.join(' ')}`.trim() || 'Rebuilt the design within the lower budget.', r, { changes: real, notApplied });
      },
    }),
    defineTool({
      name: 'generateAnotherVersion',
      description: 'Make a different arrangement of the same design brief as a NEW version (same style, colours and pieces, different layout). The current design stays available as an earlier version. No new image analysis happens.',
      input: z.object({}),
      label: () => 'Making another version',
      run: (_i, ctx) => {
        const d = service(ctx);
        if (!d) return unavailable();
        if (!state(ctx).design.brief) return noDesign();
        const r = d.anotherNow(ctx.weddingId);
        return r.ok ? result('Made another arrangement of the same design.', r) : fail(r.error, r.hint);
      },
    }),
    defineTool({
      name: 'listDesignVersions',
      description: 'List the saved design versions (id, label, where each came from, piece count and estimated cost) and which one is active.',
      input: z.object({}),
      label: () => 'Listing design versions',
      run: (_i, ctx) => {
        const s = state(ctx);
        return ok(`${s.design.versions.length} design version${s.design.versions.length === 1 ? '' : 's'}.`, { versions: s.design.versions.map((v) => versionCard(v, s.design.activeVersionId)), priceNote: PRICE_NOTE });
      },
    }),
    defineTool({
      name: 'restoreDesignVersion',
      description: 'Make a saved design version the current scene. Pass its id or its label such as "Version 2". The scene it replaces can still be undone in the studio.',
      input: z.object({ versionId: z.string().trim().min(1).max(60) }),
      label: () => 'Restoring a design version',
      run: (i, ctx) => {
        const v = findVersion(state(ctx), i.versionId);
        if (!v) return fail(`No design version "${i.versionId}".`, 'Call listDesignVersions for real ids and labels.');
        const r = apply(ctx, { type: 'restore_design_version', id: v.id });
        return r.ok ? ok(`Restored ${v.label}: ${v.objects.length} pieces, estimated ${formatInr(v.costInr)} (sample prices).`, versionCard(v, v.id)) : toFail(r);
      },
    }),
    defineTool({
      name: 'compareDesignVersions',
      description: 'Compare two saved design versions: estimated cost, piece counts by category and colours. Computed from the versions; quote it exactly.',
      input: z.object({ versionIdA: z.string().trim().min(1).max(60), versionIdB: z.string().trim().min(1).max(60) }),
      label: () => 'Comparing design versions',
      run: (i, ctx) => {
        const s = state(ctx);
        const a = findVersion(s, i.versionIdA);
        const b = findVersion(s, i.versionIdB);
        if (!a || !b) return fail(`No design version "${!a ? i.versionIdA : i.versionIdB}".`, 'Call listDesignVersions for real ids and labels.');
        const ca = counts(a), cb = counts(b);
        const cats = [...new Set([...Object.keys(ca), ...Object.keys(cb)])].sort();
        const pal = (v: DesignVersion) => v.brief?.palette.map((p) => p.color) ?? [];
        return ok(`${a.label} ${formatInr(a.costInr)} (${a.objects.length} pieces) vs ${b.label} ${formatInr(b.costInr)} (${b.objects.length} pieces); difference ${formatInr(Math.abs(b.costInr - a.costInr))} (sample prices).`, {
          a: versionCard(a, s.design.activeVersionId), b: versionCard(b, s.design.activeVersionId), costDifferenceInr: b.costInr - a.costInr,
          piecesByCategory: cats.map((c) => ({ category: c, a: ca[c] ?? 0, b: cb[c] ?? 0 })), palette: { a: pal(a), b: pal(b) }, priceNote: PRICE_NOTE,
        });
      },
    }),
  ],
};
