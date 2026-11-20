import { C, FONT, OUTLINE } from '../brand';
import { LOCALITY } from '../content';
import { pop, progress, SMOOTH } from '../lib/anim';
import { Chip, Icon } from '../ui/kit';
import { STAGE } from './stage';

const HOME: [number, number] = [520, 380];
const METRO: [number, number] = [700, 322];
const MG_ROAD: [number, number] = [150, 250];
const ROUTE = 'M520 380 L520 420 L300 420 L300 250 L150 250';
/** The metro line crosses the map on a diagonal. */
const METRO_LINE = 'M-20 650 L1170 110';

const BLOCKS: Array<[number, number, number, number]> = [];
for (let r = 0; r < 6; r++) {
  for (let c = 0; c < 9; c++) {
    BLOCKS.push([20 + c * 132, 20 + r * 118, 108, 92]);
  }
}

function Pin({ x, y, color, scale }: { x: number; y: number; color: string; scale: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M0 0 C -6 -14 -26 -26 -26 -46 A 26 26 0 0 1 26 -46 C 26 -26 6 -14 0 0 Z" fill={color} stroke={C.ink} strokeWidth={OUTLINE} strokeLinejoin="round" />
      <circle cx={0} cy={-46} r={10} fill={C.canvas} stroke={C.ink} strokeWidth={3} />
    </g>
  );
}

export function LocalityView({ t }: { t: number }) {
  const route = progress(t, 18, 50, SMOOTH);
  const [metro, mg, airport] = LOCALITY.pins;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: C.mintTint }}>
      <svg width={STAGE.w} height={STAGE.h} viewBox={`0 0 ${STAGE.w} ${STAGE.h}`}>
        {BLOCKS.map(([x, y, w, h], i) => (
          <rect key={i} x={x} y={y} width={w} height={h} rx={14} fill={C.canvas} stroke={C.line} strokeWidth={3} />
        ))}
        <ellipse cx={930} cy={520} rx={150} ry={90} fill="color-mix(in srgb, var(--color-mint) 45%, var(--color-canvas))" stroke={C.ink} strokeWidth={3} />
        {/* Main roads. */}
        <path d="M0 420 L1148 420" stroke={C.inkMute} strokeWidth={30} />
        <path d="M0 420 L1148 420" stroke={C.canvas} strokeWidth={22} />
        <path d="M300 0 L300 696" stroke={C.inkMute} strokeWidth={26} />
        <path d="M300 0 L300 696" stroke={C.canvas} strokeWidth={18} />
        <path d={METRO_LINE} stroke={C.ink} strokeWidth={18} />
        <path d={METRO_LINE} stroke={C.grape} strokeWidth={11} />
        <text x={930} y={196} fontFamily="Plus Jakarta Sans Variable" fontWeight={800} fontSize={22} fill={C.grapeDeep} transform="rotate(-24.4 930 196)">
          {LOCALITY.metroLine}
        </text>
        {/* Route to MG Road. */}
        <path d={ROUTE} fill="none" stroke={C.ink} strokeWidth={14} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - route} />
        <path d={ROUTE} fill="none" stroke={C.blue} strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - route} />
        <circle cx={METRO[0]} cy={METRO[1]} r={16 * pop(t, 10)} fill={C.canvas} stroke={C.ink} strokeWidth={5} />
        <Pin x={MG_ROAD[0]} y={MG_ROAD[1]} color={C.blue} scale={pop(t, 46)} />
        <Pin x={HOME[0]} y={HOME[1]} color={C.coral} scale={pop(t, 2)} />
      </svg>
      <Label x={HOME[0] - 100} y={HOME[1] + 18} scale={pop(t, 6)} bg={C.canvas}>
        <Icon name="home" size={24} /> {LOCALITY.home}
      </Label>
      <Label x={METRO[0] + 24} y={METRO[1] + 16} scale={pop(t, 14)} bg={C.grapeTint}>
        {metro!.label} · <b>{metro!.time}</b>
      </Label>
      <Label x={MG_ROAD[0] - 60} y={MG_ROAD[1] + 16} scale={pop(t, 50)} bg={C.blueTint}>
        {mg!.label} · <b>{mg!.time}</b>
      </Label>
      <Label x={STAGE.w - 300} y={28} scale={pop(t, 58)} bg={C.sunTint}>
        {airport!.label} · <b>{airport!.time}</b> →
      </Label>
    </div>
  );
}

function Label({ x, y, scale, bg, children }: { x: number; y: number; scale: number; bg: string; children: React.ReactNode }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `scale(${scale})`, transformOrigin: 'left top', fontFamily: FONT.sans }}>
      <Chip size={24} bg={bg}>
        {children}
      </Chip>
    </div>
  );
}
