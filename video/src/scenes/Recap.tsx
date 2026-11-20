import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, FONT } from '../brand';
import { RECAP } from '../content';
import { Mascot } from '../mascot/Mascot';
import { pop, progress, SNAP, tween } from '../lib/anim';
import { Background } from '../ui/Background';
import { At, Card, Icon } from '../ui/kit';
import { TypeLine } from '../ui/Type';

const PHONE = { x: 170, y: 250, w: 520, h: 880 };
const BUBBLE_AT = 12;
const LINE_AT = 18;
const LINE_STAGGER = 5;
const EMAIL_AT = 26;
const ICONS = ['home', 'bolt', 'calendar', 'check'] as const;

function RecapLines({ frame, size, start }: { frame: number; size: number; start: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: size * 0.55 }}>
      {RECAP.lines.map((line, i) => {
        const p = progress(frame, start + i * LINE_STAGGER, start + i * LINE_STAGGER + 6);
        return (
          <div key={line} style={{ display: 'flex', alignItems: 'center', gap: size * 0.5, opacity: p, transform: `translateX(${(1 - p) * 20}px)` }}>
            <Icon name={ICONS[i % ICONS.length]!} size={size * 1.2} stroke={2.6} />
            <span style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: size, lineHeight: 1.25 }}>{line}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Recap() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Background palette="warm" />
      <At x={120} y={96}>
        <TypeLine pieces={RECAP.headline} at={2} size={84} rate={34} />
      </At>

      {/* Chat recap on the phone. */}
      <At x={PHONE.x} y={PHONE.y + tween(frame, [0, 14], [300, 0], SNAP)} rotate={-4}>
        <Card radius={64} bg={C.ink} shadow={12} style={{ width: PHONE.w, height: PHONE.h, padding: 16 }}>
          <div style={{ width: '100%', height: '100%', borderRadius: 50, background: C.paper, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '34px 26px 20px', background: C.mint, borderBottom: `3px solid ${C.ink}` }}>
              <div style={{ width: 66, height: 66, borderRadius: '50%', background: C.canvas, border: `3px solid ${C.ink}`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                <Mascot size={70} shadow={false} style={{ marginTop: 6 }} />
              </div>
              <div style={{ fontFamily: FONT.sans, fontWeight: 800, fontSize: 28 }}>{RECAP.chatName}</div>
            </div>
            <div style={{ padding: '30px 22px' }}>
              <div style={{ transform: `scale(${pop(frame, BUBBLE_AT)})`, transformOrigin: 'top left', background: C.canvas, border: `3px solid ${C.ink}`, borderRadius: '8px 28px 28px 28px', padding: '22px 22px 14px' }}>
                <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 34, letterSpacing: '-0.02em', marginBottom: 16 }}>{RECAP.chatTitle}</div>
                <RecapLines frame={frame} size={23} start={LINE_AT} />
                <div style={{ textAlign: 'right', fontFamily: FONT.sans, fontWeight: 600, fontSize: 18, color: C.inkMute, marginTop: 10 }}>{RECAP.time}</div>
              </div>
            </div>
          </div>
        </Card>
      </At>

      {/* The same recap by email. */}
      <At x={tween(frame, [EMAIL_AT, EMAIL_AT + 16], [1960, 830], SNAP)} y={330} rotate={tween(frame, [EMAIL_AT, EMAIL_AT + 16], [12, 3], SNAP)}>
        <Card style={{ width: 900, padding: '30px 36px' }} shadow={12}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 20, borderBottom: `3px solid ${C.line}` }}>
            <span style={{ display: 'flex', width: 62, height: 62, borderRadius: 18, background: C.coral, border: `3px solid ${C.ink}`, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="mail" size={38} stroke={2.6} />
            </span>
            <div>
              <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 22, color: C.inkSoft }}>{RECAP.emailFrom}</div>
              <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 38, letterSpacing: '-0.02em' }}>{RECAP.emailSubject}</div>
            </div>
          </div>
          <div style={{ marginTop: 24 }}>
            <RecapLines frame={frame} size={28} start={EMAIL_AT + 12} />
          </div>
        </Card>
      </At>

      <div style={{ position: 'absolute', left: 1540, top: 790, transform: `translateY(${(1 - pop(frame, EMAIL_AT + 20)) * 300}px)` }}>
        <Mascot size={330} cues={[{ at: 0, state: 'idle' }, { at: EMAIL_AT + 34, state: 'wink' }]} seed={29} />
      </div>
    </AbsoluteFill>
  );
}
