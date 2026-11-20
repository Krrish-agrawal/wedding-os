import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { z } from 'zod';
import {
  CALL_LANGUAGE_INFO,
  ConsultActionSchema,
  VIEW_LABELS,
  formatDateTimeIST,
  type ActionSource,
  type ConsultAction,
  type ConsultNextStep,
  type ConsultNotes,
  type Content,
  type SessionAction,
  type SessionState,
  type TranscriptLine,
} from '@ave/shared';
import type { Config } from '../config.js';
import type { SessionStore } from '../sessions/store.js';
import type { DeskLogger } from './runtime.js';

/**
 * The scribe: while a human advisor is on the call, it rewrites the consult notes (summary, what the buyer
 * asked, what the human promised, objections, next steps with one-click actions) from the conversation so
 * far. It runs on new final lines, at most once every SCRIBE_MIN_GAP_MS and never twice at once, and a model
 * failure only keeps the last notes and shows a short error: the call itself never depends on it.
 */

/** New lines are collected for this long before the notes are rewritten, and runs are at least this far apart. */
export const SCRIBE_MIN_GAP_MS = 6000;
/** A notes update that takes longer than this is abandoned; the last notes stay. */
const SCRIBE_TIMEOUT_MS = 20_000;
/** Most recent consult lines sent to the model, and their total size. */
const MAX_CONSULT_LINES = 80;
const MAX_CONSULT_CHARS = 9000;
/** Lines from the AI part of the call, just before the human joined, for context. */
const MAX_BEFORE_LINES = 8;
const MAX_LINE_CHARS = 300;
/** Notes stay short enough to read at a glance during a live call. */
const MAX_SUMMARY_CHARS = 500;
const MAX_ITEM_CHARS = 220;
const MAX_QUOTE_CHARS = 160;
const MAX_ITEMS = 6;

export const SCRIBE_MESSAGES = {
  failed: 'Live notes could not update just now; showing the last version.',
  noModel: 'Live notes need OPENAI_API_KEY on the server; the transcript still shows on the Context tab.',
} as const;

/* ------------------------------------------------------------------ */
/* What the model returns                                              */
/* ------------------------------------------------------------------ */

const nullableString = { type: ['string', 'null'] } as const;
const actionVariant = (kind: string, properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: ['kind', ...Object.keys(properties)],
  properties: { kind: { type: 'string', enum: [kind] }, ...properties },
});

/** Strict JSON schema for structured outputs (every field required; optional ones are nullable). */
export const SCRIBE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'buyerAsks', 'promises', 'objections', 'nextSteps'],
  properties: {
    summary: { type: 'string' },
    buyerAsks: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'text', 'quote'], properties: { id: nullableString, text: { type: 'string' }, quote: nullableString } },
    },
    promises: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'quote', 'needsApproval'],
        properties: { id: nullableString, text: { type: 'string' }, quote: nullableString, needsApproval: { type: 'boolean' } },
      },
    },
    objections: { type: 'array', items: { type: 'string' } },
    nextSteps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'action'],
        properties: {
          id: nullableString,
          text: { type: 'string' },
          action: {
            anyOf: [
              { type: 'null' },
              actionVariant('whatsapp', { text: { type: 'string' } }),
              actionVariant('email', { subject: { type: 'string' }, text: { type: 'string' } }),
              actionVariant('jira', { summary: { type: 'string' }, description: nullableString, dueInDays: { type: ['integer', 'null'] } }),
              actionVariant('slack', { text: { type: 'string' } }),
              actionVariant('view', { command: { type: 'string' } }),
            ],
          },
        },
      },
    },
  },
} as const;

const RawItem = z.object({ id: z.string().nullable().optional(), text: z.string(), quote: z.string().nullable().optional() });
const RawNotesSchema = z.object({
  summary: z.string(),
  buyerAsks: z.array(RawItem),
  promises: z.array(RawItem.extend({ needsApproval: z.boolean() })),
  objections: z.array(z.string()),
  nextSteps: z.array(z.object({ id: z.string().nullable().optional(), text: z.string(), action: z.record(z.string(), z.unknown()).nullable().optional() })),
});

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = [
  'You keep live notes for a human sales advisor at a Bengaluru real-estate company while they talk with a buyer on a call. An AI advisor handled the call before the human joined.',
  'Write the notes in plain English. A quote is the speaker\'s own words exactly as in the transcript, in the language they used, under 20 words; null when there is none.',
  'Use only what is in the input. Never invent prices, discounts, dates, documents or promises.',
  'summary: two or three short sentences on where the consult stands.',
  'buyerAsks: what the buyer asked for or still wants answered.',
  'promises: what the human advisor committed to. needsApproval is true when it needs a manager\'s approval (a discount, waiver, price change or special terms) that the advisor has not confirmed on the call.',
  'objections: the buyer\'s concerns or pushback, a few words each.',
  'nextSteps: concrete follow-ups, one for each open promise and each unanswered buyer request (up to 6). Give one an action only when one click would do it: whatsapp (a short message to the buyer), email (subject and text to the buyer), jira (an internal task: summary, optional description, dueInDays), slack (a short post to the sales team), or view (a plain instruction for the buyer\'s screen, e.g. "show the EMI with 1.5 crore down"). Otherwise action is null.',
  'Cover the whole transcript, the last lines included: every request the buyer made and every commitment the human made appears somewhere. Each promise that is not yet done gets a matching next step; a promise to send something (floor plan, location, price sheet, documents) gets a whatsapp or email action that sends or covers it.',
  'Messages to the buyer are warm, short, address them by first name and never promise anything marked as needing approval.',
  'IDs: items in PREVIOUS NOTES have ids. Reuse an id when the item is the same thing (even reworded); use null for a new item. Drop items that no longer apply; keep asks and promises that still stand.',
].join('\n');

const ROLE_NAMES: Record<TranscriptLine['role'], string> = { buyer: 'Buyer', agent: 'AI advisor', human: 'Human advisor' };

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** When the current human advisor joined (the latest `handoff_joined` on the timeline), or null. */
export function consultStartedAt(state: SessionState): number | null {
  return [...state.timeline].reverse().find((e) => e.kind === 'handoff_joined')?.at ?? null;
}

/** Final buyer and human lines since the human joined. */
export function consultLines(state: SessionState): TranscriptLine[] {
  const since = consultStartedAt(state);
  if (since === null) return [];
  return state.transcript.filter((l) => l.final && l.at >= since && l.role !== 'agent' && l.text.trim());
}

/** A few lines on the AI part of the call: who the buyer is, what is on screen, what is already done. */
export function aiPartSummary(state: SessionState, content: Content): string {
  const lines: string[] = [];
  const bundle = state.propertyId ? content.byId[state.propertyId] : undefined;
  lines.push(`Buyer: ${state.buyer.name}. Call language: ${CALL_LANGUAGE_INFO[state.language].label}.`);
  lines.push(`On screen: ${bundle ? `${bundle.property.name} (${bundle.property.configuration}, ${bundle.property.localityName}), ` : ''}${VIEW_LABELS[state.view]}.`);
  const f = state.lead;
  const known = [f.purpose && `looking for ${f.purpose}`, f.budget && `budget ${f.budget}`, f.timeline && `timeline ${f.timeline}`, f.needs.length && `needs: ${f.needs.join(', ')}`].filter(Boolean);
  if (known.length) lines.push(`Known: ${known.join('; ')}.`);
  if (f.objections.length || f.concerns.length) lines.push(`Raised with the AI: ${[...f.objections, ...f.concerns].join('; ')}.`);
  if (state.booking.status === 'confirmed' && state.booking.propertyId) {
    const b = content.byId[state.booking.propertyId];
    const slot = b?.visits.find((s) => s.id === state.booking.slotId);
    lines.push(`Site visit booked${b ? ` at ${b.property.name}` : ''}${slot ? ` for ${formatDateTimeIST(slot.start)}` : ''}.`);
  }
  if (state.handoff.reason) lines.push(`Why the buyer asked for a person: ${state.handoff.reason}.`);
  const since = consultStartedAt(state);
  const before = state.transcript.filter((l) => l.final && l.text.trim() && (since === null || l.at < since)).slice(-MAX_BEFORE_LINES);
  if (before.length) {
    lines.push('Last lines before the human joined:');
    for (const l of before) lines.push(`${ROLE_NAMES[l.role]}: ${clip(l.text, MAX_LINE_CHARS)}`);
  }
  return lines.join('\n');
}

function consultTranscript(state: SessionState): string {
  const human = state.handoff.humanName ?? 'Human advisor';
  const text = consultLines(state)
    .slice(-MAX_CONSULT_LINES)
    .map((l) => `${l.role === 'human' ? `${human} (human advisor)` : 'Buyer'}: ${clip(l.text, MAX_LINE_CHARS)}`)
    .join('\n');
  return text.length > MAX_CONSULT_CHARS ? text.slice(text.length - MAX_CONSULT_CHARS) : text;
}

export interface ScribeInput {
  system: string;
  user: string;
}

export function buildScribePrompt(state: SessionState, content: Content): ScribeInput {
  const admin = state.consult.adminNotes.map((n) => `- ${n.by ? `${n.by}: ` : ''}${clip(n.text, MAX_LINE_CHARS)}`).join('\n');
  const user = [
    `CALL SO FAR:\n${aiPartSummary(state, content)}`,
    `CONSULT TRANSCRIPT:\n${consultTranscript(state) || '(nothing yet)'}`,
    `ADMIN NOTES (typed by the human advisor):\n${admin || '(none)'}`,
    `PREVIOUS NOTES:\n${state.consult.notes ? JSON.stringify(state.consult.notes) : '(none yet)'}`,
  ].join('\n\n');
  return { system: SYSTEM_PROMPT, user };
}

/* ------------------------------------------------------------------ */
/* Normalising the model's answer                                      */
/* ------------------------------------------------------------------ */

/** Turns the model's action into the shared contract, or null when it does not fit (never a broken button). */
function toAction(raw: Record<string, unknown> | null | undefined): ConsultAction | null {
  if (!raw) return null;
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
  const parsed = ConsultActionSchema.safeParse(cleaned);
  return parsed.success ? parsed.data : null;
}

/**
 * Validates and tidies the model's notes. Ids of items the model kept are reused (so the Desk only flashes
 * what is new); new items get fresh ids. Next steps the admin already ran keep their `doneRef`, and a done
 * step the model dropped is kept, because it records something that happened.
 */
export function normaliseNotes(raw: unknown, previous: ConsultNotes | null, newId: () => string = randomUUID): ConsultNotes {
  const parsed = RawNotesSchema.parse(raw);
  const pick = <T extends { id: string }>(prevItems: readonly T[]) => {
    const known = new Set(prevItems.map((i) => i.id));
    const used = new Set<string>();
    return (id: string | null | undefined): string => {
      const keep = id && known.has(id) && !used.has(id) ? id : newId();
      used.add(keep);
      return keep;
    };
  };
  const quote = (q: string | null | undefined) => (q && q.trim() ? clip(q, MAX_QUOTE_CHARS) : null);
  const text = (t: string) => clip(t, MAX_ITEM_CHARS);

  const askId = pick(previous?.buyerAsks ?? []);
  const promiseId = pick(previous?.promises ?? []);
  const stepId = pick(previous?.nextSteps ?? []);
  const prevSteps = new Map((previous?.nextSteps ?? []).map((s) => [s.id, s]));

  // Lists are built in display order so new ids are handed out in that order too.
  const buyerAsks = parsed.buyerAsks
    .filter((i) => i.text.trim())
    .slice(0, MAX_ITEMS)
    .map((i) => ({ id: askId(i.id), text: text(i.text), quote: quote(i.quote) }));
  const promises = parsed.promises
    .filter((i) => i.text.trim())
    .slice(0, MAX_ITEMS)
    .map((i) => ({ id: promiseId(i.id), text: text(i.text), quote: quote(i.quote), needsApproval: i.needsApproval }));
  const nextSteps: ConsultNextStep[] = parsed.nextSteps
    .filter((s) => s.text.trim())
    .slice(0, MAX_ITEMS)
    .map((s) => {
      const id = stepId(s.id);
      const before = prevSteps.get(id);
      return { id, text: text(s.text), action: before?.doneRef ? before.action : toAction(s.action), doneRef: before?.doneRef ?? null };
    });
  for (const s of previous?.nextSteps ?? []) if (s.doneRef && !nextSteps.some((n) => n.id === s.id)) nextSteps.push(s);

  return {
    summary: clip(parsed.summary, MAX_SUMMARY_CHARS),
    buyerAsks,
    promises,
    objections: [...new Set(parsed.objections.map((o) => text(o)).filter(Boolean))].slice(0, MAX_ITEMS),
    nextSteps,
  };
}

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

/** Returns the model's JSON answer (already parsed). Throws on any failure. */
export type ScribeModel = (input: ScribeInput) => Promise<unknown>;

/** Chat completions with a strict JSON-schema response. Null when OPENAI_API_KEY is not set. */
export function createOpenAiScribeModel(config: Pick<Config, 'OPENAI_API_KEY' | 'CONSULT_MODEL'>): ScribeModel | null {
  if (!config.OPENAI_API_KEY) return null;
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: SCRIBE_TIMEOUT_MS, maxRetries: 0 });
  return async ({ system, user }) => {
    const completion = await client.chat.completions.create({
      model: config.CONSULT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'consult_notes', strict: true, schema: SCRIBE_JSON_SCHEMA as unknown as Record<string, unknown> } },
    });
    const text = completion.choices[0]?.message.content;
    if (!text) throw new Error('the model returned no notes');
    return JSON.parse(text) as unknown;
  };
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

export interface ConsultScribeDeps {
  store: SessionStore;
  content: Content;
  /** Null when no model is configured: the notes panel says so once. */
  model: ScribeModel | null;
  log: DeskLogger;
  now?: () => number;
  minGapMs?: number;
  newId?: () => string;
}

interface ScribeRun {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  /** Something new arrived since the last run started. */
  dirty: boolean;
  /** The human left the call: one last run for what was said at the end, then stop. */
  closing: boolean;
  /** The panel's error before the scribe replaced it, restored after the next good run. */
  errorBefore: string | null;
}

export class ConsultScribe {
  private readonly runs = new Map<string, ScribeRun>();
  private readonly joined = new Set<string>();
  private readonly now: () => number;
  private readonly minGapMs: number;
  private warnedNoModel = new Set<string>();

  constructor(private readonly deps: ConsultScribeDeps) {
    this.now = deps.now ?? Date.now;
    this.minGapMs = deps.minGapMs ?? SCRIBE_MIN_GAP_MS;
  }

  /** Feed every store change here. */
  onChange(state: SessionState, action: SessionAction, _source?: ActionSource): void {
    const joinedNow = state.status !== 'ended' && state.handoff.status === 'joined';
    const wasJoined = this.joined.has(state.id);
    if (joinedNow) this.joined.add(state.id);
    else this.joined.delete(state.id);

    if (joinedNow) {
      const newLine = action.type === 'add_transcript' && action.line.final && action.line.role !== 'agent' && action.line.text.trim().length > 0;
      if (newLine || action.type === 'add_admin_note') this.mark(state.id);
    } else if (wasJoined) {
      this.close(state.id);
    }
  }

  /** Stops every pending timer (server shutdown). */
  dispose(): void {
    for (const run of this.runs.values()) if (run.timer) clearTimeout(run.timer);
    this.runs.clear();
  }

  private run(sessionId: string): ScribeRun {
    let run = this.runs.get(sessionId);
    if (!run) {
      run = { timer: null, running: false, dirty: false, closing: false, errorBefore: null };
      this.runs.set(sessionId, run);
    }
    return run;
  }

  private mark(sessionId: string): void {
    const run = this.run(sessionId);
    run.dirty = true;
    run.closing = false;
    this.schedule(sessionId, run, this.minGapMs);
  }

  private close(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (!run) return;
    run.closing = true;
    if (run.timer) {
      clearTimeout(run.timer);
      run.timer = null;
    }
    if (run.dirty && !run.running) this.schedule(sessionId, run, 0);
    else if (!run.dirty && !run.running) this.runs.delete(sessionId);
  }

  private schedule(sessionId: string, run: ScribeRun, delayMs: number): void {
    if (run.timer || run.running) return;
    run.timer = setTimeout(() => {
      run.timer = null;
      void this.update(sessionId, run);
    }, delayMs);
  }

  private dispatch(sessionId: string, patch: Partial<SessionState['consult']>): void {
    if (this.deps.store.get(sessionId)) this.deps.store.dispatch(sessionId, { type: 'set_consult', patch }, 'system');
  }

  private async update(sessionId: string, run: ScribeRun): Promise<void> {
    const state = this.deps.store.get(sessionId);
    if (!state) {
      this.runs.delete(sessionId);
      return;
    }
    run.dirty = false;
    const { model, log } = this.deps;
    if (!model) {
      if (!this.warnedNoModel.has(sessionId)) {
        this.warnedNoModel.add(sessionId);
        this.dispatch(sessionId, { error: state.consult.error ? `${state.consult.error} ${SCRIBE_MESSAGES.noModel}` : SCRIBE_MESSAGES.noModel });
      }
      this.finish(sessionId, run);
      return;
    }

    run.running = true;
    const statusBefore = state.consult.status === 'updating' ? 'listening' : state.consult.status;
    this.dispatch(sessionId, { status: 'updating' });
    try {
      const raw = await model(buildScribePrompt(state, this.deps.content));
      const latest = this.deps.store.get(sessionId);
      if (!latest) return;
      const notes = normaliseNotes(raw, latest.consult.notes, this.deps.newId);
      const error = latest.consult.error === SCRIBE_MESSAGES.failed ? run.errorBefore : latest.consult.error;
      this.dispatch(sessionId, { notes, updatedAt: this.now(), error, ...this.settledStatus(latest, statusBefore) });
    } catch (err) {
      log.warn({ sessionId, err: err instanceof Error ? err.message : String(err) }, 'consult notes update failed; keeping the last notes');
      const latest = this.deps.store.get(sessionId);
      if (latest) {
        if (latest.consult.error !== SCRIBE_MESSAGES.failed) run.errorBefore = latest.consult.error;
        this.dispatch(sessionId, { error: SCRIBE_MESSAGES.failed, ...this.settledStatus(latest, statusBefore) });
      }
    } finally {
      run.running = false;
      this.finish(sessionId, run);
    }
  }

  /** Puts `updating` back to what it was, unless something else changed the status meanwhile. */
  private settledStatus(latest: SessionState, statusBefore: SessionState['consult']['status']): Partial<SessionState['consult']> {
    if (latest.consult.status !== 'updating') return {};
    const onCall = latest.status !== 'ended' && latest.handoff.status === 'joined';
    return { status: onCall ? statusBefore : 'idle' };
  }

  private finish(sessionId: string, run: ScribeRun): void {
    if (run.dirty) {
      this.schedule(sessionId, run, run.closing ? 0 : this.minGapMs);
      return;
    }
    if (run.closing) this.runs.delete(sessionId);
  }
}
