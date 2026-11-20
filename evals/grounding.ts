/**
 * Grounding check: every number the advisor says must come from somewhere it was told.
 * A number counts as grounded when it appears in a tool result from the same turn, in the buyer's own
 * words that turn, or in the brief. Numbers found only in an earlier turn's tool results are reported
 * as a warning (the advisor repeated an older fact without re-checking it).
 */

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** "1,49,323" -> "149323"; "7.50" -> "7.5"; "08" -> "8". */
export function canonical(raw: string): string {
  const s = raw.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}

/** Product terms that contain digits but are not facts, e.g. "3D tour". */
const NOT_NUMBERS = /\b3D\b/gi;

export function numbersIn(text: string): string[] {
  return [...text.replace(NOT_NUMBERS, '').matchAll(NUMBER)].map((m) => canonical(m[0]));
}

export interface GroundingReport {
  ungrounded: string[];
  /** Grounded only by an earlier turn. */
  stale: string[];
}

export function checkGrounding(reply: string, sources: { turn: string[]; earlier: string[] }): GroundingReport {
  const now = new Set(sources.turn.flatMap(numbersIn));
  const before = new Set(sources.earlier.flatMap(numbersIn));
  const ungrounded: string[] = [];
  const stale: string[] = [];
  for (const n of new Set(numbersIn(reply))) {
    if (now.has(n)) continue;
    if (before.has(n)) stale.push(n);
    else ungrounded.push(n);
  }
  return { ungrounded, stale };
}
