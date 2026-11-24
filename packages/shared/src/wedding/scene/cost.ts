import { DECOR_CATALOG, findEntry } from './catalog.js';
import type { DecorObject } from '../state.js';

/**
 * Deterministic decoration costing from SAMPLE prices in the catalogue. The planner calls tools that call these;
 * it never adds prices up itself.
 */

export interface CostLine {
  catalogId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export function costLines(objects: readonly Pick<DecorObject, 'catalogId'>[]): CostLine[] {
  const counts = new Map<string, number>();
  for (const o of objects) counts.set(o.catalogId, (counts.get(o.catalogId) ?? 0) + 1);
  return [...counts].flatMap(([catalogId, quantity]) => {
    const e = findEntry(DECOR_CATALOG, catalogId);
    return e ? [{ catalogId, name: e.name, quantity, unitPrice: e.samplePrice, subtotal: e.samplePrice * quantity }] : [];
  });
}

export const sceneCost = (objects: readonly Pick<DecorObject, 'catalogId'>[]): number => costLines(objects).reduce((s, l) => s + l.subtotal, 0);

/** Lower number = more essential. The stage and mandap are never suggested for removal. */
const KEEP_RANK: Record<string, number> = { stage: 0, mandap: 0, arch: 2, seating: 4, table: 4, ritual: 5, floral: 5, lighting: 6 };

export interface TrimSuggestion {
  removeIds: string[];
  savings: number;
  resultingCost: number;
  /** False when even removing every optional piece leaves the scene above the limit. */
  feasible: boolean;
}

/**
 * Which pieces to remove to bring the scene under `limit`: least essential category first, then most expensive,
 * never the stage or a mandap, never something that still has objects on it.
 */
export function suggestTrim(objects: readonly DecorObject[], limit: number): TrimSuggestion {
  let cost = sceneCost(objects);
  const removeIds: string[] = [];
  if (cost <= limit) return { removeIds, savings: 0, resultingCost: cost, feasible: true };
  const rank = (o: DecorObject) => KEEP_RANK[findEntry(DECOR_CATALOG, o.catalogId)?.category ?? 'lighting'] ?? 6;
  const price = (o: DecorObject) => findEntry(DECOR_CATALOG, o.catalogId)?.samplePrice ?? 0;
  const candidates = objects.filter((o) => rank(o) > 0).sort((a, b) => rank(b) - rank(a) || price(b) - price(a) || a.id.localeCompare(b.id));
  for (const o of candidates) {
    if (cost <= limit) break;
    removeIds.push(o.id);
    cost -= price(o);
  }
  return { removeIds, savings: sceneCost(objects) - cost, resultingCost: cost, feasible: cost <= limit };
}
