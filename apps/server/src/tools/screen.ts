import {
  BLUEPRINT_LAYER_LABELS,
  COMPASS_OVERLAY_LABELS,
  MONEY_TAB_LABELS,
  PLACE_CATEGORY_LABELS,
  VIEW_LABELS,
  describeSlot,
  formatClock,
  type Content,
  type PropertyBundle,
  type ScreenSnapshot,
  type SessionState,
} from '@ave/shared';
import { amountText } from './format.js';

/** What the buyer is looking at, in a few words, for tool results and the screen line. */
export function screenSnapshot(content: Content, state: SessionState): ScreenSnapshot {
  const bundle = state.propertyId ? content.byId[state.propertyId] ?? null : null;
  return {
    propertyId: bundle?.property.id ?? null,
    propertyName: bundle?.property.name ?? null,
    view: state.view,
    detail: screenDetail(bundle, state),
  };
}

/** Used when there is no session to describe. */
export const EMPTY_SCREEN: ScreenSnapshot = { propertyId: null, propertyName: null, view: 'shortlist', detail: null };

export function screenDetail(bundle: PropertyBundle | null, state: SessionState): string | null {
  const p = state.params;
  const roomName = (id: string | null) => (id && bundle ? bundle.rooms.find((r) => r.id === id)?.name ?? null : null);
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(', ') || null;

  switch (state.view) {
    case 'shortlist':
      return 'Both properties side by side';
    case 'tour': {
      const stop = p.tour.stopId && bundle ? bundle.tour.stops.find((s) => s.id === p.tour.stopId)?.label ?? null : null;
      return join(p.tour.mode === 'walkthrough' ? 'Automatic walkthrough' : null, stop ?? (p.tour.mode === 'walkthrough' ? null : 'Overview of the whole home'));
    }
    case 'blueprint':
      return join(`${BLUEPRINT_LAYER_LABELS[p.blueprint.layer]} layer`, roomName(p.blueprint.roomId));
    case 'locality': {
      const place = p.locality.placeId && bundle ? bundle.locality.places.find((x) => x.id === p.locality.placeId)?.name ?? null : null;
      return join(p.locality.category ? PLACE_CATEGORY_LABELS[p.locality.category] : 'Area profile', place);
    }
    case 'commute': {
      if (p.commute.custom) return `Route to ${p.commute.custom.name}`;
      const route = p.commute.destinationId && bundle ? bundle.commute.routes.find((r) => r.id === p.commute.destinationId) : null;
      return route ? `Route to ${route.label}` : 'Preset routes';
    }
    case 'compass':
      return join(`${COMPASS_OVERLAY_LABELS[p.compass.overlay]} at ${formatClock(p.compass.minutes)}`, roomName(p.compass.roomId));
    case 'money': {
      const emi = p.money.tab === 'emi' && p.money.emi ? `${amountText(p.money.emi.downPayment)} down, ${p.money.emi.ratePct}%, ${p.money.emi.tenureYears} years` : null;
      return join(MONEY_TAB_LABELS[p.money.tab], emi);
    }
    case 'legal': {
      const doc = p.legal.docId && bundle ? bundle.legal.documents.find((d) => d.id === p.legal.docId)?.title ?? null : null;
      return doc ?? 'All documents';
    }
    case 'booking': {
      const slot = p.booking.slotId && bundle ? bundle.visits.find((s) => s.id === p.booking.slotId) : null;
      return slot ? `Slot ${describeSlot(slot)}` : 'Available visit slots';
    }
  }
}

/** "Pricing: EMI, ₹30 lakh down…" style one-liner of the view, used in the screen line. */
export function viewPhrase(content: Content, state: SessionState): string {
  const snap = screenSnapshot(content, state);
  return snap.detail ? `${VIEW_LABELS[snap.view]} (${snap.detail})` : VIEW_LABELS[snap.view];
}
