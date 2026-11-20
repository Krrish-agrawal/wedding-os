import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Accent } from '@/views/types';
import { ACCENT_BG, ACCENT_TINT } from './accent';
import { cn } from './cn';
import { ICON_STROKE } from './icons';

type Elevation = 'flat' | 'raised' | 'lifted';

const ELEVATION: Record<Elevation, string> = {
  flat: '',
  raised: 'shadow-[var(--shadow-pop)]',
  lifted: 'shadow-[var(--shadow-pop-lg)]',
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** `raised` (default) sits on the hard ink shadow; `flat` drops it for cards inside cards. */
  elevation?: Elevation;
  /** Hairline outline instead of ink, for quiet secondary surfaces. */
  quiet?: boolean;
  /** Fill with an accent's soft tint instead of white. */
  tint?: Accent;
  as?: 'div' | 'section' | 'article' | 'aside';
}

/** A white surface with an ink outline and generous radius. */
export function Card({ elevation = 'raised', quiet = false, tint, as: Tag = 'div', className, ...rest }: CardProps) {
  return (
    <Tag
      className={cn(
        'rounded-[var(--radius-card)] border-2',
        tint ? ACCENT_TINT[tint] : 'bg-canvas',
        quiet ? 'border-line' : 'border-ink',
        quiet ? '' : ELEVATION[elevation],
        className,
      )}
      {...rest}
    />
  );
}

/** The accent square that marks a panel's header: the same colour as the view's dock chip. */
export function HeaderMark({ accent, icon: Icon, size = 'md' }: { accent: Accent; icon?: LucideIcon; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-6 w-6 rounded-[8px]' : 'h-8 w-8 rounded-[10px]';
  return (
    <span aria-hidden className={cn('inline-grid shrink-0 place-items-center border-2 border-ink text-ink', box, ACCENT_BG[accent])}>
      {Icon ? <Icon size={size === 'sm' ? 13 : 16} strokeWidth={ICON_STROKE} /> : null}
    </span>
  );
}

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  /** One line under the title. */
  subtitle?: ReactNode;
  accent?: Accent;
  icon?: LucideIcon;
  /** Right side of the header: chips, a tag, a button. */
  actions?: ReactNode;
  elevation?: Elevation;
  /** Body padding; set false when the body draws edge to edge (a map, a table). */
  padded?: boolean;
  children?: ReactNode;
}

/** A Card with a titled header carrying the accent mark. */
export function Panel({ title, subtitle, accent = 'blue', icon, actions, elevation = 'raised', padded = true, className, children, ...rest }: PanelProps) {
  return (
    <section
      className={cn('flex min-h-0 flex-col rounded-[var(--radius-card)] border-2 border-ink bg-canvas', ELEVATION[elevation], className)}
      {...rest}
    >
      <header className="flex items-center gap-3 border-b-2 border-line px-5 py-3.5">
        <HeaderMark accent={accent} icon={icon} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-bold leading-tight">{title}</h2>
          {subtitle ? <p className="truncate text-sm text-ink-soft">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn('min-h-0 flex-1', padded && 'p-5')}>{children}</div>
    </section>
  );
}
