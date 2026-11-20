import type { ConsultSpeaker } from '@/desk/consultApi';

/**
 * OpenAI fallback for consult transcription, in the human advisor's browser: the advisor's microphone and
 * the buyer's voice are recorded separately, so every chunk has exactly one speaker. Each recorder is
 * restarted every CONSULT_CHUNK_MS, which makes each chunk a complete file with its own container header
 * (MediaRecorder timeslice chunks after the first have no header and cannot be transcribed on their own).
 * Near-silent chunks are never sent: transcription models invent words for silence.
 */

export const CONSULT_CHUNK_MS = 8000;
/** RMS level (0..1) a short window must reach to count as speech. Room noise sits well below; speech well above. */
export const SPEECH_RMS_THRESHOLD = 0.015;
/** How often the level is measured. */
const LEVEL_SAMPLE_MS = 100;
/** A chunk is sent only with at least this many speech windows (about 0.3 s of voice). */
export const MIN_SPEECH_WINDOWS = 3;
const FFT_SIZE = 1024;
/** Containers OpenAI transcription reads, in order of preference. */
const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'] as const;

export function pickMimeType(isSupported: (type: string) => boolean = (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)): string | undefined {
  return PREFERRED_MIME_TYPES.find((t) => isSupported(t));
}

/** Root mean square of one window of samples. */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

export function worthSending(speechWindows: number, measured: boolean): boolean {
  // Without a level meter (no Web Audio) every chunk goes; the server drops chunks with no words.
  return !measured || speechWindows >= MIN_SPEECH_WINDOWS;
}

interface Recording {
  recorder: MediaRecorder;
  parts: Blob[];
  speechWindows: number;
  discard: boolean;
}

/** Records one track in standalone chunks and hands over the ones with speech. */
class TrackChunker {
  private current: Recording | null = null;
  private cycle: ReturnType<typeof setTimeout> | undefined;
  private meter: ReturnType<typeof setInterval> | undefined;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private sink: HTMLAudioElement | null = null;
  private stopped = false;
  private readonly mimeType = pickMimeType();

  constructor(
    readonly track: MediaStreamTrack,
    private readonly audio: AudioContext | null,
    private readonly onChunk: (blob: Blob) => void,
  ) {}

  start(): void {
    const stream = new MediaStream([this.track]);
    // Chrome only feeds remote WebRTC audio into Web Audio while a media element plays it (muted here).
    const sink = new Audio();
    sink.muted = true;
    sink.srcObject = stream;
    void sink.play().catch(() => undefined);
    this.sink = sink;
    if (this.audio) {
      try {
        this.source = this.audio.createMediaStreamSource(stream);
        this.analyser = this.audio.createAnalyser();
        this.analyser.fftSize = FFT_SIZE;
        this.source.connect(this.analyser);
        const samples = new Float32Array(this.analyser.fftSize);
        this.meter = setInterval(() => {
          if (!this.analyser || !this.current) return;
          this.analyser.getFloatTimeDomainData(samples);
          if (rms(samples) >= SPEECH_RMS_THRESHOLD) this.current.speechWindows += 1;
        }, LEVEL_SAMPLE_MS);
      } catch {
        this.analyser = null;
      }
    }
    this.record();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.cycle);
    clearInterval(this.meter);
    const rec = this.current;
    this.current = null;
    if (rec) {
      // The call moved on (hand-back or a new track): the unfinished chunk is not sent.
      rec.discard = true;
      if (rec.recorder.state !== 'inactive') rec.recorder.stop();
    }
    this.source?.disconnect();
    if (this.sink) this.sink.srcObject = null;
  }

  private record(): void {
    if (this.stopped || this.track.readyState === 'ended') return;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(new MediaStream([this.track]), this.mimeType ? { mimeType: this.mimeType } : undefined);
    } catch (err) {
      console.warn('[consult] cannot record audio in this browser', err);
      return;
    }
    const rec: Recording = { recorder, parts: [], speechWindows: 0, discard: false };
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) rec.parts.push(e.data);
    };
    recorder.onstop = () => {
      if (rec.discard || !worthSending(rec.speechWindows, Boolean(this.analyser))) return;
      const blob = new Blob(rec.parts, { type: recorder.mimeType || this.mimeType || 'audio/webm' });
      if (blob.size > 0) this.onChunk(blob);
    };
    recorder.start();
    this.current = rec;
    this.cycle = setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
      this.record();
    }, CONSULT_CHUNK_MS);
  }
}

export interface ConsultRecorderOptions {
  upload: (speaker: ConsultSpeaker, blob: Blob) => Promise<boolean>;
}

/** Both voices of the consult, each in its own chunker. Tracks can change (the buyer re-publishes). */
export class ConsultRecorder {
  private readonly chunkers: Partial<Record<ConsultSpeaker, TrackChunker>> = {};
  private audio: AudioContext | null = null;
  private failures = 0;

  constructor(private readonly opts: ConsultRecorderOptions) {
    try {
      this.audio = new AudioContext();
      // The advisor clicked Join, so the page has had a gesture and the context can run.
      void this.audio.resume().catch(() => undefined);
    } catch {
      this.audio = null;
    }
  }

  setTrack(speaker: ConsultSpeaker, track: MediaStreamTrack | null): void {
    const current = this.chunkers[speaker];
    if (current?.track === track) return;
    current?.stop();
    delete this.chunkers[speaker];
    if (!track) return;
    const chunker = new TrackChunker(track, this.audio, (blob) => void this.send(speaker, blob));
    this.chunkers[speaker] = chunker;
    chunker.start();
  }

  stop(): void {
    for (const speaker of Object.keys(this.chunkers) as ConsultSpeaker[]) this.setTrack(speaker, null);
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
  }

  private async send(speaker: ConsultSpeaker, blob: Blob): Promise<void> {
    const ok = await this.opts.upload(speaker, blob);
    if (ok) {
      this.failures = 0;
      return;
    }
    this.failures += 1;
    if (this.failures === 1) console.warn('[consult] an audio chunk could not be transcribed; later chunks keep trying');
  }
}
