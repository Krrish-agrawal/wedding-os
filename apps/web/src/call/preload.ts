import { useEffect } from 'react';
import type { PropertyBundle } from '@ave/shared';
import { content } from '@/content';

/**
 * Warms caches while the call is ringing so the first tour, map and plan open instantly
 * (BUILD_PLAN.md section 10 and 12). Other workstreams register their own preloaders here,
 * e.g. the 3D workstream can register GLTF parsing, the Maps workstream tile prefetch:
 *
 *   registerCallPreloader('maps', (bundles) => { ... });
 *
 * A preloader must be fire-and-forget and never throw; failures are swallowed.
 */
export type CallPreloader = (bundles: PropertyBundle[]) => void | Promise<unknown>;

const preloaders = new Map<string, CallPreloader>();
const fetched = new Set<string>();

export function registerCallPreloader(id: string, preloader: CallPreloader): void {
  preloaders.set(id, preloader);
}

/** Fetches a URL into the HTTP cache once per page load. */
export function warmUrl(url: string): void {
  if (!url || fetched.has(url)) return;
  fetched.add(url);
  fetch(url)
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .catch(() => null);
}

/** Default: download every property's optimised model. Replaceable by registering 'models'. */
registerCallPreloader('models', (bundles) => {
  for (const b of bundles) warmUrl(b.property.model.url);
});

export function preloadCallAssets(bundles: PropertyBundle[] = content.properties): void {
  for (const [id, run] of preloaders) {
    try {
      const out = run(bundles);
      if (out && typeof (out as Promise<unknown>).catch === 'function') (out as Promise<unknown>).catch(() => undefined);
    } catch (err) {
      console.warn(`[preload] ${id} failed`, err);
    }
  }
}

/** Runs all preloaders once when `enabled` first becomes true. */
export function usePreloadCallAssets(enabled: boolean): void {
  useEffect(() => {
    if (enabled) preloadCallAssets();
  }, [enabled]);
}
