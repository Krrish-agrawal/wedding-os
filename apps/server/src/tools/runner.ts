import { EventEmitter } from 'node:events';
import { TOOL_ACTIVITY, TOOL_INPUTS, TOOL_NAMES, type ActionSource, type ToolName, type ToolResult } from '@ave/shared';
import type { AppContext } from '../context.js';
import { SILENT_LOGGER, resolveDeps, type ToolContext, type ToolDeps, type ToolLogger } from './context.js';
import { TOOL_IMPLS, type ToolImpl } from './impl/index.js';
import { EMPTY_SCREEN, screenSnapshot } from './screen.js';

/** Only show the activity strip when a tool is actually slow; fast tools would just flicker it. */
export const ACTIVITY_DELAY_MS = 150;

export interface RunOptions {
  source?: ActionSource;
  deps?: Partial<ToolDeps>;
  log?: ToolLogger;
  /** Which adapter called, for logs: mcp, http, director, sim. */
  via?: string;
}

export interface ToolCallEvent {
  sessionId: string;
  name: string;
  input: unknown;
  result: ToolResult;
  ms: number;
  source: ActionSource;
  via: string;
}

/** In-process feed of every tool call, for logging, metrics or presence hooks. */
export const toolEvents = new EventEmitter<{ call: [ToolCallEvent] }>();

const NAME_SET = new Set<string>(TOOL_NAMES);
export function isToolName(name: string): name is ToolName {
  return NAME_SET.has(name);
}

function snapshot(app: AppContext, sessionId: string) {
  const state = app.store.get(sessionId);
  return state ? screenSnapshot(app.content, state) : EMPTY_SCREEN;
}

function failure(app: AppContext, sessionId: string, error: string, hint?: string): ToolResult {
  return { ok: false, error, ...(hint ? { hint } : {}), screen: snapshot(app, sessionId), expression: 'apologetic' };
}

/**
 * Runs one tool for one session: validates the input, runs the implementation, keeps the activity strip
 * honest, and turns any unexpected error into a result the advisor can speak about. Never throws.
 */
export async function runTool(app: AppContext, sessionId: string, name: string, rawInput: unknown, opts: RunOptions = {}): Promise<ToolResult> {
  const started = performance.now();
  const log = opts.log ?? SILENT_LOGGER;
  const source = opts.source ?? 'agent';
  const via = opts.via ?? 'direct';
  let result: ToolResult;
  let activitySet = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    if (!isToolName(name)) {
      result = failure(app, sessionId, `There is no tool called "${name}".`, `Use one of: ${TOOL_NAMES.join(', ')}.`);
    } else if (!app.store.get(sessionId)) {
      result = failure(app, sessionId, 'This call has ended.', 'Apologise and say goodbye.');
    } else {
      const parsed = TOOL_INPUTS[name].safeParse(rawInput ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
        result = failure(app, sessionId, `Those arguments did not fit: ${issues}.`, 'Fix the arguments and call the tool again.');
      } else {
        const deps = await resolveDeps(opts.deps, { findRoute: name === 'showCommute', sendReport: name === 'sendReport' }, log);
        const tc: ToolContext = { app, sessionId, source, deps, log };
        const label = TOOL_ACTIVITY[name];
        if (label) {
          timer = setTimeout(() => {
            activitySet = true;
            app.store.dispatch(sessionId, { type: 'set_activity', label }, source);
          }, ACTIVITY_DELAY_MS);
        }
        result = await (TOOL_IMPLS[name] as ToolImpl<ToolName>)(tc, parsed.data);
      }
    }
  } catch (err) {
    log.error({ sessionId, tool: name, err: (err as Error).message, stack: (err as Error).stack }, 'tool threw');
    result = failure(app, sessionId, 'Something went wrong on my side.', 'Apologise briefly and offer to try again or to bring in a senior advisor.');
  } finally {
    clearTimeout(timer);
    if (activitySet) app.store.dispatch(sessionId, { type: 'set_activity', label: null }, source);
  }

  const ms = Math.round((performance.now() - started) * 10) / 10;
  log.info({ sessionId, tool: name, via, ok: result.ok, ms, ...(result.ok ? {} : { error: result.error }) }, 'tool call');
  toolEvents.emit('call', { sessionId, name, input: rawInput, result, ms, source, via });
  // Let the on-screen advisor react: the presence driver reads `expression` from timeline events.
  if (result.expression) {
    app.store.dispatch(sessionId, { type: 'note', kind: 'expression', label: name, expression: result.expression }, source);
  }
  return result;
}

/** Compact JSON for the model: no whitespace. */
export function resultText(result: ToolResult): string {
  return JSON.stringify(result);
}
