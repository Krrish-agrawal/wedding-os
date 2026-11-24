/** Small, deterministic text parsers for the demo router. */

const UNIT: Record<string, number> = { k: 1_000, thousand: 1_000, lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000, l: 100_000, crore: 10_000_000, crores: 10_000_000, cr: 10_000_000 };

/** First money amount in `text`: "25 lakh", "1.5 crore", "₹2,50,000", "rs 50000". Null when none. */
export function parseAmount(text: string): number | null {
  const re = /(?:₹|rs\.?\s*|inr\s*)?(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr|thousand|k|l)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const hasCurrency = /^(?:₹|rs|inr)/i.test(m[0]);
    const unit = m[2]?.toLowerCase();
    if (!unit && !hasCurrency) continue;
    const n = Number(m[1]!.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const value = Math.round(n * (unit ? UNIT[unit]! : 1));
    if (value > 0 && value <= 1_000_000_000) return value;
  }
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function parseDate(text: string): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return iso[0];
  const dm = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/i.exec(text);
  const md = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(text);
  const p = dm ? { d: dm[1]!, m: dm[2]!, y: dm[3]! } : md ? { d: md[2]!, m: md[1]!, y: md[3]! } : null;
  if (!p) return null;
  return `${p.y}-${String(MONTHS.indexOf(p.m.toLowerCase().slice(0, 3)) + 1).padStart(2, '0')}-${p.d.padStart(2, '0')}`;
}

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3, several: 4, more: 2, another: 1 };

/** A count such as "3", "two", "a couple of", "more", directly before `index` in `text`. */
export function quantityBefore(text: string, index: number): number | null {
  const head = text.slice(Math.max(0, index - 28), index).toLowerCase();
  const m = /(\d{1,2}|a couple of|a few|several|one|two|three|four|five|six|seven|eight|nine|ten|another|more|an|a)\s+(?:(?:more|extra|additional|new|traditional|modern|flower|floral|wedding|banquet|gold|golden)\s+)*$/.exec(head);
  if (!m) return null;
  const w = m[1]!.replace('a couple of', 'couple').replace('a few', 'few');
  return /^\d/.test(w) ? Math.min(12, Number(w)) : (WORD_NUMBERS[w] ?? null);
}

export const metresIn = (text: string): number | null => {
  const m = /(\d+(?:\.\d+)?)\s*(m\b|metres?|meters?|ft\b|feet|foot|cm\b)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2]!.toLowerCase();
  return u.startsWith('ft') || u.startsWith('feet') || u === 'foot' ? n * 0.3048 : u === 'cm' ? n / 100 : n;
};
