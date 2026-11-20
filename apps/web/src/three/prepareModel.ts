import { Box3, DoubleSide, Mesh, type Group, type Material, type Object3D, type Texture } from 'three';

/** Group names written by scripts/models/optimize.ts. */
export const MODEL_GROUPS = {
  structure: 'Structure',
  furnishing: 'Furnishing',
  exterior: 'Exterior',
} as const;

export interface PreparedModel {
  /** The loaded scene. Treat as read-only; clone with `scene.clone(true)` to show it twice. */
  scene: Group;
  /** World bounds of the interior (structure and furnishing, not the exterior). */
  bounds: Box3;
  /** Walls, floors, ceilings, doors and windows; used for section cuts and floor picking. */
  structure: Object3D | null;
  textures: Texture[];
  triangles: number;
}

const MATERIAL_TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'] as const;

/**
 * One-time fix-ups after loading: static matrices, double-sided structure (some source walls are
 * single planes), transparent materials that do not write depth, and bookkeeping for warm-up.
 */
export function prepareModel(scene: Group): PreparedModel {
  const textures = new Set<Texture>();
  const materials = new Set<Material>();
  let triangles = 0;

  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    o.matrixAutoUpdate = false;
    if (!(o instanceof Mesh)) return;
    const index = o.geometry.index;
    triangles += (index ? index.count : o.geometry.attributes.position?.count ?? 0) / 3;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m as Material);
  });

  for (const m of materials) {
    m.side = DoubleSide;
    if (m.transparent) m.depthWrite = false;
    const record = m as unknown as Partial<Record<(typeof MATERIAL_TEXTURE_SLOTS)[number], Texture | null>>;
    for (const slot of MATERIAL_TEXTURE_SLOTS) {
      const t = record[slot];
      if (t) textures.add(t);
    }
  }

  const structure = scene.getObjectByName(MODEL_GROUPS.structure) ?? null;
  const furnishing = scene.getObjectByName(MODEL_GROUPS.furnishing) ?? null;
  const bounds = new Box3();
  for (const g of [structure, furnishing]) if (g) bounds.union(new Box3().setFromObject(g));
  if (bounds.isEmpty()) bounds.setFromObject(scene);

  return { scene, bounds, structure, textures: [...textures], triangles: Math.round(triangles) };
}
