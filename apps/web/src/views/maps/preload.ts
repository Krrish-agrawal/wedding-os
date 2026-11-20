import { content, getBundle } from '@/content';
import { registerCallPreloader } from '@/call/preload';
import { useSessionStore } from '@/session/useSession';
import { preloadMapFor } from './engine';

/**
 * Gets the map ready before anyone asks for it:
 * - while the call rings, the map library loads and the map is created off screen;
 * - whenever a property is opened, the parked map moves to it so its tiles are already cached
 *   when the Locality view flies in.
 * Imported for its side effects by the map views, which the view registry loads at startup.
 */

let started = false;

export function startMapPreloading(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  registerCallPreloader('maps', (bundles) => {
    const propertyId = useSessionStore.getState().state?.propertyId ?? null;
    const target = getBundle(propertyId) ?? bundles[0] ?? content.properties[0];
    if (target) preloadMapFor(target.property.location);
  });

  let lastPropertyId: string | null = null;
  useSessionStore.subscribe((s) => {
    const propertyId = s.state?.propertyId ?? null;
    if (propertyId === lastPropertyId) return;
    lastPropertyId = propertyId;
    const bundle = getBundle(propertyId);
    if (bundle) preloadMapFor(bundle.property.location);
  });
}
