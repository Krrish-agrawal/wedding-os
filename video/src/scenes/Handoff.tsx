import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, FONT, OUTLINE } from '../brand';
import { BRAND, HANDOFF } from '../content';
import { Mascot } from '../mascot/Mascot';
import { pop, progress, SNAP, tween, typedCount } from '../lib/anim';
import { Background } from '../ui/Background';
import { At, Card, Chip, Icon } from '../ui/kit';
import { TypeLine } from '../ui/Type';

const TILE = { w: 420, h: 540, y: 330 };
const EXPERT_AT = 18;
const NOTES_AT = 30;
const NOTE_STAGGER = 15;
const NOTE_RATE = 48;

/** A friendly human sales expert with a headset. */
function Person() {
  const ink = { stroke: C.ink, strokeWidth: OUTLINE, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  return (
    <svg width={300} height={300} viewBox="0 0 300 300">
      <path d="M50 300 C 50 220 100 196 150 196 C 200 196 250 220 250 300 Z" fill={C.grape} {...ink} />
      <path d="M126 196 L150 230 L174 196" fill={C.canvas} {...ink} />
      <circle cx={150} cy={128} r={62} fill="color-mix(in srgb, var(--color-tangerine) 38%, var(--color-canvas))" {...ink} />
      <path d="M88 124 C 86 70 120 54 150 54 C 186 54 216 74 212 124 C 196 98 168 90 150 90 C 128 90 104 100 88 124 Z" fill={C.ink} {...ink} />
      <circle cx={128} cy={132} r={6} fill={C.ink} />
      <circle cx={172} cy={132} r={6} fill={C.ink} />
      <path d="M130 158 Q150 174 170 158" fill="none" {...ink} />
      <path d="M84 132 C 80 70 220 70 216 132" fill="none" {...ink} strokeWidth={7} />
      <rect x={76} y={120} width={20} height={34} rx={8} fill={C.sun} {...ink} strokeWidth={3} />
      <path d="M86 154 C 90 176 108 180 122 176" fill="none" {...ink} strokeWidth={5} />
    </svg>
  );
}

export function Handoff() {
  const frame = useCurrentFrame();
  const expertIn = tween(frame, [EXPERT_AT, EXPERT_AT + 14], [380, 0], SNAP);
  return (
    <AbsoluteFill>
      <Background />
      <At x={120} y={96}>
        <TypeLine pieces={HANDOFF.headline} at={2} size={80} rate={36} />
      </At>

      <At x={120} y={TILE.y}>
        <Card bg={C.blueTint} style={{ width: TILE.w, height: TILE.h, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 60, display: 'flex', justifyContent: 'center' }}>
            <Mascot size={320} cues={[{ at: 0, state: 'speaking' }, { at: EXPERT_AT + 4, state: 'wave' }, { at: EXPERT_AT + 50, state: 'happy' }]} seed={23} />
          </div>
          <div style={{ position: 'absolute', left: 24, bottom: 22, fontFamily: FONT.display, fontWeight: 800, fontSize: 38 }}>{BRAND.advisorName}</div>
        </Card>
      </At>
      <At x={570 + expertIn} y={TILE.y} opacity={progress(frame, EXPERT_AT, EXPERT_AT + 6)}>
        <Card bg={C.sunTint} style={{ width: TILE.w, height: TILE.h, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 90, display: 'flex', justifyContent: 'center' }}>
            <Person />
          </div>
          <div style={{ position: 'absolute', left: 24, bottom: 22, fontFamily: FONT.display, fontWeight: 800, fontSize: 38 }}>{HANDOFF.expert}</div>
        </Card>
      </At>
      <At x={600} y={TILE.y - 30} scale={pop(frame, EXPERT_AT + 12)} rotate={-4}>
        <Chip bg={C.mint} size={26}>
          <Icon name="check" size={28} stroke={3.2} /> {HANDOFF.expertRole}
        </Chip>
      </At>
      <At x={360} y={TILE.y - 30} scale={pop(frame, 6) * (1 - progress(frame, EXPERT_AT + 8, EXPERT_AT + 14))} rotate={3}>
        <Chip bg={C.sun} size={26}>
          {HANDOFF.handing}
        </Chip>
      </At>

      <At x={1070} y={TILE.y} scale={pop(frame, NOTES_AT - 10)} origin="top left">
        <Card style={{ width: 740, minHeight: TILE.h, padding: '30px 34px' }} shadow={10}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ display: 'flex', width: 54, height: 54, borderRadius: 16, background: C.grape, border: `3px solid ${C.ink}`, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="spark" size={34} color={C.canvas} stroke={2.8} />
            </span>
            <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 42, letterSpacing: '-0.02em' }}>{HANDOFF.notesTitle}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 30, marginTop: 34 }}>
            {HANDOFF.notes.map((note, i) => {
              const at = NOTES_AT + i * NOTE_STAGGER;
              const shown = Array.from(note).slice(0, Math.max(0, typedCount(frame, at, NOTE_RATE))).join('');
              return (
                <div key={note} style={{ display: 'flex', alignItems: 'center', gap: 16, opacity: frame >= at ? 1 : 0 }}>
                  <span style={{ transform: `scale(${pop(frame, at)})`, display: 'flex', width: 40, height: 40, borderRadius: '50%', background: C.grapeTint, border: `3px solid ${C.ink}`, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="tick" size={24} stroke={3.2} />
                  </span>
                  <span style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 35 }}>{shown}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </At>
    </AbsoluteFill>
  );
}
