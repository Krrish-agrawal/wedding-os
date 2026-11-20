import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface Size {
  width: number;
  height: number;
}

/**
 * Measures an element before first paint (so the plan draws in the same frame as the view switch)
 * and keeps the size current as the stage resizes.
 */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, Size | null] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const next = { width: Math.round(r.width), height: Math.round(r.height) };
      setSize((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size];
}

export type ImageStatus = 'loading' | 'loaded' | 'failed';

/** Remembers each plan image's outcome so a missing render is requested once per page load. */
const imageStatus = new Map<string, ImageStatus>();
const pending = new Map<string, Promise<ImageStatus>>();

function loadImage(src: string): Promise<ImageStatus> {
  const known = imageStatus.get(src);
  if (known && known !== 'loading') return Promise.resolve(known);
  let p = pending.get(src);
  if (!p) {
    p = new Promise<ImageStatus>((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve('loaded');
      img.onerror = () => resolve('failed');
      img.src = src;
    }).then((s) => {
      imageStatus.set(src, s);
      pending.delete(src);
      return s;
    });
    pending.set(src, p);
  }
  return p;
}

/** Starts loading plan images ahead of time, e.g. while the call rings. */
export function preloadPlanImages(srcs: string[]): void {
  for (const s of srcs) void loadImage(s);
}

/**
 * Whether the plan's top-down render is available. The plan never waits on it: rooms draw at once
 * and the image fades in underneath when it arrives.
 */
export function usePlanImage(src: string): ImageStatus {
  const [status, setStatus] = useState<ImageStatus>(() => imageStatus.get(src) ?? 'loading');
  useEffect(() => {
    let live = true;
    setStatus(imageStatus.get(src) ?? 'loading');
    void loadImage(src).then((s) => {
      if (live) setStatus(s);
    });
    return () => {
      live = false;
    };
  }, [src]);
  return status;
}

/** A stable callback that runs `fn` after `delayMs` of quiet; `flush` runs a pending call now. */
export function useDebounced<A extends unknown[]>(fn: (...args: A) => void, delayMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArgs = useRef<A | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const call = useCallback(
    (...args: A) => {
      lastArgs.current = args;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        lastArgs.current = null;
        fnRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    lastArgs.current = null;
  }, []);

  const flush = useCallback(() => {
    if (!timer.current || !lastArgs.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    const args = lastArgs.current;
    lastArgs.current = null;
    fnRef.current(...args);
  }, []);

  return { call, cancel, flush };
}

/** Plans at least this many times wider than deep stack their info cards underneath instead of beside. */
export const WIDE_PLAN_ASPECT = 2;
