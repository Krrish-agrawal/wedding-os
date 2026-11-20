import { Area, type AgoraArea } from 'agora-agents';
import type { Config } from '../config.js';

/** Fixed wire values for this project's pipeline (see docs/ADVISOR_NOTES.md). */
export const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
export const MURF_MODEL = 'FALCON';
export const MURF_SAMPLE_RATE = 24000;

export const ASR_VENDORS = ['ares', 'openai', 'deepgram', 'sarvam'] as const;
export type AsrVendor = (typeof ASR_VENDORS)[number];

const AREAS: Record<Config['AGORA_AREA'], AgoraArea> = { US: Area.US, EU: Area.EU, AP: Area.AP, CN: Area.CN };

/** Hosts Agora's cloud can never reach; a PUBLIC_BASE_URL on one of these cannot serve tools. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

export interface RtcSettings {
  appId: string;
  appCertificate: string;
  tokenTtlSec: number;
  advisorName: string;
}

export interface VoiceSettings extends RtcSettings {
  area: AgoraArea;
  debug: boolean;
  llm: { url: string; apiKey: string; model: string; maxHistory: number; reasoningEffort: Config['LLM_REASONING_EFFORT'] | null };
  tts: { apiKey: string; voiceId: string; locale: string; baseUrl: string; rate: number; pitch: number };
  asr: { vendor: 'ares'; language: string } | { vendor: Exclude<AsrVendor, 'ares'>; language: string; apiKey: string; openAiModel: string };
  /** Where the engine reaches our tools. `timeoutMs` null means the tools module's default. */
  tools: { kind: 'mcp' | 'http'; baseUrl: string; timeoutMs: number | null } | { kind: 'none' };
  idleTimeoutSec: number;
  fillerWaitMs: number;
}

export type Resolved<T> = { ok: true; value: T; warnings: string[] } | { ok: false; reason: string };

function unavailable(missing: string[]): { ok: false; reason: string } {
  return { ok: false, reason: `Voice is not set up on this server (missing ${missing.join(', ')}).` };
}

/** What a browser needs to join the call's channel: Agora App ID and certificate only. */
export function resolveRtcSettings(c: Config): Resolved<RtcSettings> {
  if (!c.AGORA_APP_ID || !c.AGORA_APP_CERTIFICATE) {
    const missing: string[] = [];
    if (!c.AGORA_APP_ID) missing.push('AGORA_APP_ID');
    if (!c.AGORA_APP_CERTIFICATE) missing.push('AGORA_APP_CERTIFICATE');
    return unavailable(missing);
  }
  return {
    ok: true,
    value: { appId: c.AGORA_APP_ID, appCertificate: c.AGORA_APP_CERTIFICATE, tokenTtlSec: c.VOICE_TOKEN_TTL_SEC, advisorName: c.ADVISOR_NAME },
    warnings: [],
  };
}

/**
 * Everything the voice agent needs, or a readable reason it cannot run. Missing Agora, OpenAI or
 * Murf credentials make voice unavailable; a missing public URL only turns tools off (warning).
 */
export function resolveVoiceSettings(c: Config): Resolved<VoiceSettings> {
  const vendor = ASR_VENDORS.find((v) => v === c.ASR_VENDOR.trim().toLowerCase());
  if (!vendor) return { ok: false, reason: `ASR_VENDOR "${c.ASR_VENDOR}" is not supported (use ${ASR_VENDORS.join(', ')}).` };

  const required: [string, string | undefined][] = [
    ['AGORA_APP_ID', c.AGORA_APP_ID],
    ['AGORA_APP_CERTIFICATE', c.AGORA_APP_CERTIFICATE],
    ['OPENAI_API_KEY', c.OPENAI_API_KEY],
    ['MURF_API_KEY', c.MURF_API_KEY],
  ];
  // OpenAI speech recognition reuses OPENAI_API_KEY unless ASR_API_KEY overrides it.
  if (vendor !== 'ares' && vendor !== 'openai') required.push(['ASR_API_KEY', c.ASR_API_KEY]);
  const missing = required.filter(([, v]) => !v).map(([name]) => name);

  const rtc = resolveRtcSettings(c);
  if (missing.length || !rtc.ok || !c.OPENAI_API_KEY || !c.MURF_API_KEY) return unavailable(missing);

  const warnings: string[] = [];
  const tools = resolveTools(c, warnings);
  const asr: VoiceSettings['asr'] =
    vendor === 'ares' ? { vendor, language: c.ASR_LANGUAGE } : { vendor, language: c.ASR_LANGUAGE, apiKey: c.ASR_API_KEY ?? (vendor === 'openai' ? c.OPENAI_API_KEY : ''), openAiModel: c.ASR_OPENAI_MODEL };

  return {
    ok: true,
    warnings,
    value: {
      ...rtc.value,
      area: AREAS[c.AGORA_AREA],
      debug: c.AGORA_DEBUG === '1',
      llm: {
        url: OPENAI_CHAT_COMPLETIONS_URL,
        apiKey: c.OPENAI_API_KEY,
        model: c.LLM_MODEL,
        maxHistory: c.AGENT_MAX_HISTORY,
        reasoningEffort: c.LLM_REASONING_EFFORT ?? null,
      },
      tts: {
        apiKey: c.MURF_API_KEY,
        voiceId: c.MURF_VOICE_ID,
        locale: c.MURF_LOCALE,
        baseUrl: c.MURF_BASE_URL,
        rate: c.MURF_RATE,
        pitch: c.MURF_PITCH,
      },
      asr,
      tools,
      idleTimeoutSec: c.AGENT_IDLE_TIMEOUT_SEC,
      fillerWaitMs: c.FILLER_WAIT_MS,
    },
  };
}

function resolveTools(c: Config, warnings: string[]): VoiceSettings['tools'] {
  if (!c.PUBLIC_BASE_URL) {
    warnings.push('Tools are off: PUBLIC_BASE_URL is not set, so the advisor cannot change the screen.');
    return { kind: 'none' };
  }
  const url = new URL(c.PUBLIC_BASE_URL);
  if (LOCAL_HOSTS.has(url.hostname)) {
    warnings.push(`PUBLIC_BASE_URL (${url.origin}) is this machine; Agora's cloud cannot reach it, so tool calls will fail.`);
  }
  const baseUrl = c.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const timeoutMs = c.MCP_TIMEOUT_MS ?? null;
  if (c.TOOL_TRANSPORT === 'http' && url.protocol !== 'https:') {
    warnings.push('Tools are off: TOOL_TRANSPORT=http needs an https PUBLIC_BASE_URL.');
    return { kind: 'none' };
  }
  return { kind: c.TOOL_TRANSPORT, baseUrl, timeoutMs };
}
