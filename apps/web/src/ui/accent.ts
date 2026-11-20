import type { Accent } from '@/views/types';

/**
 * Static class names per accent. Tailwind only generates classes it can see written out,
 * so never build these with string templates.
 *
 * Text on an accent fill is always ink (every accent passes 4.5:1 against ink).
 * Accent-coloured text uses the `-deep` tone so it stays legible on white.
 */
export const ACCENT_BG: Record<Accent, string> = {
  blue: 'bg-blue',
  grape: 'bg-grape',
  tangerine: 'bg-tangerine',
  sun: 'bg-sun',
  coral: 'bg-coral',
  mint: 'bg-mint',
};

export const ACCENT_TINT: Record<Accent, string> = {
  blue: 'bg-blue-tint',
  grape: 'bg-grape-tint',
  tangerine: 'bg-tangerine-tint',
  sun: 'bg-sun-tint',
  coral: 'bg-coral-tint',
  mint: 'bg-mint-tint',
};

export const ACCENT_TEXT: Record<Accent, string> = {
  blue: 'text-blue-deep',
  grape: 'text-grape-deep',
  tangerine: 'text-tangerine-deep',
  sun: 'text-sun-deep',
  coral: 'text-coral-deep',
  mint: 'text-mint-deep',
};

export const ACCENT_BORDER: Record<Accent, string> = {
  blue: 'border-blue',
  grape: 'border-grape',
  tangerine: 'border-tangerine',
  sun: 'border-sun',
  coral: 'border-coral',
  mint: 'border-mint',
};

/** Accent-coloured icon or glyph on white (the fill tone, for shapes rather than text). */
export const ACCENT_ICON: Record<Accent, string> = {
  blue: 'text-blue',
  grape: 'text-grape',
  tangerine: 'text-tangerine',
  sun: 'text-sun-deep',
  coral: 'text-coral',
  mint: 'text-mint-deep',
};

export const ACCENTS: readonly Accent[] = ['blue', 'grape', 'tangerine', 'sun', 'coral', 'mint'];
