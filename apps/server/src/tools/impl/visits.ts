import { describeSlot, type PropertyBundle, type ToolInput, type ToolResult, type VisitSlot } from '@ave/shared';
import type { ToolContext } from '../context.js';
import { dispatch, fail, ok, resolveProperty, stateOf } from '../kit.js';

const MAX_SLOTS = 6;

function openSlots(bundle: PropertyBundle, now: number): VisitSlot[] {
  return bundle.visits.filter((s) => s.available && Date.parse(s.start) > now);
}

function slotChoices(slots: VisitSlot[]): string {
  return slots
    .slice(0, MAX_SLOTS)
    .map((s) => `${s.id} (${describeSlot(s)})`)
    .join('; ');
}

export function getVisitSlots(tc: ToolContext, input: ToolInput<'getVisitSlots'>): ToolResult {
  const r = resolveProperty(tc);
  if (!r.bundle) return r.result;
  const bundle = r.bundle;
  dispatch(tc, { type: 'set_view', view: 'booking' });
  const state = stateOf(tc);
  const slots = openSlots(bundle, tc.deps.now());
  const booked = state.booking.status === 'confirmed' && state.booking.propertyId === bundle.property.id ? bundle.visits.find((s) => s.id === state.booking.slotId) : undefined;

  if (slots.length === 0) {
    return fail(tc, `There are no open visit slots for ${bundle.property.name} right now.`, 'Say so and offer to have a senior advisor arrange a time.');
  }
  return ok(
    tc,
    {
      property: bundle.property.name,
      slots: slots.slice(0, MAX_SLOTS).map((s) => ({ id: s.id, when: describeSlot(s) })),
      ...(booked ? { alreadyBooked: describeSlot(booked) } : {}),
    },
    input.tone ?? 'warm',
  );
}

export function bookSiteVisit(tc: ToolContext, input: ToolInput<'bookSiteVisit'>): ToolResult {
  const r = resolveProperty(tc);
  if (!r.bundle) return r.result;
  const bundle = r.bundle;
  const now = tc.deps.now();
  const open = openSlots(bundle, now);
  const wanted = input.slotId.trim().toLowerCase();
  const slot = bundle.visits.find((s) => s.id.toLowerCase() === wanted);

  if (!slot) {
    return fail(tc, `There is no visit slot "${input.slotId}".`, open.length ? `Offer one of: ${slotChoices(open)}.` : 'Offer to have a senior advisor arrange a time.');
  }
  if (!open.includes(slot)) {
    return fail(tc, `The ${describeSlot(slot)} slot is no longer available.`, open.length ? `Offer one of: ${slotChoices(open)}.` : 'Offer to have a senior advisor arrange a time.');
  }

  const state = stateOf(tc);
  if (state.booking.status === 'confirmed' && state.booking.propertyId === bundle.property.id && state.booking.slotId === slot.id) {
    dispatch(tc, { type: 'set_view', view: 'booking', params: { slotId: slot.id } });
    return ok(tc, { booked: describeSlot(slot), property: bundle.property.name, alreadyBooked: true }, input.tone ?? 'warm');
  }

  // Highlight the slot on screen while asking, so the buyer sees exactly what they are agreeing to.
  dispatch(tc, { type: 'set_view', view: 'booking', params: { slotId: slot.id } });
  if (!input.confirmed) {
    return fail(
      tc,
      'Booking needs the buyer\'s clear yes first.',
      `Ask: shall I book ${describeSlot(slot)} at ${bundle.property.name}? Call again with confirmed true only after a clear yes.`,
      'attentive',
    );
  }

  dispatch(tc, { type: 'confirm_booking', propertyId: bundle.property.id, slotId: slot.id });
  return ok(tc, { booked: describeSlot(slot), property: bundle.property.name, address: bundle.property.address }, input.tone ?? 'delighted');
}
