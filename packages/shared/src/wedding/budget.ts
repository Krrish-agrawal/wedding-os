import { BUDGET_CATEGORIES, type BudgetCategory, type WeddingState } from './state.js';

/**
 * Deterministic budget arithmetic. The language model never computes a total: it calls tools that call these.
 */

/** Guideline split used by `suggestAllocation`. Illustrative planning ratios, not market data. Sums to 100. */
export const SAMPLE_SPLIT_PERCENT: Readonly<Record<BudgetCategory, number>> = {
  venue: 20,
  catering: 30,
  decoration: 15,
  photography: 8,
  attire: 12,
  entertainment: 6,
  travel: 4,
  miscellaneous: 5,
};

/** Splits `total` by SAMPLE_SPLIT_PERCENT with the largest-remainder method, so the parts sum to exactly `total`. */
export function suggestAllocation(total: number): Record<BudgetCategory, number> {
  const t = Math.max(0, Math.floor(total));
  const rows = BUDGET_CATEGORIES.map((c, i) => {
    const exact = (t * SAMPLE_SPLIT_PERCENT[c]) / 100;
    return { c, i, base: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = t - rows.reduce((s, r) => s + r.base, 0);
  const order = [...rows].sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const r of order) {
    if (left <= 0) break;
    r.base += 1;
    left -= 1;
  }
  return Object.fromEntries(rows.map((r) => [r.c, r.base])) as Record<BudgetCategory, number>;
}

export interface CategoryLine {
  category: BudgetCategory;
  allocated: number;
  spent: number;
  /** allocated - spent; negative when over. */
  remaining: number;
  over: boolean;
}

export interface BudgetSummary {
  total: number;
  allocated: number;
  unallocated: number;
  spent: number;
  /** total - spent. */
  remaining: number;
  lines: CategoryLine[];
  overspent: BudgetCategory[];
  /** True when planned spend or actual spend exceeds the total. */
  overBudget: boolean;
}

export function summarizeBudget(state: Pick<WeddingState, 'budget'>): BudgetSummary {
  const { total, allocations, expenses } = state.budget;
  const lines: CategoryLine[] = BUDGET_CATEGORIES.map((category) => {
    const allocated = allocations[category] ?? 0;
    const spent = expenses.filter((e) => e.category === category).reduce((s, e) => s + e.amount, 0);
    return { category, allocated, spent, remaining: allocated - spent, over: spent > allocated };
  });
  const allocated = lines.reduce((s, l) => s + l.allocated, 0);
  const spent = lines.reduce((s, l) => s + l.spent, 0);
  return {
    total,
    allocated,
    unallocated: total - allocated,
    spent,
    remaining: total - spent,
    lines,
    overspent: lines.filter((l) => l.over && l.spent > 0).map((l) => l.category),
    overBudget: allocated > total || spent > total,
  };
}

/** Rupees in Indian grouping, e.g. 1234567 -> "₹12,34,567". */
export function formatInr(n: number): string {
  const sign = n < 0 ? '-' : '';
  const s = String(Math.abs(Math.round(n)));
  if (s.length <= 3) return `${sign}₹${s}`;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}₹${rest},${last3}`;
}
