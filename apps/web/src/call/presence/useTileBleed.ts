import { useLayoutEffect, useState, type RefObject } from 'react';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
/** How many ancestors up to look for the tile that clips the presence. */
const MAX_DEPTH = 3;
/** Never reach further than this past the presence's own box. */
const MAX_BLEED_PX = 120;

function findClip(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  for (let depth = 0; node && depth < MAX_DEPTH; depth++, node = node.parentElement) {
    const overflow = getComputedStyle(node).overflow;
    if (overflow !== 'visible') return node;
  }
  return null;
}

/** Layout offsets (transform-free, so tile layout animations do not skew them) from `el` to `clip`'s padding box. */
function measure(el: HTMLElement, clip: HTMLElement): Insets {
  let top = 0;
  let left = 0;
  let node: HTMLElement | null = el;
  while (node && node !== clip) {
    top += node.offsetTop;
    left += node.offsetLeft;
    const parent: Element | null = node.offsetParent;
    node = parent instanceof HTMLElement ? parent : null;
  }
  if (node !== clip) return NONE;
  const clamp = (v: number) => Math.max(0, Math.min(MAX_BLEED_PX, Math.round(v)));
  return {
    top: clamp(top),
    left: clamp(left),
    bottom: clamp(clip.clientHeight - top - el.offsetHeight),
    right: clamp(clip.clientWidth - left - el.offsetWidth),
  };
}

/**
 * How far the presence may draw past its own box to fill the tile that contains it, like a video
 * feed fills its frame while the name plate and labels sit on top. The call tile pads the slot to
 * keep the mascot clear of the name plate; the 3D view and its room should still reach the edges.
 * Zero when no clipping tile is found nearby.
 */
export function useTileBleed(ref: RefObject<HTMLElement | null>): Insets {
  const [insets, setInsets] = useState<Insets>(NONE);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clip = findClip(el);
    if (!clip) return;
    const update = () => {
      const next = measure(el, clip);
      setInsets((prev) =>
        prev.top === next.top && prev.right === next.right && prev.bottom === next.bottom && prev.left === next.left ? prev : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    observer.observe(clip);
    return () => observer.disconnect();
  }, [ref]);
  return insets;
}
