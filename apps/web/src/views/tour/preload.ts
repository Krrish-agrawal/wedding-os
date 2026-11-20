import type { PropertyBundle } from '@ave/shared';
import { content } from '@/content';
import { registerCallPreloader } from '@/call/preload';
import { warmModel } from '@/three/modelStore';

/**
 * Downloads and parses every property model (Meshopt geometry and WebP textures decoded) so the
 * first tour opens without a wait. Safe to call repeatedly and from anywhere, e.g. while the call
 * is ringing; failures surface later as the tour's error state, never as a thrown error.
 */
export function preloadModels(bundles: PropertyBundle[] = content.properties): void {
  for (const b of bundles) warmModel(b.property.model.url);
}

// Replaces the call screen's default "fetch the GLB into the HTTP cache" preloader.
registerCallPreloader('models', preloadModels);
