/**
 * Decides which pin labels fit on screen without overlapping. Pins always show; a label shows
 * only when its box is clear of higher-priority labels and of every pin. The selected place
 * goes first, then places by distance, so the nearest names win in a crowded street.
 */

export interface LabelCandidate {
  id: string;
  /** Pin centre in screen pixels. */
  x: number;
  y: number;
  /** Label size in pixels. */
  width: number;
  height: number;
  /** Lower goes first. */
  priority: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Pin radius plus a small gap: labels sit just right of their pin. */
export const PIN_RADIUS_PX = 15;
export const LABEL_GAP_PX = 4;
/** Breathing room between neighbouring labels. */
const LABEL_MARGIN_PX = 3;

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function labelBox(c: LabelCandidate): Box {
  const left = c.x + PIN_RADIUS_PX + LABEL_GAP_PX;
  return {
    left: left - LABEL_MARGIN_PX,
    top: c.y - c.height / 2 - LABEL_MARGIN_PX,
    right: left + c.width + LABEL_MARGIN_PX,
    bottom: c.y + c.height / 2 + LABEL_MARGIN_PX,
  };
}

function pinBox(x: number, y: number, radius = PIN_RADIUS_PX): Box {
  return { left: x - radius, top: y - radius, right: x + radius, bottom: y + radius };
}

/**
 * @param obstacles Other things on the map labels must not cover (the property pin).
 * @returns ids whose labels should show.
 */
export function placeLabels(candidates: LabelCandidate[], view: { width: number; height: number }, obstacles: Box[] = []): Set<string> {
  const pins = candidates.map((c) => pinBox(c.x, c.y));
  const taken: Box[] = [...obstacles];
  const shown = new Set<string>();
  const ordered = candidates
    .map((c, index) => ({ c, index }))
    .sort((a, b) => a.c.priority - b.c.priority);
  for (const { c, index } of ordered) {
    const box = labelBox(c);
    const offScreen = box.right > view.width || box.left < 0 || box.top < 0 || box.bottom > view.height;
    if (offScreen) continue;
    const hitsPin = pins.some((p, i) => i !== index && overlaps(box, p));
    if (hitsPin || taken.some((t) => overlaps(box, t))) continue;
    taken.push(box);
    shown.add(c.id);
  }
  return shown;
}

export { pinBox };

let measureCtx: CanvasRenderingContext2D | null = null;
/** Text width in pixels for a CSS font shorthand, measured once per call with a shared canvas. */
export function measureText(text: string, font: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
