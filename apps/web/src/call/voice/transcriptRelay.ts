import { isScreenEventText, type TranscriptLine } from '@ave/shared';
import type { AgentTranscription, TranscriptHelperItem, UserTranscription } from 'agora-agent-client-toolkit';

export type ToolkitItem = TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>;

/** Partial captions of one line reach the session at most this often; final lines go at once. */
export const PARTIAL_RELAY_INTERVAL_MS = 250;
/**
 * A buyer transcript equal to something typed within this window is the engine echoing typed input.
 * Agora can re-send an earlier typed turn when the next one starts (seen 17 s later in a live test),
 * so the window covers a whole call rather than a few seconds.
 */
export const TYPED_ECHO_WINDOW_MS = 60 * 60 * 1000;
/** Most typed lines remembered for echo filtering. */
const TYPED_MEMORY_MAX = 50;
/** Toolkit TurnStatus values. */
const TURN_IN_PROGRESS = 0;
const TURN_INTERRUPTED = 2;
/** The toolkit reports the local user's transcripts under this uid. */
const LOCAL_USER_UID = '0';

interface LineRecord {
  id: string;
  at: number;
  text: string;
  final: boolean;
  sentAt: number;
}

export interface RelayOptions {
  send: (line: TranscriptLine) => void;
  now?: () => number;
}

function roleOf(item: ToolkitItem): 'buyer' | 'agent' {
  const kind = item.metadata?.object;
  if (kind === 'user.transcription') return 'buyer';
  if (kind === 'assistant.transcription') return 'agent';
  return String(item.uid) === LOCAL_USER_UID ? 'buyer' : 'agent';
}

function isFinal(item: ToolkitItem, role: 'buyer' | 'agent'): boolean {
  const meta = item.metadata;
  // User lines always carry status END in text mode; `final` is the real signal.
  if (role === 'buyer' && meta && 'final' in meta && typeof meta.final === 'boolean') return meta.final;
  if (item.status === TURN_INTERRUPTED) return true;
  if (item.status === TURN_IN_PROGRESS) return false;
  // WORD mode marks a turn ended as soon as its full text is known, then reveals the words in time
  // with the audio; the line is final only once everything in `metadata.text` is on screen.
  const full = typeof meta?.text === 'string' ? meta.text.trim() : null;
  return full === null || item.text.trim() === full;
}

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Turns the toolkit's transcript list (the whole list on every update) into `add_transcript` lines:
 * one stable id per turn so partial captions update in place, partials throttled, finals immediate.
 * Screen events the server injected and echoes of typed input are left out.
 */
export class TranscriptRelay {
  private records = new Map<string, LineRecord>();
  private pending = new Map<string, { line: TranscriptLine; rec: LineRecord }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private typed: { text: string; at: number }[] = [];
  private epoch: string;
  private seq = 0;
  private readonly now: () => number;

  constructor(private readonly opts: RelayOptions) {
    this.now = opts.now ?? Date.now;
    this.epoch = this.now().toString(36);
  }

  update(items: readonly ToolkitItem[]): void {
    const now = this.now();
    for (const item of items) {
      const text = item.text.trim();
      if (!text || isScreenEventText(text)) continue;
      const role = roleOf(item);
      if (role === 'buyer' && this.isTypedEcho(text, now)) continue;
      const final = isFinal(item, role);
      const key = `${item.uid}:${item.stream_id}:${item.turn_id}`;
      let rec = this.records.get(key);
      if (!rec) {
        this.seq += 1;
        rec = { id: `vt-${this.epoch}-${this.seq}`, at: now, text: '', final: false, sentAt: Number.NEGATIVE_INFINITY };
        this.records.set(key, rec);
      }
      if (rec.text === text && rec.final === final) continue;
      rec.text = text;
      rec.final = final;
      const line: TranscriptLine = { id: rec.id, role, text, final, at: rec.at };
      if (final || now - rec.sentAt >= PARTIAL_RELAY_INTERVAL_MS) {
        this.pending.delete(rec.id);
        this.emit(line, rec, now);
      } else {
        this.pending.set(rec.id, { line, rec });
        this.timer ??= setTimeout(() => this.flush(), PARTIAL_RELAY_INTERVAL_MS);
      }
    }
  }

  /** Remember typed input so its transcript echo (if the engine sends one) is not shown twice. */
  noteTyped(text: string): void {
    const now = this.now();
    this.typed = [...this.typed.filter((t) => now - t.at < TYPED_ECHO_WINDOW_MS), { text: normalise(text), at: now }].slice(-TYPED_MEMORY_MAX);
  }

  /** Sends held partial lines now. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const now = this.now();
    for (const { line, rec } of this.pending.values()) this.emit(line, rec, now);
    this.pending.clear();
  }

  /** A new agent restarts turn ids: forget the old turns so new lines get new ids. */
  reset(): void {
    this.flush();
    this.records.clear();
    this.epoch = this.now().toString(36);
  }

  dispose(): void {
    this.flush();
    this.records.clear();
  }

  private emit(line: TranscriptLine, rec: LineRecord, now: number): void {
    rec.sentAt = now;
    this.opts.send(line);
  }

  private isTypedEcho(text: string, now: number): boolean {
    const n = normalise(text);
    return this.typed.some((t) => now - t.at < TYPED_ECHO_WINDOW_MS && t.text === n);
  }
}
