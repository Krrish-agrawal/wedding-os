import Fastify, { type FastifyInstance } from 'fastify';
import type { Content, PropertyBundle } from '@ave/shared';
import { loadConfig, features } from '../config.js';
import type { AppContext } from '../context.js';
import { SessionStore } from '../sessions/store.js';
import type { PromptBuilders } from './collaborators.js';
import type { AgentGateway, HistoryItem, LiveAgent, ThinkPolicy } from './gateway.js';
import type { AgentSpec } from './joinConfig.js';
import { voicePlugin } from './plugin.js';

/** Test helpers for the voice workstream: a small content fixture, fake prompts and a fake Agora gateway. */

export const FAKE_APP_ID = '0123456789abcdef0123456789abcdef';
export const FAKE_APP_CERTIFICATE = 'fedcba9876543210fedcba9876543210';

export const FULL_ENV = {
  AGORA_APP_ID: FAKE_APP_ID,
  AGORA_APP_CERTIFICATE: FAKE_APP_CERTIFICATE,
  OPENAI_API_KEY: 'sk-test-openai',
  MURF_API_KEY: 'murf-test-key',
  PUBLIC_BASE_URL: 'https://voice-test.example.com',
} as const;

/** Only the fields the voice layer reads; everything else is irrelevant here. */
export function fixtureContent(): Content {
  const bundle = {
    property: {
      id: 'apt-test',
      kind: 'sale',
      name: 'Lakeview Residency',
      builder: 'Sample Builders',
      localityName: 'Indiranagar',
      city: 'Bengaluru',
      configuration: '2 BHK apartment',
    },
    rooms: [{ id: 'kitchen', name: 'Kitchen' }],
    tour: { stops: [{ id: 'kitchen', roomId: 'kitchen', label: 'Kitchen' }] },
    legal: { documents: [{ id: 'oc', title: 'Occupancy certificate' }] },
    visits: [],
    locality: { name: 'Indiranagar', places: [{ id: 'metro', name: 'Indiranagar Metro' }] },
    commute: { routes: [{ id: 'airport', label: 'Airport', destination: { name: 'Kempegowda International Airport' } }] },
  } as unknown as PropertyBundle;
  return {
    properties: [bundle],
    byId: { [bundle.property.id]: bundle },
    offers: { properties: {} },
    scoring: { rules: [], tiers: [{ min: 0, label: 'Cold' }] },
  } as unknown as Content;
}

export const fakePrompts: PromptBuilders = {
  systemPrompt: (ctx, state) => `BRIEF advisor=${ctx.config.ADVISOR_NAME} buyer=${state.buyer.name}`,
  greeting: (_ctx, state) => `Hello ${state.buyer.name.split(' ')[0]}`,
  screenLine: (_ctx, state) => `SCREEN view=${state.view} property=${state.propertyId ?? 'none'}`,
  failureMessage: () => 'Sorry, say that again?',
};

export function testContext(env: Record<string, string> = {}): AppContext {
  const config = loadConfig({ ...env });
  return { config, features: features(config), content: fixtureContent(), store: new SessionStore() };
}

export const BUYER = { name: 'Priya Sharma', phone: '9876543210', email: 'priya@example.com' };

type Call = { method: 'update'; contents: string[] } | { method: 'think'; text: string; policy: ThinkPolicy } | { method: 'say'; text: string; interruptable: boolean } | { method: 'history' } | { method: 'stop' };

export class FakeAgent implements LiveAgent {
  calls: Call[] = [];
  historyItems: HistoryItem[] = [];
  /** Resolves pending update calls by hand to test coalescing. */
  holdUpdates = false;
  private held: (() => void)[] = [];

  constructor(readonly agentId: string) {}

  async updateSystemMessages(contents: string[]): Promise<void> {
    this.calls.push({ method: 'update', contents });
    if (this.holdUpdates) await new Promise<void>((resolve) => this.held.push(resolve));
  }
  releaseUpdates(): void {
    for (const r of this.held.splice(0)) r();
  }
  async think(text: string, policy: ThinkPolicy): Promise<void> {
    this.calls.push({ method: 'think', text, policy });
  }
  async say(text: string, opts: { interruptable: boolean }): Promise<void> {
    this.calls.push({ method: 'say', text, interruptable: opts.interruptable });
  }
  async history(): Promise<HistoryItem[]> {
    this.calls.push({ method: 'history' });
    return this.historyItems;
  }
  async stop(): Promise<void> {
    this.calls.push({ method: 'stop' });
  }
  methods(): string[] {
    return this.calls.map((c) => c.method);
  }
}

export class FakeGateway implements AgentGateway {
  specs: AgentSpec[] = [];
  agents: FakeAgent[] = [];
  /** Errors thrown by the next starts, in order. */
  failures: unknown[] = [];

  async start(spec: AgentSpec): Promise<LiveAgent> {
    this.specs.push(structuredClone(spec));
    const failure = this.failures.shift();
    if (failure) throw failure;
    const agent = new FakeAgent(`agent-${this.agents.length + 1}`);
    this.agents.push(agent);
    return agent;
  }
}

/** A Fastify app with only the voice plugin, bound to a fresh store. */
export async function voiceApp(opts: { env?: Record<string, string>; gateway?: AgentGateway | null; prompts?: PromptBuilders | null; now?: () => number } = {}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const ctx = testContext(opts.env);
  const app = Fastify({ logger: false });
  app.decorate('ctx', ctx);
  await app.register(voicePlugin, {
    gateway: opts.gateway === undefined ? new FakeGateway() : opts.gateway,
    collaborators: { prompts: opts.prompts === undefined ? fakePrompts : opts.prompts },
    ...(opts.now ? { now: opts.now } : {}),
  });
  await app.ready();
  return { app, ctx };
}
