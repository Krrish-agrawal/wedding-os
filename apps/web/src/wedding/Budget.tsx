import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { BUDGET_CATEGORIES, PRICE_NOTE, formatInr, sceneCost, suggestAllocation, summarizeBudget, type BudgetCategory } from '@ave/shared';
import { Button, Card, Notice, TextField } from '@/ui';
import { useWedding } from './useWedding';

const LABEL: Record<BudgetCategory, string> = { venue: 'Venue', catering: 'Catering', decoration: 'Decoration', photography: 'Photography', attire: 'Attire', entertainment: 'Entertainment', travel: 'Travel', miscellaneous: 'Miscellaneous' };

export default function Budget() {
  const { state, act } = useWedding();
  const [total, setTotal] = useState('');
  const [limitText, setLimitText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exp, setExp] = useState<{ category: BudgetCategory; label: string; amount: string }>({ category: 'venue', label: '', amount: '' });

  if (!state) return <p className="text-ink-soft">Loading…</p>;
  const b = summarizeBudget(state);
  const estimate = sceneCost(state.scene.objects);
  const limit = state.budget.limits.decoration;

  const run = async (p: Promise<string | null>) => setError(await p);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="font-display text-4xl font-extrabold">Budget Planner</h1>
      <Notice tone="info" title="All totals are calculated by code" body="The AI planner can change these numbers only through the same validated actions as this page." live="off" />
      {error ? <Notice tone="error" title="That change was refused" body={error} live="assertive" /> : null}
      {b.overBudget ? <Notice tone="warn" title="Over budget" body={`Planned ${formatInr(b.allocated)} and spent ${formatInr(b.spent)} against a total of ${formatInr(b.total)}.`} /> : null}

      <Card className="flex flex-wrap items-end gap-3 p-5">
        <TextField className="w-56" label="Total budget (₹)" type="number" min={0} placeholder={b.total ? String(b.total) : 'e.g. 2500000'} value={total} onChange={(e) => setTotal(e.target.value)} hint={b.total ? `Currently ${formatInr(b.total)}` : undefined} />
        <Button disabled={total === ''} onClick={() => void run(act({ type: 'set_total_budget', total: Number(total) }).then((e) => { if (!e) setTotal(''); return e; }))}>Set total</Button>
        <Button variant="secondary" disabled={b.total <= 0} onClick={() => void run(act({ type: 'set_allocations', allocations: suggestAllocation(b.total) }))}>Split with the standard guideline</Button>
      </Card>

      <Card className="flex flex-col gap-3 p-5" aria-label="Decoration limit">
        <h2 className="font-display text-xl font-extrabold">Decoration limit</h2>
        <p className="text-sm text-ink-soft">The 3D scene is estimated at <strong className="text-ink">{formatInr(estimate)}</strong>. {PRICE_NOTE} While a limit is set, additions that would pass it are refused, whether you or the planner make them.</p>
        <div className="flex flex-wrap items-end gap-3">
          <TextField className="w-56" label="Keep decoration under (₹)" type="number" min={0} value={limitText} placeholder={limit !== undefined ? String(limit) : 'e.g. 200000'} onChange={(e) => setLimitText(e.target.value)} hint={limit !== undefined ? `Currently ${formatInr(limit)}${estimate > limit ? ` · scene is ${formatInr(estimate - limit)} over` : ''}` : 'No limit set'} />
          <Button disabled={limitText === ''} onClick={() => void run(act({ type: 'set_budget_limit', category: 'decoration', amount: Number(limitText) }).then((e) => { if (!e) setLimitText(''); return e; }))}>Set limit</Button>
          <Button variant="ghost" disabled={limit === undefined} onClick={() => void run(act({ type: 'set_budget_limit', category: 'decoration', amount: null }))}>Remove limit</Button>
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="tabular w-full text-left text-[15px]">
          <thead>
            <tr className="border-b-2 border-ink text-[13px] text-ink-soft">
              <th className="p-3 font-semibold">Category</th>
              <th className="p-3 text-right font-semibold">Planned</th>
              <th className="p-3 text-right font-semibold">Spent</th>
              <th className="p-3 text-right font-semibold">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {b.lines.map((l) => (
              <tr key={l.category} className="border-b border-line">
                <td className="p-3 font-semibold">{LABEL[l.category]}</td>
                <td className="p-3 text-right">{formatInr(l.allocated)}</td>
                <td className="p-3 text-right">{formatInr(l.spent)}</td>
                <td className={`p-3 text-right font-semibold ${l.over && l.spent > 0 ? 'text-coral-deep' : ''}`}>{formatInr(l.remaining)}</td>
              </tr>
            ))}
            <tr className="font-extrabold">
              <td className="p-3">Total</td>
              <td className="p-3 text-right">{formatInr(b.allocated)}</td>
              <td className="p-3 text-right">{formatInr(b.spent)}</td>
              <td className="p-3 text-right">{formatInr(b.remaining)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-display text-xl font-extrabold">Record an expense</h2>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void run(act({ type: 'add_expense', expense: { id: crypto.randomUUID().slice(0, 8), category: exp.category, label: exp.label.trim(), amount: Number(exp.amount) } }).then((er) => { if (!er) setExp({ ...exp, label: '', amount: '' }); return er; })); }}>
          <label className="flex flex-col gap-1.5 text-sm font-bold">Category
            <select value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value as BudgetCategory })} className="h-12 rounded-[var(--radius-control)] border-2 border-ink/25 bg-canvas px-3 font-normal">
              {BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{LABEL[c]}</option>)}
            </select>
          </label>
          <TextField className="w-56" label="What for" value={exp.label} onChange={(e) => setExp({ ...exp, label: e.target.value })} maxLength={80} required />
          <TextField className="w-40" label="Amount (₹)" type="number" min={0} value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} required />
          <Button type="submit">Add expense</Button>
        </form>
        {state.budget.expenses.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {state.budget.expenses.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 rounded-[12px] border-2 border-line px-3 py-2">
                <span className="min-w-0 truncate"><strong>{LABEL[x.category]}</strong> · {x.label}</span>
                <span className="flex items-center gap-2 font-semibold">{formatInr(x.amount)}
                  <Button iconOnly size="sm" variant="ghost" icon={Trash2} label={`Remove ${x.label}`} onClick={() => void run(act({ type: 'remove_expense', expenseId: x.id }))} />
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-soft">No expenses recorded yet.</p>}
      </Card>
    </div>
  );
}
