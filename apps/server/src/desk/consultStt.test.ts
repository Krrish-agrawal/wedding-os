import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionAction } from '@ave/shared';
import { loadConfig } from '../config.js';
import { SessionStore } from '../sessions/store.js';
import { resolveRtcSettings } from '../voice/settings.js';
import { BUYER, FAKE_APP_CERTIFICATE, FAKE_APP_ID } from '../voice/testkit.js';
import {
  CONSULT_STT_MESSAGES,
  ConsultTranscription,
  STT_MAX_IDLE_SEC,
  SttRequestError,
  buildSttStartRequest,
  createAgoraSttClient,
  type SttClient,
  type SttStartRequest,
} from './consultStt.js';
import { silentLog } from './testkit.js';

const rtcResolved = resolveRtcSettings(loadConfig({ AGORA_APP_ID: FAKE_APP_ID, AGORA_APP_CERTIFICATE: FAKE_APP_CERTIFICATE }));
const rtc = rtcResolved.ok ? rtcResolved.value : null;

class FakeStt implements SttClient {
  starts: SttStartRequest[] = [];
  stops: string[] = [];
  failStart: Error | null = null;
  /** Resolves pending starts by hand, to test a hand-back during start. */
  hold = false;
  private held: (() => void)[] = [];

  async start(body: SttStartRequest) {
    this.starts.push(body);
    if (this.hold) await new Promise<void>((resolve) => this.held.push(resolve));
    if (this.failStart) throw this.failStart;
    return { agentId: `stt-${this.starts.length}` };
  }
  release() {
    for (const r of this.held.splice(0)) r();
  }
  async stop(agentId: string) {
    this.stops.push(agentId);
  }
}

let store: SessionStore;
let stt: FakeStt;
let sessionId: string;

function setup(env: { CONSULT_STT?: 'agora' | 'openai' | 'off'; OPENAI_API_KEY?: string } = {}, client: SttClient | null = stt) {
  const config = { CONSULT_STT: env.CONSULT_STT ?? 'agora', OPENAI_API_KEY: env.OPENAI_API_KEY } as const;
  const t = new ConsultTranscription({ store, config, stt: client, rtc, log: silentLog });
  store.on('change', (state) => t.onChange(state));
  return t;
}

const act = (action: SessionAction) => store.dispatch(sessionId, action, 'advisor');
const consult = () => store.get(sessionId)!.consult;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  store = new SessionStore();
  stt = new FakeStt();
  sessionId = store.create(BUYER, 'hi').id;
});
afterEach(() => vi.restoreAllMocks());

describe('Real-Time STT request', () => {
  it('joins the call channel as its own bot, listens to the buyer and the advisor, and asks for JSON captions', () => {
    const body = buildSttStartRequest(store.get(sessionId)!, rtc, Date.UTC(2026, 10, 20));
    expect(body).toMatchObject({
      languages: ['hi-IN', 'en-IN'],
      maxIdleTime: STT_MAX_IDLE_SEC,
      rtcConfig: { channelName: `ave-${sessionId}`, pubBotUid: '4001', subscribeAudioUids: ['2001', '3001'], enableJsonProtocol: true },
    });
    expect(body.name.length).toBeLessThanOrEqual(64);
    expect(body.name).toContain(sessionId);
    expect(body.rtcConfig.pubBotToken).toMatch(/^007/);
  });

  it('does not repeat English for an English call', () => {
    const en = store.create(BUYER, 'en');
    expect(buildSttStartRequest(en, rtc, 0).languages).toEqual(['en-IN']);
  });

  it('posts join and leave with Basic auth and reads agent_id', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createAgoraSttClient({
      appId: FAKE_APP_ID,
      customerId: 'cid',
      customerSecret: 'secret',
      fetch: async (url, init) => {
        calls.push({ url, init });
        return url.endsWith('/join') ? new Response(JSON.stringify({ agent_id: 'A1', create_ts: 1, status: 'RUNNING' })) : new Response('{}');
      },
    });
    const body = buildSttStartRequest(store.get(sessionId)!, rtc, 0);
    expect(await client.start(body)).toEqual({ agentId: 'A1' });
    await client.stop('A1');
    expect(calls.map((c) => c.url)).toEqual([
      `https://api.agora.io/api/speech-to-text/v1/projects/${FAKE_APP_ID}/join`,
      `https://api.agora.io/api/speech-to-text/v1/projects/${FAKE_APP_ID}/agents/A1/leave`,
    ]);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from('cid:secret').toString('base64')}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(body);
    expect(calls[1]!.init.body).toBeUndefined();
  });

  it('turns an Agora refusal into a short readable error', async () => {
    const client = createAgoraSttClient({
      appId: FAKE_APP_ID,
      customerId: 'cid',
      customerSecret: 'secret',
      fetch: async () => new Response(JSON.stringify({ reason: 'InvalidRequest', detail: 'STT not enabled for this project' }), { status: 403 }),
    });
    await expect(client.start(buildSttStartRequest(store.get(sessionId)!, rtc, 0))).rejects.toThrow('403: InvalidRequest: STT not enabled for this project');
  });
});

describe('consult transcription lifecycle', () => {
  it('starts the bot when a human joins and stops it on hand-back', async () => {
    setup({ OPENAI_API_KEY: 'sk' });
    act({ type: 'set_handoff', patch: { status: 'requested' } });
    await flush();
    expect(stt.starts).toHaveLength(0);
    act({ type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } });
    await flush();
    expect(stt.starts).toHaveLength(1);
    expect(consult()).toMatchObject({ status: 'listening', transcriptSource: 'agora_stt', error: null });

    act({ type: 'set_handoff', patch: { status: 'returned' } });
    await flush();
    expect(stt.stops).toEqual(['stt-1']);
    expect(consult()).toMatchObject({ status: 'idle', transcriptSource: 'none' });
  });

  it('stops the bot when the call ends', async () => {
    setup();
    act({ type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } });
    await flush();
    act({ type: 'set_status', status: 'ended' });
    await flush();
    expect(stt.stops).toEqual(['stt-1']);
  });

  it('falls back to OpenAI with a plain reason when the start fails', async () => {
    stt.failStart = new SttRequestError(403, 'STT not enabled');
    setup({ OPENAI_API_KEY: 'sk' });
    act({ type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } });
    await flush();
    expect(consult().transcriptSource).toBe('openai');
    expect(consult().status).toBe('listening');
    expect(consult().error).toContain('did not start (403: STT not enabled)');
    expect(consult().error).toContain(CONSULT_STT_MESSAGES.usingOpenAi);
  });

  it('falls back to OpenAI when the customer credentials are missing, and says so', async () => {
    setup({ OPENAI_API_KEY: 'sk' }, null);
    act({ type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } });
    await flush();
    expect(consult()).toMatchObject({ status: 'listening', transcriptSource: 'openai' });
    expect(consult().error).toContain('AGORA_CUSTOMER_ID');
  });

  it('reports an error when neither Agora nor OpenAI can transcribe', async () => {
    setup({}, null);
    act({ type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } });
    await flush();
    expect(consult()).toMatchObject({ status: 'error', transcriptSource: 'none' });
    expect(consult().error).toContain('OPENAI_API_KEY');
  });

  it('uses OpenAI directly when configured, and nothing when off', async () => {
    setup({ CONSULT_STT: 'openai', OPENAI_API_KEY: 'sk' });
    act({ type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } });
    await flush();
    expect(stt.starts).toHaveLength(0);
    expect(consult()).toMatchObject({ status: 'listening', transcriptSource: 'openai', error: null });

    const other = store.create(BUYER).id;
    store.removeAllListeners('change');
    const off = new ConsultTranscription({ store, config: { CONSULT_STT: 'off', OPENAI_API_KEY: 'sk' }, stt, rtc, log: silentLog });
    store.on('change', (state) => off.onChange(state));
    store.dispatch(other, { type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } }, 'advisor');
    await flush();
    expect(store.get(other)!.consult).toMatchObject({ status: 'idle', transcriptSource: 'none', error: CONSULT_STT_MESSAGES.off });
  });

  it('stops a bot that finished starting after the advisor already handed back', async () => {
    stt.hold = true;
    setup();
    act({ type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } });
    await flush();
    act({ type: 'set_handoff', patch: { status: 'returned' } });
    stt.release();
    await flush();
    await flush();
    expect(stt.stops).toEqual(['stt-1']);
    expect(consult().transcriptSource).toBe('none');
  });

  it('switches to OpenAI when the browser cannot read the captions', async () => {
    const t = setup({ OPENAI_API_KEY: 'sk' });
    act({ type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } });
    await flush();
    await t.fallBack(sessionId, 'captions arrived as protobuf');
    expect(stt.stops).toEqual(['stt-1']);
    expect(consult()).toMatchObject({ status: 'listening', transcriptSource: 'openai' });
    expect(consult().error).toContain('protobuf');
  });

  it('stops running bots on shutdown', async () => {
    const t = setup();
    act({ type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } });
    await flush();
    await t.shutdown();
    expect(stt.stops).toEqual(['stt-1']);
  });
});
