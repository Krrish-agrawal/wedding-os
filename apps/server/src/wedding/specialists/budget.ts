import { z } from 'zod';
import { BUDGET_CATEGORIES, BudgetCategorySchema, DECOR_CATALOG, MAX_AMOUNT_INR, PRICE_NOTE, costLines, formatInr, sceneCost, suggestAllocation, suggestTrim, summarizeBudget, type BudgetCategory, type WeddingState } from '@ave/shared';
import { apply, defineTool, fail, ok, propose, resolveAsset, shortId, significantChange, state, toFail, type Specialist, type ToolContext } from '../toolkit.js';

/**
 * Budget specialist. Every number comes from deterministic code in @ave/shared (summarizeBudget,
 * suggestAllocation, sceneCost, suggestTrim); the model reads results and never adds anything up itself.
 * Prices for decorations are SAMPLE prices from the catalogue, not vendor quotations.
 */

const Rupees = z.number().int().min(0).max(MAX_AMOUNT_INR).describe('Whole rupees. 1 lakh = 100000, 1 crore = 10000000.');

/** The ceiling that applies to a category: an explicit limit first, then the planned allocation. */
function constraintFor(s: WeddingState, category: BudgetCategory, override?: number) {
  if (override !== undefined) return { kind: 'limit' as const, amount: override, source: 'requested for this check' };
  const limit = s.budget.limits[category];
  if (limit !== undefined) return { kind: 'limit' as const, amount: limit, source: 'customer limit' };
  const planned = s.budget.allocations[category];
  if (planned !== undefined && planned > 0) return { kind: 'allocation' as const, amount: planned, source: 'planned allocation' };
  return null;
}

function decorationReport(s: WeddingState, extraCost: number, limitOverride?: number) {
  const current = sceneCost(s.scene.objects);
  const constraint = constraintFor(s, 'decoration', limitOverride);
  const projected = current + extraCost;
  const over = constraint ? Math.max(0, projected - constraint.amount) : 0;
  return {
    currentSceneEstimateInr: current,
    additionalInr: extraCost,
    projectedInr: projected,
    constraint,
    withinConstraint: constraint ? projected <= constraint.amount : null,
    overByInr: over,
    roomLeftInr: constraint ? constraint.amount - projected : null,
    lines: costLines(s.scene.objects),
    priceIsSample: true,
    note: PRICE_NOTE,
  };
}

const money = (n: number) => formatInr(n);

export const budgetSpecialist: Specialist = {
  id: 'budget',
  title: 'Budget',
  summary: 'Reads and updates the wedding budget and spending limits, and estimates decoration cost. All arithmetic is done by code.',
  tools: [
    defineTool({
      name: 'getBudgetSummary',
      description: 'Read the current budget: total, planned allocations per category, recorded expenses, what remains, the customer\'s spending limits, and the estimated cost of the current 3D decoration (sample prices). Always call this rather than working out a number yourself.',
      input: z.object({}),
      label: () => 'Reading the budget',
      run: (_i, ctx) => {
        const s = state(ctx);
        const b = summarizeBudget(s);
        const dec = decorationReport(s, 0);
        return ok(`Budget ${b.total > 0 ? money(b.total) : 'not set'}; decoration estimate ${money(dec.currentSceneEstimateInr)} (sample prices).`, { ...b, limits: s.budget.limits, decoration: dec });
      },
    }),

    defineTool({
      name: 'setTotalBudget',
      description: 'Set the total wedding budget. Changing an existing total by more than 10% does not happen immediately: it creates a proposal the customer must confirm in the chat.',
      input: z.object({ total: Rupees }),
      label: (i) => `Setting the budget to ${money(i.total)}`,
      run: (i, ctx) => {
        const prev = state(ctx).budget.total;
        if (significantChange(prev, i.total)) {
          return propose(ctx, { tool: 'setTotalBudget', kind: 'budget', summary: `Change the total budget from ${money(prev)} to ${money(i.total)}`, changes: [{ label: 'Total budget', from: money(prev), to: money(i.total) }], action: { type: 'set_total_budget', total: i.total } });
        }
        const r = apply(ctx, { type: 'set_total_budget', total: i.total });
        if (!r.ok) return toFail(r);
        return ok(`Total budget is now ${money(i.total)}.`, summarizeBudget(r.state));
      },
    }),

    defineTool({
      name: 'allocateBudget',
      description: 'Plan how the total budget is divided between categories. mode "guideline" fills every category using the standard percentage split of the total (computed by code). mode "custom" sets only the categories you pass. Allocations can never exceed the total. Changing an existing allocation by more than 10% does not happen immediately: it creates a proposal the customer must confirm in the chat.',
      input: z.object({ mode: z.enum(['guideline', 'custom']), allocations: z.partialRecord(BudgetCategorySchema, Rupees).optional() }),
      label: (i) => (i.mode === 'guideline' ? 'Splitting the budget' : 'Updating category budgets'),
      run: (i, ctx) => {
        const s = state(ctx);
        let next: Partial<Record<BudgetCategory, number>>;
        if (i.mode === 'guideline') {
          if (s.budget.total <= 0) return fail('The total budget is not set yet.', 'Ask the customer for a total budget, call setTotalBudget, then try again.');
          next = suggestAllocation(s.budget.total);
        } else {
          if (!i.allocations || Object.keys(i.allocations).length === 0) return fail('No allocations were given for custom mode.', 'Pass allocations like {"decoration": 200000}.');
          next = i.allocations;
        }
        const bigOnes = (Object.entries(next) as [BudgetCategory, number][]).filter(([c, v]) => significantChange(s.budget.allocations[c] ?? 0, v));
        if (bigOnes.length > 0) {
          return propose(ctx, {
            tool: 'allocateBudget', kind: 'budget', summary: `Change ${bigOnes.length} category budget${bigOnes.length === 1 ? '' : 's'}: ${bigOnes.map(([c]) => c).join(', ')}`,
            changes: bigOnes.map(([c, v]) => ({ label: `${c} allocation`, from: money(s.budget.allocations[c] ?? 0), to: money(v) })), action: { type: 'set_allocations', allocations: next },
          });
        }
        const r = apply(ctx, { type: 'set_allocations', allocations: next });
        if (!r.ok) return toFail(r);
        return ok(i.mode === 'guideline' ? `Split ${money(r.state.budget.total)} across all categories.` : 'Updated the category budgets.', summarizeBudget(r.state));
      },
    }),

    defineTool({
      name: 'setBudgetLimit',
      description: 'Record a ceiling the customer wants kept, e.g. "keep decoration under ₹2 lakhs" (category decoration, amount 200000). While a decoration limit is set, additions that would push the decoration estimate over it are refused. amount null removes the limit. Raising an existing limit by more than 10% does not happen immediately: it creates a proposal the customer must confirm in the chat.',
      input: z.object({ category: BudgetCategorySchema, amount: Rupees.nullable() }),
      label: (i) => (i.amount === null ? `Removing the ${i.category} limit` : `Limiting ${i.category} to ${money(i.amount)}`),
      run: (i, ctx) => {
        const prev = state(ctx).budget.limits[i.category];
        if (i.amount !== null && prev !== undefined && i.amount > prev && significantChange(prev, i.amount)) {
          return propose(ctx, { tool: 'setBudgetLimit', kind: 'budget', summary: `Raise the ${i.category} limit from ${money(prev)} to ${money(i.amount)}`, changes: [{ label: `${i.category} limit`, from: money(prev), to: money(i.amount) }], action: { type: 'set_budget_limit', category: i.category, amount: i.amount } });
        }
        const r = apply(ctx, { type: 'set_budget_limit', category: i.category, amount: i.amount });
        if (!r.ok) return toFail(r);
        const dec = i.category === 'decoration' ? decorationReport(r.state, 0) : null;
        return ok(i.amount === null ? `Removed the ${i.category} limit.` : `The ${i.category} limit is now ${money(i.amount)}.`, { category: i.category, limitInr: i.amount, ...(dec ? { decoration: dec } : {}) });
      },
    }),

    defineTool({
      name: 'estimateDecorationCost',
      description: 'Estimate decoration cost with SAMPLE prices. With no items, estimates the scene as it is now. With items (assetId + quantity), also estimates adding them. Reports the current estimate, the proposed total, the limit that applies (customer limit, else planned allocation, else the limit you pass), whether it fits, how much it is over, and — when the current scene is over — which pieces could be removed to fit. Use before adding things when a budget matters.',
      input: z.object({ items: z.array(z.object({ assetId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(50).default(1) })).max(30).optional(), limit: Rupees.optional() }),
      label: () => 'Calculating the decoration estimate',
      run: (i, ctx) => {
        const s = state(ctx);
        let extra = 0;
        const proposed: { assetId: string; name: string; quantity: number; unitPriceInr: number; subtotalInr: number }[] = [];
        for (const it of i.items ?? []) {
          const f = resolveAsset(it.assetId);
          if ('error' in f) return fail(f.error, f.hint);
          const sub = f.entry.samplePrice * it.quantity;
          extra += sub;
          proposed.push({ assetId: f.entry.id, name: f.entry.name, quantity: it.quantity, unitPriceInr: f.entry.samplePrice, subtotalInr: sub });
        }
        const report = decorationReport(s, extra, i.limit);
        const trim = report.constraint && sceneCost(s.scene.objects) > report.constraint.amount ? suggestTrim(s.scene.objects, report.constraint.amount) : null;
        const names = trim ? trim.removeIds.map((id) => ({ id, name: DECOR_CATALOG.find((e) => e.id === s.scene.objects.find((o) => o.id === id)?.catalogId)?.name })) : [];
        const verdict = report.constraint ? (report.withinConstraint ? `fits within ${money(report.constraint.amount)}` : `is ${money(report.overByInr)} over the ${money(report.constraint.amount)} ${report.constraint.source}`) : 'has no limit to compare against';
        return ok(`Estimated decoration cost ${money(report.projectedInr)} (sample prices) — ${verdict}.`, { ...report, proposed, trimSuggestion: trim ? { ...trim, remove: names } : null });
      },
    }),

    defineTool({
      name: 'addExpense',
      description: 'Record money actually spent or committed in one budget category (not an estimate).',
      input: z.object({ category: BudgetCategorySchema, label: z.string().trim().min(1).max(80), amount: Rupees }),
      label: (i) => `Recording ${money(i.amount)} on ${i.category}`,
      run: (i, ctx) => {
        const r = apply(ctx, { type: 'add_expense', expense: { id: shortId(), category: i.category, label: i.label, amount: i.amount } });
        if (!r.ok) return toFail(r);
        return ok(`Recorded ${money(i.amount)} on ${i.category}.`, summarizeBudget(r.state));
      },
    }),

    defineTool({
      name: 'checkBudgetFeasibility',
      description: 'Check whether an extra cost in one category fits: compares committed spend plus the extra cost against the category\'s customer limit, else its planned allocation, else a limit you pass. For decoration, committed spend is the estimate of the current 3D scene (sample prices); for other categories it is recorded expenses. Returns whether it fits and by how much it is over.',
      input: z.object({ category: z.enum(BUDGET_CATEGORIES).default('decoration'), additionalCost: Rupees.default(0), limit: Rupees.optional() }),
      label: (i) => `Checking the ${i.category} budget`,
      run: (i, ctx) => {
        const s = state(ctx);
        const b = summarizeBudget(s);
        const committed = i.category === 'decoration' ? sceneCost(s.scene.objects) : (b.lines.find((l) => l.category === i.category)?.spent ?? 0);
        const constraint = constraintFor(s, i.category, i.limit);
        const projected = committed + i.additionalCost;
        const within = constraint ? projected <= constraint.amount : null;
        return ok(constraint ? `${i.category}: ${money(projected)} ${within ? 'fits within' : 'exceeds'} ${money(constraint.amount)}.` : `${i.category}: no limit or allocation set to check against.`, {
          category: i.category, committedInr: committed, additionalInr: i.additionalCost, projectedInr: projected, constraint, withinConstraint: within,
          overByInr: constraint ? Math.max(0, projected - constraint.amount) : 0, totalBudgetInr: b.total, recordedSpendInr: b.spent, priceIsSample: i.category === 'decoration',
        });
      },
    }),
  ],
};

export type { ToolContext };
