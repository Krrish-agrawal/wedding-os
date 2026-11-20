import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root. */
export const ROOT_DIR = path.resolve(here, '../../..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const VAR_DIR = path.join(ROOT_DIR, 'apps/server/var');

const optional = z.string().trim().min(1).optional();

const EnvSchema = z.object({
  SERVER_PORT: z.coerce.number().int().positive().default(8787),
  SERVER_HOST: z.string().default('127.0.0.1'),
  /** Origin of the web app, for CORS and links in reports. */
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  /** Publicly reachable URL of this server; Agora calls tools here. */
  PUBLIC_BASE_URL: z.string().url().optional(),
  TOOL_TRANSPORT: z.enum(['mcp', 'http']).default('mcp'),

  AGORA_APP_ID: optional,
  AGORA_APP_CERTIFICATE: optional,
  AGORA_CUSTOMER_ID: optional,
  AGORA_CUSTOMER_SECRET: optional,

  OPENAI_API_KEY: optional,
  LLM_MODEL: z.string().default('gpt-4.1-mini'),
  /** Sent as `llm.params.reasoning_effort` when set; reasoning models need "none" to call tools on chat completions. */
  LLM_REASONING_EFFORT: z.enum(['none', 'low', 'medium', 'high']).optional(),
  REPORT_MODEL: z.string().default('gpt-4.1-mini'),

  MURF_API_KEY: optional,
  /** Murf Falcon voice id. Shortlist from the advisor notes: Anusha, Pooja, Anisha, Nikhil, Samar, Abhinav. */
  MURF_VOICE_ID: z.string().trim().min(1).default('Anusha'),
  MURF_LOCALE: z.string().default('en-IN'),
  /** Murf streaming endpoint. Pin wss://us-east.api.murf.ai/... for more concurrent calls. */
  MURF_BASE_URL: z.string().url().default('wss://global.api.murf.ai/v1/speech/stream-input'),
  MURF_RATE: z.coerce.number().int().min(-50).max(50).default(0),
  MURF_PITCH: z.coerce.number().int().min(-50).max(50).default(0),

  ASR_VENDOR: z.string().default('ares'),
  ASR_LANGUAGE: z.string().default('en-IN'),
  ASR_API_KEY: optional,
  /** off sends no recognition keywords (to isolate recognition problems). */
  ASR_KEYWORDS: z.enum(['on', 'off']).default('on'),
  /** OpenAI transcription model when ASR_VENDOR=openai. */
  ASR_OPENAI_MODEL: z.string().default('gpt-4o-mini-transcribe'),

  /** Agora REST region for the voice agent: US, EU, AP or CN. */
  AGORA_AREA: z.enum(['US', 'EU', 'AP', 'CN']).default('AP'),
  /** 1 logs the redacted agent start request. */
  AGORA_DEBUG: z.enum(['0', '1']).default('0'),
  /** Lifetime of browser and agent tokens, in seconds from now (Agora maximum 86400). */
  VOICE_TOKEN_TTL_SEC: z.coerce.number().int().min(600).max(86400).default(7200),
  /** Seconds the agent stays after the buyer leaves the channel. */
  AGENT_IDLE_TIMEOUT_SEC: z.coerce.number().int().min(0).max(3600).default(120),
  /** Conversation turns the engine keeps for the model. */
  AGENT_MAX_HISTORY: z.coerce.number().int().min(4).max(64).default(24),
  /** How long the engine waits for one tool call. Unset: the tools module's default (above the slowest tool). */
  MCP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(100000).optional(),
  /** A filler phrase plays only when a reply takes longer than this. */
  /**
   * A filler phrase plays only when a reply takes longer than this. Default 10000 (Agora's maximum) keeps
   * fillers out of the way: in live tests a filler playing over a reply after a tool call clipped the reply's
   * first words (2026-11-20).
   */
  FILLER_WAIT_MS: z.coerce.number().int().min(100).max(10000).default(10000),

  /** Name the advisor introduces itself with. */
  ADVISOR_NAME: z.string().default('Asha'),

  EMAIL_PROVIDER: z.enum(['none', 'resend', 'smtp']).default('none'),
  EMAIL_FROM: optional,
  RESEND_API_KEY: optional,
  SMTP_URL: optional,

  WHATSAPP_PROVIDER: z.enum(['none', 'twilio', 'meta']).default('none'),
  TWILIO_ACCOUNT_SID: optional,
  TWILIO_AUTH_TOKEN: optional,
  TWILIO_WHATSAPP_FROM: optional,
  META_WA_TOKEN: optional,
  META_WA_PHONE_NUMBER_ID: optional,

  HUBSPOT_TOKEN: optional,

  /** Slack bot token (chat:write) and channel id; replies thread under the lead's first message. */
  SLACK_BOT_TOKEN: optional,
  SLACK_CHANNEL_ID: optional,
  /** Display name of the channel, for the Desk. */
  SLACK_CHANNEL_NAME: optional,
  /** Incoming webhook, used when there is no bot token (no threads). */
  SLACK_WEBHOOK_URL: z.string().url().optional(),

  /** Jira Cloud site, e.g. https://example.atlassian.net, with an Atlassian account email and API token. */
  JIRA_BASE_URL: z.string().url().optional(),
  JIRA_EMAIL: optional,
  JIRA_API_TOKEN: optional,
  JIRA_PROJECT_KEY: optional,
  JIRA_ISSUE_TYPE: z.string().trim().min(1).default('Task'),
  /** Label added to every issue the app creates. */
  JIRA_LABEL: z.string().trim().min(1).default('virtual-estates'),

  /** Channels the automatic pipeline may use (comma separated). Manual sends from the Desk are not limited. */
  AUTOMATIONS: z.string().default('whatsapp,email,slack,jira,crm'),
  /** How long a buyer waits for a human before the AI offers a call back. */
  HANDOFF_TIMEOUT_MS: z.coerce.number().int().min(10000).max(600000).default(90000),
  /** Transcription while a human advisor is on the call: Agora Real-Time STT, OpenAI chunks, or off. */
  CONSULT_STT: z.enum(['agora', 'openai', 'off']).default('agora'),
  /** Model that keeps the consult notes. */
  CONSULT_MODEL: z.string().default('gpt-4.1-mini'),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // `KEY=` lines in .env arrive as empty strings; treat them as unset so defaults and optionals apply.
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = EnvSchema.safeParse(present);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

/** Which integrations have the credentials they need. */
export function features(c: Config) {
  return {
    // The agent SDK authenticates with App ID + certificate alone; customer credentials are optional.
    agora: Boolean(c.AGORA_APP_ID && c.AGORA_APP_CERTIFICATE),
    openai: Boolean(c.OPENAI_API_KEY),
    murf: Boolean(c.MURF_API_KEY && c.MURF_VOICE_ID),
    publicTools: Boolean(c.PUBLIC_BASE_URL),
    email: c.EMAIL_PROVIDER !== 'none',
    whatsapp: c.WHATSAPP_PROVIDER !== 'none',
    hubspot: Boolean(c.HUBSPOT_TOKEN),
    slack: Boolean((c.SLACK_BOT_TOKEN && c.SLACK_CHANNEL_ID) || c.SLACK_WEBHOOK_URL),
    jira: Boolean(c.JIRA_BASE_URL && c.JIRA_EMAIL && c.JIRA_API_TOKEN && c.JIRA_PROJECT_KEY),
  };
}
export type Features = ReturnType<typeof features>;
