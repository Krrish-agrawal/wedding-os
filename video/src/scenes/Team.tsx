import { AbsoluteFill } from 'remotion';
import { TEAM } from '../content';
import { Background } from '../ui/Background';
import { TypeLine } from '../ui/Type';

const RATE = 40;

export function Team() {
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <TypeLine pieces={TEAM} at={2} rate={RATE} size={112} style={{ textAlign: 'center', maxWidth: 1500 }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
