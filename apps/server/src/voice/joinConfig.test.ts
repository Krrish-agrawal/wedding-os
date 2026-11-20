import { AgoraClient, Area } from 'agora-agents';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { agentTools } from './collaborators.js';
import { buildJoinProperties, type AgentSpec } from './joinConfig.js';
import { buildAsrKeywords } from './keywords.js';
import { FILLER_PHRASES } from './lines.js';
import { resolveVoiceSettings, type VoiceSettings } from './settings.js';
import { FAKE_APP_CERTIFICATE, FAKE_APP_ID, FULL_ENV, fixtureContent } from './testkit.js';

const TOKEN = 'agent-token-for-tests';
const SESSION = 'abc123def456';

function settings(env: Record<string, string> = {}): VoiceSettings {
  const resolved = resolveVoiceSettings(loadConfig({ ...FULL_ENV, ...env }));
  if (!resolved.ok) throw new Error(resolved.reason);
  return resolved.value;
}

function spec(s: VoiceSettings, overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    sessionId: SESSION,
    name: `ave-${SESSION}-1`,
    channel: `ave-${SESSION}`,
    systemMessages: ['BRIEF for Priya', 'SCREEN view=shortlist property=none'],
    greeting: 'Hi Priya, I am Asha from Agora Virtual Estates.',
    failureMessage: 'Sorry, I lost that for a moment. Could you say it again?',
    keywords: buildAsrKeywords(fixtureContent()),
    tools: agentTools(s.tools, 'tool-token-xyz'),
    ...overrides,
  };
}

const client = new AgoraClient({ area: Area.AP, appId: FAKE_APP_ID, appCertificate: FAKE_APP_CERTIFICATE });

// `any`: these tests walk a plain JSON body; its full shape is pinned by the snapshot.
type Json = Record<string, any>;

describe('buildJoinProperties', () => {
  const s = settings();
  const props = buildJoinProperties(client, s, spec(s), TOKEN) as Json;

  it('matches the reviewed join body', () => {
    expect(props).toMatchSnapshot();
  });

  it('joins the session channel as uid 1000 and hears only the buyer', () => {
    expect(props.channel).toBe(`ave-${SESSION}`);
    expect(props.token).toBe(TOKEN);
    expect(props.agent_rtc_uid).toBe('1000');
    expect(props.remote_rtc_uids).toEqual(['2001']);
    expect(props.remote_rtc_uids).not.toContain('3001');
    expect(props.enable_string_uid).toBe(false);
    expect(props.idle_timeout).toBe(120);
  });

  it('enables RTM and tools together (withAdvancedFeatures before withTools)', () => {
    expect(props.advanced_features).toEqual({ enable_rtm: true, enable_tools: true });
    expect(props.parameters).toMatchObject({ data_channel: 'rtm', enable_metrics: true, enable_error_message: true });
    expect(props.parameters.farewell_config).toEqual({ graceful_enabled: true, graceful_timeout_seconds: 10 });
  });

  it('uses ARES en-IN with domain and content keywords', () => {
    expect(props.asr.vendor).toBe('ares');
    expect(props.asr.language).toBe('en-IN');
    expect(props.asr.keywords).toEqual(expect.arrayContaining(['BHK', 'Vastu', 'RERA', 'Khata', 'lakh', 'crore', 'Lakeview Residency', 'Indiranagar']));
    expect(props.asr.keywords.length).toBeLessThanOrEqual(40);
    for (const k of props.asr.keywords) expect(k).toMatch(/^[A-Za-z0-9 ]+$/);
  });

  it('configures OpenAI with brief and screen line, greeting, failure message and history cap', () => {
    const llm = props.llm;
    expect(llm.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(llm.api_key).toBe('sk-test-openai');
    expect(llm.style).toBe('openai');
    expect(llm.params).toEqual({ model: 'gpt-4.1-mini', temperature: 0.3 });
    expect(llm.system_messages).toEqual([
      { role: 'system', content: 'BRIEF for Priya' },
      { role: 'system', content: 'SCREEN view=shortlist property=none' },
    ]);
    expect(llm.greeting_message).toMatch(/Priya/);
    expect(llm.greeting_configs).toEqual({ mode: 'single_first' });
    expect(llm.failure_message).toBe('Sorry, I lost that for a moment. Could you say it again?');
    expect(llm.max_history).toBe(24);
  });

  it('attaches the MCP server with the session bearer and no allowed_tools', () => {
    expect(props.llm.mcp_servers).toHaveLength(1);
    const mcp = props.llm.mcp_servers[0];
    expect(mcp).toMatchObject({
      name: 'estates',
      endpoint: 'https://voice-test.example.com/mcp',
      transport: 'streamable_http',
      headers: { Authorization: 'Bearer tool-token-xyz' },
    });
    expect(mcp.timeout_ms).toBeGreaterThanOrEqual(1000);
    expect(mcp).not.toHaveProperty('allowed_tools');
    expect(props.llm).not.toHaveProperty('tools');
  });

  it('speaks with Murf Falcon at 24 kHz', () => {
    expect(props.tts.vendor).toBe('murf');
    expect(props.tts.params).toMatchObject({
      api_key: 'murf-test-key',
      voiceId: 'Anusha',
      locale: 'en-IN',
      model: 'FALCON',
      sample_rate: 24000,
      base_url: 'wss://global.api.murf.ai/v1/speech/stream-input',
    });
  });

  it('takes turns with semantic end of speech and start-of-speech interruption', () => {
    expect(props.turn_detection.config.end_of_speech.mode).toBe('semantic');
    expect(props.turn_detection.config.start_of_speech.mode).toBe('vad');
    expect(props.interruption).toEqual({ enable: true, mode: 'start_of_speech' });
  });

  it('adds top-level filler words that fire only when a reply is slow', () => {
    expect(props.llm).not.toHaveProperty('filler_words');
    expect(props.filler_words.enable).toBe(true);
    expect(props.filler_words.trigger.fixed_time_config.response_wait_ms).toBe(10000);
    expect(props.filler_words.content.static_config.phrases).toEqual([...FILLER_PHRASES]);
    for (const phrase of FILLER_PHRASES) expect(phrase.split(' ').length).toBeLessThanOrEqual(20);
  });

  it('labels the agent with the session id', () => {
    expect(props.labels).toEqual({ session_id: SESSION });
  });
});

describe('buildJoinProperties variants', () => {
  it('omits the greeting on restarts', () => {
    const s = settings();
    const props = buildJoinProperties(client, s, spec(s, { greeting: null }), TOKEN) as Json;
    expect(props.llm).not.toHaveProperty('greeting_message');
    expect(props.llm).not.toHaveProperty('greeting_configs');
  });

  it('turns tools off cleanly without a public URL', () => {
    const s = settings({ PUBLIC_BASE_URL: '' });
    const props = buildJoinProperties(client, s, spec(s), TOKEN) as Json;
    expect(props.advanced_features).toEqual({ enable_rtm: true, enable_tools: false });
    expect(props.llm).not.toHaveProperty('mcp_servers');
  });

  it('uses custom HTTP tools instead of MCP when TOOL_TRANSPORT=http', () => {
    const s = settings({ TOOL_TRANSPORT: 'http' });
    const props = buildJoinProperties(client, s, spec(s), TOKEN) as Json;
    expect(props.llm).not.toHaveProperty('mcp_servers');
    expect(props.llm.tools.length).toBeGreaterThan(0);
    expect(props.llm.tools[0].server.url).toMatch(/^https:\/\/voice-test\.example\.com\/tools\//);
    expect(props.llm.tools[0].server.headers.Authorization).toBe('Bearer tool-token-xyz');
    expect(props.advanced_features.enable_tools).toBe(true);
  });

  it('never sends keywords to a non-ARES vendor', () => {
    const s = settings({ ASR_VENDOR: 'deepgram', ASR_API_KEY: 'dg-key' });
    const props = buildJoinProperties(client, s, spec(s), TOKEN) as Json;
    expect(props.asr.vendor).toBe('deepgram');
    expect(props.asr).not.toHaveProperty('keywords');
    expect(props.asr.params).toMatchObject({ api_key: 'dg-key', model: 'nova-3' });
  });

  it('passes LLM_REASONING_EFFORT through as llm.params.reasoning_effort, keeping the model', () => {
    const s = settings({ LLM_MODEL: 'gpt-6-luna', LLM_REASONING_EFFORT: 'none' });
    const props = buildJoinProperties(client, s, spec(s), TOKEN) as Json;
    expect(props.llm.params).toEqual({ model: 'gpt-6-luna', temperature: 0.3, reasoning_effort: 'none' });
  });

  it('falls back to VAD end of speech for a two-language ASR setting', () => {
    const s = settings({ ASR_LANGUAGE: 'en-IN,hi-IN' });
    const props = buildJoinProperties(client, s, spec(s), TOKEN) as Json;
    expect(props.asr.language).toBe('en-IN,hi-IN');
    expect(props.turn_detection.config.end_of_speech.mode).toBe('vad');
  });
});
