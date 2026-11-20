/**
 * Brand values for use in inline styles and SVG attributes. Colours point at the CSS custom
 * properties in theme.css, so there is one source of truth for every hex value.
 */
export const C = {
  canvas: 'var(--color-canvas)',
  paper: 'var(--color-paper)',
  ink: 'var(--color-ink)',
  inkSoft: 'var(--color-ink-soft)',
  inkMute: 'var(--color-ink-mute)',
  line: 'var(--color-line)',
  blue: 'var(--color-blue)',
  blueDeep: 'var(--color-blue-deep)',
  blueTint: 'var(--color-blue-tint)',
  sun: 'var(--color-sun)',
  sunDeep: 'var(--color-sun-deep)',
  sunTint: 'var(--color-sun-tint)',
  coral: 'var(--color-coral)',
  coralDeep: 'var(--color-coral-deep)',
  coralTint: 'var(--color-coral-tint)',
  mint: 'var(--color-mint)',
  mintDeep: 'var(--color-mint-deep)',
  mintTint: 'var(--color-mint-tint)',
  grape: 'var(--color-grape)',
  grapeDeep: 'var(--color-grape-deep)',
  grapeTint: 'var(--color-grape-tint)',
  tangerine: 'var(--color-tangerine)',
  tangerineDeep: 'var(--color-tangerine-deep)',
  tangerineTint: 'var(--color-tangerine-tint)',
} as const;

export const FONT = {
  display: 'var(--font-display)',
  sans: 'var(--font-sans)',
} as const;

/** The brand's 3px ink outline, scaled up for a 1080p frame. */
export const OUTLINE = 4;

/** Hard offset shadows, never blurs. */
export function pop(offset: number, color: string = C.ink): string {
  return `${offset}px ${offset}px 0 0 ${color}`;
}

export const RADIUS = {
  card: 28,
  tile: 32,
  control: 18,
  chip: 999,
} as const;
