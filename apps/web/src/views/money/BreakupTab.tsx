import { useState } from 'react';
import { BadgePercent, ChevronDown } from 'lucide-react';
import { formatINR, groupLineItems, type LineItemGroupTotal, type PricedLineItem, type SaleTotals } from '@ave/shared';
import { Card, ICON_STROKE, cn } from '@/ui';
import { SourceLink } from './parts';

/** Groups in the left and right columns of the breakup, so the two columns come out about even. */
const LEFT_GROUPS = new Set(['base', 'charges']);

/** Itemised price: what each line is, how it was worked out, and where statutory rates come from. */
export function BreakupTab({ totals }: { totals: SaleTotals }) {
  const groups = groupLineItems(totals.items);
  const left = groups.filter((g) => LEFT_GROUPS.has(g.group));
  const right = groups.filter((g) => !LEFT_GROUPS.has(g.group));

  return (
    <div className="grid grid-cols-1 items-start gap-4 @4xl:grid-cols-2">
      <div className="flex flex-col gap-4">
        {left.map((g) => (
          <GroupCard key={g.group} group={g} />
        ))}
        {totals.discounts.length > 0 && <DiscountsCard totals={totals} />}
      </div>
      <div className="flex flex-col gap-4">
        {right.map((g) => (
          <GroupCard key={g.group} group={g} />
        ))}
      </div>
    </div>
  );
}

function GroupCard({ group }: { group: LineItemGroupTotal }) {
  return (
    <Card elevation="flat" as="section" className="px-4 pb-2 pt-3" aria-label={group.label}>
      <header className="flex items-baseline justify-between gap-3 border-b-2 border-line pb-2">
        <h3 className="text-[15px] font-extrabold leading-tight">{group.label}</h3>
        <span className="text-sm font-bold tabular">{formatINR(group.amount)}</span>
      </header>
      <ul className="divide-y divide-line">
        {group.items.map((item) => (
          <LineItemRow key={item.id} item={item} />
        ))}
      </ul>
    </Card>
  );
}

function LineItemRow({ item }: { item: PricedLineItem }) {
  const [open, setOpen] = useState(false);
  const noteId = `note-${item.id}`;
  return (
    <li className="py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {item.note ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={noteId}
              className="rounded-[6px] text-left text-sm font-semibold leading-snug hover:underline"
            >
              {item.label}
              <ChevronDown
                size={14}
                strokeWidth={ICON_STROKE}
                aria-hidden
                className={cn('ml-1 inline-block align-[-2px] text-ink-soft transition-transform duration-150', open && 'rotate-180')}
              />
            </button>
          ) : (
            <p className="text-sm font-semibold leading-snug">{item.label}</p>
          )}
          {item.basis || item.source ? (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-soft tabular">
              {item.basis ? <span>{item.basis}</span> : null}
              {item.source ? <SourceLink href={item.source} /> : null}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 pt-px text-sm font-semibold tabular">{formatINR(item.amount)}</span>
      </div>
      {item.note && open ? (
        <p id={noteId} className="mt-1.5 rounded-[10px] bg-paper px-2.5 py-1.5 text-xs leading-snug text-ink-soft">
          {item.note}
        </p>
      ) : null}
    </li>
  );
}

function DiscountsCard({ totals }: { totals: SaleTotals }) {
  return (
    <Card elevation="flat" as="section" className="bg-coral-tint px-4 pb-2 pt-3" aria-label="Offers applied">
      <header className="flex items-baseline justify-between gap-3 border-b-2 border-ink/10 pb-2">
        <h3 className="flex items-center gap-1.5 text-[15px] font-extrabold leading-tight">
          <BadgePercent size={16} strokeWidth={ICON_STROKE} aria-hidden />
          Offers applied
        </h3>
        <span className="text-sm font-bold text-coral-deep tabular">− {formatINR(totals.discountTotal)}</span>
      </header>
      <ul className="divide-y divide-ink/10">
        {totals.discounts.map((d) => (
          <li key={d.offerId} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span className="font-semibold">{d.title}</span>
            <span className="shrink-0 font-semibold text-coral-deep tabular">− {formatINR(d.amount)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
