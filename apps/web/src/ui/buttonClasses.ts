import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'confirm';
export type ButtonSize = 'sm' | 'md' | 'lg';

export const BASE =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold ' +
  'transition-[transform,box-shadow,background-color,border-color,color] duration-100 ease-[var(--ease-snap)] ' +
  'disabled:cursor-not-allowed disabled:opacity-55';

/** Raised buttons sit on a hard ink shadow and press down into it. */
const RAISED =
  'border-2 border-ink shadow-[var(--shadow-pop-sm)] hover:-translate-x-px hover:-translate-y-px hover:shadow-[var(--shadow-pop)] ' +
  'active:translate-x-0.5 active:translate-y-0.5 active:shadow-none ' +
  'disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-[var(--shadow-pop-sm)]';

export const VARIANTS: Record<ButtonVariant, string> = {
  primary: `${RAISED} bg-blue text-ink`,
  confirm: `${RAISED} bg-mint text-ink`,
  danger: `${RAISED} bg-coral text-ink`,
  secondary: `${RAISED} bg-canvas text-ink hover:bg-paper`,
  ghost: 'border-2 border-transparent bg-transparent text-ink hover:bg-paper active:bg-line',
};

export const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 rounded-[12px] px-3 text-sm',
  md: 'h-11 rounded-[var(--radius-control)] px-4 text-[15px]',
  lg: 'h-14 rounded-[16px] px-6 text-base',
};

export const ICON_ONLY: Record<ButtonSize, string> = {
  sm: 'h-9 w-9 rounded-[12px] px-0',
  md: 'h-11 w-11 rounded-[var(--radius-control)] px-0',
  lg: 'h-14 w-14 rounded-[16px] px-0',
};

export const ICON_SIZE: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

/** Class string for things that look like a button but are links (e.g. react-router Link). */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

