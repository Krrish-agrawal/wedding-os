import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { SessionAction, SessionState } from '@ave/shared';
import { VAR_DIR } from '../config.js';
import { startAutomations } from './automations.js';
import { consultPlugin } from './consultPlugin.js';
import { handoffRoutes } from './handoff.js';
import { integrationRoutes } from './integrations.js';
import { whatsappInboundRoutes } from './whatsappInbound.js';
import { LeadStore } from './leadStore.js';
import { maybeAutoSendReport } from './reports.js';
import { deskRoutes } from './routes.js';
import { copilotRoutes } from '../agent/copilot.js';
import { mediaRoutes } from './media.js';
import { outboundRoutes } from './outbound.js';
import { pipelineRoutes } from './pipeline.js';
import { defaultDeskDeps, DeskRuntime, registerDesk, unregisterDesk, type DeskDeps } from './runtime.js';

export const LEADS_DB_FILE = 'leads.sqlite';
/** On shutdown, wait this long for recaps that are mid-send before closing the database. */
const SHUTDOWN_DRAIN_MS = 5_000;

export interface DeskPluginOptions {
  /** SQLite file for leads; defaults to apps/server/var/leads.sqlite. ':memory:' for tests. */
  dbPath?: string;
  /** Replace providers or the summarizer (tests). */
  deps?: Partial<Omit<DeskDeps, 'leads'>>;
}

/**
 * Desk workstream: lead store (node:sqlite), scoring, recap reports, delivery adapters,
 * CRM sync, handoff routes and the Lead Desk API.
 */
export const deskPlugin: FastifyPluginAsync<DeskPluginOptions> = async (app, opts) => {
  const ctx = app.ctx;
  const leads = new LeadStore(opts.dbPath ?? path.join(VAR_DIR, LEADS_DB_FILE), app.log);
  const runtime = new DeskRuntime(ctx, { ...defaultDeskDeps(ctx, leads, app.log), ...opts.deps, leads });
  registerDesk(ctx, runtime);
  const detach = leads.attach(ctx.store);
  app.log.info({ leads: leads.list().length }, 'lead store ready');

  // Send the final recap once when a call ends, if the buyer agreed (see docs/desk-notes.md).
  const onChange = (state: SessionState, action: SessionAction) => {
    if (action.type !== 'set_status' || state.status !== 'ended') return;
    void maybeAutoSendReport(runtime, state.id).catch((err: Error) => app.log.error({ sessionId: state.id, err: err.message }, 'automatic recap failed'));
  };
  ctx.store.on('change', onChange);
  // WhatsApp, email, Slack, Jira and HubSpot rules (visit booked, handoff, call ended); see automations.ts.
  const stopAutomations = startAutomations(runtime);

  await app.register(handoffRoutes);
  // Consult mode: live transcription, live notes, handoff timeout and the incoming-call brief.
  await app.register(consultPlugin);
  await app.register(deskRoutes);
  await app.register(integrationRoutes);
  await app.register(whatsappInboundRoutes);
  // Admin copilot, preview-then-send, public property photos for WhatsApp, and the pipeline board.
  await app.register(outboundRoutes);
  await app.register(copilotRoutes);
  await app.register(mediaRoutes);
  await app.register(pipelineRoutes);

  app.addHook('onClose', async () => {
    ctx.store.off('change', onChange);
    stopAutomations();
    await runtime.drain(SHUTDOWN_DRAIN_MS);
    detach();
    leads.close();
    unregisterDesk(ctx);
  });
};
