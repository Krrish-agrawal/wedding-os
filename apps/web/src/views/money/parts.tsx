import type { ReactNode } from 'react';
import { ExternalLink, Info, type LucideIcon } from 'lucide-react';
import { HeaderMark, ICON_STROKE, cn } from '@/ui';
import type { Accent } from '../types';

/**
 * Small building blocks shared by the Money, Legal and Booking views
 * (one workstream owns all three, so they live here).
 */

export function ViewHeader({
  accent,
  icon,
  eyebrow,
  title,
  aside,
}: {
  accent: Accent;
  icon: LucideIcon;
  /** Small line above the title: usually the property name. */
  eyebrow: ReactNode;
  title: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 items-center gap-3">
        <HeaderMark accent={accent} icon={icon} />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.06em] text-ink-soft">{eyebrow}</p>
          <h2 className="truncate text-2xl font-extrabold leading-tight">{title}</h2>
        </div>
      </div>
      {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
    </header>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  /** Small count after the label. */
  badge?: number;
}

/** View-level tabs. Selected: accent fill, ink outline, hard shadow; the same language as chips. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  accent,
  label,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  accent: 'coral' | 'mint';
  label: string;
}) {
  const on = accent === 'coral' ? 'bg-coral' : 'bg-mint';
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap items-center gap-2">
      {items.map(({ id, label: text, icon: Icon, badge }) => {
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(id)}
            className={cn(
              'inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-chip)] border-2 px-4 text-sm font-semibold',
              'transition-[transform,box-shadow,border-color,background-color] duration-100 ease-[var(--ease-snap)] active:translate-y-px',
              selected ? cn('border-ink text-ink shadow-[var(--shadow-pop-sm)]', on) : 'border-line bg-canvas text-ink hover:border-ink',
            )}
          >
            {Icon ? <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden /> : null}
            {text}
            {badge !== undefined && badge > 0 ? (
              <span className="grid h-5 min-w-5 place-items-center rounded-full border-2 border-ink bg-canvas px-1 text-[11px] font-bold leading-none tabular">
                {badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** A small "source" link for a statutory figure. Opens in a new tab. */
export function SourceLink({ href, label = 'Source' }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 rounded-[6px] text-[11px] font-semibold text-ink-soft underline-offset-2 hover:text-ink hover:underline"
      title={href}
    >
      {label}
      <ExternalLink size={11} strokeWidth={ICON_STROKE} aria-hidden />
    </a>
  );
}

/** The honest small print: "Estimate. …" */
export function EstimateNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-start gap-1.5 text-xs leading-snug text-ink-soft', className)}>
      <Info size={13} strokeWidth={ICON_STROKE} aria-hidden className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Label and value on one line, for summary cards. */
export function FigureRow({ label, value, emphasis = false, hint }: { label: ReactNode; value: ReactNode; emphasis?: boolean; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className={cn('text-sm', emphasis ? 'font-bold text-ink' : 'text-ink-soft')}>
        {label}
        {hint ? <span className="block text-xs font-normal text-ink-soft">{hint}</span> : null}
      </dt>
      <dd className={cn('shrink-0 text-right tabular', emphasis ? 'text-base font-bold' : 'text-sm font-semibold')}>{value}</dd>
    </div>
  );
}
