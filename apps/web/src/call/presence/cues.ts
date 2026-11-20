import { ExpressionSchema, type AgentStatus, type Expression, type SessionState, type TimelineEvent } from '@ave/shared';
import type { PresenceState } from './types';

/**
 * Derives the advisor's presence from events the app already has (BUILD_PLAN.md section 5):
 * session state, the timeline, and the Voice workstream's local agent state and interrupt signal.
 * No extra model calls. Pure functions; the React hook in useAdvisorPresence.ts feeds them.
 */

export type EngineState = AgentStatus['state'];

/** Views whose explanations call for a calm, composed manner. */
const COMPOSED_VIEWS = new Set(['money', 'legal']);

/** Timeline kinds that earn an expression. */
const EVENT_EXPRESSIONS: Record<string, Expression> = {
  offer_applied: 'delighted',
  visit_booked: 'delighted',
  handoff_joined: 'nod',
  handoff_returned: 'warm',
};

export function derivePresenceState(session: SessionState | null, local?: EngineState | null): PresenceState {
  if (!session || session.status !== 'live') return 'idle';
  if (session.handoff.status === 'joined' || session.agent.status === 'standby') return 'standby';
  // The local mirror comes straight from the engine, so it counts even before the server has
  // marked the agent live (the greeting can start first).
  const engine = local ?? (session.agent.status === 'live' ? session.agent.state : null);
  if (!engine) return 'idle';
  const toolRunning = session.activity !== null;
  switch (engine) {
    case 'speaking':
      return 'speaking';
    case 'thinking':
      return 'thinking';
    case 'listening':
      return toolRunning ? 'thinking' : 'listening';
    default:
      return toolRunning ? 'thinking' : 'idle';
  }
}

/**
 * A tool result's `expression` (ToolResult in packages/shared/src/tools.ts), if the Tools
 * workstream records it on the timeline event as an optional `expression` field.
 */
function expressionOf(event: TimelineEvent): Expression | null {
  const parsed = ExpressionSchema.safeParse((event as TimelineEvent & { expression?: unknown }).expression);
  return parsed.success ? parsed.data : null;
}

export function expressionForEvent(event: TimelineEvent): Expression | null {
  const explicit = expressionOf(event);
  if (explicit) return explicit;
  const mapped = EVENT_EXPRESSIONS[event.kind];
  if (mapped) return mapped;
  if (event.kind === 'view' && event.view) {
    if (COMPOSED_VIEWS.has(event.view)) return 'composed';
    // The advisor opening a view is "let me show you": an open-hand gesture towards the stage.
    if (event.source === 'agent') return 'pointing';
  }
  return null;
}

/** Where the driver has read the timeline up to: the latest timestamp and the events seen at it. */
export interface TimelineCursor {
  at: number;
  keys: string[];
}

const eventKey = (e: TimelineEvent) => `${e.kind}|${e.label}|${e.source}`;

export function cursorAtEnd(timeline: readonly TimelineEvent[]): TimelineCursor {
  const at = timeline.reduce((max, e) => Math.max(max, e.at), Number.NEGATIVE_INFINITY);
  return { at, keys: timeline.filter((e) => e.at === at).map(eventKey) };
}

/** New timeline events since `cursor`, in order, and the cursor after them. */
export function readTimeline(timeline: readonly TimelineEvent[], cursor: TimelineCursor): { events: TimelineEvent[]; cursor: TimelineCursor } {
  const seen = new Set(cursor.keys);
  const events = timeline.filter((e) => e.at > cursor.at || (e.at === cursor.at && !seen.has(eventKey(e))));
  if (!events.length) return { events, cursor };
  const next = cursorAtEnd(timeline);
  if (next.at === cursor.at) next.keys = [...new Set([...cursor.keys, ...next.keys])];
  return { events, cursor: next };
}

export interface DriverMemory {
  sessionId: string | null;
  cursor: TimelineCursor;
  greeted: boolean;
  agentStatus: AgentStatus['status'] | null;
  interruptedAt: number | null;
}

export interface DriverInput {
  session: SessionState | null;
  state: PresenceState;
  interruptedAt: number | null;
}

export interface DriverStep {
  memory: DriverMemory;
  /** At most one: when several moments land together, the latest wins rather than queueing gestures. */
  expression: Expression | null;
  interrupt: boolean;
}

function startMemory(input: DriverInput): DriverMemory {
  const session = input.session;
  return {
    sessionId: session?.id ?? null,
    // History before presence appeared is not replayed.
    cursor: cursorAtEnd(session?.timeline ?? []),
    // Joining a call already in progress: the greeting has happened.
    greeted: Boolean(session?.transcript.some((l) => l.role === 'agent')) || input.state === 'speaking',
    agentStatus: session?.agent.status ?? null,
    interruptedAt: input.interruptedAt,
  };
}

export function stepDriver(memory: DriverMemory | null, input: DriverInput): DriverStep {
  const session = input.session;
  if (!memory || memory.sessionId !== (session?.id ?? null)) {
    return { memory: startMemory(input), expression: null, interrupt: false };
  }

  const cues: Expression[] = [];
  let greeted = memory.greeted;
  if (!greeted && input.state === 'speaking') {
    greeted = true;
    cues.push('warm');
  }

  const read = readTimeline(session?.timeline ?? [], memory.cursor);
  for (const event of read.events) {
    const e = expressionForEvent(event);
    if (e) cues.push(e);
  }

  const agentStatus = session?.agent.status ?? null;
  if (agentStatus === 'error' && memory.agentStatus !== 'error') cues.push('apologetic');

  const interrupt = input.interruptedAt !== null && input.interruptedAt !== memory.interruptedAt;

  return {
    memory: { sessionId: memory.sessionId, cursor: read.cursor, greeted, agentStatus, interruptedAt: input.interruptedAt },
    // The buyer cutting in outranks any moment that landed in the same update.
    expression: interrupt ? null : (cues.at(-1) ?? null),
    interrupt,
  };
}
