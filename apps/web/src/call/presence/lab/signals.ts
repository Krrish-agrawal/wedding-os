/**
 * Audio sources for the Presence lab, each exposed as a MediaStreamTrack exactly like the
 * advisor's Agora track. They run in their own AudioContext, so the avatar receives them across
 * contexts the way it receives the remote track. Dev tooling only.
 */

export interface LabSource {
  track: MediaStreamTrack;
  /** Play the source through the speakers too (never the microphone). */
  setAudible(on: boolean): void;
  stop(): void;
}

/** Output level of generated sources, roughly the loudness of TTS through Agora. */
const SOURCE_GAIN = 0.35;

function wrap(ctx: AudioContext, output: AudioNode, extraStop?: () => void): LabSource {
  const dest = ctx.createMediaStreamDestination();
  output.connect(dest);
  const track = dest.stream.getAudioTracks()[0];
  if (!track) throw new Error('No audio track from the generator');
  let audible = false;
  return {
    track,
    setAudible(on) {
      if (on === audible) return;
      audible = on;
      if (on) output.connect(ctx.destination);
      else output.disconnect(ctx.destination);
    },
    stop() {
      extraStop?.();
      track.stop();
      void ctx.close().catch(() => undefined);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Synthetic voice: a formant synthesiser speaking nonsense syllables  */
/* ------------------------------------------------------------------ */

/** Female-voice formants F1–F3 (Hz) for the five cardinal vowels and schwa. */
const VOWEL_FORMANTS: Array<[number, number, number]> = [
  [850, 1610, 2850], // a
  [610, 1900, 2850], // e
  [310, 2790, 3300], // i
  [500, 900, 2800], // o
  [330, 870, 2700], // u
  [550, 1500, 2600], // schwa
];
const NASAL_FORMANTS: [number, number, number] = [250, 1200, 2500];
const FORMANT_GAINS: [number, number, number] = [1, 0.55, 0.3];
const FORMANT_Q = 7;
const PITCH_HZ = 205;
const PITCH_DECLINATION = 0.82;
const VOWEL_MS: [number, number] = [110, 210];
const CONSONANT_MS: [number, number] = [45, 90];
const WORD_GAP_MS: [number, number] = [30, 90];
const SENTENCE_PAUSE_MS: [number, number] = [450, 850];
const WORDS_PER_SENTENCE: [number, number] = [4, 9];
const SYLLABLES_PER_WORD: [number, number] = [1, 3];
const SCHEDULE_AHEAD_S = 0.8;
const SCHEDULER_TICK_MS = 200;
const GLIDE_S = 0.012;
const EDGE_S = 0.02;
const FRICATIVE_CUTOFF_HZ = 3800;

/** Small seeded generator, so a run is repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  return {
    next,
    range: ([a, b]: [number, number]) => a + (b - a) * next(),
    int: ([a, b]: [number, number]) => Math.floor(a + (b - a + 1) * next()),
  };
}

export async function startTestVoice(seed = 7): Promise<LabSource> {
  const ctx = new AudioContext();
  await ctx.resume();
  const rand = rng(seed);

  const glottis = ctx.createOscillator();
  glottis.type = 'sawtooth';
  glottis.frequency.value = PITCH_HZ;
  const voiced = ctx.createGain();
  voiced.gain.value = 0;
  glottis.connect(voiced);

  const mix = ctx.createGain();
  mix.gain.value = SOURCE_GAIN;
  const formants = FORMANT_GAINS.map((g) => {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = FORMANT_Q;
    const gain = ctx.createGain();
    gain.gain.value = g;
    voiced.connect(filter).connect(gain).connect(mix);
    return filter;
  });

  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = rand.next() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;
  const hiss = ctx.createBiquadFilter();
  hiss.type = 'highpass';
  hiss.frequency.value = FRICATIVE_CUTOFF_HZ;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;
  noise.connect(hiss).connect(noiseGain).connect(mix);

  glottis.start();
  noise.start();

  const setFormants = (f: [number, number, number], at: number) => {
    formants.forEach((filter, i) => filter.frequency.setTargetAtTime(f[i]!, at, GLIDE_S));
  };
  const envelope = (param: AudioParam, level: number, at: number, durS: number) => {
    param.setTargetAtTime(level, at, EDGE_S / 3);
    param.setTargetAtTime(0, at + durS - EDGE_S, EDGE_S / 3);
  };

  let cursor = ctx.currentTime + 0.1;
  let wordsLeft = 0;
  let sentenceStart = cursor;
  let sentenceLength = 1;

  const scheduleWord = () => {
    if (wordsLeft === 0) {
      cursor += rand.range(SENTENCE_PAUSE_MS) / 1000;
      wordsLeft = rand.int(WORDS_PER_SENTENCE);
      sentenceStart = cursor;
      sentenceLength = wordsLeft;
    }
    // Pitch falls across a sentence, as in a statement.
    const progress = 1 - wordsLeft / sentenceLength;
    glottis.frequency.setTargetAtTime(PITCH_HZ * (1 - (1 - PITCH_DECLINATION) * progress), Math.max(cursor, sentenceStart), 0.08);
    const syllables = rand.int(SYLLABLES_PER_WORD);
    for (let s = 0; s < syllables; s++) {
      const consonant = rand.int([0, 3]); // 0 none, 1 stop, 2 fricative, 3 nasal
      const cDur = rand.range(CONSONANT_MS) / 1000;
      if (consonant === 1) {
        // Closure, then a short burst.
        envelope(noiseGain.gain, 0.6, cursor + cDur * 0.7, cDur * 0.3);
        cursor += cDur;
      } else if (consonant === 2) {
        envelope(noiseGain.gain, 0.5, cursor, cDur);
        cursor += cDur;
      } else if (consonant === 3) {
        setFormants(NASAL_FORMANTS, cursor);
        envelope(voiced.gain, 0.35, cursor, cDur);
        cursor += cDur;
      }
      const vowel = VOWEL_FORMANTS[rand.int([0, VOWEL_FORMANTS.length - 1])]!;
      const vDur = rand.range(VOWEL_MS) / 1000;
      setFormants(vowel, cursor);
      envelope(voiced.gain, 1, cursor, vDur);
      cursor += vDur;
    }
    cursor += rand.range(WORD_GAP_MS) / 1000;
    wordsLeft -= 1;
  };

  const timer = setInterval(() => {
    while (cursor < ctx.currentTime + SCHEDULE_AHEAD_S) scheduleWord();
  }, SCHEDULER_TICK_MS);

  return wrap(ctx, mix, () => {
    clearInterval(timer);
    glottis.stop();
    noise.stop();
  });
}

/* ------------------------------------------------------------------ */
/* Microphone and audio file                                           */
/* ------------------------------------------------------------------ */

/** The buyer's own voice as a stand-in for the advisor. Asks for permission; never played back. */
export async function startMicrophone(): Promise<LabSource> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error('No microphone track');
  return {
    track,
    setAudible() {
      // Never: playing the microphone back would feed back through the speakers.
    },
    stop() {
      for (const t of stream.getTracks()) t.stop();
    },
  };
}

/** A local recording (e.g. a saved Murf voice line), looped. Read in the browser; nothing is uploaded. */
export async function startAudioFile(file: File): Promise<LabSource> {
  const ctx = new AudioContext();
  await ctx.resume();
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 1;
  source.connect(gain);
  source.start();
  return wrap(ctx, gain, () => source.stop());
}
