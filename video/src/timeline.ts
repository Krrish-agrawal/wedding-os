/**
 * Frame size and the scene timeline, in seconds. This file holds plain data with no imports, so the
 * music script (scripts/make-music.ts) can read it with Node directly and stay in sync with the
 * picture. Change a scene length here and both the video and the music follow.
 */
export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
  /** Music tempo. Scene boundaries sit on half-second beats at this tempo. */
  bpm: 120,
};

export type SceneId =
  | 'hook'
  | 'traffic'
  | 'photos'
  | 'night'
  | 'meet'
  | 'call'
  | 'montage'
  | 'languages'
  | 'handoff'
  | 'recap'
  | 'team'
  | 'desk'
  | 'builtWith'
  | 'end';

/** Scenes in order. Each one starts where the previous one ends. */
export const SCENE_LENGTHS: ReadonlyArray<readonly [SceneId, number]> = [
  ['hook', 3],
  ['traffic', 3.5],
  ['photos', 3.5],
  ['night', 3.5],
  ['meet', 3.5],
  ['call', 4],
  ['montage', 21.5],
  ['languages', 4],
  ['handoff', 4],
  ['recap', 3.5],
  ['team', 2],
  ['desk', 5],
  ['builtWith', 4],
  ['end', 5],
];

export interface SceneSpan {
  id: SceneId;
  start: number;
  end: number;
}

export function sceneSpans(): SceneSpan[] {
  let t = 0;
  return SCENE_LENGTHS.map(([id, length]) => {
    const span = { id, start: t, end: t + length };
    t += length;
    return span;
  });
}

export function totalSeconds(): number {
  return SCENE_LENGTHS.reduce((sum, [, length]) => sum + length, 0);
}

/** Where a scene starts, in seconds. */
export function sceneStart(id: SceneId): number {
  const span = sceneSpans().find((s) => s.id === id);
  if (!span) throw new Error(`Unknown scene: ${id}`);
  return span.start;
}

/** The montage of app views: each view's share of the montage scene, in seconds. */
export const MONTAGE_STEP_LENGTHS = [3, 3, 3, 3, 3.5, 3, 3] as const;
