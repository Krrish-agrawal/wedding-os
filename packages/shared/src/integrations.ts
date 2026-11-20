import { z } from 'zod';
import type { DeliveryChannel } from './consult.js';
import type { Delivery } from './session.js';

/**
 * Integrations page contracts: GET /api/desk/integrations and
 * POST /api/desk/integrations/:channel/test.
 */

/** Outbox session id for test sends, so they never attach to a lead. */
export const TEST_SESSION_ID = 'test';

/** What a test send needs from the admin before it can go out. */
export type IntegrationTestInput = 'none' | 'email' | 'phone' | 'confirm' | 'unsupported';

export interface IntegrationStatus {
  channel: DeliveryChannel;
  /** "Slack", "Jira", ... */
  name: string;
  /** Has the credentials it needs; an unconfigured channel records not_configured instead of sending. */
  configured: boolean;
  /** Provider behind the channel, e.g. "Resend", "Twilio", "Slack webhook"; null when not configured. */
  provider: string | null;
  /** Where messages go, e.g. "#sales-pipeline", "Jira AVE", "The buyer's email". */
  destination: string;
  /** Switched on for the automatic pipeline (AUTOMATIONS). */
  automated: boolean;
  lastSentAt: number | null;
  lastError: { at: number; detail: string | null } | null;
  test: IntegrationTestInput;
  /** One line on what the automatic pipeline sends here. */
  sends: string;
  /** Where the provider should post incoming messages (WhatsApp replies through Twilio), when it can. */
  webhookUrl: string | null;
}

export interface McpLinkStatus {
  /** MCP server name the voice agent connects to. */
  server: string;
  tools: number;
  /** How the voice engine reaches the tools: MCP or plain HTTP. */
  transport: string;
  /** PUBLIC_BASE_URL is set, so the voice engine can reach the tools at all. */
  reachable: boolean;
}

export interface IntegrationsResponse {
  integrations: IntegrationStatus[];
  mcp: McpLinkStatus;
}

export const IntegrationTestRequestSchema = z
  .object({
    /** Email address or phone number for email and WhatsApp tests. */
    to: z.string().trim().max(200).optional(),
    /** Jira tests create a real issue, so the admin confirms first. */
    confirm: z.boolean().optional(),
  })
  .nullish()
  .transform((b) => ({ to: b?.to ?? null, confirm: b?.confirm ?? false }));
export type IntegrationTestRequest = z.input<typeof IntegrationTestRequestSchema>;

export interface IntegrationTestResponse {
  delivery: Delivery;
}
