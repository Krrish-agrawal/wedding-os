import { describe, expect, it } from 'vitest';
import { features, loadConfig } from '../config.js';
import { resolveRtcSettings, resolveVoiceSettings } from './settings.js';
import { FULL_ENV } from './testkit.js';

describe('voice settings', () => {
  it('treats blank .env lines as unset instead of failing validation', () => {
    const config = loadConfig({ AGORA_APP_ID: '', AGORA_CUSTOMER_ID: '', PUBLIC_BASE_URL: '', MURF_VOICE_ID: '', MCP_TIMEOUT_MS: '' });
    expect(config.AGORA_APP_ID).toBeUndefined();
    expect(config.MURF_VOICE_ID).toBe('Anusha');
    expect(config.MCP_TIMEOUT_MS).toBeUndefined();
  });

  it('needs only the App ID and certificate from Agora', () => {
    const config = loadConfig({ ...FULL_ENV });
    expect(features(config).agora).toBe(true);
    expect(resolveRtcSettings(config).ok).toBe(true);
    expect(resolveVoiceSettings(config)).toMatchObject({ ok: true, warnings: [] });
  });

  it('lists every missing credential', () => {
    const r = resolveVoiceSettings(loadConfig({ AGORA_APP_ID: FULL_ENV.AGORA_APP_ID }));
    expect(r).toEqual({ ok: false, reason: 'Voice is not set up on this server (missing AGORA_APP_CERTIFICATE, OPENAI_API_KEY, MURF_API_KEY).' });
  });

  it('requires a key for non-ARES speech recognition and rejects unknown vendors', () => {
    expect(resolveVoiceSettings(loadConfig({ ...FULL_ENV, ASR_VENDOR: 'deepgram' }))).toMatchObject({ ok: false, reason: expect.stringMatching(/ASR_API_KEY/) });
    expect(resolveVoiceSettings(loadConfig({ ...FULL_ENV, ASR_VENDOR: 'whisperx' }))).toMatchObject({ ok: false, reason: expect.stringMatching(/not supported/) });
  });

  it('warns when the public URL cannot be reached by Agora', () => {
    const r = resolveVoiceSettings(loadConfig({ ...FULL_ENV, PUBLIC_BASE_URL: 'http://localhost:8787' }));
    expect(r.ok && r.warnings).toEqual([expect.stringMatching(/cannot reach it/)]);
  });

  it('turns HTTP tools off without https', () => {
    const r = resolveVoiceSettings(loadConfig({ ...FULL_ENV, TOOL_TRANSPORT: 'http', PUBLIC_BASE_URL: 'http://tools.example.com' }));
    expect(r.ok && r.value.tools).toEqual({ kind: 'none' });
  });
});
