import { LayoutGrid } from 'lucide-react';
import type { PropertyBundle } from '@ave/shared';
import { content } from '@/content';
import { EmptyState, HeaderMark } from '@/ui';
import type { ViewProps } from '../types';
import { PropertyCard } from './PropertyCard';

/** Shortlist view (BUILD_PLAN.md section 4.2.1): the two properties as large cards. Accent: blue. */
export default function ShortlistView({ state, dispatch }: ViewProps) {
  const bundles: PropertyBundle[] = content.properties;

  if (bundles.length === 0) {
    return <EmptyState title="No properties on the shortlist yet" body="Ask your advisor what's available and they'll add them here." />;
  }

  const cities = [...new Set(bundles.map((b) => b.property.city))].join(', ');
  const open = (propertyId: string) => {
    dispatch({ type: 'set_property', propertyId });
    dispatch({ type: 'set_view', view: 'tour' });
  };

  return (
    <div className="scroll-quiet flex h-full flex-col gap-5 overflow-y-auto p-6 short:gap-4 short:p-5">
      <header className="flex items-center gap-3">
        <HeaderMark accent="blue" icon={LayoutGrid} />
        <div>
          <h2 className="text-2xl font-extrabold leading-tight">Your shortlist</h2>
          <p className="text-sm text-ink-soft">
            {bundles.length} {bundles.length === 1 ? 'property' : 'properties'} in {cities}. Pick one to step inside.
          </p>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 gap-6" style={{ gridTemplateColumns: `repeat(${Math.min(bundles.length, 2)}, minmax(0, 1fr))` }}>
        {bundles.map((b) => (
          <PropertyCard
            key={b.property.id}
            bundle={b}
            appliedOfferIds={state.appliedOffers[b.property.id] ?? []}
            active={state.propertyId === b.property.id}
            onOpen={() => open(b.property.id)}
          />
        ))}
      </div>
    </div>
  );
}
