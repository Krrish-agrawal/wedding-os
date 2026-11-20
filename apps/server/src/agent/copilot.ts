import OpenAI from 'openai';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  CALL_LANGUAGE_INFO,
  CopilotRequestSchema,
  REPORT_CHANNELS,
  TOOL_DESCRIPTIONS,
  TOOL_NAMES,
  VIEW_LABELS,
  callSummaryPath,
  describeSlot,
  mapsPinUrl,
  type CopilotResult,
  type CopilotStep,
  type OutboundDraft,
  type OutboundPreview,
  type SessionAction,
  type SessionState,
  type ToolName,
  type ToolResult,
} from '@ave/shared';
import type { AppContext } from '../context.js';
import { mediaUnavailableReason, propertyMedia } from '../desk/media.js';
import { createPreview, markNextStepDone } from '../desk/outbound.js';
import { deskFor } from '../desk/runtime.js';
import { SILENT_LOGGER, type ToolDeps, type ToolLogger } from '../tools/context.js';
import { resultText, runTool } from '../tools/runner.js';
import { toolJsonSchema, type JsonObjectSchema } from '../tools/schema.js';
import { EMPTY_SCREEN, screenSnapshot } from '../tools/screen.js';
import { buildScreenLine, firstName } from './prompt.js';
import { SimError, invalidArgsResult, openAiChat, runToolLoop, trimHistory, type ChatCreate, type ChatTool, type Msg, type ToolLoopCall } from './sim.js';

/**
 * The Desk copilot: the human advisor types an instruction during a consult ("show the master bathroom
 * plumbing", "send her the floor plan on WhatsApp") and this runs it against the call. It drives the
 * buyer's screen with the same tools the voice advisor uses, but as the advisor, and it never talks to
 * the buyer. Anything that would leave the app comes back as a preview the admin sends by hand.
 */

/** Voice tools that do not fit the admin: they are the human already, and the recap is sent through a preview. */
const EXCLUDED_TOOLS = ['requestHuman', 'sendReport'] as const satisfies readonly ToolName[];
type ScreenToolName = Exclude<ToolName, (typeof EXCLUDED_TOOLS)[number]>;
export const COPILOT_SCREEN_TOOLS = TOOL_NAMES.filter((n): n is ScreenToolName => !(EXCLUDED_TOOLS as readonly string[]).includes(n));

/** An instruction takes a few tool calls at most; past this the model is looping. */
export const COPILOT_MAX_TOOL_ROUNDS = 5;
/** Earlier instructions kept so "send that to her too" works; short, since each one stands alone. */
export const COPILOT_MAX_HISTORY = 16;
/** The copilot follows instructions; it should not be creative about them. */
export const COPILOT_TEMPERATURE = 0.1;
/** Written into a 'view' next step once its command ran (deliveries use their own id). */
export const VIEW_STEP_DONE_REF = 'done';

const MESSAGE_LIMITS = { whatsapp: 1000, emailSubject: 160, emailText: 4000, jiraSummary: 200, jiraDescription: 4000, slack: 1500, dueDays: 30 } as const;

/** Tools that only prepare a preview. Their limits match the consult next-step actions. */
export const DRAFT_TOOL_INPUTS = {
  draftWhatsApp: z.object({
    text: z.string().min(1).max(MESSAGE_LIMITS.whatsapp).describe('The message to the buyer, plain text.'),
    mediaUrl: z.string().url().optional().describe('A photo URL from the Photos list, sent as an image with the text.'),
  }),
  draftEmail: z.object({
    subject: z.string().min(1).max(MESSAGE_LIMITS.emailSubject),
    text: z.string().min(1).max(MESSAGE_LIMITS.emailText).describe('Plain text; blank lines separate paragraphs.'),
  }),
  draftJiraTask: z.object({
    summary: z.string().min(1).max(MESSAGE_LIMITS.jiraSummary).describe('Short task title, e.g. "Manager approval: 2% discount for Priya Sharma".'),
    description: z.string().max(MESSAGE_LIMITS.jiraDescription).describe('What needs doing and why, with the buyer and property.'),
    dueInDays: z.number().int().min(0).max(MESSAGE_LIMITS.dueDays).optional().describe('Days from today the task is due; 0 is today.'),
  }),
  draftSlackPost: z.object({ text: z.string().min(1).max(MESSAGE_LIMITS.slack) }),
  draftRecap: z.object({ channel: z.enum(REPORT_CHANNELS).describe('email: the full recap with the visit invite; whatsapp: the short version.') }),
} as const;
export type DraftToolName = keyof typeof DRAFT_TOOL_INPUTS;
export const DRAFT_TOOL_NAMES = Object.keys(DRAFT_TOOL_INPUTS) as DraftToolName[];

const DRAFT_TOOL_DESCRIPTIONS: Record<DraftToolName, string> = {
  draftWhatsApp: 'Prepare a WhatsApp message to the buyer, optionally with a property photo. Only creates a preview; the advisor sends it.',
  draftEmail: 'Prepare an email to the buyer. Only creates a preview; the advisor sends it.',
  draftJiraTask: 'Prepare a Jira task for the team: approvals, call-backs, paperwork. Only creates a preview; the advisor sends it.',
  draftSlackPost: "Prepare a post in the sales team's Slack channel. Only creates a preview; the advisor sends it.",
  draftRecap: 'Prepare the standard recap of this call for the buyer. Only creates a preview; the advisor sends it.',
};

const STEP_VERBS: Record<ScreenToolName, string> = {
  showShortlist: 'Showed the shortlist',
  openProperty: 'Opened the property',
  tourGoTo: 'Moved the tour',
  tourWalkthrough: 'Changed the walkthrough',
  showBlueprint: 'Showed the plan',
  showLocality: 'Showed the area',
  showCommute: 'Showed the commute',
  showCompass: 'Showed the compass',
  showMoney: 'Showed pricing',
  applyOffer: 'Applied the offer',
  requestDiscount: 'Checked the discount',
  showLegal: 'Showed the documents',
  getVisitSlots: 'Listed visit slots',
  bookSiteVisit: 'Booked the visit',
  updateLead: 'Saved to the lead',
};
/** Tools whose result is not about what the screen shows. */
const OFF_SCREEN_TOOLS: ReadonlySet<ScreenToolName> = new Set(['updateLead', 'requestDiscount', 'getVisitSlots']);

const DRAFT_NOUNS: Record<DraftToolName, string> = {
  draftWhatsApp: 'WhatsApp',
  draftEmail: 'Email',
  draftJiraTask: 'Jira task',
  draftSlackPost: 'Slack post',
  draftRecap: 'Recap',
};

const NO_KEY = 'OPENAI_API_KEY is not set on the server. Add it to .env and restart the API to use the copilot.';
const BUSY = 'The copilot is still working on the last instruction.';
const GONE = 'This call is no longer running.';
const ROUNDS_EXHAUSTED = 'That took too many steps; I stopped. Try a simpler instruction.';

const isDraftTool = (name: string): name is DraftToolName => name in DRAFT_TOOL_INPUTS;
const isScreenTool = (name: string): name is ScreenToolName => (COPILOT_SCREEN_TOOLS as string[]).includes(name);

/** The voice tools minus the `tone` argument: the copilot has no face to set. */
function withoutTone(schema: JsonObjectSchema): JsonObjectSchema {
  const { tone: _tone, ...properties } = schema.properties;
  return { ...schema, properties, ...(schema.required ? { required: schema.required.filter((r) => r !== 'tone') } : {}) };
}

function jsonSchemaOf(schema: z.ZodType): JsonObjectSchema {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
  return { properties: {}, ...rest, type: 'object' } as JsonObjectSchema;
}

export function copilotTools(): ChatTool[] {
  const screen = COPILOT_SCREEN_TOOLS.map((name) => ({ name, description: TOOL_DESCRIPTIONS[name], parameters: withoutTone(toolJsonSchema(name)) }));
  const drafts = DRAFT_TOOL_NAMES.map((name) => ({ name, description: DRAFT_TOOL_DESCRIPTIONS[name], parameters: jsonSchemaOf(DRAFT_TOOL_INPUTS[name]) }));
  return [...screen, ...drafts].map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters as unknown as Record<string, unknown> },
  }));
}

/** Public photo URLs the copilot may attach, across all properties. */
function allowedMedia(ctx: AppContext): { label: string; url: string }[] {
  return ctx.content.properties.flatMap((b) =>
    propertyMedia(ctx.config, b).flatMap((m) => (m.url ? [{ label: `${b.property.name} ${m.label.toLowerCase()}`, url: m.url }] : [])),
  );
}

function leadLines(ctx: AppContext, state: SessionState): string[] {
  const { buyer, lead } = state;
  const lines = [`- Buyer: ${buyer.name}, phone ${buyer.phone}, email ${buyer.email}. Call language: ${CALL_LANGUAGE_INFO[state.language].label}.`];
  const known = [lead.purpose && `looking for ${lead.purpose}`, lead.budget && `budget ${lead.budget}`, lead.timeline && `timeline ${lead.timeline}`].filter(Boolean);
  if (known.length) lines.push(`- ${known.join('; ')}.`);
  if (lead.needs.length) lines.push(`- Needs: ${lead.needs.join('; ')}.`);
  if (lead.objections.length) lines.push(`- Objections: ${lead.objections.join('; ')}.`);
  if (state.booking.status === 'confirmed' && state.booking.propertyId) {
    const b = ctx.content.byId[state.booking.propertyId];
    const slot = b?.visits.find((s) => s.id === state.booking.slotId);
    lines.push(`- Site visit booked${b ? ` at ${b.property.name}` : ''}${slot ? ` for ${describeSlot(slot)}` : ''}.`);
  }
  const notes = state.consult.notes;
  if (notes?.summary.trim()) lines.push(`- Consult so far: ${notes.summary.trim()}`);
  for (const p of notes?.promises ?? []) lines.push(`- Promised: ${p.text}${p.needsApproval ? ' (needs manager approval)' : ''}.`);
  return lines;
}

/** The copilot's brief. Sent with the live SCREEN line on every model call. */
export function buildCopilotBrief(ctx: AppContext, state: SessionState): string {
  const buyer = firstName(state.buyer.name);
  const humanName = state.handoff.humanName?.trim() || null;
  const advisor = humanName ?? 'the advisor';
  const signOff = humanName ? firstName(humanName) : 'the Agora Virtual Estates team';
  const origin = ctx.config.WEB_ORIGIN.replace(/\/+$/, '');
  const links = [
    `- ${buyer}'s call summary page: ${origin}${callSummaryPath(state.id)}`,
    ...ctx.content.properties.map((b) => `- ${b.property.name} map pin: ${mapsPinUrl(b.property.location)}`),
  ];
  const media = allowedMedia(ctx);
  const photos = media.length ? media.map((m) => `- ${m.label}: ${m.url}`) : [`- None. ${mediaUnavailableReason(ctx.config) ?? 'No photos are available.'} Send text only and say so.`];
  const catalogue = ctx.content.properties.map((b) => `- ${b.property.id}: ${b.property.name}, ${b.property.configuration} for ${b.property.kind === 'sale' ? 'sale' : 'lease'} in ${b.property.localityName}`);

  return `You are the copilot of ${advisor}, a human sales advisor at Agora Virtual Estates in Bengaluru, on a live call with the buyer ${state.buyer.name}. ${humanName ?? 'The advisor'} types instructions; you carry them out on ${buyer}'s screen and in the team's tools.

Rules
- You never talk to ${buyer}: nothing you write is shown or spoken to them. Reply to ${advisor} only, in one short plain English line (at most 20 words) saying what you did or what is ready to review. No markdown.
- Do what was asked with the fewest tool calls. Never add steps nobody asked for. Change the screen once per instruction.
- Screen tools change what ${buyer} sees at once. The instruction is the yes: for applyOffer and bookSiteVisit set confirmed true.
- Nothing leaves the app from you. draftWhatsApp, draftEmail, draftJiraTask, draftSlackPost and draftRecap only prepare a preview that ${advisor} checks and sends. Say it is ready to review, never that it was sent.
- Messages to ${buyer} are warm, short, plain text, signed by ${signOff}. Slack posts and Jira tasks are for the team: factual, with ${buyer}'s full name and the property.
- Facts come only from tool results, the SCREEN line and the lead facts below. For prices or EMI in a message, call showMoney first and copy its figures exactly. For a recap or summary of the call, use draftRecap.
- "jira:" means draftJiraTask; "slack:" or "tell the team" means draftSlackPost.
- If an instruction is unclear or not possible, do nothing and say why in one line.

Lead
${leadLines(ctx, state).join('\n')}

Links for messages
${links.join('\n')}

Photos for draftWhatsApp mediaUrl (use these exact URLs, no others)
${photos.join('\n')}

Properties
${catalogue.join('\n')}`;
}

export function buildCopilotMessages(ctx: AppContext, state: SessionState): Msg[] {
  return [
    { role: 'system', content: buildCopilotBrief(ctx, state) },
    { role: 'system', content: buildScreenLine(ctx, state) },
  ];
}

function stepSummary(name: ScreenToolName, result: ToolResult): string {
  if (!result.ok) return result.error;
  if (OFF_SCREEN_TOOLS.has(name)) return STEP_VERBS[name];
  const where = [result.screen.propertyName, result.screen.detail ?? VIEW_LABELS[result.screen.view]].filter(Boolean).join(' · ');
  return where ? `${STEP_VERBS[name]}: ${where}` : STEP_VERBS[name];
}

/** A line for the admin when the model answered with tool calls only. */
function fallbackReply(steps: CopilotStep[], previews: OutboundPreview[]): string {
  if (previews.length) return `Ready to review: ${previews.length} ${previews.length === 1 ? 'message' : 'messages'}.`;
  if (steps.some((s) => s.ok)) return 'Done.';
  return steps.length ? 'That did not work; see the steps.' : 'Nothing to do for that.';
}

export interface CopilotOptions {
  /** Replace the OpenAI call (tests). */
  create?: ChatCreate | null;
  deps?: Partial<ToolDeps>;
  log?: ToolLogger;
}

interface Executed {
  text: string;
  step: CopilotStep;
  preview?: OutboundPreview;
}

export class Copilot {
  private readonly histories = new Map<string, Msg[]>();
  private readonly busy = new Set<string>();
  private readonly create: ChatCreate | null;
  private readonly log: ToolLogger;

  constructor(
    private readonly app: AppContext,
    private readonly opts: CopilotOptions = {},
  ) {
    this.log = opts.log ?? SILENT_LOGGER;
    this.create = opts.create !== undefined ? opts.create : openAiChat(app.config);
  }

  get available(): boolean {
    return this.create !== null;
  }

  isBusy(sessionId: string): boolean {
    return this.busy.has(sessionId);
  }

  reset(sessionId: string): void {
    this.histories.delete(sessionId);
  }

  /** Runs one instruction. One at a time per session: a second one while busy is refused (409). */
  async run(sessionId: string, command: string, signal?: AbortSignal): Promise<CopilotResult> {
    const create = this.create;
    if (!create) throw new SimError(NO_KEY, 503);
    const state = this.app.store.get(sessionId);
    if (!state) throw new SimError(GONE, 404);
    if (state.status === 'ended') throw new SimError('This call has ended.', 409);
    if (this.busy.has(sessionId)) throw new SimError(BUSY, 409);
    this.busy.add(sessionId);

    const steps: CopilotStep[] = [];
    const previews: OutboundPreview[] = [];
    const history = this.histories.get(sessionId) ?? [];
    history.push({ role: 'user', content: command });
    try {
      const reply = await runToolLoop({
        create,
        model: this.app.config.LLM_MODEL,
        temperature: COPILOT_TEMPERATURE,
        reasoningEffort: this.app.config.LLM_REASONING_EFFORT,
        system: () => {
          const current = this.app.store.get(sessionId);
          if (!current) throw new SimError(GONE, 404);
          return buildCopilotMessages(this.app, current);
        },
        history,
        tools: copilotTools(),
        maxRounds: COPILOT_MAX_TOOL_ROUNDS,
        signal,
        execute: async (call) => {
          const done = await this.execute(sessionId, call);
          steps.push(done.step);
          if (done.preview) previews.push(done.preview);
          return done.text;
        },
      });
      if (reply === null) history.push({ role: 'assistant', content: ROUNDS_EXHAUSTED });
      const text = reply === null ? ROUNDS_EXHAUSTED : reply.trim() || fallbackReply(steps, previews);
      this.log.info({ sessionId, steps: steps.map((s) => `${s.name}:${s.ok ? 'ok' : 'fail'}`), previews: previews.length }, 'copilot instruction');
      return { reply: text, steps, previews };
    } catch (err) {
      if (err instanceof SimError) throw err;
      const message = err instanceof OpenAI.APIError ? `OpenAI error ${err.status ?? ''}: ${err.message}` : (err as Error).message;
      this.log.error({ sessionId, err: message }, 'copilot instruction failed');
      throw new SimError(message, 502);
    } finally {
      this.histories.set(sessionId, trimHistory(history, COPILOT_MAX_HISTORY));
      this.busy.delete(sessionId);
    }
  }

  private refusal(sessionId: string, name: string, error: string, hint?: string): Executed {
    const state = this.app.store.get(sessionId);
    const result: ToolResult = { ok: false, error, ...(hint ? { hint } : {}), screen: state ? screenSnapshot(this.app.content, state) : EMPTY_SCREEN };
    return { text: resultText(result), step: { name, ok: false, summary: error } };
  }

  private async execute(sessionId: string, call: ToolLoopCall): Promise<Executed> {
    const { name, args } = call;
    if (!args.ok) {
      const result = invalidArgsResult(this.app, sessionId);
      return { text: resultText(result), step: { name, ok: false, summary: result.ok ? '' : result.error } };
    }
    if (isDraftTool(name)) return this.draft(sessionId, name, args.value);
    if (!isScreenTool(name)) return this.refusal(sessionId, name, `There is no tool called "${name}".`, `Use one of: ${[...COPILOT_SCREEN_TOOLS, ...DRAFT_TOOL_NAMES].join(', ')}.`);
    const input = args.value && typeof args.value === 'object' ? { ...(args.value as Record<string, unknown>) } : {};
    delete input.tone;
    const result = await runTool(this.app, sessionId, name, input, { source: 'advisor', via: 'copilot', log: this.log, deps: this.opts.deps });
    return { text: resultText(result), step: { name, ok: result.ok, summary: stepSummary(name, result) } };
  }

  /** Validates a draft tool call and stores it as a preview. Nothing is sent. */
  private draft(sessionId: string, name: DraftToolName, raw: unknown): Executed {
    const draft = this.toDraft(name, raw ?? {});
    if (typeof draft === 'string') return this.refusal(sessionId, name, draft, 'Fix the arguments and call the tool again.');
    const preview = createPreview(deskFor(this.app), sessionId, draft);
    if (!preview) return this.refusal(sessionId, name, GONE);
    const summary = `${DRAFT_NOUNS[name]} to ${preview.to} ready to review`;
    const text = JSON.stringify({ ok: true, data: { previewId: preview.id, channel: preview.channel, to: preview.to, status: 'Waiting for the advisor to review and send it' } });
    return { text, step: { name, ok: true, summary }, preview };
  }

  /** The draft for a tool call, or why it does not fit. */
  private toDraft(name: DraftToolName, raw: unknown): OutboundDraft | string {
    const base = { mediaUrl: null, dueInDays: null, purpose: 'manual', nextStepId: null } as const;
    const issues = (e: z.ZodError) => `Those arguments did not fit: ${e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}.`;
    switch (name) {
      case 'draftWhatsApp': {
        const p = DRAFT_TOOL_INPUTS.draftWhatsApp.safeParse(raw);
        if (!p.success) return issues(p.error);
        if (p.data.mediaUrl && !allowedMedia(this.app).some((m) => m.url === p.data.mediaUrl)) {
          return mediaUnavailableReason(this.app.config) ?? 'That photo URL is not one of the listed photos; use a URL from the Photos list exactly.';
        }
        return { ...base, channel: 'whatsapp', subject: null, text: p.data.text, mediaUrl: p.data.mediaUrl ?? null };
      }
      case 'draftEmail': {
        const p = DRAFT_TOOL_INPUTS.draftEmail.safeParse(raw);
        return p.success ? { ...base, channel: 'email', subject: p.data.subject, text: p.data.text } : issues(p.error);
      }
      case 'draftJiraTask': {
        const p = DRAFT_TOOL_INPUTS.draftJiraTask.safeParse(raw);
        if (!p.success) return issues(p.error);
        return { ...base, channel: 'jira', subject: p.data.summary, text: p.data.description.trim() || p.data.summary, dueInDays: p.data.dueInDays ?? null };
      }
      case 'draftSlackPost': {
        const p = DRAFT_TOOL_INPUTS.draftSlackPost.safeParse(raw);
        return p.success ? { ...base, channel: 'slack', subject: null, text: p.data.text } : issues(p.error);
      }
      case 'draftRecap': {
        const p = DRAFT_TOOL_INPUTS.draftRecap.safeParse(raw);
        // The preview fills in the recap's own subject and text.
        return p.success ? { ...base, channel: p.data.channel, subject: null, text: 'Call recap', purpose: 'recap' } : issues(p.error);
      }
    }
  }
}

const CopilotBody = CopilotRequestSchema.extend({
  /** A live-notes next step of kind "view" this command came from; marked done once it ran. */
  nextStepId: z.string().trim().min(1).max(120).optional(),
});

/** POST /api/sessions/:id/copilot: one admin instruction, run against the live call. */
export const copilotRoutes: FastifyPluginAsync<CopilotOptions> = async (app, opts) => {
  const copilot = new Copilot(app.ctx, { log: app.log, create: opts.create, deps: opts.deps });

  // A finished call's instructions are of no use to the next one.
  const onChange = (state: SessionState, action: SessionAction) => {
    if (action.type === 'set_status' && state.status === 'ended') copilot.reset(state.id);
  };
  app.ctx.store.on('change', onChange);
  app.addHook('onClose', async () => {
    app.ctx.store.off('change', onChange);
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/copilot', async (req, reply) => {
    const parsed = CopilotBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Type an instruction for the copilot.' });
    const { id } = req.params;
    try {
      const result = await copilot.run(id, parsed.data.command);
      if (parsed.data.nextStepId && result.steps.some((s) => s.ok)) markNextStepDone(deskFor(app.ctx), id, parsed.data.nextStepId, VIEW_STEP_DONE_REF);
      return result;
    } catch (err) {
      if (err instanceof SimError) return reply.code(err.status).send({ error: err.message });
      req.log.error({ sessionId: id, err: (err as Error).message }, 'copilot failed');
      return reply.code(500).send({ error: 'The copilot failed. Check the server log.' });
    }
  });
};
