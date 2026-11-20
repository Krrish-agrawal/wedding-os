import OpenAI, { toFile } from 'openai';
import { CALL_LANGUAGE_INFO, type CallLanguage } from '@ave/shared';
import type { Config } from '../config.js';

/**
 * The OpenAI fallback for consult transcription: the advisor's browser records the advisor's microphone and
 * the buyer's voice separately in short standalone chunks and posts each one here, so every chunk belongs to
 * exactly one speaker and the transcript labels stay right.
 */

/** Largest audio chunk accepted. About eight seconds of Opus is well under 100 KB; this leaves room for WAV. */
export const CONSULT_AUDIO_MAX_BYTES = 2 * 1024 * 1024;
/** A chunk is dropped rather than holding a request open longer than this. */
const TRANSCRIBE_TIMEOUT_MS = 15_000;
/** Longest transcript line kept from one chunk. */
const MAX_LINE_CHARS = 600;

export const CONSULT_SPEAKERS = ['buyer', 'human'] as const;
export type ConsultSpeaker = (typeof CONSULT_SPEAKERS)[number];

export interface TranscribeInput {
  audio: Buffer;
  mimeType: string;
  language: CallLanguage;
}

/** Returns the recognised text (possibly empty). Throws when the provider fails. */
export type Transcriber = (input: TranscribeInput) => Promise<string>;

/** OpenAI picks the decoder from the file name, so the extension must match the container. */
export function audioFileName(mimeType: string): string {
  const type = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type.includes('ogg')) return 'chunk.ogg';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'chunk.mp4';
  if (type.includes('wav')) return 'chunk.wav';
  if (type.includes('mpeg') || type.includes('mp3')) return 'chunk.mp3';
  return 'chunk.webm';
}

/** ISO-639-1 hint for the transcription model, from the call language's recognition tag ("hi-IN" -> "hi"). */
export function languageHint(language: CallLanguage): string {
  return CALL_LANGUAGE_INFO[language].asr.split('-')[0] ?? 'en';
}

/** One clean line, or null when the chunk held no words (only punctuation, noise markers or nothing). */
export function cleanTranscription(text: string): string | null {
  const one = text.replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(one.replace(/\[[^\]]*\]|\([^)]*\)/g, ''))) return null;
  return one.length > MAX_LINE_CHARS ? `${one.slice(0, MAX_LINE_CHARS - 1)}…` : one;
}

/** Null when OPENAI_API_KEY is not set. */
export function createOpenAiTranscriber(config: Pick<Config, 'OPENAI_API_KEY' | 'ASR_OPENAI_MODEL'>): Transcriber | null {
  if (!config.OPENAI_API_KEY) return null;
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: TRANSCRIBE_TIMEOUT_MS, maxRetries: 0 });
  return async ({ audio, mimeType, language }) => {
    const file = await toFile(audio, audioFileName(mimeType), { type: mimeType.split(';')[0] });
    const res = await client.audio.transcriptions.create({ file, model: config.ASR_OPENAI_MODEL, language: languageHint(language) });
    return res.text ?? '';
  };
}
