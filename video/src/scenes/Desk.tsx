import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, FONT, OUTLINE, pop as popShadow } from '../brand';
import { DESK } from '../content';
import { Mascot } from '../mascot/Mascot';
import { pop, progress, settle, SMOOTH, tween, wobble } from '../lib/anim';
import { Background } from '../ui/Background';
import { At, Card, Chip, Icon } from '../ui/kit';

const BOARD = { x: 90, y: 150, w: 1290, h: 780, pad: 30, gap: 18, head: 150 };
const COL_W = (BOARD.w - 2 * BOARD.pad - 3 * BOARD.gap) / 4;
const CARD_H = 128;
const CARD_GAP = 16;
const TARGET_COLUMN = 2;
const LIFT_AT = 20;
const MOVE = [26, 56] as const;
const DROP_AT = 58;
const FLY_AT = [72, 84, 96];
const FLY_FRAMES = 18;
const INTEGRATION_COLORS = [C.grape, C.blue, C.tangerine];
const INTEGRATIONS = { x: 1430, y: 250, gap: 190, w: 440 };

/** Where a card sits on the board, relative to the board's top-left corner. */
function slot(column: number, row: number): [number, number] {
  return [BOARD.pad + column * (COL_W + BOARD.gap), BOARD.head + 70 + row * (CARD_H + CARD_GAP)];
}

function LeadCard({ title, who, hot, children }: { title: string; who: string; hot?: boolean; children?: React.ReactNode }) {
  return (
    <div style={{ width: COL_W, height: CARD_H, borderRadius: 18, border: `3px solid ${C.ink}`, background: hot ? C.coralTint : C.canvas, padding: '14px 16px', position: 'relative' }}>
      <div style={{ fontFamily: FONT.sans, fontWeight: 800, fontSize: 24 }}>{title}</div>
      <div style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: 18, color: C.inkSoft, marginTop: 2 }}>{who}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>{children}</div>
    </div>
  );
}

export function Desk() {
  const frame = useCurrentFrame();
  const move = progress(frame, MOVE[0], MOVE[1], SMOOTH);
  const lift = progress(frame, LIFT_AT, LIFT_AT + 6) * (1 - progress(frame, DROP_AT - 2, DROP_AT + 4));
  const [fx, fy] = slot(0, 0);
  const [tx, ty] = slot(TARGET_COLUMN, 0);
  const heroX = fx + (tx - fx) * move;
  const heroY = fy + (ty - fy) * move - 40 * Math.sin(move * Math.PI);
  // Cards already in the target column make room as the hero card lands.
  const makeRoom = settle(frame, MOVE[0] + 10);
  const boardTilt = 4 + 1.2 * wobble(frame, 6);
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ perspective: 2600 }}>
        <div style={{ position: 'absolute', left: BOARD.x, top: BOARD.y, width: BOARD.w, height: BOARD.h, transform: `rotateY(${boardTilt}deg) rotateX(3deg) translateY(${(1 - pop(frame, 0, { damping: 18, stiffness: 120 })) * 700}px)` }}>
          <Card shadow={14} style={{ width: '100%', height: '100%' }} bg={C.paper}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: `${BOARD.pad}px ${BOARD.pad}px 0` }}>
              <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 56, letterSpacing: '-0.02em' }}>{DESK.title}</div>
              <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
                {DESK.tabs.map((tab, i) => (
                  <Chip key={tab} size={22} shadow={i === 0 ? 3 : 0} bg={i === 0 ? C.blue : C.canvas} color={i === 0 ? C.canvas : C.inkSoft}>
                    {tab}
                  </Chip>
                ))}
              </div>
            </div>
            {DESK.columns.map((col, c) => {
              const [x] = slot(c, 0);
              const count = DESK.others.filter((o) => o.column === c).length + (c === 0 ? 1 - move : 0) + (c === TARGET_COLUMN ? move : 0);
              return (
                <div key={col} style={{ position: 'absolute', left: x, top: BOARD.head, width: COL_W, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: FONT.sans, fontWeight: 800, fontSize: 24 }}>
                  {col}
                  <span style={{ minWidth: 40, textAlign: 'center', borderRadius: 999, border: `3px solid ${C.ink}`, background: c === TARGET_COLUMN ? C.mintTint : C.canvas, fontSize: 20, padding: '2px 10px' }}>{Math.round(count)}</span>
                </div>
              );
            })}
            {DESK.others.map((o, i) => {
              const before = DESK.others.slice(0, i).filter((p) => p.column === o.column).length;
              const shift = o.column === TARGET_COLUMN ? makeRoom * move : 0;
              const rowOffset = o.column === 0 ? 1 - move : 0;
              const [x, y] = slot(o.column, before + shift + rowOffset);
              const enter = progress(frame, 6 + i * 2, 14 + i * 2);
              return (
                <div key={i} style={{ position: 'absolute', left: x, top: y, opacity: enter }}>
                  <LeadCard title={o.title} who={o.who} />
                </div>
              );
            })}
            <div
              style={{
                position: 'absolute',
                left: heroX,
                top: heroY,
                transform: `scale(${1 + 0.07 * lift}) rotate(${-3 * lift}deg)`,
                boxShadow: popShadow(4 + 10 * lift),
                borderRadius: 18,
                zIndex: 2,
              }}
            >
              <LeadCard title={DESK.hero.title} who={DESK.hero.who} hot>
                <Chip size={16} shadow={0} bg={C.coral}>
                  {DESK.hero.score}
                </Chip>
                <span style={{ transform: `scale(${pop(frame, DROP_AT)})` }}>
                  <Chip size={16} shadow={0} bg={C.mint}>
                    {DESK.hero.visit}
                  </Chip>
                </span>
              </LeadCard>
            </div>
          </Card>
        </div>
      </AbsoluteFill>

      {/* The booking fans out to the team's tools. */}
      {DESK.integrations.map((it, i) => {
        const p = progress(frame, FLY_AT[i]!, FLY_AT[i]! + FLY_FRAMES, SMOOTH);
        const startX = BOARD.x + tx + COL_W / 2;
        const startY = BOARD.y + ty + CARD_H / 2;
        const endX = INTEGRATIONS.x;
        const endY = INTEGRATIONS.y + i * INTEGRATIONS.gap;
        const x = startX + (endX - startX) * p;
        const y = startY + (endY - startY) * p - 120 * Math.sin(p * Math.PI);
        return (
          <At key={it.name} x={x} y={y} scale={0.3 + 0.7 * pop(frame, FLY_AT[i]!)} opacity={progress(frame, FLY_AT[i]!, FLY_AT[i]! + 4)} rotate={tween(frame, [FLY_AT[i]!, FLY_AT[i]! + FLY_FRAMES], [-12, i % 2 ? 2 : -2])} origin="left center">
            <Card style={{ width: INTEGRATIONS.w, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 18 }} shadow={8}>
              <span style={{ width: 56, height: 56, borderRadius: 16, background: INTEGRATION_COLORS[i], border: `${OUTLINE - 1}px solid ${C.ink}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="bolt" size={32} color={C.canvas} stroke={2.6} />
              </span>
              <div>
                <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 36, letterSpacing: '-0.02em', lineHeight: 1 }}>{it.name}</div>
                <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 22, color: C.inkSoft, marginTop: 6 }}>{it.detail}</div>
              </div>
            </Card>
          </At>
        );
      })}

      <div style={{ position: 'absolute', left: 1600, top: 830, transform: `translateY(${(1 - pop(frame, 30)) * 300}px)` }}>
        <Mascot size={300} state="cool" seed={31} />
      </div>
    </AbsoluteFill>
  );
}
