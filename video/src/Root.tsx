import './theme.css';
import { Composition } from 'remotion';
import { Promo } from './Promo';
import { waitForFonts } from './fonts';
import { totalSeconds, VIDEO } from './timeline';

waitForFonts();

export const COMPOSITION_ID = 'AgoraVirtualEstatesPromo';

export function Root() {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={Promo}
      durationInFrames={Math.round(totalSeconds() * VIDEO.fps)}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  );
}
