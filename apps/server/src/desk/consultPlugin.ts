import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SessionAction, SessionState } from '@ave/shared';
import { resolveRtcSettings } from '../voice/settings.js';
import { buildBrief } from './brief.js';
import { ConsultScribe, createOpenAiScribeModel, type ScribeModel } from './consult.js';
import { CONSULT_AUDIO_MAX_BYTES, CONSULT_SPEAKERS, cleanTranscription, createOpenAiTranscriber, type Transcriber } from './consultAudio.js';
import { ConsultTranscription, createAgoraSttClient, type SttClient } from './consultStt.js';
import { HandoffTimeoutWatcher } from './handoffTimeout.js';
import { deskFor } from './runtime.js';

export interface ConsultPluginOptions {
  /** Replace the Agora Real-Time STT client (tests). `null` means no STT even with credentials. */
  stt?: SttClient | null;
  /** Replace the OpenAI chunk transcriber (tests). */
  transcriber?: Transcriber | null;
  /** Replace the notes model (tests). */
  scribeModel?: ScribeModel | null;
  now?: () => number;
  scribeGapMs?: number;
}

type IdParams = { Params: { id: string } };

const AudioQuery = z.object({ speaker: z.enum(CONSULT_SPEAKERS) });
const ProblemBody = z.object({ detail: z.string().trim().min(1).max(300) });
/** Content types the audio route takes as raw bytes. */
const AUDIO_CONTENT_TYPES = /^(audio\/|application\/octet-stream)/;

/**
 * Consult mode: what happens around a human advisor's stretch of the call.
 *
 * GET  /api/sessions/:id/brief                  2-4 lines on what the AI knows (incoming-call card)
 * POST /api/sessions/:id/consult/audio?speaker= raw audio chunk (OpenAI fallback) -> transcript line
 * POST /api/sessions/:id/consult/stt-problem    { detail } the advisor's browser cannot read STT captions
 *
 * Plus three store subscribers: Real-Time STT start/stop, the live-notes scribe and the handoff timeout.
 */
export const consultPlugin: FastifyPluginAsync<ConsultPluginOptions> = async (app, opts) => {
  const { ctx } = app;
  const { config, store } = ctx;
  const now = opts.now ?? Date.now;
  const rtc = resolveRtcSettings(config);
  const stt =
    opts.stt !== undefined
      ? opts.stt
      : config.AGORA_APP_ID && config.AGORA_CUSTOMER_ID && config.AGORA_CUSTOMER_SECRET
        ? createAgoraSttClient({ appId: config.AGORA_APP_ID, customerId: config.AGORA_CUSTOMER_ID, customerSecret: config.AGORA_CUSTOMER_SECRET })
        : null;
  const transcriber = opts.transcriber !== undefined ? opts.transcriber : createOpenAiTranscriber(config);
  const scribeModel = opts.scribeModel !== undefined ? opts.scribeModel : createOpenAiScribeModel(config);

  const transcription = new ConsultTranscription({ store, config, stt, rtc: rtc.ok ? rtc.value : null, log: app.log, now });
  const scribe = new ConsultScribe({ store, content: ctx.content, model: scribeModel, log: app.log, now, ...(opts.scribeGapMs !== undefined ? { minGapMs: opts.scribeGapMs } : {}) });
  const timeout = new HandoffTimeoutWatcher({ store, timeoutMs: config.HANDOFF_TIMEOUT_MS, log: app.log });

  // One listener for all three keeps the store under Node's listener warning as workstreams add their own.
  const onChange = (state: SessionState, action: SessionAction) => {
    transcription.onChange(state);
    scribe.onChange(state, action);
    timeout.onChange(state);
  };
  store.on('change', onChange);
  app.log.info({ consultStt: config.CONSULT_STT, agoraStt: Boolean(stt), openAiChunks: Boolean(transcriber), notes: Boolean(scribeModel) }, 'consult mode ready');

  app.addHook('onClose', async () => {
    store.off('change', onChange);
    timeout.dispose();
    scribe.dispose();
    await transcription.shutdown();
  });

  app.addContentTypeParser(AUDIO_CONTENT_TYPES, { parseAs: 'buffer', bodyLimit: CONSULT_AUDIO_MAX_BYTES }, (_req, body, done) => done(null, body));

  app.get<IdParams>('/api/sessions/:id/brief', async (req, reply) => {
    const state = store.get(req.params.id) ?? deskFor(ctx).getState(req.params.id);
    if (!state) return reply.code(404).send({ error: 'Session not found' });
    const bundle = state.propertyId ? ctx.content.byId[state.propertyId] : undefined;
    return {
      brief: buildBrief(state, ctx.content),
      buyerName: state.buyer.name,
      propertyName: bundle?.property.name ?? null,
      reason: state.handoff.reason,
      requestedAt: state.handoff.requestedAt,
      handoff: state.handoff.status,
    };
  });

  let chunkCount = 0;
  app.post<IdParams & { Querystring: { speaker?: string } }>('/api/sessions/:id/consult/audio', async (req, reply) => {
    const query = AudioQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'speaker must be buyer or human' });
    const audio = req.body;
    if (!Buffer.isBuffer(audio) || audio.length === 0) return reply.code(400).send({ error: 'Send the audio chunk as the raw request body.' });
    const state = store.get(req.params.id);
    if (!state) return reply.code(404).send({ error: 'Session not found' });
    if (state.status === 'ended' || state.handoff.status !== 'joined' || state.consult.transcriptSource !== 'openai') {
      return reply.code(409).send({ error: 'OpenAI transcription is not running for this call.' });
    }
    if (!transcriber) return reply.code(503).send({ error: 'OpenAI transcription is not configured on the server.' });

    const at = now();
    let text: string | null;
    try {
      text = cleanTranscription(await transcriber({ audio, mimeType: req.headers['content-type'] ?? 'audio/webm', language: state.language }));
    } catch (err) {
      req.log.warn({ sessionId: state.id, speaker: query.data.speaker, err: (err as Error).message }, 'consult audio chunk not transcribed');
      return reply.code(502).send({ error: 'The audio could not be transcribed.' });
    }
    if (!text) return reply.code(204).send();
    chunkCount += 1;
    const line = { id: `oa-${query.data.speaker}-${at.toString(36)}-${chunkCount}`, role: query.data.speaker, text, final: true, at };
    store.dispatch(state.id, { type: 'add_transcript', line }, 'advisor');
    return { text };
  });

  app.post<IdParams>('/api/sessions/:id/consult/stt-problem', async (req, reply) => {
    const body = ProblemBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Describe the problem in a few words.' });
    if (!store.get(req.params.id)) return reply.code(404).send({ error: 'Session not found' });
    await transcription.fallBack(req.params.id, body.data.detail);
    return { consult: store.get(req.params.id)?.consult ?? null };
  });
};
