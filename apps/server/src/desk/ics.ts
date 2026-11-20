import type { RecapVisit } from './facts.js';

/** iCalendar (RFC 5545) invite for a booked site visit. */

/** Attachment name and type for the site-visit invite, wherever it is emailed. */
export const ICS_FILENAME = 'site-visit.ics';
export const ICS_CONTENT_TYPE = 'text/calendar; charset=utf-8';

const PRODUCT_ID = '-//Agora Virtual Estates//Lead Desk//EN';
const UID_DOMAIN = 'agora-virtual-estates';
const MAX_LINE_OCTETS = 75;

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets, continuing with CRLF + space, without splitting characters. */
function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    const limit = out.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (octets + size > limit) {
      out.push(current);
      current = '';
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

export interface IcsOptions {
  sessionId: string;
  visit: RecapVisit;
  description: string;
  now: Date;
}

export function buildVisitIcs({ sessionId, visit, description, now }: IcsOptions): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${sessionId}-${visit.slotId}@${UID_DOMAIN}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(new Date(visit.start))}`,
    `DTEND:${utcStamp(new Date(visit.end))}`,
    `SUMMARY:${escapeText(`Site visit: ${visit.propertyName}`)}`,
    `LOCATION:${escapeText(visit.address)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
