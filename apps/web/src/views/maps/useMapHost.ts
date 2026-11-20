import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { LatLng } from '@ave/shared';
import { attachMap, currentMap, detachMap, ensureMap, setRoute, type MapHandle } from './engine';

/**
 * Borrows the shared map for as long as the calling view is mounted.
 * Returns a ref for the host element and the map once it is ready. When the map already exists
 * (the usual case after preloading), it is attached before the first paint.
 */
export function useMapHost(center: LatLng): { hostRef: RefObject<HTMLDivElement | null>; handle: MapHandle | null } {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [handle, setHandle] = useState<MapHandle | null>(() => currentMap());
  const centerRef = useRef(center);
  centerRef.current = center;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !handle) return;
    attachMap(host);
    return () => {
      // A view leaving takes its route with it.
      setRoute(null);
      detachMap(host);
    };
  }, [handle]);

  useEffect(() => {
    if (handle) return;
    let cancelled = false;
    void ensureMap(centerRef.current).then((h) => {
      if (!cancelled && h) setHandle(h);
    });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return { hostRef, handle };
}

/** True when the buyer asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
