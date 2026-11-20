import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createSessionState,
  RecapSummarySchema,
  SessionStateSchema,
  type Delivery,
  type EmiInputs,
  type OutboxItem,
  type RecapSummary,
  type SessionState,
} from '@ave/shared';
import type { SessionStore } from '../sessions/store.js';

/** Changes are written at most this often per burst, so a busy call is not a write storm. */
export const PERSIST_DEBOUNCE_MS = 400;
const OUTBOX_LIST_LIMIT = 200;

/** Facts we keep about a lead that session state alone forgets (it resets per property). */
export interface LeadExtras {
  /** Last EMI inputs used for each sale property. */
  emiByProperty: Record<string, EmiInputs>;
}

export interface LeadRecord {
  state: SessionState;
  extras: LeadExtras;
  updatedAt: number;
}

export interface ReportRecord {
  sessionId: string;
  summary: RecapSummary | null;
  summaryAt: number | null;
  /** Fingerprint of the facts in the last recap that went out, to skip identical resends. */
  factsHash: string | null;
  sentAt: number | null;
  autoSentAt: number | null;
  crmDealId: string | null;
}

export interface OutboxRecord {
  delivery: Delivery;
  sessionId: string;
  buyerName: string;
  subject: string | null;
  text: string | null;
  html: string | null;
}

interface Logger {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_phone TEXT NOT NULL,
  state_json TEXT NOT NULL,
  extras_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  session_id TEXT PRIMARY KEY,
  summary_json TEXT,
  summary_at INTEGER,
  facts_hash TEXT,
  sent_at INTEGER,
  auto_sent_at INTEGER,
  crm_deal_id TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  at INTEGER NOT NULL,
  subject TEXT,
  body_text TEXT,
  body_html TEXT
);
CREATE INDEX IF NOT EXISTS outbox_session ON outbox (session_id);
CREATE INDEX IF NOT EXISTS outbox_at ON outbox (at);
`;

/**
 * Outbox columns added after the first release. Databases written before them get the columns
 * on open (see `migrate`); old rows read back with nulls, which means a recap or CRM sync.
 */
const OUTBOX_ADDED_COLUMNS = ['purpose', 'label', 'ref', 'url'] as const;

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null);

/**
 * Durable record of every call as a lead, in SQLite (node:sqlite). Live sessions stay in the
 * in-memory SessionStore; this keeps a cached copy of each one and writes it to disk shortly
 * after it changes, so the Lead Desk still shows past calls after a restart.
 */
export class LeadStore {
  private readonly db: DatabaseSync;
  private readonly cache = new Map<string, LeadRecord>();
  private readonly dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    dbPath: string,
    private readonly log: Logger = console as unknown as Logger,
    private readonly debounceMs = PERSIST_DEBOUNCE_MS,
  ) {
    if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    this.migrate();
    this.load();
  }

  /** Adds missing outbox columns. Idempotent: safe on new and existing databases. */
  private migrate(): void {
    const existing = new Set((this.db.prepare('PRAGMA table_info(outbox)').all() as Row[]).map((r) => str(r.name)));
    for (const column of OUTBOX_ADDED_COLUMNS) {
      if (!existing.has(column)) this.db.exec(`ALTER TABLE outbox ADD COLUMN ${column} TEXT`);
    }
  }

  /** Reads every stored lead into memory. Rows that no longer validate are skipped with a warning. */
  private load(): void {
    const rows = this.db.prepare('SELECT id, created_at, updated_at, state_json, extras_json FROM leads').all() as Row[];
    for (const row of rows) {
      const id = str(row.id) ?? '';
      try {
        const raw = JSON.parse(str(row.state_json) ?? 'null') as Partial<SessionState> & Pick<SessionState, 'buyer'>;
        // Start from a fresh state so fields added to the contract since the row was written get defaults.
        const base = createSessionState(id, raw.buyer, num(row.created_at) ?? Date.now());
        const parsed = SessionStateSchema.safeParse({ ...base, ...raw });
        if (!parsed.success) {
          this.log.warn({ sessionId: id, issues: parsed.error.issues.slice(0, 3) }, 'skipping stored lead that no longer validates');
          continue;
        }
        const extras = JSON.parse(str(row.extras_json) ?? '{}') as Partial<LeadExtras>;
        this.cache.set(id, {
          state: parsed.data,
          extras: { emiByProperty: extras.emiByProperty ?? {} },
          updatedAt: num(row.updated_at) ?? parsed.data.createdAt,
        });
      } catch (err) {
        this.log.warn({ sessionId: id, err: (err as Error).message }, 'skipping unreadable stored lead');
      }
    }
  }

  /** Persists every change of the live session store. Returns an unsubscribe function. */
  attach(store: SessionStore): () => void {
    const onCreated = (state: SessionState) => this.upsert(state);
    const onChange = (state: SessionState) => this.upsert(state);
    store.on('created', onCreated);
    store.on('change', onChange);
    return () => {
      store.off('created', onCreated);
      store.off('change', onChange);
    };
  }

  list(): LeadRecord[] {
    return [...this.cache.values()];
  }

  get(id: string): LeadRecord | undefined {
    return this.cache.get(id);
  }

  /** Records the latest state of a session. Memory is updated now; disk shortly after. */
  upsert(state: SessionState, at = Date.now()): void {
    if (this.closed) return;
    const prev = this.cache.get(state.id);
    const extras: LeadExtras = { emiByProperty: { ...(prev?.extras.emiByProperty ?? {}) } };
    const emi = state.params.money.emi;
    if (emi && state.propertyId) extras.emiByProperty[state.propertyId] = emi;
    this.cache.set(state.id, { state, extras, updatedAt: at });
    this.dirty.add(state.id);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.debounceMs);
      this.timer.unref?.();
    }
  }

  /** Writes all pending changes in one transaction. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.closed || this.dirty.size === 0) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    const stmt = this.db.prepare(`
      INSERT INTO leads (id, created_at, updated_at, status, buyer_name, buyer_email, buyer_phone, state_json, extras_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        updated_at = excluded.updated_at, status = excluded.status, buyer_name = excluded.buyer_name,
        buyer_email = excluded.buyer_email, buyer_phone = excluded.buyer_phone,
        state_json = excluded.state_json, extras_json = excluded.extras_json`);
    try {
      this.db.exec('BEGIN');
      for (const id of ids) {
        const rec = this.cache.get(id);
        if (!rec) continue;
        const s = rec.state;
        stmt.run(s.id, s.createdAt, rec.updatedAt, s.status, s.buyer.name, s.buyer.email, s.buyer.phone, JSON.stringify(s), JSON.stringify(rec.extras));
      }
      this.db.exec('COMMIT');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Nothing to roll back if BEGIN itself failed.
      }
      for (const id of ids) this.dirty.add(id);
      this.log.error({ err: (err as Error).message, sessionIds: ids }, 'could not save leads; will retry on the next change');
    }
  }

  /* ---------------------------- reports ---------------------------- */

  getReport(sessionId: string): ReportRecord {
    const row = this.db.prepare('SELECT * FROM reports WHERE session_id = ?').get(sessionId) as Row | undefined;
    const summary = row ? RecapSummarySchema.safeParse(JSON.parse(str(row.summary_json) ?? 'null')) : null;
    return {
      sessionId,
      summary: summary?.success ? summary.data : null,
      summaryAt: row ? num(row.summary_at) : null,
      factsHash: row ? str(row.facts_hash) : null,
      sentAt: row ? num(row.sent_at) : null,
      autoSentAt: row ? num(row.auto_sent_at) : null,
      crmDealId: row ? str(row.crm_deal_id) : null,
    };
  }

  saveReport(patch: Partial<ReportRecord> & { sessionId: string }): ReportRecord {
    const next: ReportRecord = { ...this.getReport(patch.sessionId), ...patch };
    this.db
      .prepare(`
        INSERT INTO reports (session_id, summary_json, summary_at, facts_hash, sent_at, auto_sent_at, crm_deal_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (session_id) DO UPDATE SET
          summary_json = excluded.summary_json, summary_at = excluded.summary_at, facts_hash = excluded.facts_hash,
          sent_at = excluded.sent_at, auto_sent_at = excluded.auto_sent_at, crm_deal_id = excluded.crm_deal_id`)
      .run(next.sessionId, next.summary ? JSON.stringify(next.summary) : null, next.summaryAt, next.factsHash, next.sentAt, next.autoSentAt, next.crmDealId);
    return next;
  }

  /* ----------------------------- outbox ---------------------------- */

  upsertOutbox(rec: OutboxRecord): void {
    const d = rec.delivery;
    this.db
      .prepare(`
        INSERT INTO outbox (id, session_id, buyer_name, channel, recipient, status, detail, at, subject, body_text, body_html, purpose, label, ref, url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          status = excluded.status, detail = excluded.detail, at = excluded.at, recipient = excluded.recipient,
          subject = COALESCE(excluded.subject, outbox.subject),
          body_text = COALESCE(excluded.body_text, outbox.body_text),
          body_html = COALESCE(excluded.body_html, outbox.body_html),
          purpose = COALESCE(excluded.purpose, outbox.purpose),
          label = COALESCE(excluded.label, outbox.label),
          ref = COALESCE(excluded.ref, outbox.ref),
          url = COALESCE(excluded.url, outbox.url)`)
      .run(d.id, rec.sessionId, rec.buyerName, d.channel, d.to, d.status, d.detail, d.at, rec.subject, rec.text, rec.html, d.purpose ?? null, d.label ?? null, d.ref ?? null, d.url ?? null);
  }

  listOutbox(limit = OUTBOX_LIST_LIMIT): OutboxItem[] {
    const rows = this.db.prepare('SELECT * FROM outbox ORDER BY at DESC LIMIT ?').all(limit) as Row[];
    return rows.map(toOutboxItem);
  }

  /** The latest sent row and the latest failure per channel, for the Integrations page. */
  outboxHealth(): Partial<Record<OutboxItem['channel'], { lastSentAt: number | null; lastError: { at: number; detail: string | null } | null }>> {
    const rows = this.db
      .prepare(`
        SELECT channel,
          MAX(CASE WHEN status = 'sent' THEN at END) AS last_sent_at,
          MAX(CASE WHEN status = 'failed' THEN at END) AS last_failed_at
        FROM outbox GROUP BY channel`)
      .all() as Row[];
    const out: ReturnType<LeadStore['outboxHealth']> = {};
    const detailAt = this.db.prepare(`SELECT detail FROM outbox WHERE channel = ? AND status = 'failed' AND at = ? LIMIT 1`);
    for (const row of rows) {
      const channel = str(row.channel) as OutboxItem['channel'] | null;
      if (!channel) continue;
      const failedAt = num(row.last_failed_at);
      const detail = failedAt !== null ? str((detailAt.get(channel, failedAt) as Row | undefined)?.detail) : null;
      out[channel] = { lastSentAt: num(row.last_sent_at), lastError: failedAt !== null ? { at: failedAt, detail } : null };
    }
    return out;
  }

  outboxForSession(sessionId: string): OutboxItem[] {
    const rows = this.db.prepare('SELECT * FROM outbox WHERE session_id = ? ORDER BY at DESC').all(sessionId) as Row[];
    return rows.map(toOutboxItem);
  }

  /** Flushes pending writes and closes the database. Safe to call twice. */
  close(): void {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    this.db.close();
  }
}

function toOutboxItem(row: Row): OutboxItem {
  return {
    id: str(row.id) ?? '',
    sessionId: str(row.session_id) ?? '',
    buyerName: str(row.buyer_name) ?? '',
    channel: (str(row.channel) ?? 'email') as OutboxItem['channel'],
    to: str(row.recipient) ?? '',
    status: (str(row.status) ?? 'failed') as OutboxItem['status'],
    detail: str(row.detail),
    at: num(row.at) ?? 0,
    subject: str(row.subject),
    text: str(row.body_text),
    html: str(row.body_html),
    // Only present when set, so rows written before these columns existed read back unchanged.
    ...(str(row.purpose) ? { purpose: str(row.purpose) as OutboxItem['purpose'] } : {}),
    ...(str(row.label) ? { label: str(row.label) } : {}),
    ...(str(row.ref) ? { ref: str(row.ref) } : {}),
    ...(str(row.url) ? { url: str(row.url) } : {}),
  };
}
