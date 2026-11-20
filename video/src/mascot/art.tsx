/*
 * Snapshot of apps/web/src/ui/mascot/art.tsx, copied for the promo on 2026-11-21 and unchanged
 * except for this note. The film keeps its own copy so it renders the same even while the app's
 * mascot is being reworked. To pick up new artwork, copy the app file over this one again.
 */
/**
 * The stand-in mascot drawing: a heavy single-storey lowercase "a" in Agora blue whose counter
 * (the hole of the letter) is the face window, standing on two legs with two arms. The face has
 * eyes and brows only (no mouth): expression comes from the eyes, brows, body and arms. Everything
 * here is artwork; the state logic and motion live in Mascot.tsx. To use the owner's artwork,
 * replace the parts in this file and keep the exported names and the anchor points
 * (see assets/brand/README.md).
 *
 * Coordinates are in a square viewBox that leaves room for the arms and legs around the letter.
 */
export const MASCOT_VIEWBOX = '-8 12 128 128';

const INK = 'var(--color-ink)';
const BLUE = 'var(--color-blue)';
const WHITE = 'var(--color-canvas)';
const HEART = 'var(--color-coral)';
const OUTLINE = 6; // drawn under the fill, so 3 units show outside the shape
const LINE = 3;
/** Limbs are a blue stroke over a wider ink stroke, so they carry the same outline as the letter. */
const LIMB_INK = 11;
const LIMB_FILL = 6;
const HAND_R = 5.5;

/** Pivot points the motion layer uses (in viewBox units). */
export const ANCHORS = {
  /** Where the mascot stands (between its feet): rotations and hops pivot here. */
  base: { x: 50, y: 121 },
  /** Where the mascot rests when seated on a ledge (the bottom of the letter). */
  seat: { x: 56, y: 111 },
  /** Hips: each leg swings about its hip when the mascot sits with its legs dangling. */
  leftHip: { x: 38, y: 98 },
  rightHip: { x: 62, y: 98 },
  /** Shoulders: the left arm hangs from the bowl, the right arm from the stem. */
  leftShoulder: { x: 14, y: 66 },
  rightShoulder: { x: 97, y: 66 },
  /** Centre of the face window. */
  face: { x: 47, y: 69 },
};

const [, VIEW_Y, , VIEW_SIZE] = MASCOT_VIEWBOX.split(' ').map(Number) as [number, number, number, number];

/**
 * How far down the mascot's square box the seat (the bottom of the letter) sits, 0–1. Scenes use it
 * to rest a seated mascot on a ledge.
 */
export const MASCOT_SEAT_FRACTION = (ANCHORS.seat.y - VIEW_Y) / VIEW_SIZE;

/** Where each hanging arm ends, relative to its shoulder. Raising an arm is a rotation about the shoulder. */
const ARM_REACH = { left: { x: -13, y: 20 }, right: { x: 13, y: 20 } } as const;

/** The letter's silhouette: bowl, stem and the little foot. Reused for outline, shadow and fill. */
function Silhouette() {
  return (
    <>
      <circle cx={50} cy={68} r={40} />
      <rect x={74} y={28} width={26} height={80} rx={13} />
      <rect x={86} y={94} width={24} height={14} rx={7} />
    </>
  );
}

/** The hard ink offset shadow under the letter. Drawn first, so the legs and arms sit on top of it. */
export function MascotShadow() {
  return (
    <g fill={INK} stroke={INK} strokeWidth={OUTLINE} strokeLinejoin="round" transform="translate(4 4)">
      <Silhouette />
    </g>
  );
}

/** Body with its ink outline and blue fill, plus the white face window. */
export function MascotBody() {
  return (
    <g>
      <g fill={INK} stroke={INK} strokeWidth={OUTLINE} strokeLinejoin="round">
        <Silhouette />
      </g>
      <g fill={BLUE}>
        <Silhouette />
      </g>
      {/* Small highlight on the stem gives the letter some volume without a gradient. */}
      <rect x={81} y={36} width={6} height={18} rx={3} fill={WHITE} opacity={0.55} />
      <ellipse cx={ANCHORS.face.x} cy={ANCHORS.face.y} rx={23} ry={25} fill={WHITE} stroke={INK} strokeWidth={LINE} />
    </g>
  );
}

const LEGS = {
  left: { x1: 38, x2: 36, shoe: { cx: 33, rot: -6 } },
  right: { x1: 62, x2: 64, shoe: { cx: 67, rot: 6 } },
} as const;

/** One short leg with a dark shoe. Drawn behind the body so it tucks under the bowl. */
export function Leg({ side }: { side: 'left' | 'right' }) {
  const { x1, x2, shoe } = LEGS[side];
  return (
    <g>
      <line x1={x1} y1={98} x2={x2} y2={117} stroke={INK} strokeWidth={LIMB_INK} strokeLinecap="round" />
      <line x1={x1} y1={98} x2={x2} y2={117} stroke={BLUE} strokeWidth={LIMB_FILL} strokeLinecap="round" />
      <ellipse cx={shoe.cx} cy={120.5} rx={8.5} ry={4.6} fill={INK} transform={`rotate(${shoe.rot} ${shoe.cx} 120.5)`} />
      <ellipse cx={shoe.cx + (shoe.rot < 0 ? -3 : 3)} cy={118.8} rx={2.6} ry={1.1} fill={WHITE} opacity={0.6} />
    </g>
  );
}

/**
 * One arm hanging from its shoulder with a white mitten. Drawn behind the body; the motion layer
 * rotates it about the shoulder to raise, wave or gesture.
 */
export function Arm({ side }: { side: 'left' | 'right' }) {
  const s = side === 'left' ? ANCHORS.leftShoulder : ANCHORS.rightShoulder;
  const r = ARM_REACH[side];
  const end = { x: s.x + r.x, y: s.y + r.y };
  return (
    <g>
      <line x1={s.x} y1={s.y} x2={end.x} y2={end.y} stroke={INK} strokeWidth={LIMB_INK} strokeLinecap="round" />
      <line x1={s.x} y1={s.y} x2={end.x} y2={end.y} stroke={BLUE} strokeWidth={LIMB_FILL} strokeLinecap="round" />
      <circle cx={end.x + r.x * 0.12} cy={end.y + r.y * 0.12} r={HAND_R} fill={WHITE} stroke={INK} strokeWidth={LINE} />
    </g>
  );
}

/** Open eyes with a catch-light. */
export function EyesOpen() {
  return (
    <g fill={INK}>
      <ellipse cx={39} cy={64} rx={3.7} ry={4.5} />
      <ellipse cx={55} cy={64} rx={3.7} ry={4.5} />
      <circle cx={40.2} cy={62.4} r={1.25} fill={WHITE} />
      <circle cx={56.2} cy={62.4} r={1.25} fill={WHITE} />
    </g>
  );
}

/** Smiling "^ ^" eyes for the happy state. */
export function EyesHappy() {
  return (
    <g fill="none" stroke={INK} strokeWidth={LINE} strokeLinecap="round">
      <path d="M35.4 65.5 Q39 59.8 42.6 65.5" />
      <path d="M51.4 65.5 Q55 59.8 58.6 65.5" />
    </g>
  );
}

/** Right eye winks shut; the left stays open. */
export function EyesWink() {
  return (
    <g>
      <ellipse cx={39} cy={64} rx={3.7} ry={4.5} fill={INK} />
      <circle cx={40.2} cy={62.4} r={1.25} fill={WHITE} />
      <path d="M51 64.5 Q55 61 59 64.5" fill="none" stroke={INK} strokeWidth={LINE} strokeLinecap="round" />
    </g>
  );
}

/** Closed, drowsy eyes. */
export function EyesSleepy() {
  return (
    <g fill="none" stroke={INK} strokeWidth={LINE} strokeLinecap="round">
      <path d="M35 63.5 Q39 67 43 63.5" />
      <path d="M51 63.5 Q55 67 59 63.5" />
    </g>
  );
}

/** Heart eyes. */
export function EyesHeart() {
  const heart = (x: number) =>
    `M${x} 69 C${x - 7} 64.5 ${x - 6.5} 58 ${x - 2.8} 58 C${x - 1.2} 58 ${x} 59.4 ${x} 60.6 C${x} 59.4 ${x + 1.2} 58 ${x + 2.8} 58 C${x + 6.5} 58 ${x + 7} 64.5 ${x} 69 Z`;
  return (
    <g fill={HEART} stroke={INK} strokeWidth={2} strokeLinejoin="round">
      <path d={heart(39)} />
      <path d={heart(55)} />
    </g>
  );
}

/** Dark sunglasses with a glint, for the cool look. */
export function Shades() {
  return (
    <g>
      <path d="M26.5 59.5 L67.5 59.5" stroke={INK} strokeWidth={LINE} strokeLinecap="round" />
      <rect x={29} y={58.5} width={17} height={11} rx={5} fill={INK} />
      <rect x={48.5} y={58.5} width={17} height={11} rx={5} fill={INK} />
      <path d="M32 61.5 L36 61.5 M51.5 61.5 L55.5 61.5" stroke={WHITE} strokeWidth={1.6} strokeLinecap="round" opacity={0.8} />
    </g>
  );
}

/** Little floating "z"s above the head while it naps. */
export function Snooze() {
  return (
    <g fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 22 L24 22 L17 29 L24 29" />
      <path d="M6 13 L11 13 L6 18 L11 18" opacity={0.7} />
    </g>
  );
}

export type BrowShape = 'none' | 'raised' | 'worried' | 'quizzical';

const BROWS: Record<Exclude<BrowShape, 'none'>, [string, string]> = {
  raised: ['M34.5 55.5 Q38.5 53 43 54.5', 'M51 54.5 Q55.5 53 59.5 55.5'],
  worried: ['M34.5 57.5 Q38.5 56.5 42.5 53.8', 'M51.5 53.8 Q55.5 56.5 59.5 57.5'],
  quizzical: ['M35 56.5 L42.5 56', 'M51.5 53 Q55.5 50.5 59.5 52.5'],
};

export function Brows({ shape }: { shape: BrowShape }) {
  if (shape === 'none') return null;
  const [l, r] = BROWS[shape];
  return (
    <g fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round">
      <path d={l} />
      <path d={r} />
    </g>
  );
}
