import { z } from 'zod';
import { DecorObjectSchema, type DecorObject } from '../state.js';

/**
 * Versioned scene files (design export/import). Pattern from the room-configurator reference's scene-store:
 * parse, migrate older versions forward, refuse newer ones, and never trust the input.
 */

export const SCENE_FILE_VERSION = 1;

export interface SceneFile {
  version: typeof SCENE_FILE_VERSION;
  venueId: string;
  objects: DecorObject[];
}

const FileSchema = z.object({ version: z.literal(SCENE_FILE_VERSION), venueId: z.string().min(1).max(60), objects: z.array(DecorObjectSchema).max(300) });

export type SceneFileError = 'not-json' | 'not-a-scene' | 'newer-version';

export function serializeScene(venueId: string, objects: readonly DecorObject[]): string {
  const file: SceneFile = { version: SCENE_FILE_VERSION, venueId, objects: [...objects] };
  return JSON.stringify(file, null, 2);
}

/** Version 0 had no per-part colours and no explicit mount (everything stood on the floor). */
function migrate(data: Record<string, unknown>): Record<string, unknown> | null {
  const v = data.version;
  if (v === SCENE_FILE_VERSION) return data;
  if (v === 0 && Array.isArray(data.objects)) {
    return {
      ...data,
      version: SCENE_FILE_VERSION,
      objects: (data.objects as Record<string, unknown>[]).map((o) => ({ mount: 'floor', colors: {}, materialId: null, ...o })),
    };
  }
  return null;
}

export function parseSceneFile(raw: string): { ok: true; file: SceneFile } | { ok: false; error: SceneFileError } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'not-json' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, error: 'not-a-scene' };
  const version = (data as { version?: unknown }).version;
  if (typeof version === 'number' && version > SCENE_FILE_VERSION) return { ok: false, error: 'newer-version' };
  const migrated = migrate(data as Record<string, unknown>);
  if (!migrated) return { ok: false, error: 'not-a-scene' };
  const parsed = FileSchema.safeParse(migrated);
  return parsed.success ? { ok: true, file: parsed.data } : { ok: false, error: 'not-a-scene' };
}
