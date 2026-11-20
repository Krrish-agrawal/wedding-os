import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, FONT } from '../brand';
import { BRAND } from '../content';
import { Mascot } from '../mascot/Mascot';
import { pop, progress, SNAP, tween } from '../lib/anim';
import { Background } from '../ui/Background';
import { TypeLine } from '../ui/Type';

const WORDMARK_AT = 8;
const TAGLINE_AT = 28;
const SUBLINE_AT = 62;

export function End() {
  const frame = useCurrentFrame();
  const rise = tween(frame, [WORDMARK_AT, WORDMARK_AT + 16], [1, 0], SNAP);
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 46 }}>
          <div style={{ transform: `scale(${pop(frame, 0)})` }}>
            <Mascot size={400} cues={[{ at: 0, state: 'happy' }, { at: 40, state: 'wave' }]} seed={41} />
          </div>
          <div>
            <div style={{ overflow: 'hidden', paddingBottom: 8 }}>
              <div style={{ transform: `translateY(${rise * 110}%)`, fontFamily: FONT.display, fontSize: 128, letterSpacing: '-0.035em', lineHeight: 1, whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 800 }}>{BRAND.wordmarkStrong}</span> <span style={{ fontWeight: 600 }}>{BRAND.wordmarkLight}</span>
              </div>
            </div>
            <div style={{ marginTop: 26 }}>
              <TypeLine pieces={[{ text: BRAND.tagline }]} at={TAGLINE_AT} rate={36} size={54} weight={700} font={FONT.sans} caretUntil={SUBLINE_AT} style={{ letterSpacing: '-0.01em', minHeight: 64 }} />
            </div>
            <div style={{ marginTop: 18, fontFamily: FONT.sans, fontWeight: 600, fontSize: 32, color: C.inkSoft, opacity: progress(frame, SUBLINE_AT, SUBLINE_AT + 10) }}>{BRAND.subline}</div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
