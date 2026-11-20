/** Every expression the mascot supports. The owner's artwork must cover all of them. */
export const MASCOT_STATES = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'happy',
  'apologetic',
  'wave',
  'surprised',
  'wink',
  'love',
  'sleepy',
  'cool',
] as const;
export type MascotState = (typeof MASCOT_STATES)[number];
