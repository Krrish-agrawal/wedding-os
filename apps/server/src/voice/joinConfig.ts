import {
  Agent,
  AresSTT,
  OpenAISTT,
  DeepgramSTT,
  MurfTTS,
  OpenAI,
  SarvamSTT,
  type AgoraClient,
  type FillerWordsConfig,
  type InterruptionConfig,
  type LlmTool,
  type McpServer,
  type McpServersItem,
  type OpenAIOptions,
  type SessionOptions,
  type SessionParamsInput,
  type SttVendor,
  type TurnDetectionConfig,
  type TurnDetectionLanguage,
} from 'agora-agents';
import { VOICE_UIDS } from '@ave/shared';
import { FILLER_PHRASES } from './lines.js';
import { MURF_MODEL, MURF_SAMPLE_RATE, type VoiceSettings } from './settings.js';

/**
 * Turn-taking starting points from Agora's own examples (docs/ADVISOR_NOTES.md section 1).
 * Tune by ear on a live call; keep the names.
 */
export const TURN_TAKING = {
  speechThreshold: 0.5,
  /** Buyer speech needed to count as a start of speech while the agent listens. */
  interruptDurationMs: 160,
  /** Buyer speech needed to cut the agent off mid-sentence; higher so a cough does not. */
  speakingInterruptDurationMs: 320,
  prefixPaddingMs: 800,
  /** Semantic end of speech: silence before the model judges the buyer finished. */
  semanticSilenceMs: 320,
  /** Semantic end of speech: never wait longer than this after the buyer stops. */
  semanticMaxWaitMs: 3000,
  /** VAD end of speech, used when the ASR language cannot run semantic detection. */
  vadSilenceMs: 640,
} as const;

/** With graceful farewell, `leave` waits up to this long for the agent to finish its sentence. */
export const FAREWELL_TIMEOUT_SEC = 10;

/** Semantic end of speech supports exactly one of these languages; anything else falls back to VAD. */
const SEMANTIC_LANGUAGES: ReadonlySet<string> = new Set(['en-US', 'en-IN', 'zh-CN', 'zh-HK', 'zh-TW']);

/** ASR bake-off alternatives (ASR_VENDOR). Only ARES takes `keywords`. */
const DEEPGRAM_MODEL = 'nova-3';
/** Deepgram's code-switching mode on Nova-3. */
const DEEPGRAM_LANGUAGE = 'multi';
/** Sarvam auto-detects the spoken language with this value. */
const SARVAM_LANGUAGE = 'unknown';

/**
 * Tool wiring for one agent, built by the Tools workstream's helpers (`buildMcpServerConfig`,
 * `buildCustomTools`) with the session's bearer token.
 */
export type AgentTools = { kind: 'none' } | { kind: 'mcp'; server: McpServer } | { kind: 'http'; tools: LlmTool[] };

/** Everything that differs from one agent start to the next. */
export interface AgentSpec {
  sessionId: string;
  /** Unique per start: Agora rejects a reused name with 409. */
  name: string;
  channel: string;
  /** Rendered system messages, in order: brief, optional context, screen line last. */
  systemMessages: string[];
  /** Spoken when the buyer is in the channel; null on restarts so the greeting never replays. */
  greeting: string | null;
  /** Spoken by the engine when the model call fails. */
  failureMessage: string;
  keywords: string[];
  tools: AgentTools;
  /** The call language: recognition language, Murf locale and filler phrases. Defaults to the settings. */
  language?: { asr: string; ttsLocale: string; fillers: readonly string[] };
}

export type SystemMessage = { role: 'system'; content: string };

export function toSystemMessages(contents: readonly string[]): SystemMessage[] {
  return contents.filter((c) => c.trim().length > 0).map((content) => ({ role: 'system', content }));
}

function turnDetection(language: string): TurnDetectionConfig {
  const languages = language
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);
  const first = languages[0] ?? 'en-IN';
  const start_of_speech = {
    mode: 'vad' as const,
    vad_config: {
      interrupt_duration_ms: TURN_TAKING.interruptDurationMs,
      speaking_interrupt_duration_ms: TURN_TAKING.speakingInterruptDurationMs,
      prefix_padding_ms: TURN_TAKING.prefixPaddingMs,
    },
  };
  if (languages.length <= 1 && SEMANTIC_LANGUAGES.has(first)) {
    return {
      mode: 'default',
      language: first as Extract<TurnDetectionLanguage, `en-${string}`>,
      config: {
        speech_threshold: TURN_TAKING.speechThreshold,
        start_of_speech,
        end_of_speech: {
          mode: 'semantic',
          semantic_config: { silence_duration_ms: TURN_TAKING.semanticSilenceMs, max_wait_ms: TURN_TAKING.semanticMaxWaitMs },
        },
      },
    };
  }
  return {
    mode: 'default',
    language: (languages.length > 1 ? languages : first) as NonNullable<TurnDetectionConfig['language']>,
    config: {
      speech_threshold: TURN_TAKING.speechThreshold,
      start_of_speech,
      end_of_speech: { mode: 'vad', vad_config: { silence_duration_ms: TURN_TAKING.vadSilenceMs } },
    },
  };
}

/** OpenAI transcription has no keyword list; a short prompt with the names it should expect does the same job. */
export function openAiAsrPrompt(keywords: string[]): string {
  const names = keywords.slice(0, OPENAI_PROMPT_MAX_TERMS).join(', ');
  return `A buyer in Bengaluru talking to a property advisor in Indian English, sometimes mixing in Hindi words. Terms that may come up: ${names}.`;
}
const OPENAI_PROMPT_MAX_TERMS = 40;
/** OpenAI transcription language (ISO 639-1). */
const OPENAI_ASR_LANGUAGE = 'en';

function speechToText(s: VoiceSettings, keywords: string[]): SttVendor {
  const { asr } = s;
  switch (asr.vendor) {
    case 'ares':
      return new AresSTT(keywords.length ? { keywords } : {});
    case 'openai':
      return new OpenAISTT({ apiKey: asr.apiKey, model: asr.openAiModel, language: OPENAI_ASR_LANGUAGE, prompt: openAiAsrPrompt(keywords) });
    case 'deepgram':
      return new DeepgramSTT({ apiKey: asr.apiKey, model: DEEPGRAM_MODEL, language: DEEPGRAM_LANGUAGE });
    case 'sarvam':
      return new SarvamSTT({ apiKey: asr.apiKey, language: SARVAM_LANGUAGE });
  }
}

function mcpServer(server: McpServer): McpServersItem {
  // Never `allowed_tools`: a list that misses a real tool can hang the agent mid-response with no error.
  return {
    name: server.name,
    endpoint: server.endpoint,
    transport: server.transport ?? 'streamable_http',
    ...(server.headers ? { headers: server.headers } : {}),
    ...(server.timeout_ms !== undefined ? { timeout_ms: server.timeout_ms } : {}),
  };
}

/** Lower than the default 1.0 so tool choice and number handling stay consistent from call to call. */
export const LLM_TEMPERATURE = 0.3;

function languageModel(s: VoiceSettings, spec: AgentSpec): OpenAI {
  const options: OpenAIOptions = {
    apiKey: s.llm.apiKey,
    url: s.llm.url,
    model: s.llm.model,
    maxHistory: s.llm.maxHistory,
    systemMessages: toSystemMessages(spec.systemMessages),
    failureMessage: spec.failureMessage,
  };
  // `llm.params` starts from { model }; `update` never sends params, so this survives the whole call.
  // No parallel_tool_calls here: OpenAI rejects it whenever the request carries no tools, which is exactly what
  // happens if Agora cannot reach our MCP server, and then every reply fails. Parallel view switches are
  // handled in the tools instead (see PARALLEL_VIEW_WINDOW_MS in tools/kit.ts).
  options.params = { temperature: LLM_TEMPERATURE, ...(s.llm.reasoningEffort ? { reasoning_effort: s.llm.reasoningEffort } : {}) };
  if (spec.greeting) {
    options.greetingMessage = spec.greeting;
    options.greetingConfigs = { mode: 'single_first' };
  }
  if (spec.tools.kind === 'mcp') options.mcpServers = [mcpServer(spec.tools.server)];
  if (spec.tools.kind === 'http') options.tools = spec.tools.tools;
  return new OpenAI(options);
}

const INTERRUPTION: InterruptionConfig = { enable: true, mode: 'start_of_speech' };

const PARAMETERS: SessionParamsInput = {
  data_channel: 'rtm',
  enable_metrics: true,
  enable_error_message: true,
  farewell_config: { graceful_enabled: true, graceful_timeout_seconds: FAREWELL_TIMEOUT_SEC },
};

function fillerWords(s: VoiceSettings, phrases: readonly string[] = FILLER_PHRASES): FillerWordsConfig {
  return {
    enable: true,
    trigger: { mode: 'fixed_time', fixed_time_config: { response_wait_ms: s.fillerWaitMs } },
    content: { mode: 'static', static_config: { phrases: [...phrases], selection_rule: 'shuffle' } },
  };
}

/**
 * The agent definition for one start: ARES (or bake-off) ASR, OpenAI with the session's brief and
 * tools, Murf Falcon, RTM data channel with metrics and errors, filler words, interruption and
 * semantic turn detection. Pure apart from object construction; `toProperties` shows the wire body.
 */
export function buildAgent(client: AgoraClient, s: VoiceSettings, spec: AgentSpec): Agent {
  return (
    new Agent({ client })
      .withStt(speechToText(s, spec.keywords))
      .withTurnDetection(turnDetection(spec.language?.asr ?? s.asr.language))
      .withInterruption(INTERRUPTION)
      .withLlm(languageModel(s, spec))
      .withTts(
        new MurfTTS({
          key: s.tts.apiKey,
          voiceId: s.tts.voiceId,
          locale: spec.language?.ttsLocale ?? s.tts.locale,
          baseUrl: s.tts.baseUrl,
          rate: s.tts.rate,
          pitch: s.tts.pitch,
          model: MURF_MODEL,
          sampleRate: MURF_SAMPLE_RATE,
        }),
      )
      // withAdvancedFeatures replaces the whole object and withTools merges into it: this order only.
      .withAdvancedFeatures({ enable_rtm: true })
      .withTools(spec.tools.kind !== 'none')
      .withParameters(PARAMETERS)
      .withFillerWords(fillerWords(s, spec.language?.fillers))
      .withLabels({ session_id: spec.sessionId })
  );
}

/** Connection options for `agent.createSession`: the buyer is the only remote UID the agent hears. */
export function buildSessionOptions(s: VoiceSettings, spec: AgentSpec, warn?: (message: string) => void): SessionOptions {
  return {
    name: spec.name,
    channel: spec.channel,
    agentUid: String(VOICE_UIDS.agent),
    remoteUids: [String(VOICE_UIDS.buyer)],
    enableStringUid: false,
    idleTimeout: s.idleTimeoutSec,
    expiresIn: s.tokenTtlSec,
    debug: s.debug,
    ...(warn ? { warn } : {}),
  };
}

/**
 * The `properties` object of the join request, exactly as the SDK would send it, with a caller
 * supplied token so the result is deterministic (tests, debugging). Undefined fields are dropped.
 */
export function buildJoinProperties(client: AgoraClient, s: VoiceSettings, spec: AgentSpec, token: string): Record<string, unknown> {
  const opts = buildSessionOptions(s, spec);
  const properties = buildAgent(client, s, spec).toProperties({
    token,
    channel: opts.channel,
    agentUid: opts.agentUid,
    remoteUids: opts.remoteUids,
    idleTimeout: opts.idleTimeout,
    enableStringUid: opts.enableStringUid,
  });
  return JSON.parse(JSON.stringify(properties)) as Record<string, unknown>;
}
