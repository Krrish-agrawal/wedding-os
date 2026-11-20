import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../context.js';
import { BUYER, testContext } from '../voice/testkit.js';
import { buildBrief } from './brief.js';
import { audioFileName, cleanTranscription, languageHint, type TranscribeInput } from './consultAudio.js';
import { consultPlugin } from './consultPlugin.js';
import type { SttClient } from './consultStt.js';

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function setup(env: Record<string, string> = {}, opts: { stt?: SttClient | null; text?: string } = {}) {
  const ctx: AppContext = testContext({ CONSULT_STT: 'openai', OPENAI_API_KEY: 'sk-test', ...env });
  const heard: TranscribeInput[] = [];
  app = Fastify({ logger: false });
  app.decorate('ctx', ctx);
  await app.register(consultPlugin, {
    stt: opts.stt ?? null,
    scribeModel: null,
    transcriber: async (input) => {
      heard.push(input);
      return opts.text ?? 'Can you drop the parking charge?';
    },
  });
  await app.ready();
  const sessionId = ctx.store.create(BUYER, 'hi').id;
  return { ctx, sessionId, heard, app };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('GET /api/sessions/:id/brief', () => {
  it('answers in a few lines from the call record', async () => {
    const { ctx, sessionId, app } = await setup();
    ctx.store.dispatchAll(
      sessionId,
      [
        { type: 'set_property', propertyId: 'apt-test' },
        { type: 'set_view', view: 'money' },
        { type: 'update_lead', patch: { purpose: 'a 2 BHK to live in', budget: '1.5 crore', objections: ['Parking is expensive'] } },
        { type: 'add_transcript', line: { id: 'b1', role: 'buyer', text: 'Can I talk to someone about the price?', final: true, at: 1 } },
        { type: 'set_handoff', patch: { status: 'requested', reason: 'Wants a better price', requestedAt: 5 } },
      ],
      'agent',
    );
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ buyerName: BUYER.name, propertyName: 'Lakeview Residency', reason: 'Wants a better price', requestedAt: 5, handoff: 'requested' });
    const lines = body.brief.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(body.brief).toContain('Lakeview Residency');
    expect(body.brief).toContain('budget 1.5 crore');
    expect(body.brief).toContain('Parking is expensive');
    expect(body.brief).toContain('Asked for a person: Wants a better price.');
    expect(body.brief).toContain('Can I talk to someone about the price?');
    expect((await app.inject({ method: 'GET', url: '/api/sessions/nope/brief' })).statusCode).toBe(404);
  });

  it('stays honest when nothing is known yet', () => {
    const ctx = testContext();
    const s = ctx.store.create(BUYER);
    expect(buildBrief(s, ctx.content)).toBe('Priya has not opened a property yet.');
  });
});

describe('POST /api/sessions/:id/consult/audio', () => {
  it('transcribes a chunk into a transcript line for the right speaker, in the call language', async () => {
    const { ctx, sessionId, heard, app } = await setup();
    ctx.store.dispatch(sessionId, { type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } }, 'advisor');
    await tick();
    expect(ctx.store.get(sessionId)!.consult.transcriptSource).toBe('openai');

    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/consult/audio?speaker=buyer`,
      headers: { 'content-type': 'audio/webm;codecs=opus' },
      payload: Buffer.from([1, 2, 3, 4]),
    });
    expect(res.statusCode).toBe(200);
    expect(heard[0]).toMatchObject({ mimeType: 'audio/webm;codecs=opus', language: 'hi' });
    expect(heard[0]!.audio.length).toBe(4);
    const line = ctx.store.get(sessionId)!.transcript.at(-1);
    expect(line).toMatchObject({ role: 'buyer', text: 'Can you drop the parking charge?', final: true });
    expect(line!.id).toMatch(/^oa-buyer-/);
  });

  it('refuses chunks while OpenAI transcription is not running, and checks the speaker', async () => {
    const { sessionId, app } = await setup();
    const post = (speaker: string) =>
      app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/consult/audio?speaker=${speaker}`, headers: { 'content-type': 'audio/webm' }, payload: Buffer.from([1]) });
    expect((await post('human')).statusCode).toBe(409);
    expect((await post('agent')).statusCode).toBe(400);
  });

  it('adds nothing for a chunk with no words', async () => {
    const { ctx, sessionId, app } = await setup({}, { text: ' [silence] ' });
    ctx.store.dispatch(sessionId, { type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } }, 'advisor');
    await tick();
    const before = ctx.store.get(sessionId)!.transcript.length;
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/consult/audio?speaker=human`, headers: { 'content-type': 'audio/webm' }, payload: Buffer.from([1]) });
    expect(res.statusCode).toBe(204);
    expect(ctx.store.get(sessionId)!.transcript.length).toBe(before);
  });
});

describe('POST /api/sessions/:id/consult/stt-problem', () => {
  it('switches a running Agora transcription to OpenAI', async () => {
    const stops: string[] = [];
    const stt: SttClient = { start: async () => ({ agentId: 'stt-1' }), stop: async (id) => void stops.push(id) };
    const { ctx, sessionId, app } = await setup({ CONSULT_STT: 'agora', AGORA_CUSTOMER_ID: 'c', AGORA_CUSTOMER_SECRET: 's', AGORA_APP_ID: '0123456789abcdef0123456789abcdef', AGORA_APP_CERTIFICATE: 'fedcba9876543210fedcba9876543210' }, { stt });
    ctx.store.dispatch(sessionId, { type: 'set_handoff', patch: { status: 'joined', humanName: 'Rahul' } }, 'advisor');
    await tick();
    expect(ctx.store.get(sessionId)!.consult.transcriptSource).toBe('agora_stt');
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/consult/stt-problem`, payload: { detail: 'captions arrived as protobuf' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().consult).toMatchObject({ transcriptSource: 'openai', status: 'listening' });
    expect(stops).toEqual(['stt-1']);
  });
});

describe('consult audio helpers', () => {
  it('names the file after the container and hints the language', () => {
    expect(audioFileName('audio/webm;codecs=opus')).toBe('chunk.webm');
    expect(audioFileName('audio/ogg')).toBe('chunk.ogg');
    expect(audioFileName('audio/mp4')).toBe('chunk.mp4');
    expect(languageHint('kn')).toBe('kn');
    expect(cleanTranscription('  ...  ')).toBeNull();
    expect(cleanTranscription('(music)')).toBeNull();
    expect(cleanTranscription(' नमस्ते   जी ')).toBe('नमस्ते जी');
  });
});
