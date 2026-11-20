import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C } from '../brand';
import { LANGUAGES } from '../content';
import { Mascot } from '../mascot/Mascot';
import { graphemes, pop, wobble } from '../lib/anim';
import { VIDEO } from '../timeline';
import { Background } from '../ui/Background';
import { Chip } from '../ui/kit';
import { piecesFrames, TypeLine } from '../ui/Type';

const START = 4;
const TYPE_RATE = 26;
const DELETE_RATE = 70;
const HOLD = 10;
const GAP = 3;

interface Slot {
  start: number;
  deleteAt: number;
  end: number;
}

/** Type each phrase, hold it, delete it, and move on; the last phrase stays. */
function schedule(): Slot[] {
  let t = START;
  return LANGUAGES.phrases.map((phrase, i) => {
    const typed = t + piecesFrames(phrase, TYPE_RATE);
    const last = i === LANGUAGES.phrases.length - 1;
    const units = phrase.reduce((n, r) => n + graphemes(r.text).length, 0);
    const deleteAt = last ? Number.POSITIVE_INFINITY : typed + HOLD;
    const end = last ? Number.POSITIVE_INFINITY : deleteAt + Math.ceil((units / DELETE_RATE) * VIDEO.fps);
    const slot = { start: t, deleteAt, end };
    t = end + GAP;
    return slot;
  });
}
const SLOTS = schedule();

/** Sound arcs either side of the speaking mascot. */
function Arcs({ frame, side }: { frame: number; side: 1 | -1 }) {
  return (
    <svg width={120} height={200} viewBox="-60 -100 120 200" style={{ transform: `scaleX(${side})` }}>
      {[0, 1, 2].map((i) => {
        const phase = ((frame / VIDEO.fps) * 2.2 + i / 3) % 1;
        const r = 26 + i * 26;
        return <path key={i} d={`M${-r * 0.2} ${-r} A ${r} ${r} 0 0 1 ${-r * 0.2} ${r}`} fill="none" stroke={C.blue} strokeWidth={9} strokeLinecap="round" opacity={0.35 + 0.65 * Math.sin(phase * Math.PI)} />;
      })}
    </svg>
  );
}

export function Languages() {
  const frame = useCurrentFrame();
  let active = 0;
  SLOTS.forEach((s, i) => {
    if (frame >= s.start) active = i;
  });
  const slot = SLOTS[active]!;
  const deleted = frame >= slot.deleteAt ? Math.floor(((frame - slot.deleteAt) / VIDEO.fps) * DELETE_RATE) : 0;
  return (
    <AbsoluteFill>
      <Background palette="warm" />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-start', paddingTop: 290 }}>
        <TypeLine key={active} pieces={LANGUAGES.phrases[active]!} at={slot.start} rate={TYPE_RATE} size={144} deleted={deleted} style={{ minHeight: 170 }} />
        <div style={{ display: 'flex', gap: 22, marginTop: 56 }}>
          {LANGUAGES.pills.map((label, i) => {
            const on = i === active;
            return (
              <div key={label} style={{ transform: `scale(${pop(frame, 2 + i * 4) * (on ? 1.08 : 1)})` }}>
                <Chip size={36} bg={on ? C.blue : C.canvas} color={on ? C.canvas : C.ink} shadow={on ? 6 : 3}>
                  {label}
                </Chip>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 690, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10 }}>
        <Arcs frame={frame} side={-1} />
        <div style={{ transform: `translateY(${4 * wobble(frame, 1.3)}px)` }}>
          <Mascot size={300} state="speaking" seed={19} />
        </div>
        <Arcs frame={frame} side={1} />
      </div>
    </AbsoluteFill>
  );
}
