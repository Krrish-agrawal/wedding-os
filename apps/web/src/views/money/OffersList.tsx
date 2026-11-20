import { BadgePercent, Check, Gift, Undo2 } from 'lucide-react';
import {
  checkOfferApplication,
  formatINR,
  formatINRShort,
  type ClientRole,
  type Offer,
  type OfferCheckReason,
  type OfferTotals,
  type PropertyOfferPolicy,
} from '@ave/shared';
import { Button, EmptyState, ICON_STROKE, Tag, cn } from '@/ui';

/** Why the buyer cannot apply an offer right now, in their words. */
const BLOCKED_COPY: Partial<Record<OfferCheckReason, string>> = {
  not_stackable: 'Cannot be combined with an offer you already have',
  over_limit: 'Not available together with the offers already applied',
  unknown_offer: 'No longer available',
};

interface OffersListProps {
  policy: PropertyOfferPolicy;
  totals: OfferTotals;
  onApply: (offerId: string) => void;
  onRemove: (offerId: string) => void;
  role: ClientRole;
  /** Tighter cards for the lease layout. */
  compact?: boolean;
}

/**
 * The property's offers with their computed value. Applying is the buyer's own click,
 * so it goes straight through; the advisor asks first when it applies one by voice.
 */
export function OffersList({ policy, totals, onApply, onRemove, role, compact = false }: OffersListProps) {
  if (policy.offers.length === 0) {
    return (
      <EmptyState
        mascotSize={80}
        title="No offers on this property right now"
        body="Your advisor can check with the builder and let you know if one opens up."
      />
    );
  }
  const applied = new Set(totals.discounts.map((d) => d.offerId));
  const usedPct = totals.subtotal > 0 ? (totals.discountTotal / totals.subtotal) * 100 : 0;

  return (
    <div className="flex flex-col gap-3">
      <ul className={cn('grid grid-cols-1 gap-3', compact && '@4xl:grid-cols-2')}>
        {policy.offers.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            amount={totals.offerValues[offer.id] ?? 0}
            applied={applied.has(offer.id)}
            blocked={applied.has(offer.id) ? null : blockedReason(policy, totals, offer.id)}
            onApply={() => onApply(offer.id)}
            onRemove={() => onRemove(offer.id)}
            compact={compact}
          />
        ))}
      </ul>
      {role !== 'buyer' && (
        <p className="text-xs text-ink-soft tabular">
          Advisor view: the AI advisor may give up to {policy.maxDiscountPct}% in total; above {policy.handoffAbovePct}% it hands over to
          a senior advisor. Used so far: {usedPct.toFixed(2)}%.
        </p>
      )}
    </div>
  );
}

function blockedReason(policy: PropertyOfferPolicy, totals: OfferTotals, offerId: string): string | null {
  const check = checkOfferApplication(policy, totals, offerId);
  return check.allowed ? null : BLOCKED_COPY[check.reason] ?? null;
}

function OfferCard({
  offer,
  amount,
  applied,
  blocked,
  onApply,
  onRemove,
  compact,
}: {
  offer: Offer;
  amount: number;
  applied: boolean;
  blocked: string | null;
  onApply: () => void;
  onRemove: () => void;
  compact: boolean;
}) {
  const Icon = offer.type === 'waiver' ? Gift : BadgePercent;
  return (
    <li
      className={cn(
        'flex gap-4 rounded-[16px] border-2 p-4 transition-colors',
        compact ? 'flex-col' : 'items-center',
        applied ? 'border-ink bg-coral-tint shadow-[var(--shadow-pop-sm)]' : 'border-ink bg-canvas',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden
          className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border-2 border-ink', applied ? 'bg-coral' : 'bg-coral-tint')}
        >
          <Icon size={18} strokeWidth={ICON_STROKE} />
        </span>
        <div className="min-w-0">
          <p className="font-bold leading-snug">{offer.title}</p>
          <p className="text-sm leading-snug text-ink-soft">{offer.description}</p>
          {blocked && !applied ? <p className="mt-1 text-xs font-semibold text-ink-soft">{blocked}</p> : null}
        </div>
      </div>
      <div className={cn('flex shrink-0 items-center gap-3', compact && 'justify-between')}>
        <div className="text-right">
          <p className="text-xs font-semibold text-ink-soft">{applied ? 'You save' : 'Saves'}</p>
          <p className="font-display text-xl font-extrabold leading-none tabular" title={formatINR(amount)}>
            {formatINRShort(amount)}
          </p>
        </div>
        {applied ? (
          <div className="flex flex-col items-end gap-1">
            <Tag accent="mint" icon={Check}>
              Applied
            </Tag>
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex items-center gap-1 rounded-[6px] text-xs font-semibold text-ink-soft hover:text-ink hover:underline"
            >
              <Undo2 size={12} strokeWidth={ICON_STROKE} aria-hidden />
              Remove
            </button>
          </div>
        ) : (
          <Button variant="danger" size="sm" onClick={onApply} disabled={blocked !== null} aria-label={`Apply ${offer.title}`}>
            Apply
          </Button>
        )}
      </div>
    </li>
  );
}
