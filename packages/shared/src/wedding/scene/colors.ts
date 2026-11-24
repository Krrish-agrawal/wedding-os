/**
 * Colour names the planner (and a customer) can use. Deterministic: the language model never invents hex values.
 */
export const NAMED_COLORS: Readonly<Record<string, string>> = {
  gold: '#c9a227', golden: '#c9a227', yellow: '#ffd23f', marigold: '#f5a623', orange: '#e8590c', saffron: '#f4802a',
  white: '#fffdf2', jasmine: '#fffdf2', ivory: '#f5efe6', cream: '#f1e3c8', pink: '#ec7aa3', rose: '#e85d75', red: '#c8102e',
  maroon: '#7a1230', crimson: '#b3123f', green: '#3f7d4e', purple: '#7b61ff', blue: '#2f6fdb', silver: '#c0c0c8', black: '#222222',
  warm: '#ffcf70', 'warm white': '#ffe2a8', brown: '#8a5a2b',
};

export const COLOR_NAMES = Object.keys(NAMED_COLORS);

/** A `#rrggbb` for a hex value or a known name ("pink", "jasmine white", "warm"); null when unknown. */
export function resolveColor(input: string): string | null {
  const t = input.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (NAMED_COLORS[t]) return NAMED_COLORS[t]!;
  const words = t.split(/\s+/);
  for (const w of words) if (NAMED_COLORS[w]) return NAMED_COLORS[w]!;
  return null;
}
