import { C, FONT } from '../brand';
import { BLUEPRINT } from '../content';
import { pop, progress, SMOOTH } from '../lib/anim';
import { Chip } from '../ui/kit';
import { STAGE } from './stage';

interface RoomRect {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const R = BLUEPRINT.rooms;
const ROOMS: RoomRect[] = [
  { label: R.kitchen, x: 150, y: 80, w: 250, h: 170 },
  { label: R.study, x: 400, y: 80, w: 220, h: 170 },
  { label: R.living, x: 150, y: 250, w: 470, h: 370 },
  { label: R.wardrobe, x: 620, y: 80, w: 180, h: 220 },
  { label: R.bath, x: 800, y: 80, w: 200, h: 220 },
  { label: R.bedroom, x: 620, y: 300, w: 380, h: 320 },
];

const OUTER = { x: 150, y: 80, w: 850, h: 540 };
/** Room above the plan for the layer toggles. */
const PLAN_DROP = 40;

/** Wiring runs from the distribution board; plumbing runs from the riser. */
const WIRES = ['M190 590 L190 300 L380 300', 'M190 590 L560 590 L560 330', 'M190 590 L190 225 L350 225', 'M560 590 L700 590 L700 380 L920 380'];
const WIRE_POINTS: Array<[number, number]> = [
  [380, 300],
  [560, 330],
  [350, 225],
  [920, 380],
];
const PIPES = ['M640 110 L210 110 L210 160', 'M640 110 L845 110 L845 165', 'M845 110 L965 110 L965 255'];
const PIPE_POINTS: Array<[number, number]> = [
  [210, 160],
  [845, 165],
  [965, 255],
];

function Toggle({ on, label, color }: { on: number; label: string; color: string }) {
  return (
    <Chip size={24} bg={C.canvas}>
      <span style={{ position: 'relative', width: 54, height: 30, borderRadius: 15, border: `3px solid ${C.ink}`, background: `color-mix(in srgb, ${color} ${on * 100}%, ${C.line})` }}>
        <span style={{ position: 'absolute', top: 2, left: 2 + on * 24, width: 20, height: 20, borderRadius: '50%', background: C.canvas, border: `3px solid ${C.ink}` }} />
      </span>
      {label}
    </Chip>
  );
}

export function BlueprintView({ t }: { t: number }) {
  const walls = progress(t, 0, 20, SMOOTH);
  const labels = progress(t, 12, 22);
  const wiring = progress(t, 22, 46, SMOOTH);
  const plumbing = progress(t, 40, 62, SMOOTH);
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.canvas }}>
      <svg width={STAGE.w} height={STAGE.h} viewBox={`0 0 ${STAGE.w} ${STAGE.h}`}>
        <defs>
          <pattern id="grid" width={28} height={28} patternUnits="userSpaceOnUse">
            <path d="M28 0 L0 0 L0 28" fill="none" stroke={C.blueTint} strokeWidth={2} />
          </pattern>
        </defs>
        <rect width={STAGE.w} height={STAGE.h} fill="url(#grid)" />
        <g transform={`translate(0 ${PLAN_DROP})`}>
        {ROOMS.map((r) => (
          <rect key={r.label} x={r.x} y={r.y} width={r.w} height={r.h} fill={C.paper} stroke={C.ink} strokeWidth={7} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - walls} />
        ))}
        <rect x={OUTER.x} y={OUTER.y} width={OUTER.w} height={OUTER.h} fill="none" stroke={C.ink} strokeWidth={16} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - walls} strokeLinejoin="round" />
        {/* Doorways cut into the interior walls. */}
        {[
          [400, 330, 400, 410],
          [620, 420, 620, 500],
          [700, 300, 780, 300],
          [800, 160, 800, 230],
        ].map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.paper} strokeWidth={10} opacity={walls} />
        ))}
        {ROOMS.map((r) => (
          <text key={`l${r.label}`} x={r.x + r.w / 2} y={r.y + r.h / 2 + 10} textAnchor="middle" fontFamily="Plus Jakarta Sans Variable" fontWeight={700} fontSize={r.w > 300 ? 30 : 24} fill={C.inkSoft} opacity={labels}>
            {r.label}
          </text>
        ))}

        {/* Wiring layer. */}
        <g opacity={wiring > 0 ? 1 : 0}>
          {WIRES.map((d, i) => (
            <g key={d}>
              <path d={d} fill="none" stroke={C.ink} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress(t, 22 + i * 3, 40 + i * 3, SMOOTH)} />
              <path d={d} fill="none" stroke={C.sun} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress(t, 22 + i * 3, 40 + i * 3, SMOOTH)} />
            </g>
          ))}
          {WIRE_POINTS.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={11 * pop(t, 36 + i * 3)} fill={C.sun} stroke={C.ink} strokeWidth={3} />
          ))}
          <rect x={170} y={572} width={40} height={36} rx={6} fill={C.sun} stroke={C.ink} strokeWidth={3} opacity={wiring} />
          <text x={190} y={597} textAnchor="middle" fontFamily="Plus Jakarta Sans Variable" fontWeight={800} fontSize={16} fill={C.ink} opacity={wiring}>
            {BLUEPRINT.board}
          </text>
        </g>

        {/* Plumbing layer. */}
        <g opacity={plumbing > 0 ? 1 : 0}>
          {PIPES.map((d, i) => (
            <g key={d}>
              <path d={d} fill="none" stroke={C.ink} strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress(t, 40 + i * 4, 58 + i * 4, SMOOTH)} />
              <path d={d} fill="none" stroke={C.blue} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress(t, 40 + i * 4, 58 + i * 4, SMOOTH)} />
            </g>
          ))}
          <circle cx={640} cy={110} r={18 * pop(t, 40)} fill={C.blue} stroke={C.ink} strokeWidth={4} />
          {PIPE_POINTS.map(([x, y], i) => {
            const s = pop(t, 56 + i * 4);
            return <path key={i} transform={`translate(${x} ${y + 8}) scale(${s})`} d="M0 -22 C 10 -8 14 -2 14 6 A 14 14 0 0 1 -14 6 C -14 -2 -10 -8 0 -22 Z" fill={C.blue} stroke={C.ink} strokeWidth={3} />;
          })}
        </g>
        </g>
      </svg>
      <div style={{ position: 'absolute', left: OUTER.x, top: 18, display: 'flex', gap: 14, fontFamily: FONT.sans }}>
        <Toggle on={progress(t, 20, 26)} label={BLUEPRINT.layers.wiring} color={C.sun} />
        <Toggle on={progress(t, 38, 44)} label={BLUEPRINT.layers.plumbing} color={C.blue} />
      </div>
    </div>
  );
}
