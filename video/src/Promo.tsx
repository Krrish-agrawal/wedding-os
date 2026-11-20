import type { ComponentType } from 'react';
import { AbsoluteFill, Html5Audio, interpolate, Sequence, staticFile } from 'remotion';
import { C } from './brand';
import { sec } from './lib/anim';
import { BuiltWith } from './scenes/BuiltWith';
import { Desk } from './scenes/Desk';
import { End } from './scenes/End';
import { Handoff } from './scenes/Handoff';
import { Hook } from './scenes/Hook';
import { Languages } from './scenes/Languages';
import { Meet } from './scenes/Meet';
import { Night } from './scenes/Night';
import { Photos } from './scenes/Photos';
import { Product } from './scenes/Product';
import { Recap } from './scenes/Recap';
import { Team } from './scenes/Team';
import { Traffic } from './scenes/Traffic';
import { BarWipe } from './ui/BarWipe';
import { sceneStart, sceneSpans, totalSeconds, type SceneId } from './timeline';
import { MUSIC_FILE } from './music';

/**
 * Scene components by id. The call and the montage share one continuous app window, so the Product
 * scene starts at 'call' and runs through the end of 'montage'.
 */
const SCENES: Record<Exclude<SceneId, 'montage'>, ComponentType> = {
  hook: Hook,
  traffic: Traffic,
  photos: Photos,
  night: Night,
  meet: Meet,
  call: Product,
  languages: Languages,
  handoff: Handoff,
  recap: Recap,
  team: Team,
  desk: Desk,
  builtWith: BuiltWith,
  end: End,
};

/** Scenes drawn by an earlier scene's component. */
const CONTINUES: Partial<Record<SceneId, SceneId>> = { montage: 'call' };

/** Colour-bar wipes centred on the cuts between acts. */
const WIPES: SceneId[] = ['meet', 'languages', 'team'];
const WIPE_FRAMES = 26;

const FADE_IN_S = 0.3;
const FADE_OUT_S = 1.6;

export function Promo() {
  const spans = sceneSpans();
  const total = sec(totalSeconds());
  return (
    <AbsoluteFill style={{ background: C.canvas }}>
      {spans.map((span) => {
        if (span.id === 'montage' || CONTINUES[span.id]) return null;
        const Scene = SCENES[span.id];
        // Extend the span over any scenes this component continues into.
        const end = spans.filter((s) => CONTINUES[s.id] === span.id).reduce((e, s) => Math.max(e, s.end), span.end);
        return (
          <Sequence key={span.id} name={span.id} from={sec(span.start)} durationInFrames={sec(end - span.start)}>
            <Scene />
          </Sequence>
        );
      })}
      {WIPES.map((id) => (
        <Sequence key={`wipe-${id}`} name={`wipe to ${id}`} from={sec(sceneStart(id)) - WIPE_FRAMES / 2} durationInFrames={WIPE_FRAMES}>
          <BarWipe duration={WIPE_FRAMES} />
        </Sequence>
      ))}
      <Html5Audio
        src={staticFile(MUSIC_FILE)}
        volume={(f) =>
          interpolate(f, [0, sec(FADE_IN_S), total - sec(FADE_OUT_S), total], [0, 1, 1, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
        }
      />
    </AbsoluteFill>
  );
}
