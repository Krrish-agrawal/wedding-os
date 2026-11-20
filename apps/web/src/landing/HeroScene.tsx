import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { MASCOT_SEAT_FRACTION, Mascot, type MascotState } from '@/ui';

/**
 * The landing hero illustration: a Bengaluru skyline (tower blocks, a tiled-roof house, rain trees,
 * an elevated metro) with the mascot sitting on the roof of the tallest block, legs dangling.
 * Drawn in the product's sticker style: ink outlines, flat fills from the palette, no gradients.
 * The SVG and the mascot share one coordinate frame, so the mascot sits exactly on the roof at any width.
 */

const SCENE = { w: 1440, h: 500, ground: 440 } as const;
const STROKE = 4;
const INK = 'var(--color-ink)';
const CANVAS = 'var(--color-canvas)';
const LIT = 'var(--color-sun)';

type Fill = 'sun-tint' | 'grape-tint' | 'mint-tint' | 'coral-tint' | 'blue-tint' | 'blue';

interface Block {
  x: number;
  w: number;
  top: number;
  fill: Fill;
  cols: number;
  antenna?: boolean;
}

/** Background blocks, left to right. The mascot's block is drawn separately. */
const BLOCKS: Block[] = [
  { x: 24, w: 150, top: 300, fill: 'sun-tint', cols: 3 },
  { x: 196, w: 120, top: 205, fill: 'grape-tint', cols: 2 },
  { x: 548, w: 150, top: 268, fill: 'mint-tint', cols: 3 },
  { x: 716, w: 104, top: 178, fill: 'coral-tint', cols: 2, antenna: true },
  { x: 1222, w: 112, top: 222, fill: 'sun-tint', cols: 2 },
  { x: 1350, w: 96, top: 318, fill: 'grape-tint', cols: 2 },
];

/** The block the mascot sits on. */
const HOME_BLOCK = { x: 880, w: 320, top: 250, cols: 5 } as const;
/** The mascot's width in scene units, and where along the roof it sits. */
const MASCOT_W = 230;
const MASCOT_SEAT_X = 1080;

const TREES = [
  { x: 184, r: 26 },
  { x: 526, r: 30 },
  { x: 846, r: 24 },
  { x: 1212, r: 22 },
  { x: 1418, r: 28 },
];

/** Clouds stay right of the headline copy, which overlaps the top-left of the scene. */
const CLOUDS = [
  { x: 740, y: 40, drift: -22 },
  { x: 1300, y: 150, drift: 18 },
];
const SUN = { x: 1360, y: 64, r: 38 };

const WINDOW = { h: 20, gapY: 16, padX: 16, gapX: 12, padTop: 22, groundClear: 52 } as const;
const METRO = { deckTop: 398, deckBottom: 412, pillarEvery: 180, pillarW: 18, carW: 118, carH: 32, cars: 3, carGap: 8 } as const;
const TRAIN_LOOP_S = 16;
const CLOUD_LOOP_S = 14;
/** The mascot greets, then cycles through a few moods while the visitor reads. */
const MOODS: MascotState[] = ['wave', 'idle', 'wink', 'idle', 'cool', 'idle', 'love', 'idle'];
const MOOD_MS = 2600;

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/** A deterministic sprinkle of lit windows, so the skyline looks lived-in without randomness between renders. */
const isLit = (i: number) => (i * 7 + 3) % 5 === 0;

function Windows({ x, w, top, cols, lit }: { x: number; w: number; top: number; cols: number; lit: string }) {
  const winW = (w - 2 * WINDOW.padX - (cols - 1) * WINDOW.gapX) / cols;
  const rows = Math.max(1, Math.floor((SCENE.ground - WINDOW.groundClear - (top + WINDOW.padTop) + WINDOW.gapY) / (WINDOW.h + WINDOW.gapY)));
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c + Math.round(x);
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={x + WINDOW.padX + c * (winW + WINDOW.gapX)}
          y={top + WINDOW.padTop + r * (WINDOW.h + WINDOW.gapY)}
          width={winW}
          height={WINDOW.h}
          rx={3}
          fill={isLit(i) ? lit : CANVAS}
          stroke={INK}
          strokeWidth={3}
        />,
      );
    }
  }
  return <g>{cells}</g>;
}

function BlockShape({ block }: { block: Block }) {
  const { x, w, top, fill, cols, antenna } = block;
  return (
    <g>
      {antenna && <line x1={x + w / 2} y1={top} x2={x + w / 2} y2={top - 30} stroke={INK} strokeWidth={STROKE} strokeLinecap="round" />}
      {antenna && <circle cx={x + w / 2} cy={top - 34} r={6} fill="var(--color-coral)" stroke={INK} strokeWidth={3} />}
      <rect x={x} y={top} width={w} height={SCENE.ground - top} fill={`var(--color-${fill})`} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
      <Windows x={x} w={w} top={top} cols={cols} lit={LIT} />
    </g>
  );
}

function HomeBlock() {
  const { x, w, top, cols } = HOME_BLOCK;
  const tank = { x: x + 22, w: 58, h: 34 };
  const door = { w: 46, h: 54 };
  return (
    <g>
      {/* A black rooftop water tank: every Bengaluru terrace has one. */}
      <rect x={tank.x} y={top - tank.h} width={tank.w} height={tank.h} rx={8} fill={INK} stroke={INK} strokeWidth={STROKE} />
      <ellipse cx={tank.x + tank.w / 2} cy={top - tank.h} rx={tank.w / 2} ry={7} fill={INK} stroke={INK} strokeWidth={STROKE} />
      <path d={`M${tank.x + 10} ${top - tank.h + 10} L${tank.x + 10} ${top - 8}`} stroke={CANVAS} strokeWidth={3} strokeLinecap="round" opacity={0.35} />
      <rect x={x} y={top} width={w} height={SCENE.ground - top} fill="var(--color-blue)" stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
      {/* Parapet the mascot sits on. */}
      <rect x={x - 8} y={top - 10} width={w + 16} height={14} rx={4} fill={CANVAS} stroke={INK} strokeWidth={STROKE} />
      <Windows x={x} w={w} top={top + 6} cols={cols} lit={LIT} />
      <rect x={x + w / 2 - door.w / 2} y={SCENE.ground - door.h} width={door.w} height={door.h} rx={6} fill="var(--color-sun)" stroke={INK} strokeWidth={STROKE} />
    </g>
  );
}

function House() {
  const x = 340;
  const w = 170;
  const wallTop = 372;
  const apexY = 300;
  return (
    <g>
      <rect x={x} y={wallTop} width={w} height={SCENE.ground - wallTop} fill={CANVAS} stroke={INK} strokeWidth={STROKE} />
      {/* Clay-tile roof. */}
      <path d={`M${x - 16} ${wallTop + 4} L${x + w / 2} ${apexY} L${x + w + 16} ${wallTop + 4} Z`} fill="var(--color-coral)" stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M${x + 4 + i * 14} ${wallTop - 8 - i * 20} L${x + w - 4 - i * 14} ${wallTop - 8 - i * 20}`}
          stroke={INK}
          strokeWidth={2.5}
          opacity={0.35}
          strokeLinecap="round"
        />
      ))}
      <rect x={x + 22} y={wallTop + 18} width={40} height={30} rx={4} fill={LIT} stroke={INK} strokeWidth={3} />
      <rect x={x + 102} y={wallTop + 20} width={40} height={SCENE.ground - wallTop - 20} rx={4} fill="var(--color-mint)" stroke={INK} strokeWidth={3} />
      {/* "TO-LET" board, the city's most familiar sign. */}
      <g transform={`rotate(-4 ${x + w / 2} ${wallTop - 2})`}>
        <rect x={x + 44} y={wallTop + 52} width={64} height={22} rx={4} fill={CANVAS} stroke={INK} strokeWidth={3} />
        <text x={x + 76} y={wallTop + 68} textAnchor="middle" fontFamily="var(--font-display)" fontWeight={800} fontSize={14} fill="var(--color-coral-deep)">
          TO-LET
        </text>
      </g>
    </g>
  );
}

function Tree({ x, r }: { x: number; r: number }) {
  const cy = SCENE.ground - r - 22;
  return (
    <g>
      <rect x={x - 4} y={cy} width={8} height={SCENE.ground - cy} fill="var(--color-tangerine-deep)" stroke={INK} strokeWidth={3} />
      <circle cx={x} cy={cy} r={r} fill="var(--color-mint)" stroke={INK} strokeWidth={STROKE} />
      <circle cx={x - r * 0.35} cy={cy - r * 0.35} r={r * 0.22} fill={CANVAS} opacity={0.35} />
    </g>
  );
}

function Cloud({ x, y }: { x: number; y: number }) {
  const puffs = [
    { dx: 0, dy: 0, r: 24 },
    { dx: 30, dy: -12, r: 30 },
    { dx: 62, dy: 0, r: 22 },
  ];
  return (
    <g>
      {/* Ink puffs drawn a little larger first give the merged cloud one clean outline. */}
      {puffs.map((p, i) => (
        <circle key={`o${i}`} cx={x + p.dx} cy={y + p.dy} r={p.r + 3} fill={INK} />
      ))}
      <rect x={x - 3} y={y} width={68} height={27} rx={10} fill={INK} />
      {puffs.map((p, i) => (
        <circle key={`f${i}`} cx={x + p.dx} cy={y + p.dy} r={p.r} fill={CANVAS} />
      ))}
      <rect x={x} y={y} width={62} height={24} rx={8} fill={CANVAS} />
    </g>
  );
}

function Train() {
  const { carW, carH, cars, carGap, deckTop } = METRO;
  const y = deckTop - carH - 2;
  return (
    <g>
      {Array.from({ length: cars }, (_, i) => {
        const x = i * (carW + carGap);
        const nose = i === cars - 1;
        return (
          <g key={i}>
            <rect x={x} y={y} width={carW} height={carH} rx={nose ? 14 : 6} fill={CANVAS} stroke={INK} strokeWidth={3} />
            <rect x={x + 3} y={y + carH - 11} width={carW - 6} height={5} fill="var(--color-grape)" />
            {[0, 1, 2, 3].map((w) => (
              <rect key={w} x={x + 12 + w * 26} y={y + 6} width={16} height={10} rx={2} fill="var(--color-blue-tint)" stroke={INK} strokeWidth={2} />
            ))}
          </g>
        );
      })}
    </g>
  );
}

function Metro() {
  const reduce = useReducedMotion();
  const { deckTop, deckBottom, pillarEvery, pillarW } = METRO;
  const trainW = METRO.cars * (METRO.carW + METRO.carGap);
  const pillars = [];
  for (let x = 60; x < SCENE.w; x += pillarEvery) {
    pillars.push(<rect key={x} x={x} y={deckBottom} width={pillarW} height={SCENE.ground - deckBottom} fill={CANVAS} stroke={INK} strokeWidth={3} />);
  }
  return (
    <g>
      {pillars}
      <motion.g
        initial={false}
        animate={reduce ? { x: SCENE.w * 0.18 } : { x: [-trainW - 40, SCENE.w + 40] }}
        transition={reduce ? { duration: 0 } : { duration: TRAIN_LOOP_S, ease: 'linear', repeat: Infinity }}
      >
        <Train />
      </motion.g>
      <rect x={-10} y={deckTop} width={SCENE.w + 20} height={deckBottom - deckTop} fill={CANVAS} stroke={INK} strokeWidth={STROKE} />
    </g>
  );
}

export function HeroScene({ advisor }: { advisor: string }) {
  const reduce = useReducedMotion();
  const [mood, setMood] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setMood((m) => (m + 1) % MOODS.length), MOOD_MS);
    return () => clearInterval(t);
  }, [reduce]);
  const mascotState = reduce ? 'idle' : MOODS[mood]!;

  const mascotLeft = MASCOT_SEAT_X - MASCOT_W / 2;
  const mascotTop = HOME_BLOCK.top - 10 - MASCOT_SEAT_FRACTION * MASCOT_W;

  return (
    <div className="relative w-full" style={{ aspectRatio: `${SCENE.w} / ${SCENE.h}` }}>
      <svg viewBox={`0 0 ${SCENE.w} ${SCENE.h}`} className="absolute inset-0 h-full w-full" aria-hidden>
        <circle cx={SUN.x} cy={SUN.y} r={SUN.r} fill="var(--color-sun)" stroke={INK} strokeWidth={STROKE} />
        {CLOUDS.map((c, i) => (
          <motion.g
            key={i}
            initial={false}
            animate={reduce ? { x: 0 } : { x: [0, c.drift, 0] }}
            transition={reduce ? { duration: 0 } : { duration: CLOUD_LOOP_S + i * 3, ease: 'easeInOut', repeat: Infinity }}
          >
            <Cloud x={c.x} y={c.y} />
          </motion.g>
        ))}
        <g fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M858 120 q8 -8 16 0 q8 -8 16 0" />
          <path d="M900 140 q6 -6 12 0 q6 -6 12 0" />
        </g>

        {BLOCKS.slice(0, 2).map((b) => (
          <BlockShape key={b.x} block={b} />
        ))}
        <House />
        {BLOCKS.slice(2, 4).map((b) => (
          <BlockShape key={b.x} block={b} />
        ))}
        <HomeBlock />
        {BLOCKS.slice(4).map((b) => (
          <BlockShape key={b.x} block={b} />
        ))}

        <Metro />
        {TREES.map((t) => (
          <Tree key={t.x} x={t.x} r={t.r} />
        ))}
        <rect x={-10} y={SCENE.ground} width={SCENE.w + 20} height={SCENE.h - SCENE.ground + 10} fill="var(--color-mint-tint)" stroke={INK} strokeWidth={STROKE} />
        <path d={`M0 ${SCENE.ground + 32} H${SCENE.w}`} stroke={INK} strokeWidth={3} strokeDasharray="22 18" opacity={0.25} />
      </svg>

      <div className="absolute" style={{ left: pct(mascotLeft, SCENE.w), top: pct(mascotTop, SCENE.h), width: pct(MASCOT_W, SCENE.w) }}>
        <Mascot state={mascotState} seated alive size="100%" title={`${advisor}, the Agora Virtual Estates advisor`} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8, rotate: -2 }}
        animate={{ opacity: 1, y: 0, rotate: -2 }}
        transition={{ delay: 0.5, type: 'spring', stiffness: 320, damping: 22 }}
        className="absolute rounded-[18px] border-2 border-ink bg-canvas px-4 py-2.5 text-[clamp(13px,1.1vw,16px)] font-bold leading-snug shadow-[var(--shadow-pop)]"
        style={{ right: pct(SCENE.w - mascotLeft + 6, SCENE.w), top: pct(mascotTop - 24, SCENE.h) }}
      >
        Namaskara! I'm {advisor}.
        <br />
        Want a tour of Bengaluru?
        <span aria-hidden className="absolute -right-[9px] bottom-4 h-4 w-4 -rotate-45 border-b-2 border-r-2 border-ink bg-canvas" />
      </motion.div>
    </div>
  );
}
