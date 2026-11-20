import {
  SCREEN_EVENT_MARKER,
  VIEW_LABELS,
  type ActionSource,
  type Content,
  type SessionAction,
  type SessionState,
  type ViewId,
} from '@ave/shared';

/**
 * The parts of session state the advisor must know about. When this key changes, the server
 * replaces the agent's screen line (debounced); everything else (transcript, activity, deliveries)
 * does not touch the agent.
 */
export function screenKey(state: SessionState): string {
  const offers = state.propertyId ? state.appliedOffers[state.propertyId] ?? [] : [];
  return JSON.stringify([
    state.propertyId,
    state.view,
    state.params[state.view],
    offers,
    state.booking.status,
    state.booking.slotId,
    state.handoff.status,
  ]);
}

/** A buyer click that deserves a spoken reaction, not just a silent screen-line update. */
export type ScreenReaction =
  | { kind: 'property'; propertyId: string }
  | { kind: 'view'; view: ViewId }
  | { kind: 'tour_stop'; stopId: string }
  | { kind: 'legal_doc'; docId: string }
  | { kind: 'human_requested' };

/**
 * Decides whether a state change was a buyer click worth a reply. Only buyer clicks count: the
 * agent's own tool calls are already in its reply, and presenter keys and the human advisor
 * steer silently. Slider drags and hovers never qualify (they update the screen line only).
 */
export function reactionFor(prev: SessionState | undefined, next: SessionState, action: SessionAction, source: ActionSource): ScreenReaction | null {
  if (source !== 'buyer' || !prev) return null;
  switch (action.type) {
    case 'set_property':
      return prev.propertyId !== next.propertyId && next.propertyId ? { kind: 'property', propertyId: next.propertyId } : null;
    case 'set_view': {
      if (prev.view !== next.view) return { kind: 'view', view: next.view };
      const stopId = next.params.tour.stopId;
      if (next.view === 'tour' && stopId && stopId !== prev.params.tour.stopId) return { kind: 'tour_stop', stopId };
      const docId = next.params.legal.docId;
      if (next.view === 'legal' && docId && docId !== prev.params.legal.docId) return { kind: 'legal_doc', docId };
      return null;
    }
    case 'set_handoff':
      return prev.handoff.status !== 'requested' && next.handoff.status === 'requested' ? { kind: 'human_requested' } : null;
    default:
      return null;
  }
}

/** One factual sentence for `think`, marked so captions and history reconciliation skip it. */
export function reactionText(reaction: ScreenReaction, state: SessionState, content: Content): string {
  const bundle = state.propertyId ? content.byId[state.propertyId] : undefined;
  const forProperty = bundle ? ` for ${bundle.property.name}` : '';
  let sentence: string;
  switch (reaction.kind) {
    case 'property': {
      const name = content.byId[reaction.propertyId]?.property.name ?? 'a property';
      sentence = `The buyer clicked to open ${name}.`;
      break;
    }
    case 'view':
      sentence = `The buyer clicked to open the ${VIEW_LABELS[reaction.view]} view${forProperty}.`;
      break;
    case 'tour_stop': {
      const label = bundle?.tour.stops.find((s) => s.id === reaction.stopId)?.label ?? 'a room';
      sentence = `The buyer tapped ${label} on the floor plan.`;
      break;
    }
    case 'legal_doc': {
      const title = bundle?.legal.documents.find((d) => d.id === reaction.docId)?.title ?? 'a document';
      sentence = `The buyer opened the ${title} card.`;
      break;
    }
    case 'human_requested':
      sentence = 'The buyer pressed Talk to a human. A senior advisor has been notified and will join shortly; keep helping until then.';
      break;
  }
  return `${SCREEN_EVENT_MARKER} ${sentence}`;
}
