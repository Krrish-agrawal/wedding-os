/**
 * Writes an original music bed for the promo to public/music.wav. Everything is synthesised here
 * from sine, triangle and noise: no samples, no downloads. The arrangement follows the scene
 * timeline in src/timeline.ts, so section changes land on the picture's cuts.
 *
 * Run: node scripts/make-music.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUSIC_FILE } from '../src/music.ts';
import { sceneStart, totalSeconds, VIDEO } from '../src/timeline.ts';

const SAMPLE_RATE = 44_100;
const BEAT = 60 / VIDEO.bpm;
const BAR = BEAT * 4;
const LENGTH = totalSeconds();
const N = Math.ceil(LENGTH * SAMPLE_RATE);
const PEAK = 0.89;

/** Section boundaries, in seconds, taken from the picture. */
const T = {
  groove: sceneStart('meet'),
  lift: sceneStart('languages'),
  breakdown: sceneStart('team'),
  groove2: sceneStart('desk'),
  outro: sceneStart('end'),
};

// Two buses: "duck" (pad and bass, pumped by the kick) and "dry" (everything else).
const duckL = new Float32Array(N);
const duckR = new Float32Array(N);
const dryL = new Float32Array(N);
const dryR = new Float32Array(N);

/** Deterministic noise. */
let seed = 0x2f6b_1a3d;
function noise(): number {
  seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
  return (seed / 0xffff_ffff) * 2 - 1;
}

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
const tri = (phase: number) => 1 - 4 * Math.abs(Math.round(phase - 0.25) - (phase - 0.25));

function write(l: Float32Array, r: Float32Array, i: number, v: number, pan: number): void {
  if (i < 0 || i >= N) return;
  l[i] += v * Math.cos(((pan + 1) * Math.PI) / 4);
  r[i] += v * Math.sin(((pan + 1) * Math.PI) / 4);
}

interface ToneOptions {
  start: number;
  dur: number;
  freq: number;
  amp: number;
  pan?: number;
  attack?: number;
  release?: number;
  /** Exponential decay time constant; when set the note fades from its attack. */
  decay?: number;
  shape: 'tri' | 'pluck' | 'bass';
  bus: 'duck' | 'dry';
}

function tone({ start, dur, freq, amp, pan = 0, attack = 0.005, release = 0.05, decay, shape, bus }: ToneOptions): void {
  const [l, r] = bus === 'duck' ? [duckL, duckR] : [dryL, dryR];
  const s0 = Math.floor(start * SAMPLE_RATE);
  const total = Math.floor((dur + release) * SAMPLE_RATE);
  for (let k = 0; k < total; k++) {
    const t = k / SAMPLE_RATE;
    let env = Math.min(1, t / attack);
    if (decay) env *= Math.exp(-t / decay);
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / release);
    const ph = freq * t;
    let v: number;
    if (shape === 'tri') v = tri(ph % 1);
    else if (shape === 'bass') v = Math.sin(2 * Math.PI * ph) + 0.25 * Math.sin(4 * Math.PI * ph);
    else v = Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(4 * Math.PI * ph) * Math.exp(-t / 0.05) + 0.12 * Math.sin(6 * Math.PI * ph);
    write(l, r, s0 + k, v * env * amp, pan);
  }
}

const kicks: number[] = [];
function kick(t: number, amp: number): void {
  kicks.push(t);
  const s0 = Math.floor(t * SAMPLE_RATE);
  const total = Math.floor(0.45 * SAMPLE_RATE);
  let phase = 0;
  for (let k = 0; k < total; k++) {
    const tt = k / SAMPLE_RATE;
    const f = 48 + 110 * Math.exp(-tt / 0.03);
    phase += f / SAMPLE_RATE;
    write(dryL, dryR, s0 + k, Math.sin(2 * Math.PI * phase) * Math.exp(-tt / 0.16) * amp, 0);
  }
}

function noiseHit(t: number, amp: number, decay: number, pan: number, kind: 'clap' | 'hat' | 'crash'): void {
  const s0 = Math.floor(t * SAMPLE_RATE);
  const total = Math.floor(decay * 6 * SAMPLE_RATE);
  let low = 0;
  let band = 0;
  for (let k = 0; k < total; k++) {
    const tt = k / SAMPLE_RATE;
    const n = noise();
    low += 0.08 * (n - low);
    band += 0.35 * (n - band);
    // Hats and crashes keep the highs (noise minus its low-passed copy); claps keep the mids.
    const v = kind === 'clap' ? band - low : n - band * 0.6;
    const flutter = kind === 'clap' ? (tt < 0.03 ? 0.6 + 0.4 * Math.sin(tt * 600) : 1) : 1;
    write(dryL, dryR, s0 + k, v * Math.exp(-tt / decay) * amp * flutter, pan);
  }
}

/** A noise swell that rises into `end`. */
function riser(end: number, length: number, amp: number): void {
  const s0 = Math.floor((end - length) * SAMPLE_RATE);
  const total = Math.floor(length * SAMPLE_RATE);
  let low = 0;
  for (let k = 0; k < total; k++) {
    const p = k / total;
    const cutoff = 0.01 + 0.5 * p * p;
    low += cutoff * (noise() - low);
    write(dryL, dryR, s0 + k, low * p * p * amp, Math.sin(p * 12) * 0.3);
  }
}

// Chords as MIDI notes (root first). Problem act in B minor, product acts in D major.
const CH = {
  Bm: [47, 50, 54],
  G: [43, 47, 50],
  D: [50, 54, 57],
  A: [45, 49, 52],
};
const INTRO = [CH.Bm, CH.G, CH.D, CH.A];
const GROOVE = [CH.D, CH.A, CH.Bm, CH.G];

function pad(chord: number[], start: number, dur: number, amp: number): void {
  for (const n of chord) {
    for (const [detune, pan] of [
      [1.003, -0.35],
      [0.997, 0.35],
    ] as const) {
      tone({ start, dur, freq: midi(n) * detune, amp, pan, attack: 0.35, release: 0.6, shape: 'tri', bus: 'duck' });
    }
  }
}

function bars(from: number, to: number, each: (barStart: number, index: number) => void): void {
  for (let i = 0, t = from; t < to - 1e-6; i++, t += BAR) each(t, i);
}

// Problem act: soft pad, slow arpeggio, a heartbeat kick.
bars(0, T.groove, (b, i) => {
  const chord = INTRO[i % INTRO.length]!;
  pad(chord, b, Math.min(BAR, T.groove - b), 0.03);
  tone({ start: b, dur: BAR * 0.9, freq: midi(chord[0]! - 12), amp: 0.09, attack: 0.05, release: 0.3, shape: 'bass', bus: 'duck' });
  for (let q = 0; q < 4; q++) {
    const t = b + q * BEAT;
    if (t >= T.groove) break;
    tone({ start: t, dur: 0.3, freq: midi(chord[q % 3]! + 24), amp: 0.045, pan: q % 2 ? 0.3 : -0.3, decay: 0.22, release: 0.1, shape: 'pluck', bus: 'dry' });
  }
  if (i > 0) {
    kick(b, 0.32);
    if (b + 2 * BEAT < T.groove) kick(b + 2 * BEAT, 0.26);
  }
});
riser(T.groove, 1.5, 0.5);

/** The full groove: four-on-the-floor, claps, hats, an eighth-note bass and a sixteenth arpeggio. */
function groove(from: number, to: number, bright: boolean): void {
  noiseHit(from, 0.1, 0.35, 0, 'crash');
  bars(from, to, (b, i) => {
    const chord = GROOVE[i % GROOVE.length]!;
    pad(chord, b, Math.min(BAR, to - b), 0.03);
    for (let e = 0; e < 8; e++) {
      const t = b + e * (BEAT / 2);
      if (t >= to) break;
      tone({ start: t, dur: 0.2, freq: midi(chord[0]! - 12), amp: e % 2 ? 0.13 : 0.09, attack: 0.004, release: 0.04, shape: 'bass', bus: 'duck' });
      noiseHit(t + BEAT / 4, 0.05, 0.018, e % 2 ? 0.25 : -0.25, 'hat');
    }
    for (let q = 0; q < 4; q++) {
      const t = b + q * BEAT;
      if (t >= to) break;
      kick(t, 0.5);
      if (q % 2 === 1) noiseHit(t, 0.17, 0.07, 0, 'clap');
    }
    const ARP = [0, 1, 2, 1, 2, 0, 1, 2, 0, 1, 2, 1, 2, 0, 2, 1];
    for (let s = 0; s < 16; s++) {
      const t = b + s * (BEAT / 4);
      if (t >= to) break;
      const n = chord[ARP[s]!]! + (bright ? 24 : 12) + (s >= 8 && bright ? 12 * (s % 4 === 0 ? 1 : 0) : 0);
      tone({ start: t, dur: 0.12, freq: midi(n), amp: 0.05, pan: s % 2 ? 0.4 : -0.4, decay: 0.12, release: 0.05, shape: 'pluck', bus: 'dry' });
    }
  });
}

groove(T.groove, T.lift, false);
riser(T.lift, 1, 0.35);
groove(T.lift, T.breakdown, true);

// Breakdown under the team title: pad and a rise into the Lead Desk.
pad(GROOVE[0]!, T.breakdown, T.groove2 - T.breakdown, 0.04);
riser(T.groove2, T.groove2 - T.breakdown, 0.55);
groove(T.groove2, T.outro, true);

// Outro: one bright chord and a rising arpeggio that rings out under the logo.
noiseHit(T.outro, 0.12, 0.6, 0, 'crash');
kick(T.outro, 0.5);
pad([50, 54, 57, 61, 64], T.outro, LENGTH - T.outro - 0.8, 0.035);
tone({ start: T.outro, dur: 3, freq: midi(38), amp: 0.14, attack: 0.01, release: 1.2, decay: 1.6, shape: 'bass', bus: 'duck' });
[62, 66, 69, 74, 78].forEach((n, i) => {
  tone({ start: T.outro + i * (BEAT / 2), dur: 1.4, freq: midi(n), amp: 0.06, pan: i % 2 ? 0.3 : -0.3, decay: 0.5, release: 0.4, shape: 'pluck', bus: 'dry' });
});

// Side-chain the pad and bass to the kick, mix, soft-clip and normalise.
kicks.sort((a, b) => a - b);
const out = new Int16Array(N * 2);
let k = 0;
let peak = 0;
const mixed = new Float32Array(N * 2);
for (let i = 0; i < N; i++) {
  const t = i / SAMPLE_RATE;
  while (k + 1 < kicks.length && kicks[k + 1]! <= t) k++;
  const since = kicks.length && kicks[k]! <= t ? t - kicks[k]! : 10;
  const duck = 1 - 0.4 * Math.exp(-since / 0.11);
  const l = Math.tanh((duckL[i]! * duck + dryL[i]!) * 1.4);
  const r = Math.tanh((duckR[i]! * duck + dryR[i]!) * 1.4);
  mixed[i * 2] = l;
  mixed[i * 2 + 1] = r;
  peak = Math.max(peak, Math.abs(l), Math.abs(r));
}
const gain = peak > 0 ? PEAK / peak : 1;
for (let i = 0; i < mixed.length; i++) out[i] = Math.round(mixed[i]! * gain * 32_767);

// 16-bit PCM WAV.
const data = Buffer.from(out.buffer);
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(SAMPLE_RATE * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'public', MUSIC_FILE);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, Buffer.concat([header, data]));
console.log(`Wrote ${target} (${LENGTH.toFixed(1)} s, peak gain ${gain.toFixed(2)})`);
