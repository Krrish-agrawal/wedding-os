import type { ActionSource, SessionAction, SessionState } from '@ave/shared';
import { loadConfig, features } from '../config.js';
import { loadContent } from '../content.js';
import type { AppContext } from '../context.js';
import { SessionStore } from '../sessions/store.js';
import type { CrmAdapter, CrmLead, CrmOutcome, EmailAdapter, EmailMessage, JiraAdapter, JiraIssue, SendOutcome, SlackAdapter, SlackMessage, WhatsAppAdapter, WhatsAppMessage } from './adapters/types.js';
import { LeadStore } from './leadStore.js';
import { DeskRuntime, type DeskDeps, type DeskLogger } from './runtime.js';

/** Helpers for Desk tests: a controllable clock, real content, and recording fake providers. */

export const T0 = Date.UTC(2026, 10, 20, 5, 0, 0);

export class Clock {
  constructor(public t = T0) {}
  now = () => this.t;
  advance(seconds: number) {
    this.t += seconds * 1000;
  }
}

export const silentLog: DeskLogger = { info: () => {}, warn: () => {}, error: () => {} };

export async function testContext(env: Record<string, string> = {}, clock = new Clock()): Promise<AppContext> {
  const config = loadConfig(env);
  return { config, features: features(config), content: await loadContent(), store: new SessionStore(clock.now) };
}

export class FakeEmail implements EmailAdapter {
  readonly provider = 'fake email';
  sent: EmailMessage[] = [];
  constructor(public outcome: SendOutcome = { status: 'sent', providerId: 'em_1', detail: 'Accepted by fake email' }) {}
  async send(m: EmailMessage) {
    this.sent.push(m);
    return this.outcome;
  }
}

export class FakeWhatsApp implements WhatsAppAdapter {
  readonly provider = 'fake whatsapp';
  sent: WhatsAppMessage[] = [];
  constructor(public outcome: SendOutcome = { status: 'sent', providerId: 'wa_1', detail: 'Accepted by fake whatsapp' }) {}
  async send(m: WhatsAppMessage) {
    this.sent.push(m);
    return this.outcome;
  }
}

export class FakeCrm implements CrmAdapter {
  readonly provider = 'fake crm';
  synced: CrmLead[] = [];
  async syncLead(lead: CrmLead): Promise<CrmOutcome> {
    this.synced.push(lead);
    return { status: 'sent', contactId: 'c1', dealId: lead.dealId ?? 'd1', noteId: `n${this.synced.length}`, detail: 'Saved in fake CRM' };
  }
}

export class FakeSlack implements SlackAdapter {
  readonly provider = 'fake slack';
  readonly destination = '#sales-pipeline';
  sent: SlackMessage[] = [];
  constructor(public outcome: SendOutcome = { status: 'sent', providerId: '1700000000.000100', detail: 'Posted to fake slack' }) {}
  async send(m: SlackMessage) {
    this.sent.push(m);
    return this.outcome;
  }
}

export class FakeJira implements JiraAdapter {
  readonly provider = 'fake jira';
  readonly destination = 'Jira AVE';
  created: JiraIssue[] = [];
  async createIssue(issue: JiraIssue): Promise<SendOutcome> {
    this.created.push(issue);
    const key = `AVE-${this.created.length}`;
    return { status: 'sent', providerId: key, detail: `Created ${key}`, url: `https://example.atlassian.net/browse/${key}` };
  }
}

export function testRuntime(ctx: AppContext, clock: Clock, deps: Partial<DeskDeps> = {}): DeskRuntime {
  const leads = deps.leads ?? new LeadStore(':memory:', silentLog, 0);
  leads.attach(ctx.store);
  return new DeskRuntime(ctx, {
    leads,
    email: new FakeEmail(),
    whatsapp: new FakeWhatsApp(),
    crm: null,
    slack: new FakeSlack(),
    jira: new FakeJira(),
    summarize: null,
    log: silentLog,
    now: clock.now,
    ...deps,
  });
}

/** Creates a session and plays actions, advancing the clock before each one. */
export function playSession(ctx: AppContext, clock: Clock, steps: [afterSeconds: number, action: SessionAction, source?: ActionSource][]): SessionState {
  const state = ctx.store.create({ name: 'Priya Sharma', phone: '98765 43210', email: 'priya@example.com' });
  for (const [after, action, source] of steps) {
    clock.advance(after);
    ctx.store.dispatch(state.id, action, source ?? 'agent');
  }
  return ctx.store.get(state.id)!;
}

export function firstProperty(ctx: AppContext, kind: 'sale' | 'lease') {
  const bundle = ctx.content.properties.find((b) => b.property.kind === kind);
  if (!bundle) throw new Error(`No ${kind} property in /data`);
  return bundle;
}
