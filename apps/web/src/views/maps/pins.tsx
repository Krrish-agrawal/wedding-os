import type { LucideIcon } from 'lucide-react';
import { cn, ICON_STROKE } from '@/ui';

/**
 * Map pin visuals. Positioned by MapMarker; these only draw.
 * Place and destination pins are centred on their coordinate (marker anchor "center");
 * the property pin stands on its coordinate (anchor "bottom").
 */

interface PropertyPinProps {
  icon: LucideIcon;
  /** Short name shown above the pin. */
  label: string;
}

/** The property itself: the one fixed point on every map. */
export function PropertyPin({ icon: Icon, label }: PropertyPinProps) {
  return (
    <div className="pointer-events-none flex flex-col items-center" aria-label={label} role="img">
      <span className="mb-1 max-w-[220px] truncate rounded-[var(--radius-chip)] border-2 border-ink bg-ink px-2.5 py-0.5 text-[12px] font-bold leading-[18px] text-canvas shadow-[var(--shadow-pop-sm)]">
        {label}
      </span>
      <span className="grid h-11 w-11 place-items-center rounded-full border-2 border-ink bg-blue text-ink shadow-[var(--shadow-pop-sm)]">
        <Icon size={20} strokeWidth={ICON_STROKE} aria-hidden />
      </span>
      <span aria-hidden className="h-2.5 w-[3px] rounded-b-full bg-ink" />
    </div>
  );
}

interface PlacePinProps {
  icon: LucideIcon;
  name: string;
  /** e.g. "650 m" or "12.4 km · 38 min" */
  detail: string;
  selected?: boolean;
  /** Whether the label has room on screen; it still appears on hover or focus. */
  showLabel: boolean;
  onSelect?: () => void;
  /** Accessible description of the action, e.g. "Show Indiranagar metro station". */
  actionLabel?: string;
}

/** A nearby place or a commute destination: an icon disc with a name tag to its right. */
export function PlacePin({ icon: Icon, name, detail, selected = false, showLabel, onSelect, actionLabel }: PlacePinProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
      aria-label={actionLabel ?? `${name}, ${detail}`}
      aria-pressed={selected}
      className="group relative block cursor-pointer rounded-full focus-visible:outline-offset-4"
    >
      <span
        className={cn(
          'grid place-items-center rounded-full border-2 border-ink text-ink transition-transform duration-150 ease-[var(--ease-snap)]',
          selected ? 'h-9 w-9 bg-tangerine shadow-[var(--shadow-pop-sm)]' : 'h-[30px] w-[30px] bg-canvas group-hover:scale-110',
        )}
      >
        <Icon size={selected ? 17 : 15} strokeWidth={ICON_STROKE} aria-hidden />
      </span>
      <span
        className={cn(
          'absolute left-[calc(100%+4px)] top-1/2 h-[26px] -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-chip)] border-2 border-ink px-2.5 text-[12px] font-semibold leading-none text-ink',
          selected ? 'bg-tangerine-tint shadow-[var(--shadow-pop-sm)]' : 'bg-canvas',
          showLabel || selected ? 'flex' : 'hidden group-hover:flex group-focus-visible:flex',
        )}
      >
        {name}
        <span className="tabular font-medium text-ink-soft">{detail}</span>
      </span>
    </button>
  );
}
