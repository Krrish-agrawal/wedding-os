import type { ActionEnvelope, SessionState, TimelineEvent } from './session.js';
import { VIEW_LABELS } from './labels.js';
import { CALL_LANGUAGE_INFO } from './language.js';

const MAX_TRANSCRIPT_LINES = 400;
const MAX_TIMELINE_EVENTS = 500;

/**
 * The single reducer for session state. Pure: same input, same output.
 * Returns the same object when nothing changed, so callers can skip broadcasts.
 */
export function reduceSession(state: SessionState, env: ActionEnvelope): SessionState {
  const { action, source, at } = env;
  const next = structuredClone(state);
  let event: Omit<TimelineEvent, 'at' | 'source'> | null = null;

  switch (action.type) {
    case 'set_view': {
      const prevView = next.view;
      next.view = action.view;
      if (action.params) {
        Object.assign(next.params[action.view], stripUndefined(action.params));
      }
      if (prevView !== action.view) {
        event = { kind: 'view', label: `Opened ${VIEW_LABELS[action.view]}`, propertyId: next.propertyId, view: action.view };
      }
      break;
    }
    case 'set_property': {
      if (next.propertyId !== action.propertyId) {
        next.propertyId = action.propertyId;
        // A new property starts its views fresh, except the money EMI inputs which are per property anyway.
        next.params.tour = { stopId: null, mode: 'step' };
        next.params.blueprint = { layer: 'layout', roomId: null };
        next.params.compass = { ...next.params.compass, roomId: null };
        next.params.commute = { destinationId: null, custom: null };
        next.params.money = { tab: 'breakup', emi: null };
        next.params.legal = { docId: null };
        next.params.booking = { slotId: null };
        event = { kind: 'property', label: 'Opened property', propertyId: action.propertyId, view: next.view };
      }
      break;
    }
    case 'set_status': {
      if (next.status !== action.status) {
        next.status = action.status;
        event = { kind: 'status', label: `Call ${action.status}`, propertyId: next.propertyId, view: null };
      }
      break;
    }
    case 'set_language': {
      if (next.language !== action.language) {
        next.language = action.language;
        event = { kind: 'language', label: `Language: ${CALL_LANGUAGE_INFO[action.language].label}`, propertyId: next.propertyId, view: null };
      }
      break;
    }
    case 'apply_offer': {
      const list = next.appliedOffers[action.propertyId] ?? [];
      if (!list.includes(action.offerId)) {
        next.appliedOffers[action.propertyId] = [...list, action.offerId];
        event = { kind: 'offer_applied', label: `Applied offer ${action.offerId}`, propertyId: action.propertyId, view: 'money' };
      }
      break;
    }
    case 'remove_offer': {
      const list = next.appliedOffers[action.propertyId] ?? [];
      next.appliedOffers[action.propertyId] = list.filter((id) => id !== action.offerId);
      break;
    }
    case 'confirm_booking': {
      next.booking = { propertyId: action.propertyId, slotId: action.slotId, status: 'confirmed' };
      next.params.booking.slotId = action.slotId;
      event = { kind: 'visit_booked', label: 'Site visit booked', propertyId: action.propertyId, view: 'booking' };
      break;
    }
    case 'update_lead': {
      const p = action.patch;
      if (p.purpose !== undefined) next.lead.purpose = p.purpose;
      if (p.budget !== undefined) next.lead.budget = p.budget;
      if (p.timeline !== undefined) next.lead.timeline = p.timeline;
      for (const key of ['needs', 'concerns', 'objections', 'notes'] as const) {
        const add = p[key];
        if (add) next.lead[key] = dedupe([...next.lead[key], ...add]);
      }
      event = { kind: 'lead', label: 'Lead details updated', propertyId: next.propertyId, view: null };
      break;
    }
    case 'set_agent': {
      Object.assign(next.agent, stripUndefined(action.patch));
      break;
    }
    case 'set_handoff': {
      const before = next.handoff.status;
      Object.assign(next.handoff, stripUndefined(action.patch));
      if (before !== next.handoff.status) {
        event = { kind: `handoff_${next.handoff.status}`, label: `Handoff ${next.handoff.status}`, propertyId: next.propertyId, view: null };
      }
      break;
    }
    case 'set_activity': {
      next.activity = action.label ? { label: action.label, at } : null;
      break;
    }
    case 'add_transcript': {
      const idx = next.transcript.findIndex((l) => l.id === action.line.id);
      if (idx >= 0) next.transcript[idx] = action.line;
      else next.transcript.push(action.line);
      if (next.transcript.length > MAX_TRANSCRIPT_LINES) next.transcript.splice(0, next.transcript.length - MAX_TRANSCRIPT_LINES);
      break;
    }
    case 'upsert_delivery': {
      const idx = next.deliveries.findIndex((d) => d.id === action.delivery.id);
      if (idx >= 0) next.deliveries[idx] = action.delivery;
      else next.deliveries.push(action.delivery);
      break;
    }
    case 'set_consult': {
      Object.assign(next.consult, stripUndefined(action.patch));
      break;
    }
    case 'add_admin_note': {
      if (!next.consult.adminNotes.some((n) => n.id === action.note.id)) next.consult.adminNotes.push(action.note);
      break;
    }
    case 'note': {
      event = { kind: action.kind, label: action.label, propertyId: next.propertyId, view: next.view, ...(action.expression ? { expression: action.expression } : {}) };
      break;
    }
  }

  if (event) {
    next.timeline.push({ ...event, at, source });
    if (next.timeline.length > MAX_TIMELINE_EVENTS) next.timeline.splice(0, next.timeline.length - MAX_TIMELINE_EVENTS);
  }
  if (JSON.stringify(next) === JSON.stringify(state)) return state;
  next.rev = state.rev + 1;
  return next;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((s) => {
    const k = s.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
