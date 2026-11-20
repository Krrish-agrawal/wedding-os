/**
 * Source models for the studio's before/after comparison. Folder names under assets/models/raw,
 * served read-only by the dev API. The raw scene is shown with the same normalisation the
 * optimiser bakes into the GLB (see scripts/models/models.config.ts), so both line up.
 */
export interface RawSource {
  dir: string;
  /** Uniform scale applied to the raw scene root. */
  scale: number;
  /** Translation applied after scaling, in metres. */
  offset: [number, number, number];
}

export const RAW_SOURCES: Record<string, RawSource> = {
  'apt-indiranagar': { dir: 'modern-apartment', scale: 1.172347, offset: [-4.5466, -0.2679, -1.7353] },
  'office-koramangala': { dir: 'loft18-office', scale: 1, offset: [-0.4, 0, -2.2] },
};

export function rawModelUrl(source: RawSource): string {
  return `/api/dev/raw-models/${source.dir}/scene.gltf`;
}
