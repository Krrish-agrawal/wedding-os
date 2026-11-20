import { useEffect, useMemo, useState } from 'react';
import type { MapHandle } from './engine';
import { measureText, placeLabels, type LabelCandidate } from './labels';

export interface LabelItem {
  id: string;
  lat: number;
  lng: number;
  /** Everything the label shows, for measuring. */
  text: string;
  /** Lower wins when labels collide. */
  priority: number;
}

/** Must match the label pill's typography and padding in pins.tsx. */
export const LABEL_FONT = '600 12px "Plus Jakarta Sans Variable", sans-serif';
const LABEL_PADDING_X = 10;
const LABEL_BORDER = 2;
const LABEL_HEIGHT = 26;
/** The property pin stands on its point: name tag, disc and stem rise about this high above it. */
const PROPERTY_PIN_HEIGHT = 88;
const PROPERTY_PIN_MIN_HALF_WIDTH = 26;
const PROPERTY_LABEL_FONT = '700 12px "Plus Jakarta Sans Variable", sans-serif';
const PROPERTY_LABEL_PADDING = 24;

/** Screen box of the property pin (its name tag, disc and stem), which labels must not cover. */
function propertyPinBox(p: { x: number; y: number }, label: string) {
  const half = Math.max(PROPERTY_PIN_MIN_HALF_WIDTH, (measureText(label, PROPERTY_LABEL_FONT) + PROPERTY_LABEL_PADDING) / 2);
  return { left: p.x - half, right: p.x + half, top: p.y - PROPERTY_PIN_HEIGHT, bottom: p.y + 2 };
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Ids of the pins whose name labels fit on screen right now. Recomputed whenever the map settles,
 * so zooming in reveals more names and zooming out hides the ones that would collide.
 */
export function useVisibleLabels(
  handle: MapHandle | null,
  items: LabelItem[],
  property: { lat: number; lng: number; label: string } | null,
): Set<string> {
  const [shown, setShown] = useState<Set<string>>(() => new Set());
  const widths = useMemo(() => new Map(items.map((i) => [i.id, measureText(i.text, LABEL_FONT) + 2 * (LABEL_PADDING_X + LABEL_BORDER)])), [items]);

  useEffect(() => {
    if (!handle) return;
    const { map } = handle;
    const compute = () => {
      const el = map.getContainer();
      const view = { width: el.clientWidth, height: el.clientHeight };
      if (!view.width || !view.height) return;
      const candidates: LabelCandidate[] = items.map((i) => {
        const p = map.project([i.lng, i.lat]);
        return { id: i.id, x: p.x, y: p.y, width: widths.get(i.id) ?? 0, height: LABEL_HEIGHT, priority: i.priority };
      });
      const obstacles = property ? [propertyPinBox(map.project([property.lng, property.lat]), property.label)] : [];
      const next = placeLabels(candidates, view, obstacles);
      setShown((prev) => (sameSet(prev, next) ? prev : next));
    };
    compute();
    map.on('moveend', compute);
    map.on('resize', compute);
    return () => {
      map.off('moveend', compute);
      map.off('resize', compute);
    };
  }, [handle, items, widths, property?.lat, property?.lng, property?.label]);

  return shown;
}
