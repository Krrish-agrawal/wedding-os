import type { PlanFile, RoomsFileSchema, TourFile } from '@ave/shared';
import type { z } from 'zod';

/**
 * Client for the dev-only authoring endpoints in apps/server/src/dev/plugin.ts.
 * Every call throws an Error with the server's message when the write is refused.
 */

async function send(url: string, init: RequestInit): Promise<{ path: string }> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string; path?: string; issues?: { path: (string | number)[]; message: string }[] };
  if (!res.ok) {
    const detail = body.issues?.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error([body.error ?? `Request failed (${res.status})`, detail].filter(Boolean).join(' — '));
  }
  return { path: body.path ?? '' };
}

export function saveTour(propertyId: string, tour: TourFile) {
  return send(`/api/dev/properties/${encodeURIComponent(propertyId)}/tour`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tour) });
}

export function saveRooms(propertyId: string, rooms: z.infer<typeof RoomsFileSchema>) {
  return send(`/api/dev/properties/${encodeURIComponent(propertyId)}/rooms`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rooms) });
}

export function savePlanBounds(propertyId: string, bounds: PlanFile['bounds']) {
  return send(`/api/dev/properties/${encodeURIComponent(propertyId)}/plan-bounds`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bounds) });
}

export function saveMedia(propertyId: string, fileName: string, image: Blob) {
  return send(`/api/dev/media/${encodeURIComponent(propertyId)}/${encodeURIComponent(fileName)}`, { method: 'PUT', headers: { 'content-type': image.type }, body: image });
}

/** "/media/<id>/plan.webp" → "plan.webp" */
export function mediaFileName(publicPath: string): string {
  return publicPath.split('/').pop() ?? publicPath;
}
