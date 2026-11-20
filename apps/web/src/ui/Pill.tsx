import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { ICON_STROKE } from './icons';
import { Spinner } from './Spinner';

export type PillTone = 'neutral' | 'blue' | 'live' | 'waiting' | 'warn' | 'error' | 'muted';

const TONES: Record<PillTone, string> = {
  neutral: 'border-ink bg-canvas text-ink',
  blue: 'border-ink bg-blue-tint text-ink',
  live: 'border-ink bg-mint-tint text-ink',
  waiting: 'border-ink bg-sun-tint text-ink',
  warn: 'border-ink bg-tangerine-tint text-ink',
  error: 'border-ink bg-coral-tint text-ink',
  muted: 'border-line bg-paper text-ink-soft',
};

const DOTS: Record<PillTone, string> = {
  neutral: 'bg-ink',
  blue: 'bg-blue',
  live: 'bg-mint',
  waiting: 'bg-sun',
  warn: 'bg-tangerine',
  error: 'bg-coral',
  muted: 'bg-ink-mute',
};

export interface PillProps {
  tone?: PillTone;
  icon?: LucideIcon;
  /** A coloured status dot before the label. */
  dot?: boolean;
  /** A spinner before the label, for states that are genuinely in progress. */
  busy?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  children: ReactNode;
}

/** Rounded label with an ink outline. */
export function Pill({ tone = 'neutral', icon: Icon, dot, busy, size = 'md', className, children }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-chip)] border-2 font-semibold',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3 text-sm',
        TONES[tone],
        className,
      )}
    >
      {busy ? (
        <Spinner size={size === 'sm' ? 12 : 14} />
      ) : dot ? (
        <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full ring-2 ring-ink/10', DOTS[tone])} />
      ) : Icon ? (
        <Icon size={size === 'sm' ? 13 : 15} strokeWidth={ICON_STROKE} aria-hidden />
      ) : null}
      {children}
    </span>
  );
}

/** A pill announcing a live status (connection, voice). Updates are read out politely. */
export function StatusPill(props: PillProps) {
  return (
    <span role="status" aria-live="polite" className="inline-flex">
      <Pill dot={!props.icon && !props.busy} {...props} />
    </span>
  );
}
