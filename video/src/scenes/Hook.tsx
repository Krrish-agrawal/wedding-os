import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { HOOK } from '../content';
import { Mascot } from '../mascot/Mascot';
import { pop, sec, tween } from '../lib/anim';
import { Background } from '../ui/Background';
import { piecesFrames, TypeLine } from '../ui/Type';

const TYPE_AT = 6;

export function Hook() {
  const frame = useCurrentFrame();
  const typed = TYPE_AT + piecesFrames(HOOK);
  const rise = pop(frame, typed - 8, { damping: 14, stiffness: 140 });
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <TypeLine pieces={HOOK} at={TYPE_AT} size={136} />
      </AbsoluteFill>
      {/* The mascot peeks up from the bottom edge to look at the question. */}
      <div style={{ position: 'absolute', left: 1440, top: 1080 - 300 * rise + tween(frame, [sec(2.4), sec(3)], [0, 40]) }}>
        <Mascot size={380} cues={[{ at: 0, state: 'idle' }, { at: typed + 4, state: 'thinking' }]} seed={3} />
      </div>
    </AbsoluteFill>
  );
}
