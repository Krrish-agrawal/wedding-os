import { C, FONT, OUTLINE } from '../brand';
import { SUN } from '../content';
import { pop, progress, settle, SMOOTH } from '../lib/anim';
import { Chip, Icon } from '../ui/kit';
import { STAGE } from './stage';

const COMPASS = { x: 270, y: 330, r: 200 };
/** The plan, north up, with the sun's arc on its south side. */
const PLAN = { x: 700, y: 140, w: 320, h: 240 };
const ARC = { cx: 860, cy: 330, r: 250 };

function arcPoint(f: number): [number, number] {
  // East (right) at sunrise, through south (bottom), to west (left) at sunset.
  const a = (f * Math.PI);
  return [ARC.cx + ARC.r * Math.cos(a), ARC.cy + ARC.r * 0.62 * Math.sin(a)];
}

export function SunView({ t }: { t: number }) {
  const swing = settle(t, 4);
  const needle = 70 * (1 - swing) + 8 * Math.sin(t / 6) * (1 - swing);
  const day = progress(t, 10, 80, SMOOTH);
  const [sx, sy] = arcPoint(day);
  const arcPath = Array.from({ length: 41 }, (_, i) => arcPoint(i / 40).join(',')).join(' ');
  const shown = Array.from({ length: Math.max(2, Math.round(day * 40) + 1) }, (_, i) => arcPoint(i / 40).join(',')).join(' ');
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.canvas, overflow: 'hidden' }}>
      <svg width={STAGE.w} height={STAGE.h} viewBox={`0 0 ${STAGE.w} ${STAGE.h}`}>
        {/* Compass. */}
        <circle cx={COMPASS.x} cy={COMPASS.y} r={COMPASS.r} fill={C.paper} stroke={C.ink} strokeWidth={OUTLINE + 1} />
        <circle cx={COMPASS.x} cy={COMPASS.y} r={COMPASS.r - 34} fill="none" stroke={C.line} strokeWidth={3} />
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2;
          const long = i % 6 === 0;
          const r1 = COMPASS.r - (long ? 30 : 18);
          return <line key={i} x1={COMPASS.x + r1 * Math.sin(a)} y1={COMPASS.y - r1 * Math.cos(a)} x2={COMPASS.x + (COMPASS.r - 6) * Math.sin(a)} y2={COMPASS.y - (COMPASS.r - 6) * Math.cos(a)} stroke={C.ink} strokeWidth={long ? 4 : 2.5} />;
        })}
        {(['N', 'E', 'S', 'W'] as const).map((d, i) => {
          const a = (i / 4) * Math.PI * 2;
          const r = COMPASS.r - 64;
          return (
            <text key={d} x={COMPASS.x + r * Math.sin(a)} y={COMPASS.y - r * Math.cos(a) + 14} textAnchor="middle" fontFamily="Bricolage Grotesque Variable" fontWeight={800} fontSize={40} fill={d === 'N' ? C.coral : C.ink}>
              {d}
            </text>
          );
        })}
        <g transform={`rotate(${needle} ${COMPASS.x} ${COMPASS.y})`}>
          <path d={`M${COMPASS.x} ${COMPASS.y - 120} L${COMPASS.x + 22} ${COMPASS.y} L${COMPASS.x - 22} ${COMPASS.y} Z`} fill={C.coral} stroke={C.ink} strokeWidth={4} strokeLinejoin="round" />
          <path d={`M${COMPASS.x} ${COMPASS.y + 120} L${COMPASS.x + 22} ${COMPASS.y} L${COMPASS.x - 22} ${COMPASS.y} Z`} fill={C.ink} stroke={C.ink} strokeWidth={4} strokeLinejoin="round" />
        </g>
        <circle cx={COMPASS.x} cy={COMPASS.y} r={12} fill={C.canvas} stroke={C.ink} strokeWidth={4} />

        {/* Sun path over the plan. */}
        <polyline points={arcPath} fill="none" stroke={C.sun} strokeWidth={5} strokeDasharray="4 14" strokeLinecap="round" />
        <polyline points={shown} fill="none" stroke={C.ink} strokeWidth={10} strokeLinecap="round" />
        <polyline points={shown} fill="none" stroke={C.sun} strokeWidth={5} strokeLinecap="round" />
        <polygon points={`${sx},${sy} ${PLAN.x + 30},${PLAN.y + PLAN.h} ${PLAN.x + PLAN.w - 30},${PLAN.y + PLAN.h}`} fill="color-mix(in srgb, var(--color-sun) 30%, transparent)" />
        <rect x={PLAN.x} y={PLAN.y} width={PLAN.w} height={PLAN.h} rx={6} fill={C.paper} stroke={C.ink} strokeWidth={8} />
        <path d={`M${PLAN.x + 180} ${PLAN.y} L${PLAN.x + 180} ${PLAN.y + PLAN.h} M${PLAN.x} ${PLAN.y + 100} L${PLAN.x + 180} ${PLAN.y + 100}`} stroke={C.ink} strokeWidth={5} />
        <rect x={PLAN.x + 120} y={PLAN.y - 10} width={50} height={20} fill={C.coral} stroke={C.ink} strokeWidth={3} />
        <g transform={`translate(${sx} ${sy})`}>
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2 + t / 20;
            return <line key={i} x1={36 * Math.cos(a)} y1={36 * Math.sin(a)} x2={50 * Math.cos(a)} y2={50 * Math.sin(a)} stroke={C.ink} strokeWidth={5} strokeLinecap="round" />;
          })}
          <circle r={26} fill={C.sun} stroke={C.ink} strokeWidth={OUTLINE} />
        </g>
        {SUN.times.map((label, i) => {
          const [x, y] = arcPoint(i / (SUN.times.length - 1));
          const out = 72;
          const dx = ((x - ARC.cx) / ARC.r) * out;
          const dy = ((y - ARC.cy) / (ARC.r * 0.62)) * 52;
          return (
            <text key={label} x={x + dx} y={y + dy + 8} textAnchor="middle" fontFamily="Plus Jakarta Sans Variable" fontWeight={700} fontSize={22} fill={C.inkSoft}>
              {label}
            </text>
          );
        })}
      </svg>
      <div style={{ position: 'absolute', left: 60, top: 24, transform: `scale(${pop(t, 24)})`, transformOrigin: 'left center', fontFamily: FONT.sans }}>
        <Chip size={26} bg={C.coralTint}>
          {SUN.facing}
        </Chip>
      </div>
      <div style={{ position: 'absolute', right: 30, top: 24, display: 'flex', gap: 12 }}>
        <div style={{ transform: `scale(${pop(t, 8)})` }}>
          <Chip size={24} bg={C.sunTint}>
            <Icon name="sun" size={26} /> {SUN.path}
          </Chip>
        </div>
      </div>
      <div style={{ position: 'absolute', right: 30, bottom: 24, transform: `scale(${pop(t, 48)})`, transformOrigin: 'right center' }}>
        <Chip size={26} bg={C.mintTint}>
          <Icon name="check" size={28} /> {SUN.vastu}
        </Chip>
      </div>
    </div>
  );
}
