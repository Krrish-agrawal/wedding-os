import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, OUTLINE } from '../brand';
import { SMOOTH, tween } from '../lib/anim';
import { VIDEO } from '../timeline';

const BARS = [C.blue, C.sun, C.coral, C.grape];
const STAGGER = 2;

/**
 * Brand-coloured bars sweep in from the left, cover the frame at the midpoint, then sweep out to the
 * right. Place it so its midpoint lands on the cut between two scenes.
 */
export function BarWipe({ duration }: { duration: number }) {
  const frame = useCurrentFrame();
  const half = duration / 2;
  const h = VIDEO.height / BARS.length;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {BARS.map((color, i) => {
        const delay = i * STAGGER;
        const inX = tween(frame, [delay, half - STAGGER * (BARS.length - 1) + delay], [-1.2, 0], SMOOTH);
        const outX = tween(frame, [half + delay, duration - STAGGER * (BARS.length - 1) + delay], [0, 1.2], SMOOTH);
        const x = frame < half + delay ? inX : outX;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: i * h - OUTLINE,
              left: 0,
              width: VIDEO.width * 1.3,
              height: h + OUTLINE * 2,
              background: color,
              border: `${OUTLINE}px solid ${C.ink}`,
              borderRadius: h / 2,
              transform: `translateX(${x * VIDEO.width - VIDEO.width * 0.15}px)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}
