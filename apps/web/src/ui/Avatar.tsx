import type { Accent } from '@/views/types';
import { ACCENT_BG } from './accent';
import { cn } from './cn';

/** Accents that keep ink initials legible and look friendly as a face tile. */
const AVATAR_ACCENTS: readonly Accent[] = ['sun', 'mint', 'coral', 'tangerine', 'grape', 'blue'];

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/** Same name, same colour, on every screen. */
function accentFor(name: string): Accent {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_ACCENTS[h % AVATAR_ACCENTS.length] ?? 'blue';
}

export interface AvatarProps {
  name: string;
  /** Pixel size of the square tile. */
  size?: number;
  accent?: Accent;
  className?: string;
}

/** An initials tile: used when a camera is off or declined, and in lists. */
export function Avatar({ name, size = 48, accent, className }: AvatarProps) {
  const fontSize = Math.round(size * 0.38);
  return (
    <span
      role="img"
      aria-label={name}
      className={cn('inline-grid shrink-0 place-items-center border-2 border-ink font-display font-extrabold text-ink', ACCENT_BG[accent ?? accentFor(name)], className)}
      style={{ width: size, height: size, fontSize, borderRadius: Math.round(size * 0.3) }}
    >
      {initialsOf(name)}
    </span>
  );
}
