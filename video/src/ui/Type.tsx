import type { CSSProperties, ReactNode } from 'react';
import { useCurrentFrame } from 'remotion';
import { C, FONT } from '../brand';
import type { Run } from '../content';
import { caretOn, graphemes, progress, TYPE_RATE, typedCount } from '../lib/anim';
import { VIDEO } from '../timeline';

/** A run of text, or an inline element (like the mascot chip) that pops in when the caret reaches it. */
export type Piece = Run | { node: (shown: number) => ReactNode };

const HIGHLIGHT_FRAMES = 9;

/**
 * A typewriter headline. Accent runs are Agora blue with a sun highlighter that swipes in once the
 * word is complete. The caret blinks when typing stops, and hides once `caretUntil` has passed.
 */
export function TypeLine({
  pieces,
  at = 0,
  rate = TYPE_RATE,
  size,
  weight = 800,
  color = C.ink,
  font = FONT.display,
  caret = true,
  caretUntil,
  /** Count of graphemes to remove from the end, for type-and-delete effects. */
  deleted = 0,
  style,
}: {
  pieces: Piece[];
  at?: number;
  rate?: number;
  size: number;
  weight?: number;
  color?: string;
  font?: string;
  caret?: boolean;
  caretUntil?: number;
  deleted?: number;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const units = pieces.map((p) => ('node' in p ? 1 : graphemes(p.text).length));
  const total = units.reduce((a, b) => a + b, 0);
  const typed = Math.max(0, Math.min(total, typedCount(frame, at, rate)) - deleted);
  const typing = typed > 0 && typed < total && frame >= at;
  const showCaret = caret && frame >= at - 6 && (caretUntil === undefined || frame < caretUntil);

  let consumed = 0;
  const parts = pieces.map((piece, i) => {
    const start = consumed;
    consumed += units[i]!;
    const shown = Math.max(0, Math.min(units[i]!, typed - start));
    if ('node' in piece) return <span key={i}>{shown > 0 ? piece.node(frame) : null}</span>;
    const text = graphemes(piece.text).slice(0, shown).join('');
    if (!piece.accent) return <span key={i}>{text}</span>;
    // Frame at which the accent word finished typing.
    const doneAt = at + Math.ceil(((start + units[i]!) / rate) * VIDEO.fps);
    const swipe = shown === units[i] ? progress(frame, doneAt, doneAt + HIGHLIGHT_FRAMES) : 0;
    return (
      <span key={i} style={{ position: 'relative', color: C.blue, whiteSpace: 'pre' }}>
        <span
          style={{
            position: 'absolute',
            left: '-0.04em',
            bottom: '0.06em',
            height: '0.36em',
            width: `calc(${swipe * 100}% + 0.08em)`,
            background: C.sun,
            borderRadius: '0.08em',
            zIndex: -1,
            transform: 'skewX(-8deg)',
          }}
        />
        {text}
      </span>
    );
  });

  return (
    <div
      style={{
        fontFamily: font,
        fontSize: size,
        fontWeight: weight,
        color,
        letterSpacing: '-0.03em',
        lineHeight: 1.08,
        whiteSpace: 'pre-wrap',
        position: 'relative',
        isolation: 'isolate',
        ...style,
      }}
    >
      {parts}
      {showCaret && (
        <span
          style={{
            display: 'inline-block',
            width: '0.075em',
            height: '0.86em',
            marginLeft: '0.05em',
            verticalAlign: '-0.08em',
            borderRadius: '0.04em',
            background: C.blue,
            opacity: caretOn(frame, typing) ? 1 : 0,
          }}
        />
      )}
    </div>
  );
}

/** Frames until a list of pieces has finished typing. */
export function piecesFrames(pieces: Piece[], rate = TYPE_RATE): number {
  const units = pieces.reduce((n, p) => n + ('node' in p ? 1 : graphemes(p.text).length), 0);
  return Math.ceil((units / rate) * VIDEO.fps);
}
