/**
 * Sarvam AI speech-to-text (REST). Documented at docs.sarvam.ai: POST https://api.sarvam.ai/speech-to-text, multipart
 * form (file, model, mode, language_code), header `api-subscription-key`; REST audio is limited to 30 seconds; the
 * response has `transcript` and `language_code`. The key is read on the server and never sent to the browser or logged.
 */

export const SARVAM_STT_URL = 'https://api.sarvam.ai/speech-to-text';
/** Languages the wedding planner offers: Kannada, English (India), or let Sarvam detect. */
export const VOICE_LANGUAGES = ['kn-IN', 'en-IN', 'unknown'] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

export class VoiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: 'not_configured' | 'too_short' | 'rejected' | 'unavailable' | 'bad_audio' | 'empty') {
    super(message);
  }
}

export interface Transcription { transcript: string; languageCode: string | null }

export interface SarvamOptions { apiKey?: string; model: string; fetchImpl?: typeof fetch }

export async function transcribeWithSarvam(opts: SarvamOptions, audio: Buffer, mime: string, language: VoiceLanguage): Promise<Transcription> {
  if (!opts.apiKey) throw new VoiceError('Voice input is not configured on the server (no Sarvam key).', 503, 'not_configured');
  if (audio.length < 800) throw new VoiceError('That recording was too short. Hold the button and speak.', 422, 'too_short');
  const form = new FormData();
  const ext = mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('wav') ? 'wav' : 'webm';
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `speech.${ext}`);
  form.append('model', opts.model);
  form.append('mode', 'transcribe');
  form.append('language_code', language);
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(SARVAM_STT_URL, { method: 'POST', headers: { 'api-subscription-key': opts.apiKey }, body: form, signal: AbortSignal.timeout(25_000) });
  } catch {
    throw new VoiceError('The speech service could not be reached. Try again, or type your request.', 502, 'unavailable');
  }
  if (!res.ok) {
    // Never relay the provider's body: it can echo request details. Map by status only.
    if (res.status === 400) throw new VoiceError('The speech service could not read that audio (recordings are limited to 30 seconds).', 422, 'bad_audio');
    if (res.status === 401 || res.status === 403) throw new VoiceError("The speech service rejected the server's credentials.", 502, 'rejected');
    if (res.status === 429) throw new VoiceError('The speech service is busy. Try again in a moment.', 503, 'unavailable');
    throw new VoiceError('The speech service had a problem. Try again, or type your request.', 502, 'unavailable');
  }
  const body = (await res.json().catch(() => ({}))) as { transcript?: unknown; language_code?: unknown };
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (!transcript) throw new VoiceError('I could not hear any speech in that recording.', 422, 'empty');
  return { transcript: transcript.slice(0, 2000), languageCode: typeof body.language_code === 'string' ? body.language_code : null };
}
