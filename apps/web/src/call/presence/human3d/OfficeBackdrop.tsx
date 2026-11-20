import { memo } from 'react';
import { cn } from '@/ui';

/**
 * The room behind the advisor: a warm, bright office seen out of focus, as a webcam with a wide
 * aperture would show it. Drawn here as flat shapes and blurred, so nothing is downloaded and it
 * scales to any tile. Daylight from a window on the left, a bookshelf and a plant on the right,
 * a low cabinet at the bottom; kept pale and low in contrast so the advisor stands out, and
 * tinted towards the app's white and blue.
 */

const VIEW_W = 400;
const VIEW_H = 320;
/** Depth of field: how far out of focus the room is, in CSS pixels at tile size. */
const BLUR_PX = 7;
/** Enlarged so the blur never shows a soft edge at the tile border. */
const BLEED_SCALE = 1.08;

const ROOM = {
  wall: '#efe8df',
  wallShade: '#e6ddd2',
  daylight: '#e3eef8',
  daylightBright: '#f3f8fc',
  frame: '#f8f5f1',
  wood: '#c9a684',
  woodDark: '#b38f6d',
  cabinet: '#ddcbb6',
  pot: '#d8c8b5',
  leaf: '#8ea888',
  leafLight: '#a9bfa2',
  books: ['#9fb4cc', '#d8b58f', '#a8b9a0', '#c99a86', '#e7d6b6', '#8fa3b8'],
  lamp: '#f1e3cf',
};

/** One shelf row of books: [x offset, width, height] in viewBox units, left to right. */
const BOOK_ROWS: Array<Array<[number, number, number]>> = [
  [[0, 9, 34], [10, 7, 30], [18, 11, 36], [30, 8, 28], [44, 22, 12], [70, 9, 33]],
  [[0, 12, 30], [13, 8, 35], [22, 9, 31], [40, 10, 36], [51, 7, 29], [59, 12, 33]],
  [[0, 26, 11], [30, 9, 32], [40, 8, 35], [49, 11, 30], [62, 8, 34]],
];

const SHELF = { x: 268, y: 46, w: 112, h: 250, board: 6, rows: [96, 160, 224] };

function Bookshelf() {
  return (
    <g>
      <rect x={SHELF.x} y={SHELF.y} width={SHELF.w} height={SHELF.h} fill={ROOM.wallShade} />
      <rect x={SHELF.x - 4} y={SHELF.y - 6} width={SHELF.w + 8} height={SHELF.board} fill={ROOM.wood} />
      {SHELF.rows.map((rowY, r) => (
        <g key={rowY}>
          <rect x={SHELF.x - 4} y={rowY} width={SHELF.w + 8} height={SHELF.board} fill={ROOM.wood} />
          {BOOK_ROWS[r]?.map(([dx, w, h], i) => (
            <rect key={dx} x={SHELF.x + 10 + dx} y={rowY - h} width={w} height={h} fill={ROOM.books[(i + r * 2) % ROOM.books.length]} />
          ))}
        </g>
      ))}
      <rect x={SHELF.x - 6} y={SHELF.y - 6} width={6} height={SHELF.h + 6} fill={ROOM.woodDark} />
      <rect x={SHELF.x + SHELF.w} y={SHELF.y - 6} width={6} height={SHELF.h + 6} fill={ROOM.woodDark} />
    </g>
  );
}

function Window() {
  return (
    <g>
      <rect x={-20} y={30} width={150} height={230} fill={ROOM.frame} />
      <rect x={-12} y={38} width={64} height={102} fill={ROOM.daylightBright} />
      <rect x={58} y={38} width={64} height={102} fill={ROOM.daylightBright} />
      <rect x={-12} y={146} width={64} height={106} fill={ROOM.daylight} />
      <rect x={58} y={146} width={64} height={106} fill={ROOM.daylight} />
    </g>
  );
}

function Plant() {
  return (
    <g>
      <ellipse cx={236} cy={214} rx={26} ry={40} fill={ROOM.leaf} />
      <ellipse cx={218} cy={232} rx={18} ry={30} fill={ROOM.leafLight} />
      <ellipse cx={252} cy={236} rx={16} ry={28} fill={ROOM.leafLight} />
      <rect x={220} y={256} width={34} height={30} rx={4} fill={ROOM.pot} />
    </g>
  );
}

export const OfficeBackdrop = memo(function OfficeBackdrop({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        style={{ filter: `blur(${BLUR_PX}px)`, transform: `scale(${BLEED_SCALE})` }}
      >
        <rect width={VIEW_W} height={VIEW_H} fill={ROOM.wall} />
        <Window />
        {/* Pendant lamp over the desk. */}
        <rect x={196} y={0} width={2} height={40} fill={ROOM.woodDark} />
        <ellipse cx={197} cy={46} rx={22} ry={9} fill={ROOM.lamp} />
        <Bookshelf />
        <Plant />
        <rect x={-10} y={286} width={VIEW_W + 20} height={40} fill={ROOM.cabinet} />
      </svg>
    </div>
  );
});
