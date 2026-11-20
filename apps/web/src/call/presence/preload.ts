import workletUrl from '@met4citizen/headaudio/dist/headworklet.min.mjs?url';
import lipsyncModelUrl from '@met4citizen/headaudio/dist/model-en-mixed.bin?url';
import { registerCallPreloader, warmUrl } from '../preload';
import { configuredPresenceMode } from './config';
import { avatarSources } from './human3d/avatars';
import { firstAvailable, hasWebGL2 } from './human3d/environment';

let registered = false;

/**
 * While the call rings, fetch the avatar file, the avatar code and the lip-sync worklet and model,
 * so the advisor's face is ready the moment the call connects. Skipped in mascot mode or where
 * the 3D avatar cannot run anyway.
 */
export function registerAvatarPreloader(): void {
  if (registered || typeof window === 'undefined') return;
  registered = true;
  registerCallPreloader('avatar', async () => {
    if (configuredPresenceMode() !== 'human3d' || !hasWebGL2()) return;
    const source = await firstAvailable(avatarSources());
    if (source) warmUrl(source.url);
    warmUrl(workletUrl);
    warmUrl(lipsyncModelUrl);
    await Promise.all([import('three'), import('@met4citizen/talkinghead'), import('@met4citizen/headaudio/dist/headaudio.min.mjs')]);
  });
}
