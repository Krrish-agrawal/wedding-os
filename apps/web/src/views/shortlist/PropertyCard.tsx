import { motion } from 'motion/react';
import { ArrowRight, Check, Eye, MapPin } from 'lucide-react';
import { formatINRShort, formatSqft, type PropertyBundle } from '@ave/shared';
import { Button, CountUp, ICON_STROKE, PropertyHero, Sticker, Tag, cn } from '@/ui';
import { keyFigures } from './figures';

interface PropertyCardProps {
  bundle: PropertyBundle;
  appliedOfferIds: string[];
  /** This property is the one open on the call. */
  active: boolean;
  onOpen: () => void;
}

/** One property on the shortlist: hero, identity, the key numbers and three highlights. */
export function PropertyCard({ bundle, appliedOfferIds, active, onOpen }: PropertyCardProps) {
  const { property } = bundle;
  const figures = keyFigures(bundle, appliedOfferIds);

  return (
    <motion.article
      onClick={onOpen}
      whileHover={{ y: -3 }}
      whileTap={{ y: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      className={cn(
        'group flex min-h-[460px] cursor-pointer flex-col overflow-hidden short:min-h-0 rounded-[var(--radius-card)] border-2 border-ink bg-canvas',
        active ? 'shadow-[var(--shadow-pop-blue)]' : 'shadow-[var(--shadow-pop)] hover:shadow-[var(--shadow-pop-lg)]',
      )}
      aria-labelledby={`card-${property.id}`}
    >
      <div className="relative max-h-[340px] min-h-[150px] flex-1 border-b-2 border-ink short:min-h-[120px]">
        <div className="absolute inset-0">
          <PropertyHero property={property} className="h-full w-full" />
        </div>
        <div className="absolute left-4 top-4">
          <Sticker tone="sun" tilt="left">
            Sample listing
          </Sticker>
        </div>
        {active && (
          <div className="absolute right-4 top-4">
            <Sticker tone="blue" tilt="right" icon={Eye}>
              Open now
            </Sticker>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col p-5 short:p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag accent={property.kind === 'sale' ? 'blue' : 'grape'}>{property.kind === 'sale' ? 'For sale' : 'For lease'}</Tag>
          <Tag>{property.configuration}</Tag>
        </div>
        <h3 id={`card-${property.id}`} className="mt-2.5 text-[26px] font-extrabold leading-[1.1] tracking-[-0.02em]">
          {property.name}
        </h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft">
          <MapPin size={14} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-tangerine" />
          {property.localityName}, {property.city}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-[14px] bg-paper p-3.5 short:mt-3 short:p-3">
          <div className="min-w-0">
            <dt className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-soft">{figures.price?.label ?? 'Price'}</dt>
            <dd className="mt-0.5 font-display text-[26px] font-extrabold leading-none tracking-[-0.01em]">
              {figures.price ? (
                <>
                  <CountUp value={figures.price.value} format={formatINRShort} />
                  {figures.price.suffix && <span className="ml-0.5 font-sans text-sm font-semibold text-ink-soft">{figures.price.suffix}</span>}
                </>
              ) : (
                <span className="font-sans text-base font-semibold text-ink-soft">See the Pricing view</span>
              )}
            </dd>
            {figures.price?.note && <dd className="mt-1 truncate text-xs text-ink-soft">{figures.price.note}</dd>}
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-soft">{figures.area.label}</dt>
            <dd className="tabular mt-0.5 font-display text-[26px] font-extrabold leading-none tracking-[-0.01em]">{figures.area.text}</dd>
            <dd className="mt-1 truncate text-xs text-ink-soft">Built-up {formatSqft(property.areas.builtUpSqft)}</dd>
          </div>
        </dl>

        <ul className="mt-4 flex flex-col gap-2 short:mt-3 short:gap-1.5">
          {property.highlights.map((h) => (
            <li key={h} className="flex items-start gap-2.5 text-[14.5px] leading-snug">
              <span aria-hidden className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-ink bg-mint">
                <Check size={13} strokeWidth={ICON_STROKE} />
              </span>
              {h}
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between gap-3 pt-5 short:pt-3">
          <p className="truncate text-xs text-ink-soft">{property.possession}</p>
          <Button
            variant={active ? 'secondary' : 'primary'}
            trailingIcon={ArrowRight}
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            {active ? 'Back to the tour' : 'Step inside'}
          </Button>
        </div>
      </div>
    </motion.article>
  );
}
