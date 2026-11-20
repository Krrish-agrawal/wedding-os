import { reduceSession, type ActionSource, type SessionAction, type SessionState } from '@ave/shared';
import type { AppContext } from '../context.js';
import { createCrmAdapter } from './adapters/crm.js';
import { createEmailAdapter } from './adapters/email.js';
import { createJiraAdapter } from './adapters/jira.js';
import { createSlackAdapter } from './adapters/slack.js';
import type { CrmAdapter, EmailAdapter, FetchLike, JiraAdapter, SlackAdapter, WhatsAppAdapter } from './adapters/types.js';
import { createWhatsAppAdapter } from './adapters/whatsapp.js';
import { LeadStore } from './leadStore.js';
import { createOpenAiSummarizer, type Summarizer } from './summary.js';

export interface DeskLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface DeskDeps {
  leads: LeadStore;
  email: EmailAdapter;
  whatsapp: WhatsAppAdapter;
  crm: CrmAdapter | null;
  slack: SlackAdapter;
  jira: JiraAdapter;
  /** Writes the AI part of the recap; null when OpenAI is not configured. */
  summarize: Summarizer | null;
  log: DeskLogger;
  now: () => number;
}

/**
 * Everything the Desk needs at runtime, bound to one AppContext. Report jobs for a session run
 * one after another so a tool call and the end-of-call send never race each other.
 */
export class DeskRuntime {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    readonly ctx: AppContext,
    readonly deps: DeskDeps,
  ) {}

  get leads(): LeadStore {
    return this.deps.leads;
  }

  get log(): DeskLogger {
    return this.deps.log;
  }

  /** Runs `task` after any earlier job for the same session. Never rejects the chain. */
  enqueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(sessionId) ?? Promise.resolve();
    const run = prev.then(task, task);
    const tail = run.catch(() => undefined);
    this.queues.set(sessionId, tail);
    void tail.then(() => {
      if (this.queues.get(sessionId) === tail) this.queues.delete(sessionId);
    });
    return run;
  }

  /** Resolves when every queued job for the session has finished. */
  async idle(sessionId: string): Promise<void> {
    while (this.queues.has(sessionId)) await this.queues.get(sessionId);
  }

  /** Waits for every queued job, up to `timeoutMs`. */
  async drain(timeoutMs: number): Promise<void> {
    const all = Promise.all([...this.queues.keys()].map((id) => this.idle(id)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([all, timeout]);
    clearTimeout(timer);
  }

  /** The freshest state we have: the live session if it is running, else the stored lead. */
  getState(sessionId: string): SessionState | undefined {
    return this.ctx.store.get(sessionId) ?? this.leads.get(sessionId)?.state;
  }

  isLive(sessionId: string): boolean {
    const live = this.ctx.store.get(sessionId);
    return Boolean(live && live.status !== 'ended');
  }

  /**
   * Applies an action through the shared reducer. Live sessions go through the session store
   * (and so reach every screen); past leads are updated in the lead store directly.
   */
  apply(sessionId: string, action: SessionAction, source: ActionSource): SessionState | undefined {
    if (this.ctx.store.get(sessionId)) return this.ctx.store.dispatch(sessionId, action, source);
    const rec = this.leads.get(sessionId);
    if (!rec) return undefined;
    const at = this.deps.now();
    const next = reduceSession(rec.state, { action, source, at });
    if (next !== rec.state) this.leads.upsert(next, at);
    return next;
  }
}

const runtimes = new WeakMap<AppContext, DeskRuntime>();

export function defaultDeskDeps(ctx: AppContext, leads: LeadStore, log: DeskLogger, fetchImpl: FetchLike = fetch): DeskDeps {
  return {
    leads,
    email: createEmailAdapter(ctx.config, fetchImpl),
    whatsapp: createWhatsAppAdapter(ctx.config, fetchImpl),
    crm: createCrmAdapter(ctx.config.HUBSPOT_TOKEN, fetchImpl),
    slack: createSlackAdapter(ctx.config, fetchImpl),
    jira: createJiraAdapter(ctx.config, fetchImpl),
    summarize: createOpenAiSummarizer(ctx.config, log),
    log,
    now: Date.now,
  };
}

export function registerDesk(ctx: AppContext, runtime: DeskRuntime): void {
  runtimes.set(ctx, runtime);
}

export function unregisterDesk(ctx: AppContext): void {
  runtimes.delete(ctx);
}

/**
 * The Desk runtime for this app. The Desk plugin registers one at startup; callers outside a
 * running server (scripts, tests of other workstreams) get an in-memory one, so nothing breaks
 * and nothing is written to disk.
 */
export function deskFor(ctx: AppContext): DeskRuntime {
  let rt = runtimes.get(ctx);
  if (!rt) {
    const log: DeskLogger = {
      info: () => {},
      warn: (obj, msg) => console.warn(msg, obj),
      error: (obj, msg) => console.error(msg, obj),
    };
    rt = new DeskRuntime(ctx, defaultDeskDeps(ctx, new LeadStore(':memory:', log), log));
    rt.leads.attach(ctx.store);
    runtimes.set(ctx, rt);
  }
  return rt;
}
