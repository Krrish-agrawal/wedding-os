import { useLayoutEffect, useRef, type ReactElement } from 'react';
import { Object3D, type InstancedMesh } from 'three';
import type { CatalogEntry } from '@ave/shared';
import { withGlb } from './glb';
import { texture, type TexKind } from './textures';

/**
 * Procedural models for the catalogue, keyed by `CatalogEntry.model`. Origin is the bottom centre, +z is
 * forward, sizes come from the catalogue entry so the drawn object matches the footprint used for collisions.
 * Every mesh declares its own material, so recolouring one object can never change another. To use a GLB
 * instead, add a builder here that loads it; the scene logic does not change.
 */

interface P {
  w: number;
  d: number;
  h: number;
  /** Colour for a part id (override or catalogue default). */
  c: (part: string) => string;
}

type Builder = (p: P) => ReactElement;

const Box = ({ s, p, color, rough = 0.7, emissive, ei = 0, tex }: { s: [number, number, number]; p: [number, number, number]; color: string; rough?: number; emissive?: string; ei?: number; tex?: TexKind }) => (
  <mesh position={p} castShadow>
    <boxGeometry args={s} />
    <meshStandardMaterial color={color} roughness={rough} map={tex ? texture(tex) : null} emissive={emissive ?? '#000000'} emissiveIntensity={ei} />
  </mesh>
);
const Cyl = ({ r, h, p, color, seg = 20, rough = 0.6, emissive, ei = 0, rt, tex }: { r: number; h: number; p: [number, number, number]; color: string; seg?: number; rough?: number; emissive?: string; ei?: number; rt?: number; tex?: TexKind }) => (
  <mesh position={p} castShadow>
    <cylinderGeometry args={[rt ?? r, r, h, seg]} />
    <meshStandardMaterial color={color} roughness={rough} map={tex ? texture(tex) : null} emissive={emissive ?? '#000000'} emissiveIntensity={ei} />
  </mesh>
);
const Ball = ({ r, p, color, glow = 0 }: { r: number; p: [number, number, number]; color: string; glow?: number }) => (
  <mesh position={p}>
    <sphereGeometry args={[r, 10, 8]} />
    <meshStandardMaterial color={color} roughness={0.8} emissive={glow ? color : '#000000'} emissiveIntensity={glow} />
  </mesh>
);

/** Small deterministic jitter, so flowers look natural but never change between renders. */
const jit = (i: number, k: number) => (Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1;

const garland = (n: number, from: [number, number, number], to: [number, number, number], r: number, color: string, key: string) =>
  Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    return <Ball key={`${key}${i}`} r={r * (0.85 + 0.3 * Math.abs(jit(i, 1)))} color={color} p={[from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t + 0.03 * jit(i, 2), from[2] + (to[2] - from[2]) * t]} />;
  });


/** One draw call for many small blooms. Each object gets its own material, so recolouring stays per object. */
export type Bloom = [x: number, y: number, z: number, r: number];
const Blooms = ({ pts, color, glow = 0 }: { pts: Bloom[]; color: string; glow?: number }) => {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new Object3D();
    pts.forEach(([x, y, z, r], i) => { o.position.set(x, y, z); o.scale.setScalar(r); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.count = pts.length;
    m.instanceMatrix.needsUpdate = true;
  }, [pts]);
  if (pts.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, pts.length]} castShadow frustumCulled={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color={color} roughness={0.85} emissive={glow ? color : '#000000'} emissiveIntensity={glow} />
    </instancedMesh>
  );
};
/** Points along a hanging garland: a gentle sag between two ends, with jitter. */
export const strand = (n: number, a: [number, number, number], b: [number, number, number], r: number, sag: number, k: number): Bloom[] =>
  Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    return [a[0] + (b[0] - a[0]) * t + 0.015 * jit(i, k), a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t + 0.015 * jit(i, k + 1), r * (0.8 + 0.4 * Math.abs(jit(i, k + 2)))] as Bloom;
  });

export const MODELS: Record<string, Builder> = {
  stage: ({ w, d, h, c }) => (
    <group>
      <Box s={[w, h, d]} p={[0, h / 2, 0]} color={c('platform')} rough={0.8} />
      <Box s={[w, 0.07, d]} p={[0, h - 0.035, 0]} color={c('platform')} rough={0.5} />
      <Box s={[w, 0.05, d]} p={[0, 0.025, 0]} color={c('platform')} rough={0.5} />
      <Box s={[w - 0.3, 0.02, d - 0.3]} p={[0, h + 0.01, 0]} color={c('carpet')} tex="fabric" rough={1} />
      {/* Inset front steps (kept inside the footprint) with a carpet runner. */}
      {[0, 1].map((i) => <Box key={i} s={[1.6 - i * 0.3, 0.02, 0.28]} p={[0, h + 0.012 + i * 0.005, d / 2 - 0.4 - i * 0.3]} color={c('carpet')} rough={1} />)}
      <Box s={[0.9, h - 0.1, 0.012]} p={[0, h / 2, d / 2 + 0.002]} color={c('carpet')} tex="fabric" rough={1} />
      {/* Tiered inset border on the deck, inside the footprint. */}
      {[0, 1].map((i) => <Box key={i} s={[w - 0.5 - i * 0.5, 0.025, d - 0.5 - i * 0.5]} p={[0, h + 0.02 + i * 0.012, 0]} color={c(i ? 'platform' : 'carpet')} rough={0.9} />)}
    </group>
  ),
  'mandap-traditional': ({ w, d, h, c }) => {
    const px = w / 2 - 0.25;
    const pz = d / 2 - 0.25;
    const top = 2.7;
    const base = 0.18;
    const y0 = base + top;
    const corners: [number, number][] = [[-px, -pz], [px, -pz], [px, pz], [-px, pz]];
    const sides: [[number, number, number], [number, number, number]][] = [
      [[-px, y0 - 0.12, -pz], [px, y0 - 0.12, -pz]], [[-px, y0 - 0.12, pz], [px, y0 - 0.12, pz]],
      [[-px, y0 - 0.12, -pz], [-px, y0 - 0.12, pz]], [[px, y0 - 0.12, -pz], [px, y0 - 0.12, pz]],
    ];
    const blooms: Bloom[] = [
      ...sides.flatMap(([a, b], k) => strand(15, a, b, 0.09, 0.22, 3 + k * 5)),
      ...corners.flatMap(([x, z], k) => strand(9, [x, 0.5, z], [x, y0 - 0.25, z], 0.1, 0, 40 + k)),
    ];
    const rim = (w / 2) * 1.3 * Math.SQRT1_2 + 0.03;
    const fringe: Bloom[] = [
      ...strand(16, [-rim, y0 + 0.1, -rim], [rim, y0 + 0.1, -rim], 0.1, 0, 60), ...strand(16, [-rim, y0 + 0.1, rim], [rim, y0 + 0.1, rim], 0.1, 0, 65),
      ...strand(16, [-rim, y0 + 0.1, -rim], [-rim, y0 + 0.1, rim], 0.1, 0, 70), ...strand(16, [rim, y0 + 0.1, -rim], [rim, y0 + 0.1, rim], 0.1, 0, 75),
    ];
    const tiers = [{ r: 1.3, hh: 0.5, y: y0 + 0.05 }, { r: 0.98, hh: 0.45, y: y0 + 0.45 }, { r: 0.6, hh: 0.4, y: y0 + 0.8 }];
    const spire = Math.max(0.1, h - (y0 + 1.2));
    return (
      <group>
        <Box s={[w, base, d]} p={[0, base / 2, 0]} color={c('pillars')} rough={0.5} />
        <Box s={[w - 0.3, 0.1, d - 0.3]} p={[0, base + 0.05, 0]} color={c('canopy')} tex="brocade" rough={1} />
        {corners.map(([x, z], i) => (
          <group key={i}>
            <Box s={[0.36, 0.2, 0.36]} p={[x, base + 0.1, z]} color={c('pillars')} rough={0.4} />
            <Cyl r={0.13} rt={0.1} h={top - 0.5} seg={12} p={[x, base + 0.2 + (top - 0.5) / 2, z]} color={c('pillars')} rough={0.35} />
            {[0, 1, 2, 3].map((k) => <Cyl key={k} r={0.02} h={top - 0.6} seg={5} p={[x + Math.cos((k * Math.PI) / 2) * 0.115, base + 0.2 + (top - 0.5) / 2, z + Math.sin((k * Math.PI) / 2) * 0.115]} color={c('pillars')} rough={0.3} />)}
            <Cyl r={0.17} rt={0.2} h={0.14} p={[x, y0 - 0.2, z]} color={c('pillars')} rough={0.4} />
            <Box s={[0.4, 0.1, 0.4]} p={[x, y0 - 0.08, z]} color={c('pillars')} rough={0.4} />
            <Cyl r={0.1} rt={0.05} h={0.16} p={[x, y0 + 0.07, z]} color={c('pillars')} rough={0.25} />
            <Ball r={0.07} p={[x, y0 + 0.2, z]} color={c('flowers')} />
          </group>
        ))}
        {sides.map(([a, b], k) => { const horiz = k < 2; const len = horiz ? px * 2 : pz * 2; return <Box key={k} s={horiz ? [len, 0.16, 0.16] : [0.16, 0.16, len]} p={[(a[0] + b[0]) / 2, y0, (a[2] + b[2]) / 2]} color={c('pillars')} />; })}
        <Box s={[px * 2, 0.28, 0.02]} p={[0, y0 - 0.22, -pz]} color={c('canopy')} tex="brocade" rough={1} />
        <Box s={[px * 2, 0.28, 0.02]} p={[0, y0 - 0.22, pz]} color={c('canopy')} tex="brocade" rough={1} />
        {tiers.map((t, i) => (
          <mesh key={i} position={[0, t.y + t.hh / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[(w / 2) * t.r * 0.98, t.hh, 4]} />
            <meshStandardMaterial color={i === 1 ? c('pillars') : c('canopy')} roughness={0.85} metalness={i === 1 ? 0.35 : 0} />
          </mesh>
        ))}
        <Cyl r={0.05} rt={0.02} h={spire} p={[0, y0 + 1.2 + spire / 2, 0]} color={c('pillars')} rough={0.25} />
        <Ball r={0.16} p={[0, h - 0.05, 0]} color={c('flowers')} />
        <Blooms pts={blooms} color={c('flowers')} />
        <Blooms pts={fringe} color={c('flowers')} />
        <Box s={[0.7, 0.14, 0.7]} p={[0, base + 0.17, 0]} color={c('pillars')} rough={0.6} />
        <Box s={[0.5, 0.05, 0.5]} p={[0, base + 0.26, 0]} color="#3a2a22" rough={1} />
        <Ball r={0.09} p={[0, base + 0.35, 0]} color="#ff9f1c" glow={2} />
      </group>
    );
  },
  'mandap-modern': ({ w, d, h, c }) => {
    const px = w / 2 - 0.1;
    const pz = d / 2 - 0.1;
    const corners: [number, number][] = [[-px, -pz], [px, -pz], [px, pz], [-px, pz]];
    return (
      <group>
        {corners.map(([x, z], i) => <Box key={i} s={[0.08, h - 0.2, 0.08]} p={[x, (h - 0.2) / 2, z]} color={c('frame')} rough={0.3} />)}
        <Box s={[px * 2, 0.08, 0.08]} p={[0, h - 0.2, -pz]} color={c('frame')} />
        <Box s={[px * 2, 0.08, 0.08]} p={[0, h - 0.2, pz]} color={c('frame')} />
        <Box s={[0.08, 0.08, pz * 2]} p={[-px, h - 0.2, 0]} color={c('frame')} />
        <Box s={[0.08, 0.08, pz * 2]} p={[px, h - 0.2, 0]} color={c('frame')} />
        {[-1, 1].flatMap((sx) => [-0.7, 0.7].map((oz, i) => <Box key={`${sx}${i}`} s={[0.03, h - 0.9, 0.9]} p={[sx * (px - 0.05), (h - 0.9) / 2 + 0.5, oz]} color={c('drapes')} rough={1} />))}
        {corners.map(([x, z], i) => (
          <group key={i}>
            <Ball r={0.3} p={[x, h - 0.45, z]} color={c('flowers')} />
            <Ball r={0.2} p={[x * 0.9, h - 0.75, z * 0.9]} color={c('flowers')} />
            <Ball r={0.25} p={[x, 0.3, z]} color={c('flowers')} />
          </group>
        ))}
        <Box s={[w - 0.4, 0.06, d - 0.4]} p={[0, 0.03, 0]} color={c('drapes')} tex="fabric" rough={1} />
      </group>
    );
  },
  arch: ({ w, h, c }) => {
    const r = (w - 0.34) / 2;
    const post = h - r - 0.05;
    const arc: Bloom[] = Array.from({ length: 34 }, (_, i) => { const a = (i / 33) * Math.PI; return [Math.cos(a) * r + 0.03 * jit(i, 3), post + Math.sin(a) * r, 0.05 * jit(i, 4), 0.085 + 0.04 * Math.abs(jit(i, 9))] as Bloom; });
    const drops = [-1, 1].flatMap((s, k) => strand(9, [s * r, post - 0.05, 0.02], [s * r, 0.5, 0.02], 0.085, 0, 30 + k));
    const petals: Bloom[] = Array.from({ length: 12 }, (_, i) => [(jit(i, 51) * (w - 0.5)) / 2, 0.02, 0.2 * jit(i, 52), 0.04]);
    return (
      <group>
        {[-1, 1].map((s) => (
          <group key={s}>
            <Box s={[0.3, 0.14, 0.3]} p={[s * r, 0.07, 0]} color={c('frame')} rough={0.5} />
            <Cyl r={0.08} rt={0.06} h={post - 0.14} p={[s * r, 0.14 + (post - 0.14) / 2, 0]} color={c('frame')} rough={0.4} />
            <Ball r={0.1} p={[s * r, post + 0.02, 0]} color={c('frame')} />
          </group>
        ))}
        <mesh position={[0, post, 0]}>
          <torusGeometry args={[r, 0.05, 8, 32, Math.PI]} />
          <meshStandardMaterial color={c('frame')} roughness={0.5} />
        </mesh>
        <Blooms pts={arc} color={c('flowers')} />
        <Blooms pts={drops} color={c('flowers')} />
        <Blooms pts={petals} color={c('flowers')} />
      </group>
    );
  },
  centrepiece: ({ w, h, c }) => {
    const pts: Bloom[] = Array.from({ length: 26 }, (_, i) => {
      const a = i * 2.4;
      const ring = Math.sqrt((i + 1) / 26);
      return [Math.cos(a) * w * 0.3 * ring, h * 0.5 + (1 - ring) * 0.3 + 0.04 * jit(i, 5), Math.sin(a) * w * 0.3 * ring, 0.07 + 0.035 * Math.abs(jit(i, 6))] as Bloom;
    });
    return (
      <group>
        <Cyl r={w * 0.22} rt={w * 0.3} h={h * 0.4} p={[0, h * 0.2, 0]} color={c('vase')} rough={0.3} />
        <Cyl r={w * 0.3} rt={w * 0.32} h={0.04} p={[0, h * 0.41, 0]} color={c('vase')} rough={0.3} />
        <Cyl r={0.02} h={h * 0.2} p={[0, h * 0.5, 0]} color="#3f7d4e" seg={5} />
        <Blooms pts={pts} color={c('flowers')} />
      </group>
    );
  },
  'wall-panel': ({ w, d, h, c }) => {
    const z0 = -d / 2;
    const at = (i: number, k: number) => (jit(i, k) * 0.5 + 0.5);
    const leaves: Bloom[] = Array.from({ length: 70 }, (_, i) => [-w / 2 + 0.1 + at(i, 31) * (w - 0.2), 0.1 + at(i, 32) * (h - 0.2), z0 + 0.1 + 0.03 * jit(i, 33), 0.09 + 0.05 * Math.abs(jit(i, 34))]);
    const flowers: Bloom[] = Array.from({ length: 150 }, (_, i) => [-w / 2 + 0.12 + at(i, 35) * (w - 0.24), 0.12 + at(i, 36) * (h - 0.24), z0 + 0.14 + 0.06 * Math.abs(jit(i, 37)), 0.07 + 0.07 * Math.abs(jit(i, 38))]);
    return (
      <group>
        <Box s={[w, h, 0.04]} p={[0, h / 2, z0 + 0.02]} color={c('leaves')} rough={1} />
        <Box s={[w + 0.08, 0.06, 0.1]} p={[0, h + 0.03, z0 + 0.05]} color="#6b5a3a" />
        <Blooms pts={leaves} color={c('leaves')} />
        <Blooms pts={flowers} color={c('flowers')} />
      </group>
    );
  },
  chair: ({ w, d, h, c }) => (
    <group>
      <Box s={[w * 0.92, 0.09, d * 0.92]} p={[0, h * 0.47, 0]} color={c('seat')} rough={0.95} />
      <Box s={[w * 0.96, 0.04, d * 0.96]} p={[0, h * 0.47 - 0.065, 0]} color={c('frame')} rough={0.4} />
      <Box s={[w * 0.9, h * 0.42, 0.07]} p={[0, h * 0.74, -d * 0.43]} color={c('seat')} rough={0.95} />
      <Box s={[w * 0.96, 0.05, 0.08]} p={[0, h * 0.97 - 0.02, -d * 0.43]} color={c('frame')} rough={0.4} />
      {[-1, 1].map((x) => <Box key={x} s={[0.04, h * 0.55, 0.04]} p={[x * w * 0.46, h * 0.72, -d * 0.43]} color={c('frame')} rough={0.4} />)}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z], i) => <Cyl key={i} r={0.022} rt={0.016} h={h * 0.44} seg={6} p={[x! * w * 0.42, h * 0.22, z! * d * 0.42]} color={c('frame')} rough={0.35} />)}
    </group>
  ),
  sofa: ({ w, d, h, c }) => (
    <group>
      <Box s={[w, h * 0.3, d]} p={[0, h * 0.25, 0]} color={c('frame')} rough={0.6} />
      <Box s={[w - 0.4, h * 0.22, d - 0.25]} p={[0, h * 0.5, 0.05]} color={c('fabric')} tex="fabric" rough={1} />
      <Box s={[w, h * 0.65, 0.22]} p={[0, h * 0.55, -d / 2 + 0.11]} color={c('fabric')} tex="fabric" rough={1} />
      <Box s={[0.2, h * 0.5, d]} p={[-w / 2 + 0.1, h * 0.5, 0]} color={c('fabric')} tex="fabric" rough={1} />
      <Box s={[0.2, h * 0.5, d]} p={[w / 2 - 0.1, h * 0.5, 0]} color={c('fabric')} tex="fabric" rough={1} />
    </group>
  ),
  chandelier: ({ w, h, c }) => {
    const ring = w * 0.42;
    const arms = 12;
    return (
      <group>
        <Cyl r={0.015} h={h * 0.4} p={[0, h - h * 0.2, 0]} color={c('metal')} rough={0.3} />
        <Cyl r={0.08} rt={0.03} h={0.1} p={[0, h * 0.58, 0]} color={c('metal')} rough={0.25} />
        <Ball r={0.1} p={[0, h * 0.52, 0]} color={c('metal')} />
        {[ring, ring * 0.62].map((rr, k) => (
          <mesh key={k} position={[0, h * (0.5 - k * 0.2), 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[rr, 0.022, 8, 40]} />
            <meshStandardMaterial color={c('metal')} roughness={0.25} metalness={0.7} />
          </mesh>
        ))}
        {Array.from({ length: arms }, (_, i) => {
          const a = (i / arms) * Math.PI * 2;
          const x = Math.cos(a), z = Math.sin(a);
          return (
            <group key={i}>
              <Cyl r={0.03} rt={0.022} h={0.09} p={[x * ring, h * 0.5 + 0.06, z * ring]} color={c('metal')} rough={0.3} />
              <Ball r={0.05} p={[x * ring, h * 0.5 + 0.16, z * ring]} color={c('glow')} glow={2.2} />
              <Cyl r={0.012} rt={0.004} h={0.2} seg={5} p={[x * ring * 0.62, h * 0.3 - 0.1 - (i % 2) * 0.06, z * ring * 0.62]} color="#e8f4ff" rough={0.1} emissive="#e8f4ff" ei={0.35} />
              <Ball r={0.03} p={[x * ring, h * 0.5 - 0.12 - (i % 3) * 0.05, z * ring]} color="#e8f4ff" glow={0.4} />
            </group>
          );
        })}
        <Ball r={0.06} p={[0, h * 0.16, 0]} color={c('glow')} glow={2.2} />
      </group>
    );
  },
  'fairy-curtain': ({ w, d, h, c }) => (
    <group>
      {Array.from({ length: 11 }, (_, i) => {
        const x = -w / 2 + 0.1 + (i / 10) * (w - 0.2);
        const len = h * (0.75 + 0.25 * Math.abs(jit(i, 8)));
        return (
          <group key={i}>
            <Cyl r={0.004} h={len} p={[x, h - len / 2, -d / 2 + 0.03]} color="#6b5a3a" seg={4} />
            {Array.from({ length: Math.floor(len / 0.3) }, (_, j) => <Ball key={j} r={0.025} p={[x, h - 0.1 - j * 0.3, -d / 2 + 0.03]} color={c('lights')} glow={1.8} />)}
          </group>
        );
      })}
    </group>
  ),
  lantern: ({ w, h, c }) => (
    <group>
      <Cyl r={w * 0.4} h={0.06} p={[0, 0.03, 0]} color={c('body')} />
      <Cyl r={w * 0.28} rt={w * 0.22} h={h * 0.75} p={[0, h * 0.42, 0]} color={c('glow')} rough={0.4} emissive={c('glow')} ei={1.1} />
      <Cyl r={w * 0.32} rt={w * 0.1} h={0.12} p={[0, h * 0.88, 0]} color={c('body')} />
      <Cyl r={0.015} h={0.12} p={[0, h * 0.96, 0]} color={c('body')} />
    </group>
  ),
  'marigold-curtain': ({ w, d, h, c }) => {
    const z0 = -d / 2 + 0.04;
    const pts: Bloom[] = Array.from({ length: 14 }, (_, i) => {
      const x = -w / 2 + 0.1 + (i / 13) * (w - 0.2);
      const len = h * (0.8 + 0.2 * Math.abs(jit(i, 11)));
      return strand(Math.floor(len / 0.1), [x, h - 0.08, z0], [x + 0.03 * jit(i, 14), h - len, z0 + 0.02 * jit(i, 15)], 0.058, 0.02, 12 + i * 3);
    }).flat();
    return (
      <group>
        <mesh position={[0, h - 0.02, z0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.015, 0.015, w, 6]} /><meshStandardMaterial color={c('string')} /></mesh>
        <Blooms pts={pts} color={c('flowers')} />
      </group>
    );
  },
  'brass-lamp': ({ w, h, c }) => (
    <group>
      <Cyl r={w * 0.45} rt={w * 0.3} h={0.1} p={[0, 0.05, 0]} color={c('brass')} rough={0.25} />
      <Cyl r={0.05} rt={0.035} h={h * 0.62} p={[0, 0.1 + (h * 0.62) / 2, 0]} color={c('brass')} rough={0.25} />
      {[0.3, 0.5].map((f) => <Cyl key={f} r={0.09} rt={0.06} h={0.05} p={[0, h * f, 0]} color={c('brass')} rough={0.25} />)}
      {/* The oil bowl on top with five wicks, the way a nilavilakku is drawn. */}
      <Cyl r={w * 0.48} rt={w * 0.42} h={0.07} p={[0, h * 0.74, 0]} color={c('brass')} rough={0.25} />
      {[-2, -1, 0, 1, 2].map((k) => <Ball key={k} r={0.03} p={[Math.sin(k * 0.6) * w * 0.34, h * 0.74 + 0.07 + Math.abs(k) * -0.005, Math.cos(k * 0.6) * w * 0.34 - w * 0.34 * 0.1]} color={c('flame')} glow={2} />)}
      <Ball r={0.05} p={[0, h * 0.9, 0]} color={c('flame')} glow={1.4} />
      <Cyl r={0.012} rt={0.012} h={h * 0.16} p={[0, h * 0.82, 0]} color={c('brass')} />
    </group>
  ),
  'aisle-runner': ({ w, d, h, c }) => (
    <group>
      <Box s={[w, h, d]} p={[0, h / 2, 0]} color={c('runner')} tex="petals" rough={1} />
      <Box s={[0.06, h + 0.004, d]} p={[-w / 2 + 0.05, h / 2 + 0.002, 0]} color={c('petals')} rough={1} />
      <Box s={[0.06, h + 0.004, d]} p={[w / 2 - 0.05, h / 2 + 0.002, 0]} color={c('petals')} rough={1} />
      {Array.from({ length: 64 }, (_, i) => (
        <mesh key={i} position={[(jit(i, 21) * (w - 0.3)) / 2, h + 0.012, -d / 2 + 0.1 + (i / 63) * (d - 0.2)]} rotation={[-Math.PI / 2, 0, jit(i, 22) * 3]}>
          <circleGeometry args={[0.05 + 0.02 * Math.abs(jit(i, 23)), 6]} />
          <meshStandardMaterial color={c('petals')} roughness={1} />
        </mesh>
      ))}
    </group>
  ),
  'round-table': ({ w, h, c }) => (
    <group>
      <Cyl r={0.05} h={h - 0.05} p={[0, (h - 0.05) / 2, 0]} color="#6b5a3a" />
      <Cyl r={w * 0.2} h={0.04} p={[0, 0.02, 0]} color="#6b5a3a" />
      <Cyl r={w * 0.5} h={0.05} p={[0, h - 0.025, 0]} color={c('cloth')} tex="fabric" rough={1} seg={32} />
      <Cyl r={w * 0.5} rt={w * 0.34} h={h * 0.5} p={[0, h * 0.5, 0]} color={c('cloth')} tex="fabric" rough={1} seg={32} />
      <Cyl r={0.07} rt={0.1} h={0.12} p={[0, h + 0.06, 0]} color="#e9e4d8" rough={0.3} />
      {Array.from({ length: 7 }, (_, i) => <Ball key={i} r={0.08} p={[Math.cos(i * 2.4) * (i === 0 ? 0 : 0.1), h + 0.17 + (i % 3) * 0.04, Math.sin(i * 2.4) * (i === 0 ? 0 : 0.1)]} color={c('centre')} />)}
    </group>
  ),
  jhula: ({ w, d, h, c }) => {
    const px = w / 2 - 0.08;
    const seatY = h * 0.3;
    const sw = w * 0.62;
    return (
      <group>
        {[-px, px].flatMap((x) => [-d / 2 + 0.1, d / 2 - 0.1].map((z, k) => <Cyl key={`${x}${k}`} r={0.07} h={h} p={[x, h / 2, z]} color={c('frame')} rough={0.5} />))}
        {[-d / 2 + 0.1, d / 2 - 0.1].map((z) => <Box key={z} s={[px * 2 + 0.2, 0.12, 0.12]} p={[0, h - 0.04, z]} color={c('frame')} />)}
        {[-sw / 2 + 0.05, sw / 2 - 0.05].map((x) => <Cyl key={x} r={0.012} h={h - seatY - 0.1} p={[x, seatY + (h - seatY - 0.1) / 2, 0]} color={c('frame')} seg={6} />)}
        {[-sw / 2 + 0.05, sw / 2 - 0.05].map((x) => garland(8, [x, seatY + 0.1, 0.02], [x, h - 0.15, 0.02], 0.06, c('flowers'), `j${x}`))}
        <Box s={[sw, 0.1, d * 0.5]} p={[0, seatY, 0]} color={c('seat')} rough={0.9} />
        <Box s={[sw, 0.45, 0.08]} p={[0, seatY + 0.28, -d * 0.22]} color={c('seat')} rough={0.9} />
        {garland(12, [-px, h - 0.1, -d / 2 + 0.1], [px, h - 0.1, -d / 2 + 0.1], 0.08, c('flowers'), 'jt')}
      </group>
    );
  },
  'plant-potted': ({ w, h, c }) => (
    <group>
      <Cyl r={w * 0.3} rt={w * 0.38} h={h * 0.3} p={[0, h * 0.15, 0]} color={c('pot')} rough={0.8} />
      {Array.from({ length: 9 }, (_, i) => { const a = (i / 9) * Math.PI * 2; return <group key={i} position={[Math.cos(a) * w * 0.18, h * 0.62, Math.sin(a) * w * 0.18]} rotation={[Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7]}><Cyl r={w * 0.12} rt={0.005} h={h * 0.62} seg={6} p={[0, 0, 0]} color={c('leaves')} rough={0.8} /></group>; })}
      <Cyl r={0.025} h={h * 0.5} p={[0, h * 0.55, 0]} color={c('leaves')} />
    </group>
  ),
  'urn-flowers': ({ w, h, c }) => (
    <group>
      <Cyl r={w * 0.3} rt={w * 0.18} h={h * 0.55} p={[0, h * 0.275, 0]} color={c('brass')} rough={0.3} />
      <Cyl r={w * 0.2} rt={w * 0.36} h={h * 0.12} p={[0, h * 0.58, 0]} color={c('brass')} rough={0.3} />
      <Blooms pts={Array.from({ length: 26 }, (_, i) => [Math.cos(i * 2.4) * w * 0.3 * Math.sqrt((i + 1) / 26), h * 0.7 + 0.18 * Math.sqrt(1 - (i / 26) ** 2) + h * 0.06 * jit(i, 3), Math.sin(i * 2.4) * w * 0.3 * Math.sqrt((i + 1) / 26), 0.07 + 0.02 * Math.abs(jit(i, 4))] as Bloom)} color={c('flowers')} />
    </group>
  ),
  elephant: ({ w, d, h, c }) => (
    <group>
      <Box s={[w * 0.75, h * 0.42, d * 0.62]} p={[0, h * 0.58, -d * 0.05]} color={c('wood')} rough={0.6} />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z], i) => <Cyl key={i} r={w * 0.11} h={h * 0.38} p={[x! * w * 0.26, h * 0.19, z! * d * 0.2]} color={c('wood')} rough={0.6} />)}
      <Box s={[w * 0.5, h * 0.36, d * 0.26]} p={[0, h * 0.78, d * 0.3]} color={c('wood')} rough={0.6} />
      <Cyl r={w * 0.07} h={h * 0.5} p={[0, h * 0.42, d * 0.46]} color={c('wood')} rough={0.6} />
      <Box s={[w * 0.82, 0.04, d * 0.55]} p={[0, h * 0.8, -d * 0.05]} color={c('trim')} rough={0.3} />
    </group>
  ),
  rangoli: ({ w, h, c }) => {
    const r = w / 2;
    return (
      <group>
        <Cyl r={r} h={h} p={[0, h / 2, 0]} color={c('outer')} rough={1} seg={40} />
        <Cyl r={r * 0.72} h={h + 0.004} p={[0, h / 2, 0]} color={c('middle')} rough={1} seg={40} />
        <Cyl r={r * 0.42} h={h + 0.008} p={[0, h / 2, 0]} color={c('outer')} rough={1} seg={40} />
        <Cyl r={r * 0.2} h={h + 0.012} p={[0, h / 2, 0]} color={c('centre')} rough={1} seg={40} />
        {Array.from({ length: 8 }, (_, i) => <Ball key={i} r={0.07} p={[Math.cos((i / 8) * Math.PI * 2) * r * 0.57, h + 0.02, Math.sin((i / 8) * Math.PI * 2) * r * 0.57]} color={c('centre')} />)}
      </group>
    );
  },
};

/** Procedural parts drawn on top of a real GLB: flowers in the urn (the GLB carries none). */
function overlayFor(catalogId: string, s: { w: number; d: number; h: number }, c: (part: string) => string): ReactElement | undefined {
  if (catalogId === 'urn-brass-flowers') {
    const top = s.h * 0.62;
    return <Blooms pts={Array.from({ length: 30 }, (_, i) => [Math.cos(i * 2.4) * s.w * 0.28 * Math.sqrt((i + 1) / 30), top + 0.05 + 0.2 * Math.sqrt(1 - (i / 30) ** 2), Math.sin(i * 2.4) * s.w * 0.28 * Math.sqrt((i + 1) / 30), 0.075 + 0.02 * Math.abs(jit(i, 4))] as Bloom)} color={c('flowers')} />;
  }
  return undefined;
}

export function buildModel(entry: CatalogEntry, scaleColors: Record<string, string>): ReactElement | null {
  const b = MODELS[entry.model];
  if (!b) return null;
  const c = (part: string) => scaleColors[part] ?? entry.parts.find((p) => p.id === part)?.color ?? '#cccccc';
  const size = { w: entry.size.width, d: entry.size.depth, h: entry.size.height };
  const colours = Object.fromEntries(entry.parts.map((p) => [p.id, c(p.id)]));
  // A registered, licence-checked GLB replaces the procedural model; the procedural one stays as the fallback.
  const overlay = overlayFor(entry.id, size, c);
  return withGlb(entry.id, size, colours, b({ ...size, c }), undefined, overlay);
}
