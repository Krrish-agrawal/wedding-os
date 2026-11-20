import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HANDOFF_TIMEOUT_NOTE_KIND, SCREEN_EVENT_MARKER, type ActionSource, type SessionAction } from '@ave/shared';
import type { AppContext } from '../context.js';
import { agentTools } from './collaborators.js';
import { MIN_REACTION_GAP_MS, POST_START_NUDGE_DELAY_MS, SCREEN_SYNC_DEBOUNCE_MS, VoiceController } from './controller.js';
import { HAND_BACK_EVENT } from './lines.js';
import { resolveVoiceSettings } from './settings.js';
import { BUYER, FULL_ENV, FakeGateway, fakePrompts, testContext, type FakeAgent } from './testkit.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

let ctx: AppContext;
let gateway: FakeGateway;
let controller: VoiceController;
let sessionId: string;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  ctx = testContext(FULL_ENV);
  gateway = new FakeGateway();
  controller = new VoiceController({
    ctx,
    settings: resolveVoiceSettings(ctx.config),
    gateway,
    collaborators: { prompts: fakePrompts, handoffContext: (state) => `HANDOFF CONTEXT for ${state.buyer.name}`, tools: agentTools },
    log: silent,
  });
  controller.attach();
  sessionId = ctx.store.create(BUYER).id;
});

afterEach(async () => {
  await controller.shutdown();
  vi.useRealTimers();
});

const act = (action: SessionAction, source: ActionSource) => ctx.store.dispatch(sessionId, action, source);
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

async function live(): Promise<FakeAgent> {
  await controller.start(sessionId, { restart: false });
  return gateway.agents.at(-1)!;
}

describe('screen awareness', () => {
  it('replaces the screen line once per burst of changes, after the debounce', async () => {
    const agent = await live();
    act({ type: 'set_property', propertyId: 'apt-test' }, 'presenter');
    act({ type: 'set_view', view: 'money' }, 'presenter');
    act({ type: 'set_view', view: 'money', params: { tab: 'emi' } }, 'presenter');
    await settle(SCREEN_SYNC_DEBOUNCE_MS - 1);
    expect(agent.calls).toEqual([]);
    await settle(1);
    expect(agent.calls).toEqual([
      { method: 'update', contents: ['BRIEF advisor=Asha buyer=Priya Sharma', 'SCREEN view=money property=apt-test'] },
    ]);
  });

  it('ignores changes the advisor does not need (transcript, activity)', async () => {
    const agent = await live();
    act({ type: 'add_transcript', line: { id: 'l1', role: 'buyer', text: 'hi', final: true, at: 1 } }, 'buyer');
    act({ type: 'set_activity', label: 'Calculating' }, 'agent');
    await settle(SCREEN_SYNC_DEBOUNCE_MS * 2);
    expect(agent.calls).toEqual([]);
  });

  it('never overlaps updates and coalesces changes made during a flight', async () => {
    const agent = await live();
    agent.holdUpdates = true;
    act({ type: 'set_view', view: 'tour' }, 'agent');
    await settle(SCREEN_SYNC_DEBOUNCE_MS);
    act({ type: 'set_view', view: 'blueprint' }, 'agent');
    act({ type: 'set_view', view: 'legal' }, 'agent');
    await settle(SCREEN_SYNC_DEBOUNCE_MS * 3);
    expect(agent.calls.filter((c) => c.method === 'update')).toHaveLength(1);
    agent.holdUpdates = false;
    agent.releaseUpdates();
    await settle(SCREEN_SYNC_DEBOUNCE_MS);
    const updates = agent.calls.filter((c) => c.method === 'update');
    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({ contents: [expect.any(String), 'SCREEN view=legal property=none'] });
  });

  it('answers a buyer click with one think after the update, and never for the agent\'s own tool calls', async () => {
    const agent = await live();
    act({ type: 'set_view', view: 'locality' }, 'agent');
    await settle(SCREEN_SYNC_DEBOUNCE_MS);
    expect(agent.methods()).toEqual(['update']);

    act({ type: 'set_view', view: 'money' }, 'buyer');
    await settle(SCREEN_SYNC_DEBOUNCE_MS);
    expect(agent.methods()).toEqual(['update', 'update', 'think']);
    const think = agent.calls[2]!;
    expect(think).toMatchObject({
      method: 'think',
      policy: { onListening: 'interrupt', onThinking: 'append', onSpeaking: 'ignore', interruptable: true },
    });
    expect(think.method === 'think' && think.text).toBe(`${SCREEN_EVENT_MARKER} The buyer clicked to open the Pricing view.`);
  });

  it('rate limits spoken reactions to clicks', async () => {
    const agent = await live();
    act({ type: 'set_view', view: 'money' }, 'buyer');
    await settle(SCREEN_SYNC_DEBOUNCE_MS);
    act({ type: 'set_view', view: 'legal' }, 'buyer');
    await settle(SCREEN_SYNC_DEBOUNCE_MS);
    expect(agent.calls.filter((c) => c.method === 'think')).toHaveLength(1);
    await settle(MIN_REACTION_GAP_MS);
    act({ type: 'set_view', view: 'tour' }, 'buyer');
    await settle(SCREEN_SYNC_DEBOUNCE_MS);
    expect(agent.calls.filter((c) => c.method === 'think')).toHaveLength(2);
  });

  it('tells the advisor when the buyer presses Talk to a human', async () => {
    const agent = await live();
    act({ type: 'set_handoff', patch: { status: 'requested', reason: 'Buyer asked', requestedAt: 1 } }, 'buyer');
    await settle(SCREEN_SYNC_DEBOUNCE_MS);
    const think = agent.calls.find((c) => c.method === 'think');
    expect(think?.method === 'think' && think.text).toMatch(/Talk to a human/);
  });
});

describe('handoff timeout', () => {
  it('tells the buyer, in the call language, that the team will call back', async () => {
    const agent = await live();
    act({ type: 'set_language', language: 'hi' }, 'buyer');
    await settle(SCREEN_SYNC_DEBOUNCE_MS);
    const current = gateway.agents.at(-1)!;
    current.calls = [];
    act({ type: 'note', kind: HANDOFF_TIMEOUT_NOTE_KIND, label: 'No advisor joined within 90 s' }, 'system');
    await settle();
    const think = current.calls.find((c) => c.method === 'think');
    expect(think?.method === 'think' && think.text.startsWith(SCREEN_EVENT_MARKER)).toBe(true);
    expect(think?.method === 'think' && think.text).toMatch(/call them back/);
    expect(think?.method === 'think' && think.text).toMatch(/Hindi/);
    expect(agent).toBeDefined();
  });
});

describe('human handoff', () => {
  it('speaks one handover line, reads history, leaves, and stands by', async () => {
    const agent = await live();
    act({ type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } }, 'advisor');
    await settle();
    expect(agent.methods()).toEqual(['say', 'history', 'stop']);
    const say = agent.calls[0]!;
    expect(say).toMatchObject({ method: 'say', interruptable: false });
    expect(say.method === 'say' && say.text).toMatch(/Rahul/);
    expect(ctx.store.get(sessionId)?.agent).toMatchObject({ status: 'standby', agentId: null });

    // While the human is on the call a start request does not bring the AI back.
    expect(await controller.start(sessionId, { restart: false })).toMatchObject({ available: true, standby: true, agentId: null });
    expect(gateway.specs).toHaveLength(1);
  });

  it('restarts with a new name, no greeting and the handoff context when handed back', async () => {
    await live();
    act({ type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } }, 'advisor');
    await settle();
    act({ type: 'set_handoff', patch: { status: 'returned' } }, 'advisor');
    await settle();

    expect(gateway.specs).toHaveLength(2);
    const spec = gateway.specs[1]!;
    expect(spec.name).toBe(`ave-${sessionId}-2`);
    expect(spec.greeting).toBeNull();
    expect(spec.systemMessages).toEqual(['BRIEF advisor=Asha buyer=Priya Sharma', 'HANDOFF CONTEXT for Priya Sharma', 'SCREEN view=shortlist property=none']);
    expect(ctx.store.get(sessionId)?.agent).toMatchObject({ status: 'live', agentId: 'agent-2' });

    const agent = gateway.agents[1]!;
    await settle(POST_START_NUDGE_DELAY_MS);
    expect(agent.calls).toContainEqual(expect.objectContaining({ method: 'think', text: HAND_BACK_EVENT }));

    // The handoff context survives later screen updates.
    act({ type: 'set_view', view: 'money' }, 'agent');
    await settle(SCREEN_SYNC_DEBOUNCE_MS);
    expect(agent.calls.find((c) => c.method === 'update')).toMatchObject({ contents: [expect.any(String), 'HANDOFF CONTEXT for Priya Sharma', 'SCREEN view=money property=none'] });
  });
});

describe('end of call', () => {
  it('stops the agent and fills transcript gaps from its history', async () => {
    const agent = await live();
    act({ type: 'add_transcript', line: { id: 'a1', role: 'agent', text: 'Hello Priya, welcome to Agora Virtual Estates.', final: true, at: Date.now() } }, 'buyer');
    agent.historyItems = [
      { role: 'assistant', content: 'Hello Priya, welcome to Agora Virtual Estates.' },
      { role: 'user', content: `${SCREEN_EVENT_MARKER} The buyer clicked to open the Pricing view.` },
      { role: 'user', content: 'What does it cost?' },
      { role: 'assistant', content: 'The total comes to ₹1,28,00,000.' },
    ];
    act({ type: 'set_status', status: 'ended' }, 'buyer');
    await settle();
    expect(agent.methods()).toEqual(['history', 'stop']);
    const lines = ctx.store.get(sessionId)!.transcript;
    expect(lines.map((l) => [l.role, l.text])).toEqual([
      ['agent', 'Hello Priya, welcome to Agora Virtual Estates.'],
      ['buyer', 'What does it cost?'],
      ['agent', 'The total comes to ₹1,28,00,000.'],
    ]);
    expect(ctx.store.get(sessionId)?.agent.status).toBe('off');
  });
});
