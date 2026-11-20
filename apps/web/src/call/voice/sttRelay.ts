import type { TranscriptLine } from '@ave/shared';

/**
 * Agora Real-Time STT captions, relayed from the human advisor's browser to the session.
 *
 * The STT bot publishes RTC stream messages. With `enableJsonProtocol` they are JSON, gzip-compressed;
 * gzip is undone with the browser's own DecompressionStream, so nothing is installed. Documented shape:
 *   { transcript: { uid, text, isFinal, sentenceId, textTs, language, results: [{ text, isFinal }] } }
 *   { translation: ... }   (ignored: translation is not enabled)
 * Protobuf (the default when JSON is off) is reported once, never crashes the call.
 */

const GZIP_MAGIC = [0x1f, 0x8b] as const;
/** Partial captions of one sentence reach the session at most this often; finals go at once. */
export const STT_PARTIAL_INTERVAL_MS = 400;
/** First-seen times remembered per sentence, so partial updates keep their place in the transcript. */
const MAX_REMEMBERED_SENTENCES = 200;

export interface SttCaption {
  /** RTC uid of the person speaking. */
  uid: number;
  sentenceId: string | null;
  text: string;
  isFinal: boolean;
}

export type SttDecoded = { kind: 'caption'; caption: SttCaption } | { kind: 'ignore' } | { kind: 'unreadable'; reason: string };

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface RawResult {
  text?: unknown;
  isFinal?: unknown;
}

/** Reads one caption from the documented JSON shape; anything else is ignored. */
export function parseSttJson(json: unknown): SttDecoded {
  if (!json || typeof json !== 'object') return { kind: 'ignore' };
  const t = (json as { transcript?: unknown }).transcript;
  if (!t || typeof t !== 'object') return { kind: 'ignore' };
  const raw = t as { uid?: unknown; text?: unknown; isFinal?: unknown; sentenceId?: unknown; results?: unknown };
  const uid = Number(raw.uid);
  if (!Number.isFinite(uid)) return { kind: 'ignore' };
  const results = Array.isArray(raw.results) ? (raw.results as RawResult[]) : [];
  const fromResults = results.map((r) => (typeof r.text === 'string' ? r.text : '')).join('');
  const text = (typeof raw.text === 'string' && raw.text.trim() ? raw.text : fromResults).replace(/\s+/g, ' ').trim();
  // Empty follow-up messages are part of the protocol.
  if (!text) return { kind: 'ignore' };
  const isFinal = raw.isFinal === true || (results.length > 0 && results.every((r) => r.isFinal === true));
  const sentenceId = typeof raw.sentenceId === 'number' || typeof raw.sentenceId === 'string' ? String(raw.sentenceId) : null;
  return { kind: 'caption', caption: { uid, sentenceId, text, isFinal } };
}

/** Bytes from the bot -> one caption, or why it could not be read. */
export async function decodeSttPayload(bytes: Uint8Array): Promise<SttDecoded> {
  let body = bytes;
  if (isGzip(bytes)) {
    try {
      body = await gunzip(bytes);
    } catch {
      return { kind: 'unreadable', reason: 'a gzip caption could not be decompressed' };
    }
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8').decode(body));
  } catch {
    return { kind: 'unreadable', reason: 'captions arrived in a format other than JSON (probably protobuf)' };
  }
  return parseSttJson(json);
}

export interface SttRelayOptions {
  buyerUid: number;
  advisorUid: number;
  send: (line: TranscriptLine) => void;
  /** Called once, the first time a message cannot be read. */
  onProblem: (reason: string) => void;
  now?: () => number;
}

interface SentenceRecord {
  at: number;
  text: string;
  final: boolean;
  sentAt: number;
}

/**
 * Turns decoded captions into `add_transcript` lines: the speaker's uid picks the role, one stable id per
 * sentence (so partials update in place), partials throttled, finals immediate. A per-relay prefix keeps ids
 * from a later consult (a new STT task restarts sentence ids) from overwriting earlier lines.
 */
export class SttRelay {
  private readonly now: () => number;
  private readonly prefix: string;
  private readonly sentences = new Map<string, SentenceRecord>();
  /** Fallback numbering per speaker when a caption carries no sentence id. */
  private readonly counters = new Map<number, number>();
  private reported = false;

  constructor(private readonly opts: SttRelayOptions) {
    this.now = opts.now ?? Date.now;
    this.prefix = `stt-${this.now().toString(36)}`;
  }

  async handle(bytes: Uint8Array): Promise<void> {
    const decoded = await decodeSttPayload(bytes);
    if (decoded.kind === 'unreadable') {
      if (!this.reported) {
        this.reported = true;
        this.opts.onProblem(decoded.reason);
      }
      return;
    }
    if (decoded.kind === 'caption') this.relay(decoded.caption);
  }

  relay(caption: SttCaption): void {
    const role = caption.uid === this.opts.buyerUid ? 'buyer' : caption.uid === this.opts.advisorUid ? 'human' : null;
    if (!role) return;
    const id = this.lineId(caption);
    const now = this.now();
    const prev = this.sentences.get(id);
    if (prev && prev.text === caption.text && prev.final === caption.isFinal) return;
    if (prev?.final && !caption.isFinal) return; // a late partial never undoes a final
    if (prev && !caption.isFinal && now - prev.sentAt < STT_PARTIAL_INTERVAL_MS) return;

    const at = prev?.at ?? now;
    this.sentences.set(id, { at, text: caption.text, final: caption.isFinal, sentAt: now });
    if (this.sentences.size > MAX_REMEMBERED_SENTENCES) {
      const oldest = this.sentences.keys().next().value;
      if (oldest !== undefined) this.sentences.delete(oldest);
    }
    if (caption.isFinal && caption.sentenceId === null) this.counters.set(caption.uid, (this.counters.get(caption.uid) ?? 0) + 1);
    this.opts.send({ id, role, text: caption.text, final: caption.isFinal, at });
  }

  private lineId(caption: SttCaption): string {
    const sentence = caption.sentenceId ?? `n${this.counters.get(caption.uid) ?? 0}`;
    return `${this.prefix}-${caption.uid}-${sentence}`;
  }
}
