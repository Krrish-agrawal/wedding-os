import type { PropertyBundle, ToolResult } from '@ave/shared';
import { features, loadConfig } from '../config.js';
import { loadContent } from '../content.js';
import type { AppContext } from '../context.js';
import { SessionStore } from '../sessions/store.js';
import type { ToolDeps } from './context.js';
import { runTool } from './runner.js';

/** Helpers for tool tests: real content, a fresh store, a fixed clock, and no network. */

/** 20 November 2026, 10:30 AM in Bengaluru. */
export const TEST_NOW = Date.UTC(2026, 10, 20, 5, 0, 0);

export async function toolTestContext(env: Record<string, string> = {}): Promise<AppContext> {
  const config = loadConfig(env);
  return { config, features: features(config), content: await loadContent(), store: new SessionStore(() => TEST_NOW) };
}

export function newSession(ctx: AppContext, name = 'Priya Sharma'): string {
  return ctx.store.create({ name, phone: '9000000000', email: 'buyer@example.com' }).id;
}

export const offlineDeps: Partial<ToolDeps> = { findRoute: null, sendReport: null, now: () => TEST_NOW };

export function caller(ctx: AppContext, sessionId: string, deps: Partial<ToolDeps> = {}) {
  return (name: string, input: unknown = {}) => runTool(ctx, sessionId, name, input, { deps: { ...offlineDeps, ...deps } });
}

export function dataOf<T = Record<string, unknown>>(r: ToolResult): T {
  if (!r.ok) throw new Error(`Expected ok, got error: ${r.error} (${r.hint ?? 'no hint'})`);
  return r.data as T;
}

export function saleBundle(ctx: AppContext): PropertyBundle {
  const b = ctx.content.properties.find((p) => p.property.kind === 'sale');
  if (!b) throw new Error('Content has no sale property');
  return b;
}

export function leaseBundle(ctx: AppContext): PropertyBundle {
  const b = ctx.content.properties.find((p) => p.property.kind === 'lease');
  if (!b) throw new Error('Content has no lease property');
  return b;
}
