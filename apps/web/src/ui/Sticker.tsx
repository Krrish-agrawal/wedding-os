import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Accent } from '@/views/types';
import { ACCENT_BG, ACCENT_TINT } from './accent';
import { cn } from './cn';
import { ICON_STROKE } from './icons';

type Tilt = 'left' | 'right' | 'none';
const TILT: Record<Tilt, string> = { left: '-rotate-2', right: 'rotate-2', none: '' };

export interface StickerProps {
  children: ReactNode;
  icon?: LucideIcon;
  /** `paper` is white; any accent fills the sticker with it. */
  tone?: Accent | 'paper' | 'ink';
  tilt?: Tilt;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A slightly tilted label stuck onto a card: "Sample listing", "Open now".
 * Stickers carry the playfulness; keep them to one per card.
 */
export function Sticker({ children, icon: Icon, tone = 'sun', tilt = 'left', size = 'md', className }: StickerProps) {
  const fill = tone === 'paper' ? 'bg-canvas text-ink' : tone === 'ink' ? 'bg-ink text-canvas' : cn(ACCENT_BG[tone], 'text-ink');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap border-2 border-ink font-bold uppercase tracking-[0.06em] shadow-[var(--shadow-pop-sm)]',
        size === 'sm' ? 'rounded-[8px] px-2 py-0.5 text-[10.5px]' : 'rounded-[10px] px-2.5 py-1 text-xs',
        fill,
        TILT[tilt],
        className,
      )}
    >
      {Icon ? <Icon size={size === 'sm' ? 12 : 14} strokeWidth={ICON_STROKE} aria-hidden /> : null}
      {children}
    </span>
  );
}

/** A flat, quiet tag for metadata: "For sale", "Carpet area". */
export function Tag({ children, icon: Icon, accent, className }: { children: ReactNode; icon?: LucideIcon; accent?: Accent; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-[8px] px-2 py-0.5 text-xs font-semibold text-ink',
        accent ? ACCENT_TINT[accent] : 'bg-paper',
        className,
      )}
    >
      {Icon ? <Icon size={13} strokeWidth={ICON_STROKE} aria-hidden /> : null}
      {children}
    </span>
  );
}
