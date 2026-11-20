import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, FONT, OUTLINE } from '../brand';
import { NIGHT } from '../content';
import { Mascot } from '../mascot/Mascot';
import { pop, progress, tween, wobble } from '../lib/anim';
import { Background } from '../ui/Background';
import { At, Card, Icon } from '../ui/kit';
import { TypeLine } from '../ui/Type';

const PHONE = { x: 1150, y: 270, w: 540, h: 900 };
const MESSAGE_AT = [16, 32, 48];
const STARS: Array<[number, number, number]> = [
  [520, 330, 0],
  [180, 300, 1],
  [640, 470, 2],
  [90, 520, 3],
  [940, 380, 4],
];

function Moon() {
  return (
    <svg width={220} height={220} viewBox="0 0 220 220">
      <defs>
        <clipPath id="moonDisc">
          <circle cx={110} cy={110} r={92} />
        </clipPath>
        <mask id="crescent">
          <rect width={220} height={220} fill="white" />
          <circle cx={145} cy={85} r={78} fill="black" />
        </mask>
      </defs>
      <g mask="url(#crescent)">
        <circle cx={110} cy={110} r={92} fill={C.sun} stroke={C.ink} strokeWidth={OUTLINE} />
      </g>
      <circle cx={145} cy={85} r={78} fill="none" stroke={C.ink} strokeWidth={OUTLINE} clipPath="url(#moonDisc)" />
    </svg>
  );
}

export function Night() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Background palette="night" />
      <At x={140} y={110}>
        <TypeLine pieces={NIGHT.headline} at={2} size={88} />
      </At>

      <At x={300} y={300} scale={pop(frame, 4)} rotate={-12 + 3 * wobble(frame, 3)}>
        <Moon />
      </At>
      {STARS.map(([x, y, i]) => (
        <At key={i} x={x} y={y} scale={0.6 + 0.4 * (0.5 + 0.5 * wobble(frame, 1.1, i * 2))} opacity={progress(frame, 6 + i * 3, 12 + i * 3)}>
          <Icon name="spark" size={44} color={C.ink} stroke={2.4} />
        </At>
      ))}

      <div style={{ position: 'absolute', left: 230, top: 560 }}>
        <Mascot size={420} cues={[{ at: 0, state: 'apologetic' }, { at: 66, state: 'sleepy' }]} seed={11} />
      </div>

      {/* The unanswered chat. */}
      <At x={PHONE.x} y={PHONE.y + tween(frame, [0, 14], [240, 0])} rotate={3}>
        <Card radius={64} bg={C.ink} shadow={12} style={{ width: PHONE.w, height: PHONE.h, padding: 16 }}>
          <div style={{ width: '100%', height: '100%', borderRadius: 50, background: C.paper, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '34px 28px 22px', background: C.canvas, borderBottom: `3px solid ${C.ink}` }}>
              <div style={{ width: 70, height: 70, borderRadius: '50%', background: C.grapeTint, border: `3px solid ${C.ink}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="home" size={38} />
              </div>
              <div>
                <div style={{ fontFamily: FONT.sans, fontWeight: 800, fontSize: 32 }}>{NIGHT.contact}</div>
                <div style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: 24, color: C.inkSoft }}>{NIGHT.status}</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 22, padding: '34px 26px' }}>
              {NIGHT.messages.map((m, i) => {
                const s = pop(frame, MESSAGE_AT[i]!);
                return (
                  <div
                    key={m}
                    style={{
                      transform: `scale(${s})`,
                      transformOrigin: 'bottom right',
                      background: C.blueTint,
                      border: `3px solid ${C.ink}`,
                      borderRadius: '26px 26px 8px 26px',
                      padding: '16px 22px 12px',
                      maxWidth: 420,
                    }}
                  >
                    <div style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: 30, lineHeight: 1.25 }}>{m}</div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginTop: 6, fontFamily: FONT.sans, fontWeight: 600, fontSize: 20, color: C.inkMute }}>
                      {NIGHT.time}
                      <Icon name="tick" size={22} color={C.inkMute} stroke={2.6} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </At>
    </AbsoluteFill>
  );
}
