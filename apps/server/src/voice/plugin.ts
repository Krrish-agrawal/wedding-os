import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  VoiceStartRequestSchema,
  VoiceStateRequestSchema,
  VoiceTextRequestSchema,
  VoiceTokenRequestSchema,
  type VoiceTokenResponse,
} from '@ave/shared';
import { defaultCollaborators, type Collaborators } from './collaborators.js';
import { VoiceController, VoiceError } from './controller.js';
import { createAgoraGateway, type AgentGateway } from './gateway.js';
import { resolveRtcSettings, resolveVoiceSettings } from './settings.js';
import { issueClientToken } from './tokens.js';

export interface VoicePluginOptions {
  /** Replace the Agora gateway (tests). `null` means no gateway even when credentials exist. */
  gateway?: AgentGateway | null;
  /** Replace prompt builders, handoff context or tool wiring (tests). */
  collaborators?: Partial<Collaborators>;
  now?: () => number;
}

type IdParams = { Params: { id: string } };

/**
 * Voice workstream: Agora tokens for the buyer and the human advisor, the voice agent's lifecycle,
 * screen awareness, typed input, handoff reactions and the transcript cross-check.
 *
 * GET  /api/sessions/:id/voice          availability (and warnings such as tools being off)
 * POST /api/sessions/:id/voice/token    { role: buyer | advisor } -> one RTC + RTM token
 * POST /api/sessions/:id/voice/start    { restart? } -> starts (or returns) the call's agent
 * POST /api/sessions/:id/voice/stop     leaves the agent
 * POST /api/sessions/:id/voice/text     { text } -> typed buyer input
 * POST /api/sessions/:id/voice/state    { state } -> engine state seen by the buyer's browser
 */
export const voicePlugin: FastifyPluginAsync<VoicePluginOptions> = async (app, opts) => {
  const { ctx } = app;
  const now = opts.now ?? Date.now;
  const settings = resolveVoiceSettings(ctx.config);
  const rtc = resolveRtcSettings(ctx.config);
  const collaborators: Collaborators = { ...defaultCollaborators, ...opts.collaborators };
  const gateway = opts.gateway !== undefined ? opts.gateway : settings.ok ? createAgoraGateway(settings.value, app.log) : null;

  const controller = new VoiceController({ ctx, settings, gateway, collaborators, log: app.log, now });
  controller.attach();
  app.addHook('onClose', () => controller.shutdown());

  if (settings.ok) {
    app.log.info({ tools: settings.value.tools.kind, asr: settings.value.asr.vendor, warnings: settings.warnings }, 'voice ready');
  } else {
    app.log.warn({ reason: settings.reason }, 'voice unavailable; buyers get typed input');
  }

  const sessionMissing = (reply: FastifyReply) => reply.code(404).send({ error: 'Session not found' });
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof VoiceError) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  };

  app.get<IdParams>('/api/sessions/:id/voice', async (req, reply) => {
    if (!ctx.store.get(req.params.id)) return sessionMissing(reply);
    return controller.availability();
  });

  // Dev only: raw agent history, to see exactly what speech recognition heard.
  if (process.env.NODE_ENV !== 'production') {
    app.get<IdParams>('/api/sessions/:id/voice/debug/history', async (req) => ({ history: await controller.debugHistory(req.params.id) }));
  }

  app.post<IdParams>('/api/sessions/:id/voice/token', async (req, reply): Promise<VoiceTokenResponse | FastifyReply> => {
    const parsed = VoiceTokenRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'role must be buyer or advisor' });
    const state = ctx.store.get(req.params.id);
    if (!state) return sessionMissing(reply);
    if (state.status === 'ended') return reply.code(409).send({ error: 'This call has ended.' });
    if (!rtc.ok) return { available: false, reason: rtc.reason };
    return issueClientToken(rtc.value, state.id, parsed.data.role, now());
  });

  app.post<IdParams>('/api/sessions/:id/voice/start', async (req, reply) => {
    const parsed = VoiceStartRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' });
    try {
      return await controller.start(req.params.id, parsed.data);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<IdParams>('/api/sessions/:id/voice/stop', async (req, reply) => {
    if (!ctx.store.get(req.params.id)) return sessionMissing(reply);
    await controller.stop(req.params.id);
    return { stopped: true };
  });

  app.post<IdParams>('/api/sessions/:id/voice/text', async (req, reply) => {
    const parsed = VoiceTextRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Type a message first.' });
    try {
      return await controller.sendText(req.params.id, parsed.data.text);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<IdParams>('/api/sessions/:id/voice/state', async (req, reply) => {
    const parsed = VoiceStateRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Unknown state' });
    if (!ctx.store.get(req.params.id)) return sessionMissing(reply);
    controller.setConversationState(req.params.id, parsed.data.state);
    return reply.code(204).send();
  });
};
