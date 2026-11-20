import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Accent } from '@/views/types';
import { ACCENT_BG, ACCENT_ICON } from './accent';
import { cn } from './cn';
import { ICON_STROKE } from './icons';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  icon?: LucideIcon;
  accent?: Accent;
  /** Selected chips fill with their accent and lift onto an ink shadow. */
  selected?: boolean;
  size?: 'sm' | 'md';
}

/**
 * A selectable chip: categories, layers, tabs inside a view.
 * Selected: accent fill, ink outline, hard shadow. Idle: white with a hairline and an accent icon.
 */
export function Chip({ label, icon: Icon, accent = 'blue', selected = false, size = 'md', className, type = 'button', ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-chip)] border-2 font-semibold',
        'transition-[transform,box-shadow,border-color,background-color] duration-100 ease-[var(--ease-snap)] active:translate-y-px',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        selected
          ? cn('border-ink text-ink shadow-[var(--shadow-pop-sm)]', ACCENT_BG[accent])
          : 'border-line bg-canvas text-ink hover:border-ink',
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={size === 'sm' ? 14 : 16} strokeWidth={ICON_STROKE} aria-hidden className={selected ? undefined : ACCENT_ICON[accent]} />}
      {label}
    </button>
  );
}
