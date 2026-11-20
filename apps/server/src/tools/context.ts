import type { FastifyBaseLogger } from 'fastify';
import type { ActionSource, CustomRoute, Delivery, LatLng } from '@ave/shared';
import type { AppContext } from '../context.js';
import type { sendReport as deskSendReport } from '../desk/reports.js';
import type { findRoute as liveFindRoute } from '../maps/live.js';

/** Live route lookup owned by the Maps workstream (`apps/server/src/maps/live.ts`). */
export type FindRoute = (origin: LatLng, query: string, opts?: { signal?: AbortSignal }) => Promise<CustomRoute | null>;

/** Recap delivery owned by the Desk workstream (`apps/server/src/desk/reports.ts`). */
export type SendReport = (ctx: AppContext, sessionId: string, channels: ('email' | 'whatsapp')[]) => Promise<Delivery[]>;

export type ToolLogger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

/** Collaborators a tool may need beyond session state. Injectable so tests and evals stay offline. */
export interface ToolDeps {
  /** Resolves to null when the module or the route is unavailable. */
  findRoute: FindRoute | null;
  sendReport: SendReport | null;
  now: () => number;
  /** Override for how long sendReport waits for delivery results (tests). */
  reportWaitMs?: number;
}

/** Everything one tool call runs against: the app, the session it is bound to, and who caused it. */
export interface ToolContext {
  app: AppContext;
  sessionId: string;
  source: ActionSource;
  deps: ToolDeps;
  log: ToolLogger;
}

// Compile-time check that the modules loaded at runtime below still match these signatures.
type Conforms<T extends true> = T;
export type LiveRouterConforms = Conforms<typeof liveFindRoute extends FindRoute ? true : false>;
export type ReportsConform = Conforms<typeof deskSendReport extends SendReport ? true : false>;

const silentLogger: ToolLogger = { info: () => {}, warn: () => {}, error: () => {} };
export const SILENT_LOGGER = silentLogger;

/**
 * Other workstreams' modules are loaded on first use rather than imported statically, so a missing
 * or half-written file degrades one tool to a spoken "not available" instead of failing server start.
 * The specifiers are relative to this file.
 */
const MAPS_LIVE_MODULE = '../maps/live.js';
const DESK_REPORTS_MODULE = '../desk/reports.js';

async function importFunction<T>(specifier: string, exportName: string, log: ToolLogger): Promise<T | null> {
  try {
    const mod = (await import(specifier)) as Record<string, unknown>;
    const fn = mod[exportName];
    if (typeof fn === 'function') return fn as T;
    log.warn({ specifier, exportName }, 'tool dependency has no such export');
  } catch (err) {
    log.warn({ specifier, err: (err as Error).message }, 'tool dependency unavailable');
  }
  return null;
}

/** Resolves the default collaborators, letting explicit overrides win. */
export async function resolveDeps(overrides: Partial<ToolDeps> | undefined, needs: { findRoute?: boolean; sendReport?: boolean }, log: ToolLogger): Promise<ToolDeps> {
  const findRoute =
    overrides && 'findRoute' in overrides ? overrides.findRoute ?? null : needs.findRoute ? await importFunction<FindRoute>(MAPS_LIVE_MODULE, 'findRoute', log) : null;
  const sendReport =
    overrides && 'sendReport' in overrides ? overrides.sendReport ?? null : needs.sendReport ? await importFunction<SendReport>(DESK_REPORTS_MODULE, 'sendReport', log) : null;
  return { findRoute, sendReport, now: overrides?.now ?? Date.now, ...(overrides?.reportWaitMs !== undefined ? { reportWaitMs: overrides.reportWaitMs } : {}) };
}
