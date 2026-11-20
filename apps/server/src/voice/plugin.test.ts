import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AgoraError } from 'agora-agents';
import type { AppContext } from '../context.js';
import { AgentExitedError } from './gateway.js';
import { BUYER, FULL_ENV, FakeGateway, voiceApp } from './testkit.js';

const NOW = Date.UTC(2026, 10, 20, 6, 0, 0);
const TTL_MS = 7200 * 1000;

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function setup(opts: Parameters<typeof voiceApp>[0] = {}): Promise<{ app: FastifyInstance; ctx: AppContext; sessionId: string }> {
  const built = await voiceApp({ now: () => NOW, ...opts });
  app = built.app;
  const sessionId = built.ctx.store.create(BUYER).id;
  return { ...built, sessionId };
}

const post = (a: FastifyInstance, url: string, payload: unknown = {}) => a.inject({ method: 'POST', url, payload: payload as object });

describe('voice without credentials', () => {
  it('reports voice unavailable from /voice/start, naming what is missing', async () => {
    const { app, sessionId, ctx } = await setup({ env: {} });
    const res = await post(app, `/api/sessions/${sessionId}/voice/start`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available).toBe(false);
    expect(body.reason).toMatch(/AGORA_APP_ID/);
    expect(body.reason).toMatch(/OPENAI_API_KEY/);
    expect(body.reason).toMatch(/MURF_API_KEY/);
    expect(ctx.store.get(sessionId)?.agent.status).toBe('off');
  });

  it('reports voice unavailable when only Agora is configured', async () => {
    const { app, sessionId } = await setup({ env: { AGORA_APP_ID: FULL_ENV.AGORA_APP_ID, AGORA_APP_CERTIFICATE: FULL_ENV.AGORA_APP_CERTIFICATE } });
    const body = (await post(app, `/api/sessions/${sessionId}/voice/start`)).json();
    expect(body).toEqual({ available: false, reason: expect.stringMatching(/OPENAI_API_KEY, MURF_API_KEY/) });
  });

  it('returns no token without Agora credentials', async () => {
    const { app, sessionId } = await setup({ env: {} });
    const res = await post(app, `/api/sessions/${sessionId}/voice/token`, { role: 'buyer' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false, reason: expect.stringMatching(/AGORA_APP_ID/) });
  });

  it('still records typed buyer input for the Desk', async () => {
    const { app, sessionId, ctx } = await setup({ env: {} });
    const res = await post(app, `/api/sessions/${sessionId}/voice/text`, { text: 'Is there parking?' });
    expect(res.json()).toEqual({ delivered: false, reason: expect.any(String) });
    expect(ctx.store.get(sessionId)?.transcript).toEqual([expect.objectContaining({ role: 'buyer', text: 'Is there parking?', final: true })]);
  });
});

describe('POST /voice/token', () => {
  it('issues one RTC + RTM token for the buyer, expiring in the configured seconds', async () => {
    const { app, sessionId } = await setup({ env: FULL_ENV });
    const res = await post(app, `/api/sessions/${sessionId}/voice/token`, { role: 'buyer' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      available: true,
      appId: FULL_ENV.AGORA_APP_ID,
      channel: `ave-${sessionId}`,
      uid: 2001,
      agentUid: 1000,
      buyerUid: 2001,
      advisorUid: 3001,
      advisorName: 'Asha',
      expiresAt: NOW + TTL_MS,
    });
    // AccessToken2 tokens start with the version "007".
    expect(body.token).toMatch(/^007/);
  });

  it('defaults to the buyer and gives the human advisor a different uid', async () => {
    const { app, sessionId } = await setup({ env: FULL_ENV });
    const buyer = (await post(app, `/api/sessions/${sessionId}/voice/token`)).json();
    const advisor = (await post(app, `/api/sessions/${sessionId}/voice/token`, { role: 'advisor' })).json();
    expect(buyer.uid).toBe(2001);
    expect(advisor.uid).toBe(3001);
    expect(advisor.channel).toBe(buyer.channel);
    expect(advisor.token).not.toBe(buyer.token);
  });

  it('rejects unknown sessions and roles', async () => {
    const { app, sessionId } = await setup({ env: FULL_ENV });
    expect((await post(app, '/api/sessions/nope/voice/token')).statusCode).toBe(404);
    expect((await post(app, `/api/sessions/${sessionId}/voice/token`, { role: 'agent' })).statusCode).toBe(400);
  });
});

describe('POST /voice/start', () => {
  it('starts one agent per call with a unique name, the greeting and the session tools', async () => {
    const gateway = new FakeGateway();
    const { app, sessionId, ctx } = await setup({ env: FULL_ENV, gateway });
    const res = await post(app, `/api/sessions/${sessionId}/voice/start`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: true, agentId: 'agent-1', standby: false, warnings: [] });

    const spec = gateway.specs[0]!;
    expect(spec.name).toBe(`ave-${sessionId}-1`);
    expect(spec.channel).toBe(`ave-${sessionId}`);
    expect(spec.greeting).toBe('Hello Priya');
    expect(spec.systemMessages).toEqual(['BRIEF advisor=Asha buyer=Priya Sharma', 'SCREEN view=shortlist property=none']);
    expect(spec.tools.kind).toBe('mcp');
    expect(ctx.store.get(sessionId)?.agent).toMatchObject({ status: 'live', agentId: 'agent-1', error: null });

    const again = (await post(app, `/api/sessions/${sessionId}/voice/start`)).json();
    expect(again.agentId).toBe('agent-1');
    expect(gateway.specs).toHaveLength(1);
  });

  it('replaces a dead agent on restart without replaying the greeting', async () => {
    const gateway = new FakeGateway();
    const { app, sessionId } = await setup({ env: FULL_ENV, gateway });
    await post(app, `/api/sessions/${sessionId}/voice/start`);
    const res = (await post(app, `/api/sessions/${sessionId}/voice/start`, { restart: true })).json();
    expect(res.agentId).toBe('agent-2');
    expect(gateway.agents[0]!.methods()).toContain('stop');
    expect(gateway.specs[1]!.name).toBe(`ave-${sessionId}-2`);
    expect(gateway.specs[1]!.greeting).toBeNull();
  });

  it('retries a name conflict with the next name', async () => {
    const gateway = new FakeGateway();
    gateway.failures.push(new AgoraError({ message: 'conflict', statusCode: 409 }));
    const { app, sessionId } = await setup({ env: FULL_ENV, gateway });
    const res = (await post(app, `/api/sessions/${sessionId}/voice/start`)).json();
    expect(res.agentId).toBe('agent-1');
    expect(gateway.specs.map((s) => s.name)).toEqual([`ave-${sessionId}-1`, `ave-${sessionId}-2`]);
  });

  it('retries an agent that exits right after Agora accepts it', async () => {
    const gateway = new FakeGateway();
    gateway.failures.push(new AgentExitedError('agent-x', 'FAILED', 'agent exits with reason: RTC connection error'));
    const { app, sessionId, ctx } = await setup({ env: FULL_ENV, gateway });
    const res = (await post(app, `/api/sessions/${sessionId}/voice/start`)).json();
    expect(res.agentId).toBe('agent-1');
    expect(gateway.specs.map((s) => s.name)).toEqual([`ave-${sessionId}-1`, `ave-${sessionId}-2`]);
    expect(gateway.specs[1]!.greeting).toBe('Hello Priya');
    expect(ctx.store.get(sessionId)?.agent.status).toBe('live');
  });

  it('reports a start failure as 502 and marks the agent as errored', async () => {
    const gateway = new FakeGateway();
    gateway.failures.push(new AgoraError({ message: 'startup failed', statusCode: 503, body: { reason: 'TTS', detail: 'bad key' } }));
    const { app, sessionId, ctx } = await setup({ env: FULL_ENV, gateway });
    const res = await post(app, `/api/sessions/${sessionId}/voice/start`);
    expect(res.statusCode).toBe(502);
    expect(ctx.store.get(sessionId)?.agent).toMatchObject({ status: 'error', agentId: null, error: expect.any(String) });
  });

  it('is unavailable while the prompt module is missing', async () => {
    const { app, sessionId } = await setup({ env: FULL_ENV, prompts: null });
    const res = (await post(app, `/api/sessions/${sessionId}/voice/start`)).json();
    expect(res).toEqual({ available: false, reason: expect.any(String) });
  });

  it('warns and turns tools off without a public URL', async () => {
    const gateway = new FakeGateway();
    const { app, sessionId } = await setup({ env: { ...FULL_ENV, PUBLIC_BASE_URL: '' }, gateway });
    const res = (await post(app, `/api/sessions/${sessionId}/voice/start`)).json();
    expect(res.warnings).toEqual([expect.stringMatching(/PUBLIC_BASE_URL/)]);
    expect(gateway.specs[0]!.tools).toEqual({ kind: 'none' });
  });
});

describe('POST /voice/text, /voice/state and /voice/stop', () => {
  it('records typed input and hands it to the agent as a turn that takes the floor', async () => {
    const gateway = new FakeGateway();
    const { app, sessionId, ctx } = await setup({ env: FULL_ENV, gateway });
    await post(app, `/api/sessions/${sessionId}/voice/start`);
    const res = (await post(app, `/api/sessions/${sessionId}/voice/text`, { text: 'What is the EMI?' })).json();
    expect(res).toEqual({ delivered: true });
    expect(gateway.agents[0]!.calls).toContainEqual({
      method: 'think',
      text: 'What is the EMI?',
      policy: { onListening: 'interrupt', onThinking: 'interrupt', onSpeaking: 'interrupt', interruptable: true },
    });
    expect(ctx.store.get(sessionId)?.transcript.at(-1)).toMatchObject({ role: 'buyer', text: 'What is the EMI?', final: true });
  });

  it('rejects empty typed input', async () => {
    const { app, sessionId } = await setup({ env: FULL_ENV });
    expect((await post(app, `/api/sessions/${sessionId}/voice/text`, { text: '   ' })).statusCode).toBe(400);
  });

  it('keeps the engine state on the session while the agent is live', async () => {
    const { app, sessionId, ctx } = await setup({ env: FULL_ENV });
    await post(app, `/api/sessions/${sessionId}/voice/start`);
    const res = await post(app, `/api/sessions/${sessionId}/voice/state`, { state: 'speaking' });
    expect(res.statusCode).toBe(204);
    expect(ctx.store.get(sessionId)?.agent.state).toBe('speaking');
  });

  it('stops the agent after reading its history', async () => {
    const gateway = new FakeGateway();
    const { app, sessionId, ctx } = await setup({ env: FULL_ENV, gateway });
    await post(app, `/api/sessions/${sessionId}/voice/start`);
    gateway.agents[0]!.historyItems = [{ role: 'assistant', content: 'Hello Priya, welcome.' }];
    await post(app, `/api/sessions/${sessionId}/voice/stop`);
    expect(gateway.agents[0]!.methods()).toEqual(['history', 'stop']);
    const state = ctx.store.get(sessionId)!;
    expect(state.agent).toMatchObject({ status: 'off', agentId: null });
    expect(state.transcript).toEqual([expect.objectContaining({ role: 'agent', text: 'Hello Priya, welcome.', id: 'hist-agent-1-0' })]);
  });

  it('stops running agents when the server closes', async () => {
    const gateway = new FakeGateway();
    const { app: a, sessionId } = await setup({ env: FULL_ENV, gateway });
    await post(a, `/api/sessions/${sessionId}/voice/start`);
    await a.close();
    app = null;
    expect(gateway.agents[0]!.methods()).toContain('stop');
  });
});
