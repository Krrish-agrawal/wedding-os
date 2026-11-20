import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C } from '../brand';
import { wobble } from '../lib/anim';

interface Blob {
  x: number;
  y: number;
  r: number;
  color: string;
  strength: number;
  period: number;
}

/** Soft corner glows in brand tints. Mixed with transparency so the base stays white. */
const PALETTES: Record<'default' | 'warm' | 'night', Blob[]> = {
  default: [
    { x: 160, y: 120, r: 620, color: C.blue, strength: 20, period: 9 },
    { x: 1780, y: 980, r: 680, color: C.grape, strength: 16, period: 11 },
    { x: 1700, y: 80, r: 420, color: C.sun, strength: 22, period: 7 },
  ],
  warm: [
    { x: 160, y: 140, r: 620, color: C.sun, strength: 26, period: 8 },
    { x: 1780, y: 960, r: 680, color: C.coral, strength: 14, period: 10 },
    { x: 1750, y: 100, r: 420, color: C.blue, strength: 14, period: 12 },
  ],
  night: [
    { x: 200, y: 140, r: 700, color: C.grape, strength: 26, period: 10 },
    { x: 1760, y: 980, r: 700, color: C.blue, strength: 18, period: 12 },
    { x: 1700, y: 120, r: 380, color: C.grape, strength: 14, period: 8 },
  ],
};

export function Background({ palette = 'default' }: { palette?: keyof typeof PALETTES }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.canvas, overflow: 'hidden' }}>
      {PALETTES[palette].map((b, i) => {
        const dx = 40 * wobble(frame, b.period, i);
        const dy = 30 * wobble(frame, b.period * 1.3, i + 1);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: b.x - b.r + dx,
              top: b.y - b.r + dy,
              width: b.r * 2,
              height: b.r * 2,
              borderRadius: '50%',
              background: `radial-gradient(circle, color-mix(in srgb, ${b.color} ${b.strength}%, transparent) 0%, transparent 68%)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}
