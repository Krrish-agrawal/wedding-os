import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, FONT, OUTLINE } from '../brand';
import { TRAFFIC } from '../content';
import { Mascot } from '../mascot/Mascot';
import { pop, progress, sec, SMOOTH, wobble } from '../lib/anim';
import { Background } from '../ui/Background';
import { At, Card, Chip } from '../ui/kit';
import { TypeLine } from '../ui/Type';

const ROAD_TOP = 560;
const ROAD_H = 380;
const DASH = 90;
const DASH_GAP = 70;
const LANE_SPEED = 2.4;
const ROAD_ZOOM = 1.15;

interface CarSpec {
  x: number;
  lane: 0 | 1;
  color: string;
  honkAt?: number;
}

const CARS: CarSpec[] = [
  { x: -120, lane: 0, color: C.grape },
  { x: 250, lane: 0, color: C.coral, honkAt: 34 },
  { x: 620, lane: 0, color: C.mint },
  { x: 990, lane: 0, color: C.tangerine },
  { x: 1360, lane: 0, color: C.blueDeep, honkAt: 66 },
  { x: 1730, lane: 0, color: C.grape },
  { x: 40, lane: 1, color: C.tangerine },
  { x: 1150, lane: 1, color: C.coral, honkAt: 50 },
  { x: 1520, lane: 1, color: C.mint },
];

/** Where the mascot's open-top car sits in the front lane. */
const HERO_X = 640;
const LANE_BASE = [190, 340];

function CarShape({ color, roof }: { color: string; roof: boolean }) {
  const ink = { stroke: C.ink, strokeWidth: OUTLINE, strokeLinejoin: 'round' as const };
  return (
    <g>
      {roof && (
        <>
          <path d="M62 -92 L100 -158 L212 -158 L252 -92 Z" fill={color} {...ink} />
          <path d="M84 -98 L110 -144 L152 -144 L152 -98 Z" fill={C.blueTint} {...ink} strokeWidth={3} />
          <path d="M164 -98 L164 -144 L204 -144 L232 -98 Z" fill={C.blueTint} {...ink} strokeWidth={3} />
        </>
      )}
      <rect x={0} y={-96} width={310} height={88} rx={28} fill={color} {...ink} />
      <rect x={18} y={-80} width={60} height={10} rx={5} fill={C.canvas} opacity={0.55} />
      <circle cx={296} cy={-58} r={9} fill={C.sun} {...ink} strokeWidth={3} />
      {[72, 238].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={-6} r={30} fill={C.ink} />
          <circle cx={cx} cy={-6} r={12} fill={C.line} />
        </g>
      ))}
    </g>
  );
}

function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function Traffic() {
  const frame = useCurrentFrame();
  const dashOffset = -((frame * LANE_SPEED) % (DASH + DASH_GAP));
  const creep = (i: number) => frame * 0.5 + 5 * Math.max(0, wobble(frame, 1.4, i));
  const bob = (i: number) => 1.6 * wobble(frame, 0.5, i * 1.7);

  const clockT = progress(frame, 6, sec(3.2), SMOOTH);
  const step = 10;
  const minutes = Math.round((TRAFFIC.clockFrom + (TRAFFIC.clockTo - TRAFFIC.clockFrom) * clockT) / step) * step;
  const handTurns = ((minutes - TRAFFIC.clockFrom) / 60) * 360;

  const heroBase = ROAD_TOP + LANE_BASE[1]!;
  const heroX = HERO_X + creep(99);

  return (
    <AbsoluteFill>
      <Background palette="warm" />
      <At x={140} y={110}>
        <TypeLine pieces={TRAFFIC.headline} at={2} size={96} />
      </At>

      {/* The clock races through the day. */}
      <At x={1330} y={96} scale={pop(frame, 4)} origin="top right">
        <Card style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '18px 30px 18px 22px' }}>
          <svg width={78} height={78} viewBox="0 0 78 78">
            <circle cx={39} cy={39} r={34} fill={C.sunTint} stroke={C.ink} strokeWidth={OUTLINE} />
            <line x1={39} y1={39} x2={39} y2={16} stroke={C.ink} strokeWidth={4} strokeLinecap="round" transform={`rotate(${handTurns * 12} 39 39)`} />
            <line x1={39} y1={39} x2={39} y2={24} stroke={C.coral} strokeWidth={5} strokeLinecap="round" transform={`rotate(${handTurns} 39 39)`} />
            <circle cx={39} cy={39} r={4} fill={C.ink} />
          </svg>
          <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 56, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', minWidth: 330 }}>
            {TRAFFIC.day} {formatClock(minutes)}
          </div>
        </Card>
      </At>
      <At x={1450} y={250} scale={pop(frame, 14)} origin="top right">
        <Chip bg={C.coralTint} size={30}>
          {TRAFFIC.tally}
        </Chip>
      </At>

      {/* Road, lane markings and the jam, scaled up a touch to fill the frame. */}
      <AbsoluteFill style={{ transform: `scale(${ROAD_ZOOM})`, transformOrigin: '50% 75%' }}>
      <svg width={1920} height={ROAD_H + 140} style={{ position: 'absolute', left: 0, top: ROAD_TOP - 140 }} viewBox={`0 -140 1920 ${ROAD_H + 140}`}>
        <rect x={-10} y={20} width={1940} height={ROAD_H - 40} fill="color-mix(in srgb, var(--color-ink) 14%, var(--color-canvas))" stroke={C.ink} strokeWidth={OUTLINE} />
        <line x1={-200} y1={ROAD_H / 2 + 10} x2={2120} y2={ROAD_H / 2 + 10} stroke={C.canvas} strokeWidth={10} strokeDasharray={`${DASH} ${DASH_GAP}`} strokeDashoffset={dashOffset} strokeLinecap="round" />
        {CARS.filter((c) => c.lane === 0).map((car, i) => (
          <g key={`a${i}`} transform={`translate(${car.x + creep(i)} ${LANE_BASE[0]! + bob(i)})`}>
            <CarShape color={car.color} roof />
          </g>
        ))}
        {CARS.filter((c) => c.lane === 1).map((car, i) => (
          <g key={`b${i}`} transform={`translate(${car.x + creep(i + 10)} ${LANE_BASE[1]! + bob(i + 10)})`}>
            <CarShape color={car.color} roof />
          </g>
        ))}
      </svg>

      {/* Honks. */}
      {CARS.map((car, i) => {
        if (car.honkAt === undefined) return null;
        const s = pop(frame, car.honkAt);
        const fade = 1 - progress(frame, car.honkAt + 22, car.honkAt + 30);
        const laneIndex = car.lane === 0 ? i : i - 6 + 10;
        return (
          <At key={i} x={car.x + creep(laneIndex) + 200} y={ROAD_TOP + LANE_BASE[car.lane]! - 250} scale={s} opacity={fade} rotate={-6} origin="bottom left">
            <Chip bg={C.sun} size={30} shadow={3}>
              {TRAFFIC.honk}
            </Chip>
          </At>
        );
      })}

      {/* The mascot dozes in an open-top car in the front lane. */}
      <div style={{ position: 'absolute', left: heroX + 78, top: heroBase - 262 + bob(99) }}>
        <Mascot size={250} state="sleepy" seed={5} shadow={false} />
      </div>
      <svg width={360} height={200} viewBox="-20 -160 360 200" style={{ position: 'absolute', left: heroX - 20, top: heroBase - 160 + bob(99) }}>
        <path d="M206 -92 L232 -138" stroke={C.ink} strokeWidth={OUTLINE + 2} strokeLinecap="round" />
        <path d="M206 -92 L232 -138" stroke={C.blueTint} strokeWidth={3} strokeLinecap="round" />
        <CarShape color={C.sun} roof={false} />
      </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
