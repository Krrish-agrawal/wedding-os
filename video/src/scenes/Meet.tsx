import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, OUTLINE, pop as popShadow } from '../brand';
import { MEET } from '../content';
import { Mascot } from '../mascot/Mascot';
import { graphemes, pop, TYPE_RATE } from '../lib/anim';
import { VIDEO } from '../timeline';
import { Background } from '../ui/Background';
import { piecesFrames, TypeLine, type Piece } from '../ui/Type';

const MAIN_AT = 4;
const MAIN_SIZE = 168;
const SUB_RATE = 44;
const SUB_GAP = 10;

/** The mascot in a rounded chip that sits inline with the headline, like a logo in a sentence. */
function MascotChip({ appearAt }: { appearAt: number }) {
  const frame = useCurrentFrame();
  const s = pop(frame, appearAt);
  return (
    <span
      style={{
        display: 'inline-block',
        position: 'relative',
        width: '1.32em',
        height: '0.96em',
        margin: '0 0.12em 0 0.02em',
        verticalAlign: '-0.14em',
        borderRadius: '0.3em',
        border: `${OUTLINE + 1}px solid ${C.ink}`,
        background: C.blueTint,
        boxShadow: popShadow(8),
        transform: `scale(${s}) rotate(${(1 - s) * -12}deg)`,
      }}
    >
      <span style={{ position: 'absolute', left: '0.1em', top: '-0.34em' }}>
        <Mascot size={MAIN_SIZE * 1.28} cues={[{ at: 0, state: 'idle' }, { at: appearAt + 6, state: 'wave' }]} seed={13} shadow={false} />
      </span>
    </span>
  );
}

export function Meet() {
  const lead = graphemes(MEET.lead).length;
  const chipAt = MAIN_AT + Math.ceil((lead / TYPE_RATE) * VIDEO.fps);
  const pieces: Piece[] = [{ text: MEET.lead }, { node: () => <MascotChip appearAt={chipAt} /> }, { text: ' ' }, { text: MEET.name, accent: true }];
  const subAt = MAIN_AT + piecesFrames(pieces) + SUB_GAP;
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 34 }}>
        <TypeLine pieces={pieces} at={MAIN_AT} size={MAIN_SIZE} caretUntil={subAt} />
        <TypeLine pieces={[{ text: MEET.sub }]} at={subAt} rate={SUB_RATE} size={56} weight={600} font="var(--font-sans)" color={C.inkSoft} style={{ letterSpacing: '-0.01em', minHeight: 62 }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
