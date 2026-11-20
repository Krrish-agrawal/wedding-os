import type { ReactNode } from 'react';
import { C, OUTLINE } from '../brand';
import { TOUR } from '../content';
import { pop, progress, SMOOTH } from '../lib/anim';
import { Chip } from '../ui/kit';
import { STAGE } from './stage';

/** Isometric projection: x runs down-right, y runs down-left, z is up. Units are roughly feet. */
const K = 22;
const COS = Math.cos(Math.PI / 6);
const SIN = 0.5;
type P3 = [number, number, number];
const iso = ([x, y, z]: P3): [number, number] => [(x - y) * COS * K, (x + y) * SIN * K - z * K];
const pts = (list: P3[]) => list.map((p) => iso(p).join(',')).join(' ');

const shade = (color: string, pct: number) => `color-mix(in srgb, ${C.ink} ${pct}%, ${color})`;

interface BoxSpec {
  x: number;
  y: number;
  z?: number;
  w: number;
  d: number;
  h: number;
  color: string;
  /** A round crown on top, for plants. */
  crown?: string;
}

/** A box with its three visible faces (top, front-left, front-right), outlined in ink. */
function Box({ x, y, z = 0, w, d, h, color, crown }: BoxSpec) {
  const line = { stroke: C.ink, strokeWidth: 3, strokeLinejoin: 'round' as const };
  const [cx, cy] = iso([x + w / 2, y + d / 2, z + h + 1.4]);
  return (
    <g>
      <polygon points={pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]])} fill={shade(color, 10)} {...line} />
      <polygon points={pts([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]])} fill={shade(color, 22)} {...line} />
      <polygon points={pts([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]])} fill={color} {...line} />
      {crown && <circle cx={cx} cy={cy} r={1.5 * K} fill={crown} stroke={C.ink} strokeWidth={OUTLINE} />}
    </g>
  );
}

const LENGTH = 40;
const DEPTH = 16;
const WALL = 9;

/** Furniture, drawn back to front. */
const FURNITURE: BoxSpec[] = [
  { x: 0, y: 2, w: 2.6, d: 11, h: 3.4, color: C.mintTint },
  { x: 4, y: 5, w: 11, d: 8, h: 0.2, color: C.sunTint },
  { x: 7, y: 7, w: 4.5, d: 3, h: 1.6, color: C.canvas },
  { x: 5, y: 13.6, w: 9, d: 1.6, h: 5, color: C.grape },
  { x: 5, y: 11.4, w: 9, d: 2.4, h: 2.6, color: C.grape },
  { x: 37, y: 0, w: 3, d: 8, h: 8, color: C.tangerineTint },
  { x: 25.5, y: 4, w: 1, d: 8, h: 4.8, color: C.coral },
  { x: 26.5, y: 4, w: 9.5, d: 8, h: 2.2, color: C.coralTint },
  { x: 27, y: 5, w: 2, d: 2.6, h: 2.9, color: C.canvas },
  { x: 27, y: 8.4, w: 2, d: 2.6, h: 2.9, color: C.canvas },
  { x: 33, y: 13, w: 3, d: 2.5, h: 2.4, color: C.sunTint },
  { x: 18.2, y: 0.8, w: 1.6, d: 1.6, h: 2, color: C.coral, crown: C.mint },
];

/** Tall black-framed windows on the back wall (y = 0), as x ranges. */
const WINDOWS: Array<[number, number]> = [
  [4, 9],
  [11, 16],
  [28, 34],
];

function Room() {
  const line = { stroke: C.ink, strokeWidth: OUTLINE, strokeLinejoin: 'round' as const };
  const parts: ReactNode[] = [];
  // Floor, then the two back walls.
  parts.push(<polygon key="floor" points={pts([[0, 0, 0], [LENGTH, 0, 0], [LENGTH, DEPTH, 0], [0, DEPTH, 0]])} fill="color-mix(in srgb, var(--color-tangerine) 18%, var(--color-canvas))" {...line} />);
  parts.push(<polygon key="wallX" points={pts([[0, 0, 0], [0, DEPTH, 0], [0, DEPTH, WALL], [0, 0, WALL]])} fill={C.blueTint} {...line} />);
  parts.push(<polygon key="wallY" points={pts([[0, 0, 0], [LENGTH, 0, 0], [LENGTH, 0, WALL], [0, 0, WALL]])} fill={C.canvas} {...line} />);
  WINDOWS.forEach(([a, b], i) => {
    parts.push(<polygon key={`w${i}`} points={pts([[a, 0, 1.2], [b, 0, 1.2], [b, 0, 8], [a, 0, 8]])} fill="color-mix(in srgb, var(--color-blue) 28%, var(--color-canvas))" stroke={C.ink} strokeWidth={5} />);
    const mid = (a + b) / 2;
    parts.push(<polyline key={`m${i}`} points={pts([[mid, 0, 1.2], [mid, 0, 8]])} fill="none" stroke={C.ink} strokeWidth={4} />);
  });
  // Partition with a doorway between the living room and the bedroom.
  const partition: BoxSpec[] = [
    { x: 22.5, y: 0, w: 0.6, d: 5.5, h: WALL, color: C.canvas },
    { x: 22.5, y: 10, w: 0.6, d: 6, h: WALL, color: C.canvas },
  ];
  const all = [...FURNITURE, ...partition].sort((p, q) => p.x + p.w / 2 + p.y + p.d / 2 - (q.x + q.w / 2 + q.y + q.d / 2));
  all.forEach((b, i) => parts.push(<Box key={`b${i}`} {...b} />));
  return <g>{parts}</g>;
}

/** Camera focus points: the living room, then the bedroom. */
const FROM: P3 = [11, 8, 2];
const TO: P3 = [31, 8, 2];

export function TourView({ t }: { t: number }) {
  const move = progress(t, 14, 74, SMOOTH);
  const focus: P3 = [FROM[0] + (TO[0] - FROM[0]) * move, FROM[1], FROM[2]];
  const zoom = 1.12 + 0.16 * move;
  const [fx, fy] = iso(focus);
  const living = 1 - progress(t, 30, 38);
  const bedroom = pop(t, 40);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: C.paper }}>
      <svg width={STAGE.w} height={STAGE.h} viewBox={`0 0 ${STAGE.w} ${STAGE.h}`}>
        <g transform={`translate(${STAGE.w / 2} ${STAGE.h / 2 + 40}) scale(${zoom}) translate(${-fx} ${-fy})`}>
          <Room />
        </g>
      </svg>
      <div style={{ position: 'absolute', left: 28, top: 26, opacity: living }}>
        <Chip size={26}>{TOUR.rooms[0]}</Chip>
      </div>
      <div style={{ position: 'absolute', left: 28, top: 26, transform: `scale(${bedroom})`, transformOrigin: 'left center' }}>
        <Chip size={26} bg={C.coralTint}>
          {TOUR.rooms[1]}
        </Chip>
      </div>
    </div>
  );
}
