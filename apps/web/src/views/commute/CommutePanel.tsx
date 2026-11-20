import { Clock, MapPin, Navigation, Route, Search } from 'lucide-react';
import { formatKm, formatMinutes, type CommuteRoute, type PropertyBundle } from '@ave/shared';
import { getBundle } from '@/content';
import { HeaderMark, ICON_STROKE, cn } from '@/ui';
import { COMMUTE_CATEGORY_ICONS } from '../maps/icons';
import type { ActiveRoute, CommuteSelection } from './activeRoute';

interface CommutePanelProps {
  bundle: PropertyBundle;
  selection: CommuteSelection;
  activeId: string | null;
  onChoose: (route: CommuteRoute) => void;
}

/** Side panel: the chosen route's distance and drive time, then every preset to pick from. */
export function CommutePanel({ bundle, selection, activeId, onChoose }: CommutePanelProps) {
  const { property, commute } = bundle;
  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto border-l-2 border-ink bg-canvas" aria-label="Drive times">
      <header className="flex items-start gap-3 px-6 pb-4 pt-5">
        <HeaderMark accent="tangerine" icon={Route} />
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold leading-tight">Drive times</h2>
          <p className="mt-0.5 text-sm text-ink-soft">From {property.address}</p>
        </div>
      </header>

      <div className="px-6">
        {selection.status === 'route' ? (
          <RouteCard route={selection.route} note={commute.note} />
        ) : (
          <div className="rounded-[var(--radius-card)] border-2 border-ink bg-tangerine-tint p-4" role="status">
            <p className="font-bold">{selection.status === 'missing' ? 'That route is not in the list' : 'Pick a place to see the drive'}</p>
            <p className="mt-1 text-sm text-ink-soft">Choose one below, or ask the advisor about any place in {bundle.locality.city}.</p>
          </div>
        )}
      </div>

      <div className="flex-1 px-6 pb-5 pt-5">
        <h3 className="mb-2 text-[13px] font-bold uppercase tracking-[0.06em] text-tangerine-deep">Places people ask about</h3>
        <ul className="space-y-1.5">
          {commute.routes.map((r) => (
            <li key={r.id}>
              <PresetRow route={r} selected={r.id === activeId} onChoose={() => onChoose(r)} />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function RouteCard({ route, note }: { route: ActiveRoute; note: string }) {
  const Icon = route.category ? COMMUTE_CATEGORY_ICONS[route.category] : Search;
  const otherProperty = getBundle(route.propertyId)?.property ?? null;
  return (
    <div className="rounded-[var(--radius-card)] border-2 border-ink bg-canvas p-4 shadow-[var(--shadow-pop)]" aria-live="polite">
      <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.06em] text-tangerine-deep">
        <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden />
        {route.kind === 'custom' ? 'Place you asked about' : route.label}
      </p>
      <p className="mt-1 font-display text-xl font-bold leading-snug">{otherProperty?.name ?? route.destinationName}</p>
      {otherProperty && <p className="text-sm text-ink-soft">{route.destinationName}</p>}
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <Stat icon={Navigation} label="Distance" value={formatKm(route.distanceKm)} />
        <Stat icon={Clock} label="Drive time" value={formatMinutes(route.durationMin)} />
      </dl>
      <p className="mt-4 text-[13px] leading-snug text-ink-soft">{note}</p>
      <p className="mt-2 text-[11px] leading-snug text-ink-soft">
        {route.source ? `Route: ${route.source}.` : 'Route worked out just now with OSRM.'} Map data © OpenStreetMap contributors.
      </p>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="rounded-[14px] border-2 border-ink bg-tangerine-tint px-3 py-2">
      <dt className="flex items-center gap-1 text-[12px] font-semibold text-ink-soft">
        <Icon size={13} strokeWidth={ICON_STROKE} aria-hidden />
        {label}
      </dt>
      <dd className="tabular font-display text-[26px] font-bold leading-tight">{value}</dd>
    </div>
  );
}

function PresetRow({ route, selected, onChoose }: { route: CommuteRoute; selected: boolean; onChoose: () => void }) {
  const Icon = COMMUTE_CATEGORY_ICONS[route.category] ?? MapPin;
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-3 rounded-[14px] border-2 px-3 py-2 text-left transition-[background-color,border-color] duration-100',
        selected ? 'border-ink bg-tangerine-tint shadow-[var(--shadow-pop-sm)]' : 'border-transparent hover:border-line hover:bg-paper',
      )}
    >
      <span aria-hidden className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-ink', selected ? 'bg-tangerine' : 'bg-canvas')}>
        <Icon size={15} strokeWidth={ICON_STROKE} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-[14px] font-semibold leading-snug">{route.label}</span>
        <span className="block truncate text-[12px] text-ink-soft">{route.destination.name}</span>
      </span>
      <span className="tabular shrink-0 text-right leading-tight">
        <span className="block text-[14px] font-semibold">{formatKm(route.distanceKm)}</span>
        <span className="block text-[12px] text-ink-soft">{formatMinutes(route.durationMin)}</span>
      </span>
    </button>
  );
}
