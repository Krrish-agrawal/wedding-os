import { EmptyState } from '@/ui';
import type { ViewProps } from '../types';
import { LeaseMoneyView } from './LeaseMoneyView';
import { SaleMoneyView } from './SaleMoneyView';

/** Money view (BUILD_PLAN.md section 4.2.7). Accent: coral. Sale and lease properties get their own layout. */
export default function MoneyView(props: ViewProps) {
  const { bundle } = props;
  if (!bundle) {
    return <EmptyState title="Pick a property to see its price" body="Open a property from the shortlist and its full price appears here." />;
  }
  return bundle.money.kind === 'sale' ? (
    <SaleMoneyView {...props} bundle={bundle} money={bundle.money} />
  ) : (
    <LeaseMoneyView {...props} bundle={bundle} money={bundle.money} />
  );
}
