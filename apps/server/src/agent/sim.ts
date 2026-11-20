import OpenAI from 'openai';
import { LLM_TEMPERATURE } from '../voice/joinConfig.js';
import type { ToolResult } from '@ave/shared';
import type { Config } from '../config.js';
import type { AppContext } from '../context.js';
import { SILENT_LOGGER, type ToolDeps, type ToolLogger } from '../tools/context.js';
import { resultText, runTool } from '../tools/runner.js';
import { toolDefinitions } from '../tools/schema.js';
import { buildGreeting, buildSystemMessages } from './prompt.js';

/**
 * Simulated advisor: the real brief, screen line and tool definitions against OpenAI chat completions,
 * with tool calls executed locally against the session. No voice. Used by the Studio chat and the evals.
 */

export type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;
type CreateBody = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type Completion = OpenAI.Chat.Completions.ChatCompletion;

/** Rounds of tool calls allowed before the model must answer in words. */
export const SIM_MAX_TOOL_ROUNDS = 6;
/** Mirrors the engine's `llm.max_history` so the simulator sees roughly what the live advisor sees. */
export const SIM_MAX_HISTORY = 32;
const SIM_REQUEST_TIMEOUT_MS = 30_000;
const SIM_MAX_RETRIES = 1;
const ROUNDS_EXHAUSTED_REPLY = 'Sorry, give me a moment. Could you ask that again?';

/** The one OpenAI call the simulator makes; injectable for offline tests. */
export type ChatCreate = (body: CreateBody, opts?: { signal?: AbortSignal }) => Promise<Completion>;

export interface SimToolCall {
  name: string;
  args: unknown;
  result: ToolResult;
  ms: number;
}

export interface SimTurn {
  reply: string;
  toolCalls: SimToolCall[];
  ms: number;
  model: string;
  /** The advisor's greeting, on the first turn of a conversation only. */
  greeting?: string;
}

export class SimError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface SimOptions {
  deps?: Partial<ToolDeps>;
  log?: ToolLogger;
  /** Write buyer and advisor lines into the session transcript, as a live call would. */
  recordTranscript?: boolean;
  create?: ChatCreate;
}

export function openAiTools(): ChatTool[] {
  return toolDefinitions().map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters as unknown as Record<string, unknown> },
  }));
}

/** The OpenAI chat call for this server's key, or null when no key is configured. */
export function openAiChat(config: Pick<Config, 'OPENAI_API_KEY'>): ChatCreate | null {
  const key = config.OPENAI_API_KEY;
  if (!key) return null;
  const client = new OpenAI({ apiKey: key, timeout: SIM_REQUEST_TIMEOUT_MS, maxRetries: SIM_MAX_RETRIES });
  return (body: CreateBody, o?: { signal?: AbortSignal }) => client.chat.completions.create(body, o);
}

export function trimHistory(history: Msg[], max: number): Msg[] {
  if (history.length <= max) return history;
  // Cut at a user message so no tool result is left without the call that produced it.
  let start = history.length - max;
  while (start < history.length && history[start]!.role !== 'user') start++;
  return start < history.length ? history.slice(start) : history.slice(-1);
}

export type ParsedArgs = { ok: true; value: unknown } | { ok: false };

export function parseArgs(raw: string): ParsedArgs {
  try {
    return { ok: true, value: raw.trim() ? (JSON.parse(raw) as unknown) : {} };
  } catch {
    return { ok: false };
  }
}

export interface ToolLoopCall {
  name: string;
  /** The arguments as the model sent them. */
  raw: string;
  args: ParsedArgs;
}

export interface ToolLoopOptions {
  create: ChatCreate;
  model: string;
  temperature: number;
  reasoningEffort?: Config['LLM_REASONING_EFFORT'];
  /** System messages for each model call, rebuilt every round so the screen line stays current. May throw to stop. */
  system: () => Msg[];
  /** The conversation so far. The loop appends the model's messages and the tool results to it. */
  history: Msg[];
  tools: ChatTool[];
  maxRounds: number;
  signal?: AbortSignal;
  /** Runs one tool call and returns the text the model sees as its result. */
  execute: (call: ToolLoopCall) => Promise<string>;
}

/**
 * Chat completions with tool calls, executed one after another, until the model answers in words.
 * Shared by the simulated advisor and the Desk copilot. Returns null when the model was still calling
 * tools after `maxRounds`; errors from the model call propagate to the caller.
 */
export async function runToolLoop(o: ToolLoopOptions): Promise<string | null> {
  for (let round = 0; round < o.maxRounds; round++) {
    const messages = [...o.system(), ...o.history];
    const completion = await o.create(
      { model: o.model, messages, tools: o.tools, tool_choice: 'auto', temperature: o.temperature, ...(o.reasoningEffort ? { reasoning_effort: o.reasoningEffort } : {}) },
      { signal: o.signal },
    );
    const msg = completion.choices[0]?.message;
    if (!msg) throw new SimError('The model returned no message.', 502);
    const calls = (msg.tool_calls ?? []).filter((c) => c.type === 'function');
    o.history.push({ role: 'assistant', content: msg.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (calls.length === 0) return msg.content ?? '';
    for (const call of calls) {
      const content = await o.execute({ name: call.function.name, raw: call.function.arguments, args: parseArgs(call.function.arguments) });
      o.history.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }
  return null;
}

/** What the model sees when its tool arguments were not JSON, so it can correct itself. */
export function invalidArgsResult(app: AppContext, sessionId: string): ToolResult {
  const state = app.store.get(sessionId);
  return {
    ok: false,
    error: 'The arguments were not valid JSON.',
    hint: 'Call the tool again with valid JSON arguments.',
    screen: { propertyId: state?.propertyId ?? null, propertyName: null, view: state?.view ?? 'shortlist', detail: null },
  };
}

export class SimAdvisor {
  private readonly histories = new Map<string, Msg[]>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly create: ChatCreate | null;
  private readonly log: ToolLogger;
  private lineSeq = 0;

  constructor(
    private readonly app: AppContext,
    private readonly opts: SimOptions = {},
  ) {
    this.log = opts.log ?? SILENT_LOGGER;
    this.create = opts.create ?? openAiChat(app.config);
  }

  get available(): boolean {
    return this.create !== null;
  }

  reset(sessionId: string): void {
    this.histories.delete(sessionId);
  }

  /** One buyer turn. Turns for the same session run one at a time. */
  chat(sessionId: string, text: string, signal?: AbortSignal): Promise<SimTurn> {
    const prev = this.queues.get(sessionId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.turn(sessionId, text, signal));
    this.queues.set(sessionId, next);
    return next.finally(() => {
      if (this.queues.get(sessionId) === next) this.queues.delete(sessionId);
    });
  }

  private transcript(sessionId: string, role: 'buyer' | 'agent', text: string): void {
    if (!this.opts.recordTranscript || !text.trim()) return;
    const at = Date.now();
    this.lineSeq += 1;
    this.app.store.dispatch(sessionId, { type: 'add_transcript', line: { id: `sim-${at}-${this.lineSeq}`, role, text, final: true, at } }, role === 'buyer' ? 'buyer' : 'agent');
  }

  private async turn(sessionId: string, text: string, signal?: AbortSignal): Promise<SimTurn> {
    const started = performance.now();
    const create = this.create;
    if (!create) throw new SimError('OPENAI_API_KEY is not set on the server. Add it to .env and restart the API to use the simulated advisor.', 503);
    const initial = this.app.store.get(sessionId);
    if (!initial) throw new SimError('Session not found', 404);

    let history = this.histories.get(sessionId);
    let greeting: string | undefined;
    if (!history) {
      greeting = buildGreeting(this.app, initial);
      history = [{ role: 'assistant', content: greeting }];
      this.transcript(sessionId, 'agent', greeting);
    }
    history.push({ role: 'user', content: text });
    this.transcript(sessionId, 'buyer', text);

    const model = this.app.config.LLM_MODEL;
    const tools = openAiTools();
    const toolCalls: SimToolCall[] = [];
    let reply: string | null = null;

    try {
      reply = await runToolLoop({
        create,
        model,
        temperature: LLM_TEMPERATURE,
        reasoningEffort: this.app.config.LLM_REASONING_EFFORT,
        system: () => {
          const state = this.app.store.get(sessionId);
          if (!state) throw new SimError('Session not found', 404);
          return buildSystemMessages(this.app, state);
        },
        history,
        tools,
        maxRounds: SIM_MAX_TOOL_ROUNDS,
        signal,
        execute: async ({ name, raw, args }) => {
          const t0 = performance.now();
          const result: ToolResult = args.ok
            ? await runTool(this.app, sessionId, name, args.value, { source: 'agent', via: 'sim', log: this.log, deps: this.opts.deps })
            : invalidArgsResult(this.app, sessionId);
          toolCalls.push({ name, args: args.ok ? args.value : raw, result, ms: Math.round((performance.now() - t0) * 10) / 10 });
          return resultText(result);
        },
      });
    } catch (err) {
      if (err instanceof SimError) throw err;
      const message = err instanceof OpenAI.APIError ? `OpenAI error ${err.status ?? ''}: ${err.message}` : (err as Error).message;
      this.log.error({ sessionId, err: message }, 'sim turn failed');
      throw new SimError(message, 502);
    } finally {
      this.histories.set(sessionId, trimHistory(history, SIM_MAX_HISTORY));
    }

    if (reply === null) {
      reply = ROUNDS_EXHAUSTED_REPLY;
      history.push({ role: 'assistant', content: reply });
      this.histories.set(sessionId, trimHistory(history, SIM_MAX_HISTORY));
    }
    this.transcript(sessionId, 'agent', reply);
    return { reply, toolCalls, ms: Math.round(performance.now() - started), model, ...(greeting ? { greeting } : {}) };
  }
}
