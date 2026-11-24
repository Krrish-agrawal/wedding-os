import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { WeddingAction, WeddingState } from '@ave/shared';
import type { WeddingStore } from './store.js';

/**
 * Pending customer confirmations.
 *
 * Some planner actions are too consequential for the model to authorise itself (a large budget change, adding
 * past the customer's own limit). Instead of a flag the model can set, the tool records a PROPOSAL here and
 * returns it. A proposal changes nothing. Only an application route that the browser calls (see routes.ts) can
 * confirm or cancel it, and no planner tool can.
 *
 * A proposal is bound to one workspace, stores the exact validated reducer action, and can be consumed once.
 * It is rejected if it expired, was cancelled or already used, was altered (HMAC check), or if the part of the
 * wedding it was written against has changed since.
 */

export type ProposalStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'failed';
export type FingerprintKind = 'budget' | 'scene';

export interface ProposalChange {
  label: string;
  from: string;
  to: string;
}

/** What the browser (and the model, for context) may see. Never includes the stored action. */
export interface ProposalView {
  id: string;
  tool: string;
  summary: string;
  changes: ProposalChange[];
  expiresAt: number;
  status: ProposalStatus;
}

interface Stored extends ProposalView {
  weddingId: string;
  action: WeddingAction;
  kind: FingerprintKind;
  fingerprint: string;
  createdAt: number;
  /** Creation order; timestamps can tie within a millisecond. */
  seq: number;
  mac: string;
}

export type ProposalFailure = { ok: false; status: 404 | 409 | 410 | 422; code: 'not_found' | 'already_used' | 'cancelled' | 'expired' | 'stale' | 'tampered' | 'rejected'; message: string };
export type ProposalOutcome = { ok: true; state: WeddingState; proposal: ProposalView } | ProposalFailure;

export const PROPOSAL_TTL_MS = 10 * 60 * 1000;
export const MAX_PENDING_PER_WEDDING = 10;
const KEEP_FINISHED_MS = 60 * 60 * 1000;

/** The slice of the wedding a proposal was written against; if it changes, the proposal is stale. */
export function fingerprintOf(kind: FingerprintKind, s: WeddingState): string {
  return kind === 'budget'
    ? JSON.stringify({ total: s.budget.total, allocations: s.budget.allocations, limits: s.budget.limits })
    : JSON.stringify({ objects: s.scene.objects, limit: s.budget.limits.decoration ?? null });
}

/** The action with ids the planner generated removed, so a retried request is recognised as the same proposal. */
function canonical(action: WeddingAction): string {
  return JSON.stringify(action, (k, v) => (k === 'newId' ? undefined : k === 'items' && Array.isArray(v) ? v.map(({ id: _id, ...rest }: Record<string, unknown>) => rest) : v));
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

export class ProposalStore {
  private readonly records = new Map<string, Stored>();
  private seq = 0;
  private readonly key: Buffer;
  private readonly ttl: number;
  private readonly now: () => number;
  private readonly file: string | null;

  /** With `dir`, the integrity key and the proposals persist across restarts (files are private to the server process). */
  constructor(opts: { ttlMs?: number; now?: () => number; dir?: string } = {}) {
    this.ttl = opts.ttlMs ?? PROPOSAL_TTL_MS;
    this.now = opts.now ?? Date.now;
    this.file = opts.dir ? path.join(opts.dir, 'proposals.json') : null;
    this.key = randomBytes(32);
    if (opts.dir) {
      try {
        fs.mkdirSync(opts.dir, { recursive: true });
        const keyFile = path.join(opts.dir, 'proposal.key');
        try { const k = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex'); if (k.length === 32) this.key = k; else throw new Error('bad key'); }
        catch { fs.writeFileSync(keyFile, this.key.toString('hex'), { mode: 0o600 }); }
        const saved = JSON.parse(fs.readFileSync(this.file!, 'utf8')) as Stored[];
        for (const r of saved) { r.action = deepFreeze(r.action); this.records.set(r.id, r); this.seq = Math.max(this.seq, r.seq); }
      } catch { /* nothing saved yet, or unreadable: start empty (a tampered file fails the HMAC check anyway) */ }
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify([...this.records.values()]), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch { /* best effort: memory stays authoritative */ }
  }

  private mac(id: string, weddingId: string, kind: FingerprintKind, fingerprint: string, action: WeddingAction): string {
    return createHmac('sha256', this.key).update([id, weddingId, kind, fingerprint, JSON.stringify(action)].join('\n')).digest('hex');
  }

  private view(r: Stored): ProposalView {
    return { id: r.id, tool: r.tool, summary: r.summary, changes: r.changes, expiresAt: r.expiresAt, status: r.status };
  }

  private sweep(): void {
    const t = this.now();
    for (const r of this.records.values()) {
      if (r.status === 'pending' && t > r.expiresAt) r.status = 'expired';
      if (r.status !== 'pending' && t - r.createdAt > this.ttl + KEEP_FINISHED_MS) this.records.delete(r.id);
    }
  }

  /**
   * Records a proposal and returns its view, or null when the workspace already has too many pending. An identical
   * pending proposal (same action against the same state) is returned instead of creating a duplicate.
   */
  create(weddingId: string, input: { tool: string; summary: string; changes: ProposalChange[]; action: WeddingAction; kind: FingerprintKind; state: WeddingState }): ProposalView | null {
    this.sweep();
    const fingerprint = fingerprintOf(input.kind, input.state);
    const sameAction = canonical(input.action);
    const pending = [...this.records.values()].filter((r) => r.weddingId === weddingId && r.status === 'pending');
    const dup = pending.find((r) => r.tool === input.tool && r.kind === input.kind && r.fingerprint === fingerprint && canonical(r.action) === sameAction);
    if (dup) return this.view(dup);
    if (pending.length >= MAX_PENDING_PER_WEDDING) return null;
    const id = randomUUID();
    const action = deepFreeze(structuredClone(input.action));
    const createdAt = this.now();
    const rec: Stored = {
      id, tool: input.tool, summary: input.summary, changes: input.changes, expiresAt: createdAt + this.ttl, status: 'pending',
      weddingId, action, kind: input.kind, fingerprint, createdAt, seq: ++this.seq, mac: this.mac(id, weddingId, input.kind, fingerprint, action),
    };
    this.records.set(id, rec);
    this.save();
    return this.view(rec);
  }

  /** Pending proposals for one workspace, newest first. */
  pending(weddingId: string): ProposalView[] {
    this.sweep();
    return [...this.records.values()].filter((r) => r.weddingId === weddingId && r.status === 'pending').sort((a, b) => b.seq - a.seq).map((r) => this.view(r));
  }

  /** Looks a proposal up for this workspace only. A proposal from another workspace is indistinguishable from none. */
  private own(weddingId: string, id: string): Stored | null {
    this.sweep();
    const r = this.records.get(id);
    return r && r.weddingId === weddingId ? r : null;
  }

  private notPending(r: Stored): ProposalFailure {
    if (r.status === 'cancelled') return { ok: false, status: 409, code: 'cancelled', message: 'This proposal was cancelled.' };
    if (r.status === 'expired') return { ok: false, status: 410, code: 'expired', message: 'This proposal expired. Ask the planner to propose it again.' };
    return { ok: false, status: 409, code: 'already_used', message: 'This proposal has already been used.' };
  }

  /** Applies a proposal once, through the reducer, if every check passes. */
  confirm(store: WeddingStore, weddingId: string, id: string): ProposalOutcome {
    try { return this.confirmInner(store, weddingId, id); } finally { this.save(); }
  }

  private confirmInner(store: WeddingStore, weddingId: string, id: string): ProposalOutcome {
    const r = this.own(weddingId, id);
    if (!r) return { ok: false, status: 404, code: 'not_found', message: 'No such proposal.' };
    if (r.status !== 'pending') return this.notPending(r);
    if (this.now() > r.expiresAt) {
      r.status = 'expired';
      return this.notPending(r);
    }
    const expected = Buffer.from(this.mac(r.id, r.weddingId, r.kind, r.fingerprint, r.action), 'hex');
    const actual = Buffer.from(r.mac, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      r.status = 'failed';
      return { ok: false, status: 409, code: 'tampered', message: 'This proposal failed its integrity check and was discarded.' };
    }
    if (fingerprintOf(r.kind, store.getOrCreate(weddingId)) !== r.fingerprint) {
      r.status = 'failed';
      return { ok: false, status: 409, code: 'stale', message: 'The wedding changed since this was proposed, so it was discarded. Ask the planner to propose it again.' };
    }
    r.status = 'confirmed'; // consumed before applying, so it can never apply twice
    const result = store.dispatch(weddingId, r.action);
    if (!result.ok) {
      r.status = 'failed';
      return { ok: false, status: 422, code: 'rejected', message: `${result.error} ${result.hint}` };
    }
    return { ok: true, state: result.state, proposal: this.view(r) };
  }

  cancel(weddingId: string, id: string): { ok: true; proposal: ProposalView } | ProposalFailure {
    const r = this.own(weddingId, id);
    if (!r) return { ok: false, status: 404, code: 'not_found', message: 'No such proposal.' };
    if (r.status !== 'pending') return this.notPending(r);
    r.status = 'cancelled';
    this.save();
    return { ok: true, proposal: this.view(r) };
  }

  /** Test hook: alters a stored action the way an attacker with memory access might, to prove the integrity check. */
  _tamperForTest(id: string, action: WeddingAction): void {
    const r = this.records.get(id);
    if (r) r.action = action;
  }
}
