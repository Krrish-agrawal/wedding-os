import {
  computeLeaseTotals,
  computeSaleTotals,
  formatINRShort,
  formatSqft,
  type PropertyBundle,
  type SaleTotals,
} from '@ave/shared';
import { content } from '@/content';

export interface PriceFigure {
  /** "Estimated total" or "Monthly, all-in". */
  label: string;
  value: number;
  /** Shown after the number, e.g. "/month". */
  suffix: string | null;
  /** One supporting line, e.g. per-seat cost or the discount applied. */
  note: string | null;
}

export interface KeyFigures {
  price: PriceFigure | null;
  area: { label: string; text: string };
}

export function offersFor(propertyId: string) {
  return content.offers.properties[propertyId]?.offers ?? [];
}

/** Sale totals with the buyer's applied offers, or null if the money file cannot be priced. */
export function saleTotals(bundle: PropertyBundle, appliedOfferIds: string[]): SaleTotals | null {
  if (bundle.money.kind !== 'sale') return null;
  try {
    return computeSaleTotals(bundle.money, bundle.property.areas, offersFor(bundle.property.id), appliedOfferIds);
  } catch (err) {
    console.error(`[shortlist] could not price ${bundle.property.id}`, err);
    return null;
  }
}

/** The two numbers a buyer looks for first, computed from the data (never typed). */
export function keyFigures(bundle: PropertyBundle, appliedOfferIds: string[]): KeyFigures {
  const area = { label: 'Carpet area', text: formatSqft(bundle.property.areas.carpetSqft) };

  if (bundle.money.kind === 'lease') {
    const lease = computeLeaseTotals(bundle.money);
    return {
      price: {
        label: 'Monthly, all-in',
        value: lease.monthlyTotal,
        suffix: '/month',
        note: `${formatINRShort(lease.perSeatMonthly)} per seat · ${bundle.money.seats} seats`,
      },
      area,
    };
  }

  const totals = saleTotals(bundle, appliedOfferIds);
  if (!totals) return { price: null, area };
  return {
    price: {
      label: 'Estimated total',
      value: totals.total,
      suffix: null,
      note:
        totals.discountTotal > 0
          ? `After ${formatINRShort(totals.discountTotal)} in offers`
          : totals.items.some((i) => i.group === 'government')
            ? 'Includes government charges'
            : null,
    },
    area,
  };
}
