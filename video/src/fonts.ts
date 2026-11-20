import { cancelRender, continueRender, delayRender } from 'remotion';

/**
 * Holds rendering until every face and script the film uses has loaded, so no frame is drawn with a
 * fallback font. Each sample string makes the browser fetch the matching unicode-range subset.
 */
const FACES: ReadonlyArray<readonly [string, string]> = [
  ['800 100px "Bricolage Grotesque Variable"', 'House hunting ₹'],
  ['600 100px "Bricolage Grotesque Variable"', 'Virtual Estates'],
  ['500 40px "Plus Jakarta Sans Variable"', 'Larkspur Court ₹5.61'],
  ['700 40px "Plus Jakarta Sans Variable"', 'Live AI notes'],
  ['800 100px "Noto Sans Devanagari"', 'हिंदी में बात करें'],
  ['600 40px "Noto Sans Devanagari"', 'हिंदी'],
  ['800 100px "Noto Sans Kannada"', 'ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡಿ'],
  ['600 40px "Noto Sans Kannada"', 'ಕನ್ನಡ'],
];

let started = false;

export function waitForFonts(): void {
  if (started) return;
  started = true;
  const handle = delayRender('Loading brand fonts');
  Promise.all(FACES.map(([font, sample]) => document.fonts.load(font, sample)))
    .then(() => document.fonts.ready)
    .then(() => continueRender(handle))
    // A missing face fails the render rather than drawing with a fallback.
    .catch((err: unknown) => cancelRender(err instanceof Error ? err : new Error(String(err))));
}
