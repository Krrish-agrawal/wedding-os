import { useMemo } from 'react';
import { BadgePercent, Calculator, IndianRupee, ListOrdered, Receipt } from 'lucide-react';
import {
  MONEY_TAB_LABELS,
  checkLoanToValue,
  computeEmi,
  computePaymentPlan,
  computeSaleTotals,
  defaultEmiInputs,
  type MoneyTab,
  type PropertyBundle,
  type SaleMoney,
} from '@ave/shared';
import { ErrorState } from '@/ui';
import type { ViewProps } from '../types';
import { BreakupTab } from './BreakupTab';
import { EmiSummary, EmiTab } from './EmiTab';
import { OffersList } from './OffersList';
import { PriceCard } from './PriceCard';
import { ScheduleTab } from './ScheduleTab';
import { Tabs, ViewHeader, type TabItem } from './parts';
import { offerPolicyFor } from './policy';
import { useEmiDraft } from './useEmiDraft';

type SaleTab = Exclude<MoneyTab, 'lease'>;
const SALE_TABS: { id: SaleTab; icon: TabItem<SaleTab>['icon'] }[] = [
  { id: 'breakup', icon: Receipt },
  { id: 'emi', icon: Calculator },
  { id: 'offers', icon: BadgePercent },
  { id: 'schedule', icon: ListOrdered },
];

function saleTab(tab: MoneyTab): SaleTab {
  return tab === 'lease' ? 'breakup' : tab;
}

interface SaleMoneyViewProps extends ViewProps {
  bundle: PropertyBundle;
  money: SaleMoney;
}

/** Sale variant: price breakup, EMI, offers and the payment schedule, with "your price" always in view. */
export function SaleMoneyView({ state, bundle, money, dispatch, role }: SaleMoneyViewProps) {
  const { property } = bundle;
  const propertyId = property.id;
  const policy = offerPolicyFor(propertyId);
  const appliedKey = (state.appliedOffers[propertyId] ?? []).join('|');

  const priced = useMemo(() => {
    try {
      const totals = computeSaleTotals(money, property.areas, policy.offers, appliedKey ? appliedKey.split('|') : []);
      return { totals, plan: computePaymentPlan(money, totals) };
    } catch (err) {
      console.error(`[money] could not price ${propertyId}`, err);
      return null;
    }
  }, [money, property.areas, policy.offers, appliedKey, propertyId]);

  const price = priced?.totals.total ?? 0;
  const defaults = useMemo(() => defaultEmiInputs(money, price), [money, price]);
  const [inputs, setInputs] = useEmiDraft(state.params.money.emi, defaults, dispatch);

  if (!priced) {
    return (
      <ErrorState
        title="This price could not be worked out"
        body="Something in the pricing data for this property does not add up. Your advisor can confirm the numbers with the builder."
      />
    );
  }

  const { totals, plan } = priced;
  const tab = saleTab(state.params.money.tab);
  const emi = computeEmi(totals.total, inputs);
  const ltv = checkLoanToValue(money, totals, inputs);
  const setTab = (next: SaleTab) => dispatch({ type: 'set_view', view: 'money', params: { tab: next } });
  const tabs: TabItem<SaleTab>[] = SALE_TABS.map(({ id, icon }) => ({
    id,
    icon,
    label: MONEY_TAB_LABELS[id],
    ...(id === 'offers' ? { badge: totals.discounts.length } : {}),
  }));

  return (
    <div className="@container flex h-full flex-col gap-5 overflow-y-auto p-6 scroll-quiet">
      <ViewHeader
        accent="coral"
        icon={IndianRupee}
        eyebrow={`${property.name} · ${property.configuration}`}
        title="Price and payments"
        aside={<Tabs label="Pricing sections" items={tabs} value={tab} onChange={setTab} accent="coral" />}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(260px,320px)] items-start gap-5">
        <div className="min-w-0">
          {tab === 'breakup' && <BreakupTab totals={totals} />}
          {tab === 'emi' && <EmiTab money={money} price={totals.total} inputs={inputs} emi={emi} ltv={ltv} onChange={setInputs} />}
          {tab === 'offers' && (
            <OffersList
              policy={policy}
              totals={totals}
              role={role}
              onApply={(offerId) => dispatch({ type: 'apply_offer', propertyId, offerId })}
              onRemove={(offerId) => dispatch({ type: 'remove_offer', propertyId, offerId })}
            />
          )}
          {tab === 'schedule' && <ScheduleTab plan={plan} />}
        </div>
        <div className="sticky top-0">
          {tab === 'emi' ? (
            <EmiSummary inputs={inputs} emi={emi} price={totals.total} />
          ) : (
            <PriceCard totals={totals} property={property} estimateNote={money.estimateNote} />
          )}
        </div>
      </div>
    </div>
  );
}
