import { BadgePercent } from 'lucide-react';
import {
  AREA_LABELS,
  formatINR,
  formatINRShort,
  formatIndianNumber,
  groupLineItems,
  type LineItemGroup,
  type Property,
  type SaleTotals,
} from '@ave/shared';
import { Card, CountUp, ICON_STROKE, Tag } from '@/ui';
import { EstimateNote } from './parts';

/** Fill per line-item group in the composition bar: the money accent and neutrals only. */
const GROUP_FILL: Record<LineItemGroup, string> = {
  base: 'bg-coral',
  charges: 'bg-coral-tint',
  government: 'bg-ink',
  deposits: 'bg-paper',
};

/** "Your price": the running total that counts to its new value when an offer is applied. */
export function PriceCard({ totals, property, estimateNote }: { totals: SaleTotals; property: Property; estimateNote: string }) {
  const groups = groupLineItems(totals.items);
  const { areas } = property;
  const perSqft = areas.superBuiltUpSqft > 0 ? totals.total / areas.superBuiltUpSqft : 0;

  return (
    <Card as="aside" className="flex flex-col p-5" aria-label="Your price">
      <p className="text-sm font-semibold text-ink-soft">Your price</p>
      <p className="mt-1 font-display text-[44px] font-extrabold leading-none tracking-[-0.02em]">
        <CountUp value={totals.total} format={formatINRShort} />
      </p>
      <p className="mt-1.5 text-sm font-semibold text-ink-soft">
        <CountUp value={totals.total} format={formatINR} />
      </p>

      {totals.discountTotal > 0 ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-[12px] border-2 border-ink bg-coral-tint px-3 py-2 text-sm">
          <span className="flex items-center gap-1.5 font-semibold">
            <BadgePercent size={15} strokeWidth={ICON_STROKE} aria-hidden />
            Offers
          </span>
          <span className="font-bold text-coral-deep tabular">
            − <CountUp value={totals.discountTotal} format={formatINR} />
          </span>
        </div>
      ) : null}

      <div className="mt-5">
        <div className="flex h-4 overflow-hidden rounded-full border-2 border-ink" role="img" aria-label="What makes up the price">
          {groups.map((g, i) => (
            <div
              key={g.group}
              className={`${GROUP_FILL[g.group]} ${i > 0 ? 'border-l-2 border-ink' : ''} h-full`}
              style={{ width: `${(g.amount / totals.subtotal) * 100}%` }}
            />
          ))}
        </div>
        <dl className="mt-3 flex flex-col gap-1.5">
          {groups.map((g) => (
            <div key={g.group} className="flex items-center justify-between gap-3 text-sm">
              <dt className="flex min-w-0 items-center gap-2 text-ink-soft">
                <span aria-hidden className={`h-3 w-3 shrink-0 rounded-[4px] border-2 border-ink ${GROUP_FILL[g.group]}`} />
                <span className="truncate">{g.label}</span>
              </dt>
              <dd className="shrink-0 font-semibold tabular">{formatINRShort(g.amount)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-5 rounded-[14px] bg-paper px-3 py-2.5">
        <p className="text-xs font-semibold text-ink-soft">All-in, per sq ft {AREA_LABELS.superBuiltUp}</p>
        <p className="font-display text-xl font-extrabold tabular">
          <CountUp value={perSqft} format={formatINR} />
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Tag className="bg-canvas">Carpet {formatIndianNumber(areas.carpetSqft)} sq ft</Tag>
          <Tag className="bg-canvas">Built-up {formatIndianNumber(areas.builtUpSqft)}</Tag>
          <Tag className="bg-canvas">Super built-up {formatIndianNumber(areas.superBuiltUpSqft)}</Tag>
        </div>
      </div>

      <EstimateNote className="mt-auto pt-4">{estimateNote}</EstimateNote>
    </Card>
  );
}
