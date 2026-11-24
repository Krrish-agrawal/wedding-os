import { Component, Suspense, useMemo, type ReactElement, type ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import { Box3, Color, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D } from 'three';
import registryJson from './assets/registry.json';

/**
 * Optional third-party GLB models, with procedural geometry as the fallback. A GLB is used only when the licence
 * registry lists it; the catalogue (shared code) is not touched. If the file is missing, fails or is still loading, the
 * procedural model is drawn, so the scene never breaks and never waits on a download.
 */

export interface RegistryFile { path: string; sha256: string; bytes: number }
export interface RegistryAsset {
  /** The source's own id (Poly Haven id). */
  assetId: string;
  kind?: 'model' | 'texture' | 'hdri';
  /** Main file, path under /models/wedding/. */
  file: string;
  /** Other files the main file needs (glTF bin and textures, PBR map sets). */
  includes?: RegistryFile[];
  /** Catalogue ids this model draws (models only). */
  catalogIds?: string[];
  use?: string;
  sourceUrl: string;
  author: string;
  /** SPDX identifier. */
  licence: 'CC0-1.0' | 'CC-BY-4.0' | 'MIT' | 'Apache-2.0';
  licenceUrl: string;
  attributionRequired: boolean;
  attributionText: string;
  /** ISO date the licence page was read. */
  checkedOn: string;
  sha256: string;
  notes?: string;
}

/**
 * How each real model is fitted: which GLB material takes which catalogue colour part (so recolouring still works),
 * the fraction of the catalogue height the GLB occupies (the rest is drawn procedurally), and a Y rotation if the model
 * faces the wrong way. Models whose materials are not listed keep their own textures and cannot be recoloured.
 */
export interface GlbFit { parts?: Record<string, string>; heightFraction?: number; rotationY?: number }
export const GLB_FIT: Record<string, GlbFit> = {
  'chandelier-crystal': { parts: { metal: 'basecolor_classic_chandelier_1' } },
  'lantern-floor': { parts: { body: 'brass_diya_lantern' } },
  'sofa-loveseat': { parts: { fabric: 'sofa_02' } },
  'plant-potted': { parts: { pot: 'potted_plant_02_pot' } },
  'urn-brass-flowers': { parts: { brass: 'brass_vase_001' }, heightFraction: 0.62 },
  'elephant-carved': { parts: { wood: 'carved_wooden_elephant' } },
};

export const ALLOWED_LICENCES = ['CC0-1.0', 'CC-BY-4.0', 'MIT', 'Apache-2.0'] as const;
export const REGISTRY: readonly RegistryAsset[] = (registryJson as { assets: RegistryAsset[] }).assets;
/** The model registered for a catalogue id. */
export const glbFor = (catalogId: string, registry: readonly RegistryAsset[] = REGISTRY) => registry.find((a) => (a.kind ?? 'model') === 'model' && a.catalogIds?.includes(catalogId));
/** A texture or HDRI by Poly Haven id, as a public URL (main file). */
export const assetUrl = (assetId: string, registry: readonly RegistryAsset[] = REGISTRY) => { const a = registry.find((x) => x.assetId === assetId); return a ? `/models/wedding/${a.file}` : null; };
/** Public URL of one included file of an asset (e.g. a PBR map) selected by a filename fragment such as `_nor_`. */
export const assetPart = (assetId: string, fragment: string, registry: readonly RegistryAsset[] = REGISTRY) => { const a = registry.find((x) => x.assetId === assetId); const f = [{ path: a?.file ?? '' }, ...(a?.includes ?? [])].find((i) => i.path.includes(fragment)); return f ? `/models/wedding/${f.path}` : null; };

/** Text for an in-app "Credits" note: assets that require attribution, plus a courtesy line for CC0 sources. */
export const creditsFor = (registry: readonly RegistryAsset[] = REGISTRY): string[] => [
  ...registry.filter((a) => a.attributionRequired).map((a) => a.attributionText),
  ...(registry.some((a) => a.licence === 'CC0-1.0' && a.sourceUrl.includes('polyhaven.com')) ? ['Includes CC0 assets from Poly Haven (polyhaven.com).'] : []),
];

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch() { /* the procedural model is shown instead */ }
  override render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** A per-instance copy of a loaded scene: geometry is shared, materials are cloned, so recolouring one object never changes another. */
function Loaded({ asset, size, colors, fit }: { asset: RegistryAsset; size: { w: number; d: number; h: number }; colors: Record<string, string>; fit: GlbFit }) {
  const gltf = useGLTF(`/models/wedding/${asset.file}`, false, true);
  const { object, scale, offset } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((o: Object3D) => {
      if (!(o instanceof Mesh)) return;
      const mats: Material[] = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = mats.map((m) => {
        const c = m.clone();
        const part = Object.entries(fit.parts ?? {}).find(([, name]) => name === m.name)?.[0];
        if (part && colors[part] && c instanceof MeshStandardMaterial) c.color = new Color(colors[part]);
        return c;
      });
      o.material = Array.isArray(o.material) ? cloned : cloned[0]!;
    });
    const box = new Box3().setFromObject(clone);
    const sz = box.getSize(new Vector3());
    const sh = size.h * (fit.heightFraction ?? 1);
    const k = Math.min(size.w / Math.max(sz.x, 1e-3), size.d / Math.max(sz.z, 1e-3), sh / Math.max(sz.y, 1e-3));
    const centre = box.getCenter(new Vector3());
    return { object: clone, scale: k, offset: [-centre.x * k, -box.min.y * k, -centre.z * k] as [number, number, number] };
  }, [gltf, asset, fit, size.w, size.d, size.h, colors]);
  return <group rotation={[0, fit.rotationY ?? 0, 0]}><primitive object={object} scale={scale} position={offset} /></group>;
}

/** The GLB for `assetId` normalised to the catalogue footprint, or `fallback` while loading, on failure, or when none is registered. */
export function withGlb(catalogId: string, size: { w: number; d: number; h: number }, colors: Record<string, string>, fallback: ReactElement, registry: readonly RegistryAsset[] = REGISTRY, overlay?: ReactElement): ReactElement {
  const asset = glbFor(catalogId, registry);
  if (!asset) return fallback;
  const fit = GLB_FIT[catalogId] ?? {};
  return (
    <Fallback fallback={fallback}>
      <Suspense fallback={fallback}><Loaded asset={asset} size={size} colors={colors} fit={fit} />{overlay}</Suspense>
    </Fallback>
  );
}
