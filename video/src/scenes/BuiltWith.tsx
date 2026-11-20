import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, FONT } from '../brand';
import { BUILT_WITH } from '../content';
import { Mascot } from '../mascot/Mascot';
import { pop } from '../lib/anim';
import { Background } from '../ui/Background';
import { Card, Waveform } from '../ui/kit';
import { TypeLine } from '../ui/Type';

const BARS = 7;
const UNDER_AT = 44;

function levels(frame: number, offset: number): number[] {
  return Array.from({ length: BARS }, (_, i) => 0.2 + 0.8 * Math.abs(Math.sin(frame / 3.1 + i * 0.9 + offset) * Math.cos(frame / 5.3 + i * 1.3)));
}

function Partner({ label, bg, color, at, frame }: { label: string; bg: string; color: string; at: number; frame: number }) {
  const s = pop(frame, at);
  return (
    <div style={{ transform: `scale(${s}) rotate(${(1 - s) * 10}deg)` }}>
      <Card bg={bg} shadow={10} radius={28} style={{ padding: '30px 38px' }}>
        <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 56, letterSpacing: '-0.02em', color, lineHeight: 1.05, textAlign: 'center', whiteSpace: 'pre-line' }}>{label}</div>
      </Card>
    </div>
  );
}

export function BuiltWith() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 200 }}>
        <TypeLine pieces={[{ text: BUILT_WITH.lead }]} at={2} size={88} rate={30} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 26, marginTop: 70 }}>
          <Partner label={BUILT_WITH.left} bg={C.blue} color={C.ink} at={14} frame={frame} />
          <Waveform levels={levels(frame, 0)} height={110} barWidth={16} gap={8} color={C.blue} />
          <Mascot size={250} state="speaking" seed={37} />
          <Waveform levels={levels(frame, 2)} height={110} barWidth={16} gap={8} color={C.grape} />
          <Partner label={BUILT_WITH.right} bg={C.grape} color={C.canvas} at={22} frame={frame} />
        </div>
        <div style={{ marginTop: 70 }}>
          <TypeLine pieces={[{ text: BUILT_WITH.under }]} at={UNDER_AT} rate={44} size={48} weight={700} font={FONT.sans} color={C.inkSoft} caret={false} style={{ letterSpacing: '-0.01em' }} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
