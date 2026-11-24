/** Client-side checks for inspiration photos. The server re-checks everything (by magic bytes); this only gives fast, kind feedback. */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 6 * 1024 * 1024;

export type FileCheck = { ok: true } | { ok: false; reason: string };

export function checkImageFile(f: { name: string; type: string; size: number }): FileCheck {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(f.type)) return { ok: false, reason: `${f.name}: only JPEG, PNG or WebP photos are accepted.` };
  if (f.size === 0) return { ok: false, reason: `${f.name} is empty.` };
  if (f.size > MAX_FILE_BYTES) return { ok: false, reason: `${f.name} is ${(f.size / 1048576).toFixed(1)} MB; the limit is ${MAX_FILE_BYTES / 1048576} MB per photo.` };
  return { ok: true };
}

/** Splits picked files into those that can be added (respecting how many slots are free) and readable rejections. */
export function acceptFiles<T extends { name: string; type: string; size: number }>(files: readonly T[], slotsFree: number): { accepted: T[]; rejected: string[] } {
  const accepted: T[] = [];
  const rejected: string[] = [];
  for (const f of files) {
    const c = checkImageFile(f);
    if (!c.ok) rejected.push(c.reason);
    else if (accepted.length >= slotsFree) rejected.push(`${f.name}: you can add up to ${MAX_FILES} photos.`);
    else accepted.push(f);
  }
  return { accepted, rejected };
}
