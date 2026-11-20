import { AVATAR_PROBE_TIMEOUT_MS } from '../config';

/**
 * Checks that run before the 3D avatar creates anything, so a missing capability or file ends in
 * a quiet fallback to the mascot instead of a console error from three.js or the GLTF loader.
 */

let webglResult: boolean | null = null;

/**
 * WebGL 2 with hardware acceleration. Software rendering would make the avatar a CPU hog during a
 * call, so it counts as unavailable. The probe context is released straight away.
 */
export function hasWebGL2(): boolean {
  if (webglResult !== null) return webglResult;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    webglResult = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglResult = false;
  }
  return webglResult;
}

/**
 * Whether `url` serves a binary file. A dev server or SPA host answers a missing file with
 * index.html and status 200, so an HTML content type counts as missing. HEAD only: nothing is
 * downloaded here.
 */
export async function probeAsset(url: string, timeoutMs = AVATAR_PROBE_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') ?? '';
    return !type.includes('text/html');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** The first candidate whose file exists, or null. Checked in order, one at a time. */
export async function firstAvailable<T extends { url: string }>(candidates: readonly T[]): Promise<T | null> {
  for (const candidate of candidates) {
    if (await probeAsset(candidate.url)) return candidate;
  }
  return null;
}

/** Rejects with `onTimeout()` if `work` has not settled in `ms`. */
export function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
