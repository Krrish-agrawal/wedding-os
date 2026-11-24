import { Component, Suspense, useMemo, type ReactNode } from 'react';
import { Environment, useTexture } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { bounds, type StudioRoom } from '@ave/shared';
import { assetPart, assetUrl, REGISTRY } from './glb';
import { useStudio, type Quality } from './useStudio';

/**
 * Realistic rendering for the studio: image-based lighting from a Poly Haven HDRI (CC0, shipped in /models/wedding), soft
 * shadows, bloom on emissive bulbs, and PBR floor and wall materials. Everything has a plain fallback: a missing file
 * or the Fast setting draws flat colours with simple lights, and the scene still works.
 */

export type Warmth = 'warm' | 'neutral' | 'cool';
type Theme = NonNullable<StudioRoom['theme']>;

export const THEME_HDRI: Record<Theme, string> = { ballroom: 'marry_hall', courtyard: 'old_hall', lawn: 'evening_meadow' };
export const THEME_FLOOR: Record<Theme, { id: string; tile: number }> = { ballroom: { id: 'marble_tiles', tile: 2.4 }, courtyard: { id: 'old_wood_floor', tile: 2 }, lawn: { id: 'leafy_grass', tile: 3 } };
export const WALL_TEXTURE = { id: 'beige_wall_001', tile: 3 };

const EXPOSURE: Record<Warmth, number> = { warm: 1.05, neutral: 1, cool: 0.95 };
const WARM_LIGHT: Record<Warmth, string> = { warm: '#ffd9a0', neutral: '#fff1d6', cool: '#dce8ff' };

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** HDRI lighting (and the sky behind the lawn). Skipped in Fast mode or if the file is missing. */
export function Atmosphere({ room, warmth, quality, span, centre }: { room: StudioRoom; warmth: Warmth; quality: Quality; span: number; centre: { x: number; z: number } }) {
  const theme = room.theme ?? 'ballroom';
  const url = assetUrl(THEME_HDRI[theme]);
  const outdoor = Boolean(room.outdoor);
  const fast = quality === 'fast';
  return (
    <>
      {!fast && url ? (
        <Boundary fallback={null}>
          <Suspense fallback={null}>
            <Environment files={url} background={outdoor} backgroundBlurriness={outdoor ? 0.08 : 0} backgroundIntensity={outdoor ? 0.9 : 1} environmentIntensity={outdoor ? 0.9 : 0.75 * EXPOSURE[warmth]} />
          </Suspense>
        </Boundary>
      ) : null}
      <ambientLight intensity={fast ? 0.9 : 0.25} color={WARM_LIGHT[warmth]} />
      <hemisphereLight args={outdoor ? ['#ffffff', '#6fa15a', fast ? 0.8 : 0.25] : ['#fff1d6', '#b98a5a', fast ? 0.6 : 0.2]} />
      <directionalLight
        position={[centre.x + span * 0.5, span * 0.9, centre.z + span * 0.35]}
        intensity={fast ? 1.4 : outdoor ? 2.2 : 1.1}
        color={outdoor ? '#fff0d0' : WARM_LIGHT[warmth]}
        castShadow={!fast}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-left={-span * 0.7} shadow-camera-right={span * 0.7} shadow-camera-top={span * 0.7} shadow-camera-bottom={-span * 0.7} shadow-camera-near={1} shadow-camera-far={span * 3}
      />
      {!fast ? <fog attach="fog" args={[outdoor ? '#cfe4f0' : '#efe3d0', span * 1.6, span * 6]} /> : null}
    </>
  );
}

/** Bloom on emissive bulbs and flames. High quality only. */
export function Effects({ quality }: { quality: Quality }) {
  if (quality === 'fast') return null;
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.92} luminanceSmoothing={0.2} />
    </EffectComposer>
  );
}

function useMaps(id: string, tile: { x: number; y: number }) {
  const diff = assetPart(id, '_diff_');
  const nor = assetPart(id, '_nor_');
  const arm = assetPart(id, '_arm_');
  if (!diff || !nor || !arm) throw new Error(`texture ${id} is not registered`);
  const maps = useTexture([diff, nor, arm]) as Texture[];
  return useMemo(() => {
    const cloned = maps.map((t, i) => { const c = t.clone(); c.wrapS = c.wrapT = RepeatWrapping; c.repeat.set(tile.x, tile.y); c.colorSpace = i === 0 ? SRGBColorSpace : t.colorSpace; c.anisotropy = 8; c.needsUpdate = true; return c; });
    return { diff: cloned[0]!, nor: cloned[1]!, arm: cloned[2]! };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps, tile.x, tile.y]);
}

function PbrInner({ id, tile, tint }: { id: string; tile: { x: number; y: number }; tint?: string }) {
  const m = useMaps(id, tile);
  return <meshStandardMaterial map={m.diff} normalMap={m.nor} roughnessMap={m.arm} metalnessMap={m.arm} roughness={1} metalness={1} color={tint ?? '#ffffff'} />;
}

/** A PBR surface from a registered Poly Haven texture set, or a plain material when unavailable (Fast mode, missing files). */
export function Surface({ id, tile, flat, tint, roughness = 0.85 }: { id: string; tile: { x: number; y: number }; flat: string; tint?: string; roughness?: number }) {
  const quality = useStudio((s) => s.quality);
  const plain = <meshStandardMaterial color={flat} roughness={roughness} />;
  if (quality === 'fast' || !REGISTRY.some((a) => a.assetId === id)) return plain;
  return <Boundary fallback={plain}><Suspense fallback={plain}><PbrInner id={id} tile={tile} tint={tint} /></Suspense></Boundary>;
}

export const bounded = (room: StudioRoom) => { const b = bounds(room); return { b, span: Math.max(b.width, b.depth), centre: { x: b.centre.x, z: b.centre.z } }; };
