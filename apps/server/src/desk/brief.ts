import { VIEW_LABELS, formatDateTimeIST, type Content, type SessionState } from '@ave/shared';

/** The brief stays glanceable on the incoming-call card. */
const MAX_BRIEF_LINES = 4;
const MAX_ITEM_CHARS = 90;
const MAX_QUOTE_CHARS = 120;
const MAX_LIST_ITEMS = 3;

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/**
 * Two to four short lines on what the AI knows, for the advisor deciding whether to take a call: the
 * property and view on screen, purpose, budget and timeline, objections, and why the buyer asked for a person.
 * Built from the call record only (no model), so it is instant and never invents anything.
 */
export function buildBrief(state: SessionState, content: Content): string {
  const first = state.buyer.name.trim().split(/\s+/)[0] ?? state.buyer.name;
  const bundle = state.propertyId ? content.byId[state.propertyId] : undefined;
  const lines: string[] = [];

  lines.push(
    bundle
      ? `${first} is on ${bundle.property.name} (${bundle.property.configuration}, ${bundle.property.localityName}), looking at ${VIEW_LABELS[state.view]}.`
      : `${first} has not opened a property yet.`,
  );

  const f = state.lead;
  const known = [f.purpose && `wants ${clip(f.purpose, MAX_ITEM_CHARS)}`, f.budget && `budget ${clip(f.budget, MAX_ITEM_CHARS)}`, f.timeline && `timeline ${clip(f.timeline, MAX_ITEM_CHARS)}`].filter(Boolean);
  if (state.booking.status === 'confirmed' && state.booking.propertyId) {
    const b = content.byId[state.booking.propertyId];
    const slot = b?.visits.find((s) => s.id === state.booking.slotId);
    known.push(`visit booked${slot ? ` for ${formatDateTimeIST(slot.start)}` : ''}`);
  }
  if (known.length) lines.push(`${known.join('; ').replace(/^./, (c) => c.toUpperCase())}.`);

  const objections = [...f.objections, ...f.concerns].slice(0, MAX_LIST_ITEMS).map((o) => clip(o, MAX_ITEM_CHARS));
  if (objections.length) lines.push(`Objections: ${objections.join('; ')}.`);

  const lastBuyer = [...state.transcript].reverse().find((l) => l.role === 'buyer' && l.final && l.text.trim());
  const reason = state.handoff.reason ? clip(state.handoff.reason, MAX_ITEM_CHARS) : null;
  if (reason || lastBuyer) {
    const said = lastBuyer ? `Last said: “${clip(lastBuyer.text, MAX_QUOTE_CHARS)}”` : '';
    lines.push(reason ? `Asked for a person: ${reason}.${said ? ` ${said}` : ''}` : said);
  }

  return lines.slice(0, MAX_BRIEF_LINES).join('\n');
}
