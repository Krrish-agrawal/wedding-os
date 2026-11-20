import { useMemo } from 'react';
import { Armchair, CalendarRange, Check, IndianRupee, Lock, PiggyBank, TrendingUp, type LucideIcon } from 'lucide-react';
import {
  AREA_LABELS,
  computeLeaseOfferTotals,
  computeLeaseTotals,
  formatINR,
  formatINRShort,
  type LeaseMoney,
  type PropertyBundle,
} from '@ave/shared';
import { Card, CountUp, ICON_STROKE, Tag } from '@/ui';
import type { ViewProps } from '../types';
import { OffersList } from './OffersList';
import { EstimateNote, FigureRow, SourceLink, ViewHeader } from './parts';
import { offerPolicyFor } from './policy';

interface LeaseMoneyViewProps extends ViewProps {
  bundle: PropertyBundle;
  money: LeaseMoney;
}

function months(n: number): string {
  return `${n} ${n === 1 ? 'month' : 'months'}`;
}

/** Lease variant: the monthly cost, per-seat cost, deposit, term, escalation, inclusions and offers. */
export function LeaseMoneyView({ state, bundle, money, dispatch, role }: LeaseMoneyViewProps) {
  const { property } = bundle;
  const propertyId = property.id;
  const policy = offerPolicyFor(propertyId);
  const appliedKey = (state.appliedOffers[propertyId] ?? []).join('|');

  const lease = useMemo(() => computeLeaseTotals(money), [money]);
  const term = useMemo(
    () => computeLeaseOfferTotals(money, policy.offers, appliedKey ? appliedKey.split('|') : []),
    [money, policy.offers, appliedKey],
  );

  // An independent building has no shared areas, so its super built-up equals its built-up area.
  const areaKind = property.areas.superBuiltUpSqft > property.areas.builtUpSqft ? 'superBuiltUp' : 'builtUp';
  const area = areaKind === 'superBuiltUp' ? property.areas.superBuiltUpSqft : property.areas.builtUpSqft;
  const perSqft = (amount: number) => (area > 0 ? `${formatINR(amount / area)} per sq ft ${AREA_LABELS[areaKind]}` : undefined);
  const gstOn = (amount: number) => Math.round((money.gstPct / 100) * amount);
  const termAfterOffers = term.total;
  const termGst = gstOn(termAfterOffers);

  return (
    <div className="@container flex h-full flex-col gap-5 overflow-y-auto p-6 scroll-quiet">
      <ViewHeader
        accent="coral"
        icon={IndianRupee}
        eyebrow={`${property.name} · ${property.configuration}`}
        title="Lease terms"
        aside={
          <>
            <Tag accent="coral">For lease</Tag>
            <Tag>{property.possession}</Tag>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(260px,320px)] items-start gap-5">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-1 items-start gap-4 @4xl:grid-cols-2">
            <Card elevation="flat" as="section" className="p-5" aria-label="Every month">
              <h3 className="text-lg font-extrabold leading-tight">Every month</h3>
              <dl className="mt-2 divide-y-2 divide-line">
                <FigureRow label="Rent" hint={perSqft(money.rentMonthly)} value={formatINR(money.rentMonthly)} />
                <FigureRow label="Maintenance" hint={perSqft(money.maintenanceMonthly)} value={formatINR(money.maintenanceMonthly)} />
                <FigureRow
                  label={`GST at ${money.gstPct}%`}
                  hint={
                    <>
                      On rent and maintenance {money.gstSource ? <SourceLink href={money.gstSource} /> : null}
                    </>
                  }
                  value={formatINR(lease.gst)}
                />
                <FigureRow label="Monthly total" value={formatINR(lease.monthlyTotal)} emphasis />
              </dl>
            </Card>

            <Card elevation="flat" as="section" className="p-5" aria-label="Key terms">
              <h3 className="text-lg font-extrabold leading-tight">Key terms</h3>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <Term icon={PiggyBank} label="Security deposit" value={formatINRShort(lease.deposit)} hint={`${months(money.depositMonths)}' rent, refundable`} />
                <Term icon={Lock} label="Lock-in" value={months(money.lockInMonths)} hint="Neither side can exit" />
                <Term icon={CalendarRange} label="Term" value={months(money.termMonths)} hint={`Lock-in is the first ${months(money.lockInMonths)}`} />
                <Term
                  icon={TrendingUp}
                  label="Escalation"
                  value={`${money.escalationPct}%`}
                  hint={`On rent, every ${months(money.escalationEveryMonths)}`}
                />
                <Term icon={Armchair} label="Fit-out" value="" hint={money.fitOut} wide />
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 items-start gap-4 @4xl:grid-cols-2">
            <Card elevation="flat" as="section" className="p-5" aria-label="Rent over the term">
              <h3 className="text-lg font-extrabold leading-tight">Rent over the term</h3>
              <table className="mt-3 w-full text-sm tabular">
                <thead>
                  <tr className="border-b-2 border-ink text-left text-xs font-semibold text-ink-soft">
                    <th className="pb-1.5 font-semibold">Months</th>
                    <th className="pb-1.5 text-right font-semibold">Rent</th>
                    <th className="pb-1.5 text-right font-semibold">Monthly, with GST</th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-line">
                  {lease.rentByPeriod.map((p, i) => {
                    const monthly = p.rentMonthly + money.maintenanceMonthly;
                    return (
                      <tr key={p.fromMonth}>
                        <td className="py-2 font-semibold">
                          {p.fromMonth}–{p.toMonth}
                          {i > 0 ? <span className="ml-1.5 text-xs font-normal text-ink-soft">+{money.escalationPct}%</span> : null}
                        </td>
                        <td className="py-2 text-right">{formatINR(p.rentMonthly)}</td>
                        <td className="py-2 text-right font-semibold">{formatINR(monthly + gstOn(monthly))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            <Card elevation="flat" as="section" className="p-5" aria-label="Included">
              <h3 className="text-lg font-extrabold leading-tight">Included</h3>
              {money.inclusions.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-2">
                  {money.inclusions.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm">
                      <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-ink bg-mint">
                        <Check size={11} strokeWidth={3} />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-ink-soft">Nothing beyond the space itself; your advisor can confirm what the landlord provides.</p>
              )}
            </Card>
          </div>

          <section aria-label="Offers">
            <h3 className="mb-3 text-lg font-extrabold leading-tight">Offers</h3>
            <OffersList
              compact
              policy={policy}
              totals={term}
              role={role}
              onApply={(offerId) => dispatch({ type: 'apply_offer', propertyId, offerId })}
              onRemove={(offerId) => dispatch({ type: 'remove_offer', propertyId, offerId })}
            />
          </section>
        </div>

        <Card as="aside" className="sticky top-0 flex flex-col p-5" aria-label="Monthly cost">
          <p className="text-sm font-semibold text-ink-soft">Monthly, all-in</p>
          <p className="mt-1 font-display text-[40px] font-extrabold leading-none tracking-[-0.02em] tabular">{formatINR(lease.monthlyTotal)}</p>
          <p className="mt-1.5 text-sm text-ink-soft">Rent, maintenance and GST</p>

          <div className="mt-4 rounded-[14px] border-2 border-ink bg-coral-tint px-3 py-2.5">
            <p className="text-xs font-semibold text-ink-soft">Per seat, a month</p>
            <p className="font-display text-2xl font-extrabold tabular">{formatINR(lease.perSeatMonthly)}</p>
            <p className="text-xs text-ink-soft">{money.seats} seats</p>
          </div>

          <dl className="mt-4 divide-y-2 divide-line border-y-2 border-line">
            <FigureRow label={`Over ${months(money.termMonths)}`} hint="Rent and maintenance, before GST" value={formatINR(term.subtotal)} />
            {term.discountTotal > 0 ? (
              <FigureRow
                label="Offers"
                value={
                  <span className="text-coral-deep">
                    − <CountUp value={term.discountTotal} format={formatINR} />
                  </span>
                }
              />
            ) : null}
            <FigureRow label="You pay over the term" hint={`Plus ${formatINRShort(termGst)} GST`} value={<CountUp value={termAfterOffers} format={formatINR} />} emphasis />
            <FigureRow label="Deposit, refundable" hint="Paid once, returned when you leave" value={formatINR(lease.deposit)} />
          </dl>

          <EstimateNote className="mt-4">{money.estimateNote}</EstimateNote>
        </Card>
      </div>
    </div>
  );
}

function Term({ icon: Icon, label, value, hint, wide = false }: { icon: LucideIcon; label: string; value: string; hint: string; wide?: boolean }) {
  return (
    <div className={`rounded-[12px] bg-paper px-3 py-2 ${wide ? 'col-span-2' : ''}`}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
        <Icon size={13} strokeWidth={ICON_STROKE} aria-hidden />
        {label}
      </p>
      {value ? <p className="font-display text-lg font-extrabold leading-tight tabular">{value}</p> : null}
      <p className="text-xs leading-snug text-ink-soft">{hint}</p>
    </div>
  );
}
