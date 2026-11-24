/**
 * Optional look thumbnails. They live ONLY in this browser's localStorage, only when the customer ticks the box, and are
 * never sent to the server. Deleting a look, or "Delete my photo and generated images", removes them.
 */
const PREFIX = 'wedding-os:look-thumb:';

export const getThumb = (lookId: string): string | null => { try { return localStorage.getItem(PREFIX + lookId); } catch { return null; } };
export const setThumb = (lookId: string, dataUrl: string): boolean => { try { localStorage.setItem(PREFIX + lookId, dataUrl); return true; } catch { return false; } };
export const removeThumb = (lookId: string): void => { try { localStorage.removeItem(PREFIX + lookId); } catch { /* ignore */ } };

export function removeAllThumbs(): void {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k); } catch { /* ignore */ }
}

/** Drops thumbnails whose look no longer exists (deleted here, by the planner, or on another device). */
export function pruneThumbs(keepIds: readonly string[]): void {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX) && !keepIds.includes(k.slice(PREFIX.length))) localStorage.removeItem(k); } catch { /* ignore */ }
}

/** Scales a canvas to a small JPEG data URL. */
export function thumbOf(canvas: HTMLCanvasElement, maxDim = 240): string {
  const k = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
  c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}
