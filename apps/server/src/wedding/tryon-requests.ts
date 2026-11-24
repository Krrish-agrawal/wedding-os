import { randomUUID } from 'node:crypto';

/**
 * Preview requests. The planner cannot generate a try-on image: generation runs in the customer's browser, on their
 * own photo, which never reaches this server. A fashion tool records WHAT should be previewed; the browser page fetches
 * the request, runs the real engine, and reports back. Until it does, the request stays `pending` and no tool may
 * claim a preview exists.
 */

export type TryOnRequestKind = 'preview' | 'compare';
export type TryOnRequestStatus = 'pending' | 'generated' | 'failed' | 'expired';

export interface TryOnRequest {
  id: string;
  kind: TryOnRequestKind;
  garmentIds: string[];
  status: TryOnRequestStatus;
  message: string | null;
  createdAt: number;
}

const TTL_MS = 30 * 60_000;
const MAX_PER_WEDDING = 10;

export class TryOnRequests {
  private readonly byWedding = new Map<string, TryOnRequest[]>();

  constructor(private readonly now: () => number = Date.now) {}

  private list(weddingId: string): TryOnRequest[] {
    const all = this.byWedding.get(weddingId) ?? [];
    for (const r of all) if (r.status === 'pending' && this.now() - r.createdAt > TTL_MS) r.status = 'expired';
    return all;
  }

  /** Records a request (or returns the identical pending one). Returns null when too many are waiting. */
  create(weddingId: string, kind: TryOnRequestKind, garmentIds: string[]): TryOnRequest | null {
    const all = this.list(weddingId);
    const same = all.find((r) => r.status === 'pending' && r.kind === kind && r.garmentIds.join() === garmentIds.join());
    if (same) return same;
    if (all.filter((r) => r.status === 'pending').length >= MAX_PER_WEDDING) return null;
    const r: TryOnRequest = { id: randomUUID(), kind, garmentIds, status: 'pending', message: null, createdAt: this.now() };
    all.push(r);
    this.byWedding.set(weddingId, all.slice(-50));
    return r;
  }

  pending(weddingId: string): TryOnRequest[] { return this.list(weddingId).filter((r) => r.status === 'pending'); }
  recent(weddingId: string): TryOnRequest[] { return this.list(weddingId).slice(-10); }

  /** Called by the browser after it ran (or failed to run) the engine. Only a pending request can be completed. */
  complete(weddingId: string, id: string, status: 'generated' | 'failed', message: string | null): TryOnRequest | null {
    const r = this.list(weddingId).find((x) => x.id === id && x.status === 'pending');
    if (!r) return null;
    r.status = status;
    r.message = message ? message.slice(0, 300) : null;
    return r;
  }
}

/** One registry per wedding store, so tools and routes share it without widening the tool context. */
const registries = new WeakMap<object, TryOnRequests>();
export function tryOnRequestsFor(owner: object): TryOnRequests {
  let r = registries.get(owner);
  if (!r) registries.set(owner, (r = new TryOnRequests()));
  return r;
}
