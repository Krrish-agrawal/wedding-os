import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, FONT, OUTLINE } from '../brand';
import { PHOTOS } from '../content';
import { Mascot } from '../mascot/Mascot';
import { pop, progress, SMOOTH, tween, wobble } from '../lib/anim';
import { Background } from '../ui/Background';
import { At, Card, Chip, Icon } from '../ui/kit';
import { TypeLine } from '../ui/Type';

const CARD = { x: 700, y: 250, w: 880, photoH: 500 };

/** A too-perfect listing photo: wide angle, bright window, staged sofa. */
function ListingPhoto({ w, h }: { w: number; h: number }) {
  const ink = { stroke: C.ink, strokeWidth: OUTLINE, strokeLinejoin: 'round' as const };
  return (
    <svg width={w} height={h} viewBox="0 0 880 500" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-blue)" stopOpacity={0.55} />
          <stop offset="1" stopColor="var(--color-sun-tint)" />
        </linearGradient>
      </defs>
      <rect width={880} height={500} fill={C.sunTint} />
      {/* Wide-angle floor and walls. */}
      <path d="M0 330 L880 330 L880 500 L0 500 Z" fill="color-mix(in srgb, var(--color-tangerine) 22%, var(--color-canvas))" />
      <path d="M0 330 L120 300 L760 300 L880 330" fill="none" {...ink} strokeWidth={3} />
      {/* Big window with a glowing sky. */}
      <rect x={250} y={50} width={380} height={230} rx={10} fill="url(#sky)" {...ink} />
      <line x1={440} y1={50} x2={440} y2={280} {...ink} />
      <circle cx={560} cy={120} r={36} fill={C.sun} {...ink} strokeWidth={3} />
      {/* Sofa. */}
      <rect x={300} y={300} width={300} height={70} rx={22} fill={C.grape} {...ink} />
      <rect x={290} y={340} width={320} height={60} rx={20} fill={C.grape} {...ink} />
      <rect x={340} y={330} width={70} height={36} rx={12} fill={C.sun} {...ink} strokeWidth={3} />
      {/* Plant and lamp. */}
      <rect x={120} y={330} width={70} height={70} rx={10} fill={C.coral} {...ink} />
      <circle cx={155} cy={290} r={48} fill={C.mint} {...ink} />
      <line x1={760} y1={160} x2={760} y2={400} {...ink} />
      <path d="M720 160 L800 160 L780 110 L740 110 Z" fill={C.sun} {...ink} />
      {/* Sparkles that sell it. */}
      {[
        [210, 90],
        [690, 70],
        [820, 250],
      ].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y! - 18} L${x! + 5} ${y! - 5} L${x! + 18} ${y} L${x! + 5} ${y! + 5} L${x} ${y! + 18} L${x! - 5} ${y! + 5} L${x! - 18} ${y} L${x! - 5} ${y! - 5} Z`} fill={C.canvas} {...ink} strokeWidth={3} />
      ))}
    </svg>
  );
}

const QUESTIONS: Array<{ x: number; y: number; rot: number; at: number }> = [
  { x: 1620, y: 300, rot: 5, at: 30 },
  { x: 1630, y: 500, rot: -4, at: 42 },
  { x: 760, y: 900, rot: -3, at: 54 },
  { x: 1580, y: 720, rot: 4, at: 66 },
];

export function Photos() {
  const frame = useCurrentFrame();
  // The magnifier scans across the photo.
  const scan = progress(frame, 16, 100, SMOOTH);
  const lensX = CARD.x + 140 + scan * 560;
  const lensY = CARD.y + 160 + 80 * Math.sin(scan * Math.PI * 1.5);
  return (
    <AbsoluteFill>
      <Background />
      <At x={140} y={110}>
        <TypeLine pieces={PHOTOS.headline} at={2} size={96} />
      </At>

      <At x={CARD.x} y={CARD.y + tween(frame, [0, 12], [60, 0])} opacity={progress(frame, 0, 8)} rotate={-1.5}>
        <Card style={{ width: CARD.w, overflow: 'hidden' }} shadow={10}>
          <ListingPhoto w={CARD.w - OUTLINE * 2} h={(CARD.photoH * (CARD.w - OUTLINE * 2)) / 880} />
          <div style={{ padding: '22px 30px 26px', borderTop: `${OUTLINE}px solid ${C.ink}` }}>
            <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 44, letterSpacing: '-0.02em' }}>{PHOTOS.listingTitle}</div>
            <div style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: 28, color: C.inkSoft, marginTop: 6 }}>{PHOTOS.listingMeta}</div>
          </div>
        </Card>
      </At>

      {PHOTOS.stickers.map((label, i) => (
        <At key={label} x={CARD.x + (i === 0 ? 40 : 640)} y={CARD.y + (i === 0 ? 34 : 60)} scale={pop(frame, 6 + i * 6)} rotate={i === 0 ? -10 : 8}>
          <Chip bg={i === 0 ? C.sun : C.coral} size={40} shadow={5}>
            {label}
          </Chip>
        </At>
      ))}

      {/* Magnifier. */}
      <div style={{ position: 'absolute', left: lensX - 90, top: lensY - 90, opacity: progress(frame, 14, 20) }}>
        <svg width={260} height={260} viewBox="0 0 260 260" style={{ overflow: 'visible' }}>
          <line x1={150} y1={150} x2={230} y2={230} stroke={C.ink} strokeWidth={26} strokeLinecap="round" />
          <line x1={150} y1={150} x2={228} y2={228} stroke={C.tangerine} strokeWidth={14} strokeLinecap="round" />
          <circle cx={90} cy={90} r={86} fill="color-mix(in srgb, var(--color-blue-tint) 55%, transparent)" stroke={C.ink} strokeWidth={10} />
          <text x={90} y={118} textAnchor="middle" fontFamily="Bricolage Grotesque Variable" fontWeight={800} fontSize={86} fill={C.coral} stroke={C.ink} strokeWidth={3}>
            ?
          </text>
        </svg>
      </div>

      {QUESTIONS.map((q, i) => (
        <At key={i} x={q.x} y={q.y + 4 * wobble(frame, 1.6, i)} scale={pop(frame, q.at)} rotate={q.rot} origin="left center">
          <Chip bg={C.coralTint} size={36} shadow={5}>
            <span style={{ display: 'inline-flex', width: 44, height: 44, borderRadius: '50%', background: C.coral, border: `3px solid ${C.ink}`, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="question" size={30} />
            </span>
            {PHOTOS.questions[i]}
          </Chip>
        </At>
      ))}

      <div style={{ position: 'absolute', left: 150, top: 560 }}>
        <Mascot size={420} cues={[{ at: 0, state: 'idle' }, { at: 20, state: 'thinking' }]} seed={7} />
      </div>
    </AbsoluteFill>
  );
}
