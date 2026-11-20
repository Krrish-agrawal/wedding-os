import { DIRECTION_LABELS, formatINRShort, formatKm, type Direction } from '@ave/shared';

/**
 * Formatting for tool results. The voice (Murf Falcon) reads digits and the rupee sign best,
 * so amounts go out as a number plus a ready-to-say display string such as "₹1.28 crore".
 */

export interface Amount {
  rupees: number;
  /** Say this verbatim: "₹1.28 crore", "₹45.5 lakh", "₹85,047". */
  text: string;
}

export function amountText(rupees: number): string {
  return formatINRShort(rupees).replace(/ Cr$/, ' crore').replace(/ L$/, ' lakh');
}

export function amount(rupees: number): Amount {
  return { rupees: Math.round(rupees), text: amountText(rupees) };
}

export function distanceText(km: number): string {
  return formatKm(km);
}

const MINUTES_PER_HOUR = 60;

export function durationText(minutes: number): string {
  const m = Math.round(minutes);
  if (m < MINUTES_PER_HOUR) return `${m} minutes`;
  const h = Math.floor(m / MINUTES_PER_HOUR);
  const r = m % MINUTES_PER_HOUR;
  const hours = h === 1 ? '1 hour' : `${h} hours`;
  return r ? `${hours} ${r} minutes` : hours;
}

/** One decimal place, without a trailing ".0". */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** "north-east": the shared direction label, lower case for speech. */
export function directionWord(d: Direction): string {
  return DIRECTION_LABELS[d].toLowerCase();
}

/* ------------------------------ Time of day ------------------------------ */

/** Named parts of the day, as local clock minutes. Used when the buyer says "morning" rather than a time. */
export const TIME_OF_DAY_MINUTES: Record<string, number> = {
  'early morning': 7 * 60,
  morning: 8 * 60,
  'late morning': 10 * 60 + 30,
  noon: 12 * 60,
  midday: 12 * 60,
  afternoon: 15 * 60,
  'late afternoon': 16 * 60 + 30,
  evening: 17 * 60 + 30,
  night: 20 * 60,
};

/** Hours written without am/pm at or below this are read as afternoon ("at 5" means 5 PM). */
const LATEST_AMBIGUOUS_PM_HOUR = 5;
const NOON_HOUR = 12;

/**
 * Parses spoken or written clock times: "7:30", "07:30", "7.30", "5 pm", "5:30pm", "17:00",
 * "7 in the morning", "morning", "evening". Returns local minutes (0..1439) or null.
 * `sunrise` and `sunset` are resolved by the caller, which knows the property's sun times.
 */
export function parseClock(input: string, named: Partial<Record<'sunrise' | 'sunset', number>> = {}): number | null {
  const q = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return null;
  if (q.includes('sunrise') && named.sunrise !== undefined) return named.sunrise;
  if (q.includes('sunset') && named.sunset !== undefined) return named.sunset;

  const m = /(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/.exec(q);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h > 23 || min > 59) return null;
    const meridiem = m[3]?.replace(/[.\s]/g, '');
    const saysMorning = /morning/.test(q);
    const saysLater = /afternoon|evening|night/.test(q);
    if (meridiem === 'pm' || (!meridiem && saysLater)) {
      if (h < NOON_HOUR) h += NOON_HOUR;
    } else if (meridiem === 'am' || saysMorning) {
      if (h === NOON_HOUR) h = 0;
    } else if (h >= 1 && h <= LATEST_AMBIGUOUS_PM_HOUR) {
      h += NOON_HOUR;
    }
    return h * MINUTES_PER_HOUR + min;
  }

  // Longest phrase first so "late morning" wins over "morning".
  const phrases = Object.keys(TIME_OF_DAY_MINUTES).sort((a, b) => b.length - a.length);
  for (const p of phrases) if (q.includes(p)) return TIME_OF_DAY_MINUTES[p]!;
  return null;
}
