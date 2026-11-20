import type { ReactNode } from 'react';
import { ArrowLeft, Compass, Info, MapPin, TramFront } from 'lucide-react';
import { PLACE_CATEGORY_LABELS, formatKm, type PlaceCategory, type PropertyBundle } from '@ave/shared';
import { Button, HeaderMark, ICON_STROKE, cn } from '@/ui';
import type { PlaceWithDistance } from './LocalityView';
import { placeIcon } from './placeIcon';

interface LocalityPanelProps {
  bundle: PropertyBundle;
  category: PlaceCategory | null;
  /** Places in the chosen category, nearest first. */
  places: PlaceWithDistance[];
  selectedId: string | null;
  onSelect: (place: PlaceWithDistance) => void;
  onProfile: () => void;
}

/** The side panel: the area profile, or the list of nearby places in one category. */
export function LocalityPanel({ bundle, category, places, selectedId, onSelect, onProfile }: LocalityPanelProps) {
  const { property, locality } = bundle;
  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto border-l-2 border-ink bg-canvas" aria-label={`About ${locality.name}`}>
      <header className="flex items-start gap-3 px-6 pb-4 pt-5">
        <HeaderMark accent="tangerine" icon={MapPin} />
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold leading-tight">{locality.name}</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            {property.address}, {locality.city}
          </p>
        </div>
      </header>
      <div className="flex-1 px-6 pb-6">
        {category ? (
          <PlaceList category={category} places={places} selectedId={selectedId} onSelect={onSelect} onProfile={onProfile} />
        ) : (
          <Profile bundle={bundle} />
        )}
      </div>
      <footer className="border-t-2 border-line px-6 py-3 text-[12px] leading-relaxed text-ink-soft">
        {category ? (
          <p>Places: {locality.attribution}. Distances are in a straight line from the property.</p>
        ) : (
          <SourceList sources={locality.sources} />
        )}
      </footer>
    </aside>
  );
}

function Profile({ bundle }: { bundle: PropertyBundle }) {
  const { profile } = bundle.locality;
  return (
    <div className="space-y-5">
      <p className="text-[15px] leading-relaxed text-ink">{profile.summary}</p>
      <Section title="Character" icon={Compass}>
        <p>{profile.character}</p>
      </Section>
      <Section title="Getting around" icon={TramFront}>
        <p>{profile.connectivity}</p>
      </Section>
      {profile.goodToKnow.length > 0 && (
        <Section title="Good to know" icon={Info}>
          <ul className="space-y-2">
            {profile.goodToKnow.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="mt-[7px] h-2 w-2 shrink-0 rounded-full border-2 border-ink bg-tangerine" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Compass; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.06em] text-tangerine-deep">
        <Icon size={15} strokeWidth={ICON_STROKE} aria-hidden />
        {title}
      </h3>
      <div className="text-[14px] leading-relaxed text-ink">{children}</div>
    </section>
  );
}

function PlaceList({
  category,
  places,
  selectedId,
  onSelect,
  onProfile,
}: {
  category: PlaceCategory;
  places: PlaceWithDistance[];
  selectedId: string | null;
  onSelect: (p: PlaceWithDistance) => void;
  onProfile: () => void;
}) {
  const label = PLACE_CATEGORY_LABELS[category];
  if (places.length === 0) {
    return (
      <div className="rounded-[16px] border-2 border-ink bg-paper p-4">
        <p className="font-bold">No {label.toLowerCase()} listed close by</p>
        <p className="mt-1 text-sm text-ink-soft">OpenStreetMap lists none near this address. A senior advisor can confirm what is nearby.</p>
        <Button className="mt-3" variant="secondary" size="sm" icon={ArrowLeft} onClick={onProfile}>
          Back to the area profile
        </Button>
      </div>
    );
  }
  return (
    <div>
      <h3 className="font-display text-lg font-bold leading-tight">{label} nearby</h3>
      <p className="text-[13px] text-ink-soft">
        {places.length} {places.length === 1 ? 'place' : 'places'}, nearest first
      </p>
      <ol className="mt-3 space-y-1.5">
        {places.map((p) => {
          const Icon = placeIcon(p);
          const selected = p.id === selectedId;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p)}
                aria-pressed={selected}
                className={cn(
                  'flex w-full items-center gap-3 rounded-[14px] border-2 px-3 py-2 text-left transition-[background-color,border-color] duration-100',
                  selected ? 'border-ink bg-tangerine-tint shadow-[var(--shadow-pop-sm)]' : 'border-transparent hover:border-line hover:bg-paper',
                )}
              >
                <span
                  aria-hidden
                  className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-ink', selected ? 'bg-tangerine' : 'bg-canvas')}
                >
                  <Icon size={15} strokeWidth={ICON_STROKE} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block text-[14px] font-semibold leading-snug">{p.name}</span>
                  {p.kind && <span className="block truncate text-[12px] text-ink-soft">{p.kind}</span>}
                </span>
                <span className="tabular shrink-0 text-[14px] font-semibold">{formatKm(p.km)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SourceList({ sources }: { sources: PropertyBundle['locality']['sources'] }) {
  if (sources.length === 0) return null;
  return (
    <div>
      <p className="font-semibold text-ink">Sources</p>
      <ul className="mt-0.5 space-y-0.5">
        {sources.map((s) => (
          <li key={s.url} className="truncate">
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
