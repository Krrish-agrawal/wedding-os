import type { Content, SessionState } from '@ave/shared';
import { buildFailureMessage, buildGreeting, buildScreenLine, buildSystemPrompt } from '../agent/prompt.js';
import type { AppContext } from '../context.js';
import { buildHandoffContext } from '../desk/handoff.js';
import { buildCustomTools } from '../tools/http.js';
import { buildMcpServerConfig } from '../tools/mcp.js';
import type { AgentTools } from './joinConfig.js';
import type { VoiceSettings } from './settings.js';

/** The advisor brief, greeting, screen line and failure line, owned by the Tools workstream (agent/prompt.ts). */
export interface PromptBuilders {
  systemPrompt(ctx: AppContext, state: SessionState): string;
  greeting(ctx: AppContext, state: SessionState): string;
  screenLine(ctx: AppContext, state: SessionState): string;
  failureMessage(state?: SessionState): string;
}

/** Other workstreams' pieces the voice layer composes. Injectable so tests stay deterministic. */
export interface Collaborators {
  /** Null makes voice report itself unavailable (used by tests; the real builders always exist). */
  prompts: PromptBuilders | null;
  /** Desk workstream: where things stand when the human advisor hands the call back. */
  handoffContext: (state: SessionState, content: Content) => string;
  tools: (settings: VoiceSettings['tools'], token: string | undefined) => AgentTools;
}

export const defaultPrompts: PromptBuilders = {
  systemPrompt: buildSystemPrompt,
  greeting: buildGreeting,
  screenLine: buildScreenLine,
  failureMessage: buildFailureMessage,
};

/** MCP (default) or Agora custom HTTP tools, bound to the session's bearer token. */
export function agentTools(settings: VoiceSettings['tools'], token: string | undefined): AgentTools {
  if (settings.kind === 'none' || !token) return { kind: 'none' };
  const opts = { baseUrl: settings.baseUrl, token, ...(settings.timeoutMs !== null ? { timeoutMs: settings.timeoutMs } : {}) };
  return settings.kind === 'mcp' ? { kind: 'mcp', server: buildMcpServerConfig(opts) } : { kind: 'http', tools: buildCustomTools(opts) };
}

export const defaultCollaborators: Collaborators = {
  prompts: defaultPrompts,
  handoffContext: buildHandoffContext,
  tools: agentTools,
};
