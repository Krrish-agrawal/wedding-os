import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CLIENT_ALLOWED_ACTIONS, SAMPLE_DATA_NOTICE, SAMPLE_VENUES, WeddingActionSchema } from '@ave/shared';
import { SimError, openAiChat, type ChatCreate } from '../agent/sim.js';
import { VAR_DIR } from '../config.js';
import { WeddingPlanner, redactSecrets } from './planner.js';
import { ProposalStore } from './proposals.js';
import { registerFashionRoutes } from './fashion-routes.js';
import { VendorStore } from './vendor-store.js';
import { OwnerStore } from './owners.js';
import { DesignService } from './design/jobs.js';
import { registerDesignRoutes } from './design/design-routes.js';
import { createImageService, MemoryBlobStore } from './storage/index.js';
import { registerImageRoutes } from './image-routes.js';
import { FLAG_DESCRIPTIONS, FLAG_NAMES, FlagService, createFlagService } from './flags.js';
import { VOICE_LANGUAGES, VoiceError, transcribeWithSarvam, type VoiceLanguage } from './sarvam.js';
import { DEMO_ADMIN_KEY, adminKeyFrom, registerVendorRoutes } from './vendor-routes.js';
import { WeddingStore, isValidWeddingId } from './store.js';
import path from 'node:path';

const ChatBody = z.object({
  message: z.string().trim().min(1).max(2000),
  reset: z.boolean().optional(),
  /** Object selected in the studio, so "it" can be resolved. Checked against the scene; unknown ids are ignored. */
  selectedId: z.string().min(1).max(40).nullable().optional(),
  /** Stream tool progress as newline-delimited JSON events. */
  stream: z.boolean().optional(),
});

declare module 'fastify' {
  interface FastifyInstance {
    wedding: { store: WeddingStore; planner: WeddingPlanner; proposals: ProposalStore; vendors: VendorStore; flags: FlagService; images: ReturnType<typeof createImageService>; design: DesignService };
  }
}

export interface WeddingPluginOptions {
  /** Persistence directory; `null` keeps everything in memory (tests). */
  dir?: string | null;
  create?: ChatCreate | null;
  /** Test hook: a proposal store with a controllable clock. */
  proposals?: ProposalStore;
  /** Test hook / override for the vendor store. */
  vendors?: VendorStore;
  /** Feature flag service. Defaults to Flagsmith when FLAGSMITH_ENVIRONMENT_KEY is set, else built-in defaults. */
  flags?: FlagService;
  /** Test hook: an image service (e.g. with a mock blob store). */
  images?: ReturnType<typeof createImageService>;
  /** Test hook for the speech-to-text HTTP call. */
  sarvamFetch?: typeof fetch;
  /** Admin key override; `null` disables admin. Defaults to WEDDING_ADMIN_KEY (demo key outside production). */
  adminKey?: string | null;
}

/**
 * Wedding API. Browsers may send only the actions in CLIENT_ALLOWED_ACTIONS; the reducer re-validates every
 * one. There is no login yet: workspaces are keyed by an unguessable id the browser creates, which is a
 * demo-grade boundary (see docs/WEDDING_OS.md).
 */
export const weddingPlugin: FastifyPluginAsync<WeddingPluginOptions> = async (app, opts) => {
  const dir = opts.dir === undefined ? path.join(VAR_DIR, 'weddings') : opts.dir ?? undefined;
  const store = new WeddingStore(dir);
  const base = dir ? path.dirname(dir) : undefined;
  const proposals = opts.proposals ?? new ProposalStore(base ? { dir: path.join(base, 'proposals') } : {});
  const owners = new OwnerStore(base ? path.join(base, 'owners.json') : undefined);
  const vendors = opts.vendors ?? new VendorStore(dir ? path.join(path.dirname(dir), 'vendors') : undefined);
  const flags = opts.flags ?? createFlagService(app.ctx.config);
  app.addHook('onClose', async () => flags.close());
  const images = opts.images ?? createImageService(app.ctx.config, { dir: base ? path.join(base, 'uploads') : null, blobs: base ? undefined : new MemoryBlobStore() });
  const create = opts.create === undefined ? openAiChat(app.ctx.config) : opts.create;
  const design = new DesignService({ store, images, create, visionModel: app.ctx.config.WEDDING_VISION_MODEL, timeoutMs: app.ctx.config.WEDDING_VISION_TIMEOUT_MS, dir: base ? path.join(base, 'design-jobs') : undefined, log: app.log });
  const planner = new WeddingPlanner(store, app.ctx.config, create, proposals, vendors, flags, base ? path.join(base, 'planner') : undefined, design);
  app.decorate('wedding', { store, planner, proposals, vendors, flags, images, design });
  const adminKey = opts.adminKey === undefined ? adminKeyFrom(process.env) : opts.adminKey;
  registerVendorRoutes(app, { vendors, store, adminKey, flags });
  registerFashionRoutes(app, { store });
  registerDesignRoutes(app, { design, images, flags });

  app.get('/api/wedding-meta', async () => ({
    plannerMode: planner.mode,
    model: planner.mode === 'llm' ? app.ctx.config.LLM_MODEL : null,
    notice: SAMPLE_DATA_NOTICE,
    venues: SAMPLE_VENUES,
    adminDemoKey: adminKey === DEMO_ADMIN_KEY ? DEMO_ADMIN_KEY : null,
  }));

  // ---- workspace ownership (demo session) ---------------------------------------------------------------------------
  // Once a workspace is claimed, every /api/wedding/:id/... request needs its token (x-workspace-token), including
  // chat, voice, actions, shortlist, enquiries and confirming or cancelling proposals. Knowing the id is not enough.
  app.addHook('onRequest', async (req, reply) => {
    const m = /^\/api\/wedding\/([^/?]+)/.exec(req.url);
    if (!m || m[1] === undefined) return;
    if (req.method === 'POST' && /^\/api\/wedding\/[^/?]+\/claim(?:\?|$)/.test(req.url)) return;
    const t = req.headers['x-workspace-token'];
    if (!owners.verify(decodeURIComponent(m[1]), typeof t === 'string' ? t : undefined)) {
      return reply.code(401).send({ error: 'This wedding belongs to another session. Open it from the browser that created it.', code: 'workspace_locked' });
    }
  });
  app.post<{ Params: { id: string } }>('/api/wedding/:id/claim', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    const token = owners.claim(req.params.id);
    return token ? { token } : reply.code(409).send({ error: 'This workspace is already claimed.', code: 'already_claimed' });
  });

  // Registered after the ownership hook above so the hook covers it.
  await registerImageRoutes(app, { images, store });

  // Flags are evaluated on the server. The browser gets only the resulting booleans (to hide pages), never the ability to set them.
  app.get('/api/flags', async () => {
    const snap = await flags.refresh();
    return { ...snap, configured: flags.configured, descriptions: FLAG_DESCRIPTIONS, names: FLAG_NAMES, voiceConfigured: Boolean(app.ctx.config.SARVAM_API_KEY) };
  });

  // ---- voice: the same planner path as typed chat --------------------------------------------------------------------
  // audio -> Sarvam speech-to-text -> planner.chat (the same tools, validators and reducer as text) -> reply.
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer', bodyLimit: 2_000_000 }, (_req, body, done) => done(null, body));
  app.post<{ Params: { id: string }; Querystring: { lang?: string; selectedId?: string } }>('/api/wedding/:id/voice', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    await flags.refresh();
    if (!flags.isEnabled('voice.sarvam')) return reply.code(403).send({ error: 'Voice input is switched off right now.', code: 'feature_disabled' });
    const lang = (VOICE_LANGUAGES as readonly string[]).includes(req.query.lang ?? '') ? (req.query.lang as VoiceLanguage) : 'unknown';
    if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: 'Send the recording as audio/* in the request body.' });
    try {
      const heard = await transcribeWithSarvam({ apiKey: app.ctx.config.SARVAM_API_KEY, model: app.ctx.config.SARVAM_STT_MODEL, fetchImpl: opts.sarvamFetch }, req.body, String(req.headers['content-type'] ?? 'audio/webm'), lang);
      const turn = await planner.chat(req.params.id, heard.transcript, { selectedId: req.query.selectedId ?? null });
      return { transcript: heard.transcript, languageCode: heard.languageCode, turn };
    } catch (err) {
      if (err instanceof VoiceError) return reply.code(err.status).send({ error: err.message, code: err.code });
      if (err instanceof SimError) return reply.code(err.status).send({ error: err.message });
      req.log.error({ err: redactSecrets((err as Error).message) }, 'voice request failed');
      return reply.code(500).send({ error: 'The planner failed. Check the server log.' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/wedding/:id', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    return { state: store.getOrCreate(req.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/wedding/:id/actions', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    const parsed = WeddingActionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid action', issues: parsed.error.issues.map((i) => i.message) });
    if (!CLIENT_ALLOWED_ACTIONS.includes(parsed.data.type)) return reply.code(403).send({ error: `The "${parsed.data.type}" action is not available from the browser.` });
    const result = store.dispatch(req.params.id, parsed.data);
    return result.ok ? { state: result.state } : reply.code(422).send({ error: result.error, hint: result.hint });
  });

  app.post<{ Params: { id: string } }>('/api/wedding/:id/reset', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    planner.reset(req.params.id);
    const result = store.dispatch(req.params.id, { type: 'reset_to_sample' });
    return result.ok ? { state: result.state } : reply.code(500).send({ error: result.error });
  });

  // ---- customer confirmations ---------------------------------------------------------------------------------------
  // These are the ONLY way a proposal is applied. They are plain HTTP routes for the browser: no planner tool, no chat
  // text and no model-supplied flag can reach them. A proposal id from another workspace is simply "not found".
  const ProposalParams = z.object({ id: z.string().min(1).max(64), pid: z.string().uuid() });

  app.get<{ Params: { id: string } }>('/api/wedding/:id/proposals', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    return { proposals: proposals.pending(req.params.id) };
  });

  app.post<{ Params: { id: string; pid: string } }>('/api/wedding/:id/proposals/:pid/confirm', async (req, reply) => {
    const p = ProposalParams.safeParse(req.params);
    if (!p.success || !isValidWeddingId(p.data.id)) return reply.code(404).send({ error: 'No such proposal.', code: 'not_found' });
    const r = proposals.confirm(store, p.data.id, p.data.pid);
    return r.ok ? { state: r.state, proposal: r.proposal } : reply.code(r.status).send({ error: r.message, code: r.code });
  });

  app.post<{ Params: { id: string; pid: string } }>('/api/wedding/:id/proposals/:pid/cancel', async (req, reply) => {
    const p = ProposalParams.safeParse(req.params);
    if (!p.success || !isValidWeddingId(p.data.id)) return reply.code(404).send({ error: 'No such proposal.', code: 'not_found' });
    const r = proposals.cancel(p.data.id, p.data.pid);
    return r.ok ? { proposal: r.proposal } : reply.code(r.status).send({ error: r.message, code: r.code });
  });

  app.post<{ Params: { id: string } }>('/api/wedding/:id/chat', async (req, reply) => {
    if (!isValidWeddingId(req.params.id)) return reply.code(400).send({ error: 'Invalid wedding id' });
    const body = ChatBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Send { "message": "..." } with some text.' });
    if (body.data.reset) planner.reset(req.params.id);
    const id = req.params.id;
    const opts = { selectedId: body.data.selectedId };

    if (!body.data.stream) {
      try {
        return await planner.chat(id, body.data.message, opts);
      } catch (err) {
        if (err instanceof SimError) return reply.code(err.status).send({ error: err.message });
        req.log.error({ err: redactSecrets((err as Error).message) }, 'wedding chat failed');
        return reply.code(500).send({ error: 'The planner failed. Check the server log.' });
      }
    }

    // Streaming: one JSON object per line, so the browser can show each step and redraw the scene as it is accepted.
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { ...reply.getHeaders(), 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' } as Record<string, string>);
    const abort = new AbortController();
    raw.on('close', () => abort.abort());
    const send = (event: unknown) => { if (!raw.writableEnded) raw.write(`${JSON.stringify(event)}\n`); };
    try {
      await planner.chat(id, body.data.message, { ...opts, signal: abort.signal, onEvent: send });
    } catch (err) {
      const message = err instanceof SimError ? err.message : 'The planner failed. Check the server log.';
      if (!(err instanceof SimError)) req.log.error({ err: redactSecrets((err as Error).message) }, 'wedding chat failed');
      send({ type: 'error', message });
    }
    raw.end();
  });
};
