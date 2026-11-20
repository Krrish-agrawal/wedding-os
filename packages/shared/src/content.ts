import { z } from 'zod';
import {
  CommuteFileSchema,
  LegalFileSchema,
  LocalityFileSchema,
  MoneyFileSchema,
  OffersPolicySchema,
  PlanFileSchema,
  PropertySchema,
  RoomsFileSchema,
  ScoringSchema,
  TourFileSchema,
  VisitsFileSchema,
  type OffersPolicy,
  type PropertyBundle,
  type Scoring,
} from './data.js';
import { LEASE_ITEM_IDS, priceLineItems } from './money.js';
import { slotLocalParts } from './visits.js';

/**
 * Assembles and validates all content from /data.
 * Environment-agnostic: the caller supplies a map of path (relative to /data, e.g.
 * "properties/indiranagar-apartment/property.json") to parsed JSON.
 * The server reads it from disk; the web app bundles it with import.meta.glob.
 */
export interface Content {
  properties: PropertyBundle[];
  byId: Record<string, PropertyBundle>;
  offers: OffersPolicy;
  scoring: Scoring;
}

export class ContentError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Content is invalid:\n- ${issues.join('\n- ')}`);
  }
}

const PROPERTY_FILES = ['property', 'rooms', 'tour', 'plan', 'money', 'legal', 'visits'] as const;

export function buildContent(files: Record<string, unknown>): Content {
  const issues: string[] = [];
  const parse = <S extends z.ZodTypeAny>(schema: S, path: string): z.infer<S> | null => {
    if (!(path in files)) {
      issues.push(`${path}: missing`);
      return null;
    }
    const r = schema.safeParse(files[path]);
    if (!r.success) {
      for (const i of r.error.issues) issues.push(`${path}: ${i.path.join('.') || '(root)'} ${i.message}`);
      return null;
    }
    return r.data;
  };

  const propertyIds = [
    ...new Set(
      Object.keys(files)
        .map((p) => /^properties\/([^/]+)\/property\.json$/.exec(p)?.[1])
        .filter((id): id is string => Boolean(id)),
    ),
  ].sort();

  const offers = parse(OffersPolicySchema, 'policy/offers.json');
  const scoring = parse(ScoringSchema, 'policy/scoring.json');

  const properties: PropertyBundle[] = [];
  for (const id of propertyIds) {
    const base = `properties/${id}`;
    const parts = Object.fromEntries(PROPERTY_FILES.map((f) => [f, `${base}/${f}.json`])) as Record<(typeof PROPERTY_FILES)[number], string>;
    const property = parse(PropertySchema, parts.property);
    const rooms = parse(RoomsFileSchema, parts.rooms);
    const tour = parse(TourFileSchema, parts.tour);
    const plan = parse(PlanFileSchema, parts.plan);
    const money = parse(MoneyFileSchema, parts.money);
    const legal = parse(LegalFileSchema, parts.legal);
    const visits = parse(VisitsFileSchema, parts.visits);
    const locality = property ? parse(LocalityFileSchema, `localities/${property.localityId}.json`) : null;
    const commute = parse(CommuteFileSchema, `commute/${id}.json`);
    if (!property || !rooms || !tour || !plan || !money || !legal || !visits || !locality || !commute) continue;

    if (property.id !== id) issues.push(`${parts.property}: id "${property.id}" does not match folder "${id}"`);
    if ((property.kind === 'sale') !== (money.kind === 'sale')) issues.push(`${parts.money}: kind "${money.kind}" does not match property kind "${property.kind}"`);
    const roomIds = new Set(rooms.rooms.map((r) => r.id));
    for (const s of tour.stops) if (!roomIds.has(s.roomId)) issues.push(`${parts.tour}: stop "${s.id}" references unknown room "${s.roomId}"`);
    for (const p of [...plan.electrical.points, ...plan.plumbing.fixtures]) {
      if (p.roomId && !roomIds.has(p.roomId)) issues.push(`${parts.plan}: point "${p.id}" references unknown room "${p.roomId}"`);
    }
    if (money.kind === 'sale') {
      const ids = new Set(money.lineItems.map((l) => l.id));
      for (const li of money.lineItems) {
        if (li.calc.type === 'percent') for (const ref of li.calc.of) if (!ids.has(ref)) issues.push(`${parts.money}: "${li.id}" references unknown item "${ref}"`);
      }
      const pct = money.schedule.reduce((s, x) => s + x.percent, 0);
      if (Math.abs(pct - 100) > 0.01) issues.push(`${parts.money}: payment schedule sums to ${pct}%, not 100%`);
      try {
        priceLineItems(money, property.areas);
      } catch (err) {
        issues.push(`${parts.money}: ${(err as Error).message}`);
      }
    }
    if (money.kind === 'lease' && rooms.rooms.some((r) => r.seats !== undefined)) {
      const roomSeats = rooms.rooms.reduce((s, r) => s + (r.seats ?? 0), 0);
      if (roomSeats !== money.seats) issues.push(`${parts.money}: ${money.seats} seats, but the rooms in ${parts.rooms} hold ${roomSeats}`);
    }
    const offerEntry = offers?.properties[id];
    if (offerEntry) {
      const known = new Set<string>(money.kind === 'sale' ? money.lineItems.map((l) => l.id) : LEASE_ITEM_IDS);
      for (const o of offerEntry.offers) {
        if (o.lineItemId && !known.has(o.lineItemId)) issues.push(`policy/offers.json: offer "${o.id}" for "${id}" references unknown line item "${o.lineItemId}"`);
      }
    }
    const docIds = new Set<string>();
    for (const d of legal.documents) {
      if (docIds.has(d.id)) issues.push(`${parts.legal}: duplicate document id "${d.id}"`);
      docIds.add(d.id);
    }
    const slotIds = new Set<string>();
    for (const s of visits.slots) {
      if (slotIds.has(s.id)) issues.push(`${parts.visits}: duplicate slot id "${s.id}"`);
      slotIds.add(s.id);
      const start = Date.parse(s.start);
      const end = Date.parse(s.end);
      if (!slotLocalParts(s.start) || !slotLocalParts(s.end) || Number.isNaN(start) || Number.isNaN(end) || end <= start) {
        issues.push(`${parts.visits}: slot "${s.id}" does not have a valid start before its end`);
      }
    }
    if (commute.propertyId !== id) issues.push(`commute/${id}.json: propertyId "${commute.propertyId}" does not match`);
    if (offers && !offers.properties[id]) issues.push(`policy/offers.json: no entry for property "${id}"`);

    properties.push({ property, rooms: rooms.rooms, tour, plan, money, legal, visits: visits.slots, locality, commute });
  }

  if (propertyIds.length === 0) issues.push('properties/: no properties found');
  if (issues.length || !offers || !scoring) throw new ContentError(issues);
  return { properties, byId: Object.fromEntries(properties.map((b) => [b.property.id, b])), offers, scoring };
}

/** Find a room or tour stop by id or loosely by name ("the kitchen", "master bedroom"). */
export function matchByName<T extends { id: string; name?: string; label?: string }>(items: T[], query: string): T | null {
  const q = normalise(query);
  if (!q) return null;
  const exact = items.find((i) => normalise(i.id) === q || normalise(i.name ?? '') === q || normalise(i.label ?? '') === q);
  if (exact) return exact;
  const words = q.split(' ').filter(Boolean);
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const hay = normalise(`${item.id} ${item.name ?? ''} ${item.label ?? ''}`);
    const score = words.filter((w) => hay.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\b(the|a|an|room|please|show|me|go|to)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
