import { useMemo } from 'react';
import { Shape, Vector2 } from 'three';
import { bounds, inwardNormal, walls, type StudioRoom } from '@ave/shared';
import { Surface, THEME_FLOOR, WALL_TEXTURE } from './render';

/**
 * The venue shell, built from plan data (floor polygon + height + theme). It contains no decorations and decorations
 * never touch it: the studio draws this and the decoration layer as siblings. The pilasters and the lawn's covered platform
 * are scenery only: they do not take part in placement or collision.
 * SAMPLE DATA: invented venues, drawn procedurally. No third-party model is used.
 */

export const THEME_SKY: Record<NonNullable<StudioRoom['theme']>, string> = { ballroom: '#f6f1ea', courtyard: '#efe3d0', lawn: '#bfe3f5' };

const PALETTE = {
  ballroom: { floor: '#d9c4a1', wall: '#f1e9dc', dado: '#8b5e3c', cornice: '#d8c6a5' },
  courtyard: { floor: '#b98a5a', wall: '#efe3cc', dado: '#5e3a1f', cornice: '#8a5a2b' },
  lawn: { floor: '#79b062', wall: '#f3ead8', dado: '#2f6b3a', cornice: '#e6dcc4' },
} as const;

function Walls({ room, theme }: { room: StudioRoom; theme: keyof typeof PALETTE }) {
  const ws = useMemo(() => walls(room), [room]);
  const pal = PALETTE[theme];
  const wallH = room.wallHeight ?? room.height;
  return (
    <>
      {ws.map((w) => {
        // Single-sided planes facing into the room: seen from outside they vanish, so the near walls never
        // block the view (a dollhouse cutaway) while the far walls stay solid.
        const n = inwardNormal(room, w);
        const rot = Math.atan2(n.x, n.z);
        const mx = (w.from.x + w.to.x) / 2;
        const mz = (w.from.z + w.to.z) / 2;
        return (
          <group key={w.index} position={[mx, 0, mz]} rotation={[0, rot, 0]}>
            <mesh position={[0, wallH / 2, 0]} receiveShadow>
              <planeGeometry args={[w.length, wallH]} />
              {theme === 'lawn' ? <meshStandardMaterial color={pal.wall} roughness={0.9} transparent opacity={0.55} /> : <Surface id={WALL_TEXTURE.id} tile={{ x: w.length / WALL_TEXTURE.tile, y: wallH / WALL_TEXTURE.tile }} flat={pal.wall} tint={theme === 'courtyard' ? '#ffe9c4' : '#fff6e8'} roughness={0.95} />}
            </mesh>
            {theme === 'lawn' ? (
              // A clipped hedge along the foot of the lattice screen.
              <mesh position={[0, 0.55, -0.25]}>
                <boxGeometry args={[w.length, 1.1, 0.5]} />
                <meshStandardMaterial color={pal.dado} roughness={1} />
              </mesh>
            ) : (
              <mesh position={[0, theme === 'courtyard' ? 1.1 : 0.5, 0.01]}>
                <planeGeometry args={[w.length, theme === 'courtyard' ? 2.2 : 1.0]} />
                <meshStandardMaterial color={pal.dado} roughness={0.7} />
              </mesh>
            )}
            {theme !== 'lawn' ? (
              <mesh position={[0, wallH - 0.15, 0.01]}>
                <planeGeometry args={[w.length, 0.3]} />
                <meshStandardMaterial color={pal.cornice} roughness={0.8} />
              </mesh>
            ) : null}
          </group>
        );
      })}
    </>
  );
}

function Pilasters({ room }: { room: StudioRoom }) {
  const b = bounds(room);
  return (
    <>
      {(room.pilasters ?? []).map((p, i) => {
        const z = p.z <= b.min.z + 0.01 ? p.z + 0.16 : p.z - 0.16;
        return (
          <group key={i} position={[p.x, 0, z]}>
            <mesh position={[0, 0.15, 0]}><boxGeometry args={[0.5, 0.3, 0.5]} /><meshStandardMaterial color="#8a5a2b" roughness={0.7} /></mesh>
            <mesh position={[0, room.height / 2, 0]}><cylinderGeometry args={[0.2, 0.22, room.height - 0.5, 16]} /><meshStandardMaterial color="#c9a56b" roughness={0.6} /></mesh>
            <mesh position={[0, room.height - 0.3, 0]}><boxGeometry args={[0.55, 0.25, 0.55]} /><meshStandardMaterial color="#8a5a2b" roughness={0.7} /></mesh>
          </group>
        );
      })}
    </>
  );
}

/** Covered mandap platform at the back of the lawn: a low pad and a cloth roof on four slim posts. Scenery only. */
function LawnPavilion({ room }: { room: StudioRoom }) {
  const b = bounds(room);
  const cx = b.centre.x;
  const z0 = b.min.z + 4.2;
  const w = 11;
  const d = 6;
  const posts: [number, number][] = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]];
  return (
    <group position={[cx, 0, z0]}>
      <mesh position={[0, 0.04, 0]}><boxGeometry args={[w + 0.6, 0.08, d + 0.6]} /><meshStandardMaterial color="#d9c9a8" roughness={0.9} /></mesh>
      {posts.map(([x, z], i) => <mesh key={i} position={[x, 2.1, z]}><cylinderGeometry args={[0.06, 0.06, 4.2, 8]} /><meshStandardMaterial color="#8a5a2b" roughness={0.6} /></mesh>)}
      <mesh position={[0, 4.35, 0]}><boxGeometry args={[w + 0.8, 0.12, d + 0.8]} /><meshStandardMaterial color="#f5efe6" roughness={1} transparent opacity={0.8} /></mesh>
    </group>
  );
}

export function VenueModel({ room }: { room: StudioRoom }) {
  const theme = room.theme ?? 'ballroom';
  const floor = useMemo(() => new Shape(room.corners.map((c) => new Vector2(c.x, -c.z))), [room]);
  const b = bounds(room);
  const pal = PALETTE[theme];
  return (
    <group name="venue">
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
        <shapeGeometry args={[floor]} />
        <Surface id={THEME_FLOOR[theme].id} tile={{ x: 1 / THEME_FLOOR[theme].tile, y: 1 / THEME_FLOOR[theme].tile }} flat={pal.floor} roughness={theme === 'courtyard' ? 0.55 : 0.85} />
      </mesh>
      {theme === 'lawn' ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[b.centre.x, -0.01, b.centre.z]} receiveShadow><planeGeometry args={[b.width * 5, b.depth * 5]} /><Surface id="leafy_grass" tile={{ x: (b.width * 5) / 3, y: (b.depth * 5) / 3 }} flat="#5f9650" roughness={1} /></mesh>
      ) : null}
      <Walls room={room} theme={theme} />
      <Pilasters room={room} />
      {theme === 'lawn' ? <LawnPavilion room={room} /> : null}
      {/* Warm fill for the ballroom: two soft lights only (the courtyard has six; chandeliers carry none, to keep the light count low). */}
      {theme === 'ballroom' ? [0.3, 0.7].map((fx) => <pointLight key={fx} color="#ffd9a0" intensity={10} distance={14} decay={2} position={[b.min.x + b.width * fx, room.height - 1.5, b.centre.z]} />) : null}
      {theme === 'courtyard' ? [0.2, 0.5, 0.8].flatMap((fx) => [0.3, 0.7].map((fz) => <pointLight key={`${fx}${fz}`} color="#ffb35c" intensity={14} distance={9} decay={2} position={[b.min.x + b.width * fx, room.height - 1, b.min.z + b.depth * fz]} />)) : null}
    </group>
  );
}
