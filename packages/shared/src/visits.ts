import type { VisitSlot } from './data.js';
import { formatClock } from './format.js';

/**
 * Site-visit slot helpers. Slots are stored as ISO 8601 with the property's UTC offset, and are
 * always shown in the property's local time, whatever time zone the viewer is in.
 */

export interface SlotLocalParts {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Local clock time, minutes after midnight. */
  minutes: number;
}

const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** Reads the local date and clock time written in an ISO string, without converting time zones. */
export function slotLocalParts(iso: string): SlotLocalParts | null {
  const m = ISO_LOCAL.exec(iso);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return { date: `${y}-${mo}-${d}`, minutes: Number(h) * 60 + Number(mi) };
}

const dayLong = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const weekdayOnly = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long' });

function utcDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

/** "Sunday, 22 November" */
export function formatSlotDay(iso: string): string {
  const p = slotLocalParts(iso);
  return p ? dayLong.format(utcDate(p.date)) : iso;
}

/** "Sun, 22 Nov" */
export function formatSlotDayShort(iso: string): string {
  const p = slotLocalParts(iso);
  return p ? dayShort.format(utcDate(p.date)) : iso;
}

/** "Sunday" */
export function formatSlotWeekday(iso: string): string {
  const p = slotLocalParts(iso);
  return p ? weekdayOnly.format(utcDate(p.date)) : iso;
}

/** "10:00 AM" */
export function formatSlotTime(iso: string): string {
  const p = slotLocalParts(iso);
  return p ? formatClock(p.minutes) : iso;
}

/** "10:00 AM – 11:00 AM" */
export function formatSlotRange(slot: Pick<VisitSlot, 'start' | 'end'>): string {
  return `${formatSlotTime(slot.start)} – ${formatSlotTime(slot.end)}`;
}

/** "Sunday, 22 November, 10:00 AM to 11:00 AM" — for the advisor and for recaps. */
export function describeSlot(slot: Pick<VisitSlot, 'start' | 'end'>): string {
  return `${formatSlotDay(slot.start)}, ${formatSlotTime(slot.start)} to ${formatSlotTime(slot.end)}`;
}

/** Whether a slot falls on a Saturday or Sunday, in the property's local time. */
export function isWeekendSlot(slot: Pick<VisitSlot, 'start'>): boolean {
  const p = slotLocalParts(slot.start);
  if (!p) return false;
  const day = utcDate(p.date).getUTCDay();
  return day === 0 || day === 6;
}

export interface SlotDay<S extends Pick<VisitSlot, 'start'>> {
  date: string;
  label: string;
  slots: S[];
}

/** Slots in time order, grouped by local day. */
export function groupSlotsByDay<S extends Pick<VisitSlot, 'start'>>(slots: S[]): SlotDay<S>[] {
  const sorted = [...slots].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const days: SlotDay<S>[] = [];
  for (const slot of sorted) {
    const date = slotLocalParts(slot.start)?.date ?? slot.start;
    let day = days.find((d) => d.date === date);
    if (!day) {
      day = { date, label: formatSlotDay(slot.start), slots: [] };
      days.push(day);
    }
    day.slots.push(slot);
  }
  return days;
}
