import {
  computeLeaseOfferTotals,
  computeSaleTotals,
  matchByName,
  type Expression,
  type OfferTotals,
  type PropertyBundle,
  type SessionAction,
  type SessionState,
  type ToolResult,
} from '@ave/shared';
import type { ToolContext } from './context.js';
import { EMPTY_SCREEN, screenSnapshot } from './screen.js';

/** Helpers every tool implementation uses. Tools return results; they never throw on purpose. */

export class SessionGoneError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} no longer exists`);
  }
}

export function stateOf(tc: ToolContext): SessionState {
  const state = tc.app.store.get(tc.sessionId);
  if (!state) throw new SessionGoneError(tc.sessionId);
  return state;
}

/**
 * Tool calls the model makes in parallel arrive within milliseconds; sequential ones are a model round trip apart.
 * Within this window a move back to the 3D tour must not override the more specific view another call just opened
 * (e.g. showBlueprint and tourGoTo answering "where are the AC points?").
 */
export const PARALLEL_VIEW_WINDOW_MS = 250;
const lastAgentView = new Map<string, { view: string; at: number }>();

export function dispatch(tc: ToolContext, action: SessionAction): SessionState {
  if (action.type === 'set_view' && tc.source === 'agent') {
    const now = Date.now();
    const prev = lastAgentView.get(tc.sessionId);
    if (prev && now - prev.at < PARALLEL_VIEW_WINDOW_MS && action.view === 'tour' && prev.view !== 'tour') {
      return stateOf(tc);
    }
    lastAgentView.set(tc.sessionId, { view: action.view, at: now });
  }
  const next = tc.app.store.dispatch(tc.sessionId, action, tc.source);
  if (!next) throw new SessionGoneError(tc.sessionId);
  return next;
}

function currentScreen(tc: ToolContext) {
  const state = tc.app.store.get(tc.sessionId);
  return state ? screenSnapshot(tc.app.content, state) : EMPTY_SCREEN;
}

export function ok(tc: ToolContext, data: unknown, expression?: Expression): ToolResult {
  return { ok: true, data, screen: currentScreen(tc), ...(expression ? { expression } : {}) };
}

export function fail(tc: ToolContext, error: string, hint?: string, expression: Expression = 'apologetic'): ToolResult {
  return { ok: false, error, ...(hint ? { hint } : {}), screen: currentScreen(tc), expression };
}

/** "apt-indiranagar (Name, 2 BHK apartment for sale)" for hints. */
export function propertyChoices(tc: ToolContext): string {
  return tc.app.content.properties.map((b) => `${b.property.id} (${b.property.name}, ${b.property.configuration})`).join('; ');
}

export type Resolved = { bundle: PropertyBundle; result?: undefined } | { bundle?: undefined; result: ToolResult };

/**
 * The property a tool should work on. Uses the open property; otherwise opens the single property that
 * fits `prefer` (or the only property), so a question like "what's the EMI?" never dead-ends.
 */
export function resolveProperty(tc: ToolContext, prefer?: (b: PropertyBundle) => boolean): Resolved {
  const state = stateOf(tc);
  const open = state.propertyId ? tc.app.content.byId[state.propertyId] : undefined;
  if (open) return { bundle: open };
  const all = tc.app.content.properties;
  const candidates = prefer ? all.filter(prefer) : all;
  const pick = candidates.length === 1 ? candidates[0] : all.length === 1 ? all[0] : undefined;
  if (pick) {
    dispatch(tc, { type: 'set_property', propertyId: pick.property.id });
    return { bundle: pick };
  }
  return {
    result: fail(tc, 'No property is open yet.', `Ask which property they mean, or call openProperty with one of: ${propertyChoices(tc)}.`, 'attentive'),
  };
}

export const isSale = (b: PropertyBundle) => b.property.kind === 'sale';
export const isLease = (b: PropertyBundle) => b.property.kind === 'lease';

export function policyFor(tc: ToolContext, bundle: PropertyBundle) {
  return tc.app.content.offers.properties[bundle.property.id] ?? null;
}

/**
 * Totals with the buyer's applied offers: the sale price, or for a lease, rent and maintenance over the
 * term. The same shape the offers policy is checked against.
 */
export function offerTotals(tc: ToolContext, bundle: PropertyBundle, state: SessionState): OfferTotals {
  const offers = policyFor(tc, bundle)?.offers ?? [];
  const applied = state.appliedOffers[bundle.property.id] ?? [];
  return bundle.money.kind === 'sale'
    ? computeSaleTotals(bundle.money, bundle.property.areas, offers, applied)
    : computeLeaseOfferTotals(bundle.money, offers, applied);
}

/** Finds a tour stop by id, label or room name. */
export function findStop(bundle: PropertyBundle, query: string) {
  const stops = bundle.tour.stops;
  const direct = matchByName(stops, query);
  if (direct) return direct;
  const room = matchByName(bundle.rooms, query);
  return room ? stops.find((s) => s.roomId === room.id) ?? null : null;
}

export function findRoom(bundle: PropertyBundle, query: string) {
  return matchByName(bundle.rooms, query);
}

export function listNames(items: { name?: string; label?: string; title?: string }[], max = 8): string {
  return items
    .slice(0, max)
    .map((i) => i.name ?? i.label ?? i.title ?? '')
    .filter(Boolean)
    .join(', ');
}

/** Keeps only defined values so results stay compact. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}
