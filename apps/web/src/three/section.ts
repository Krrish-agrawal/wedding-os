import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3, type Object3D } from 'three';

/** Two endpoints in plan coordinates (x, z). */
export type Segment = [number, number, number, number];

const EPSILON = 1e-6;

/**
 * Where a horizontal plane at height `y` cuts the meshes under `root`: one segment per triangle that
 * crosses the plane, in world x and z. Used to draw walls in plan renders, where a wall modelled as a
 * single plane would otherwise vanish when seen edge-on from above.
 */
export function sectionSegments(root: Object3D, y: number): Segment[] {
  const out: Segment[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const geo = o.geometry as BufferGeometry;
    const pos = geo.attributes.position;
    if (!pos) return;
    const index = geo.index;
    const count = index ? index.count : pos.count;
    const m = o.matrixWorld;
    for (let i = 0; i < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(m);
      b.fromBufferAttribute(pos, ib).applyMatrix4(m);
      c.fromBufferAttribute(pos, ic).applyMatrix4(m);
      const seg = cutTriangle(a, b, c, y);
      if (seg) out.push(seg);
    }
  });
  return out;
}

function cutTriangle(a: Vector3, b: Vector3, c: Vector3, y: number): Segment | null {
  const da = a.y - y;
  const db = b.y - y;
  const dc = c.y - y;
  if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) return null;
  if (Math.abs(da) < EPSILON && Math.abs(db) < EPSILON && Math.abs(dc) < EPSILON) return null;
  const pts: [number, number][] = [];
  const edge = (p: Vector3, dp: number, q: Vector3, dq: number) => {
    if ((dp > 0) === (dq > 0) && Math.abs(dp) > EPSILON && Math.abs(dq) > EPSILON) return;
    const denom = dp - dq;
    if (Math.abs(denom) < EPSILON) return;
    const t = dp / denom;
    if (t < -EPSILON || t > 1 + EPSILON) return;
    pts.push([p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t]);
  };
  edge(a, da, b, db);
  edge(b, db, c, dc);
  edge(c, dc, a, da);
  if (pts.length < 2) return null;
  const [p, q] = pts as [[number, number], [number, number], ...[number, number][]];
  if (Math.hypot(p[0] - q[0], p[1] - q[1]) < EPSILON) return null;
  return [p[0], p[1], q[0], q[1]];
}

/** A flat ribbon mesh (in the XZ plane at height `y`) drawing each segment with the given width. */
export function segmentsToRibbon(segments: Segment[], width: number, y: number): BufferGeometry {
  const half = width / 2;
  const positions: number[] = [];
  for (const [x0, z0, x1, z1] of segments) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < EPSILON) continue;
    // Perpendicular, and a small extension so neighbouring segments overlap at corners.
    const nx = (-(z1 - z0) / len) * half;
    const nz = ((x1 - x0) / len) * half;
    const ex = ((x1 - x0) / len) * half;
    const ez = ((z1 - z0) / len) * half;
    const p0 = [x0 - ex + nx, z0 - ez + nz];
    const p1 = [x1 + ex + nx, z1 + ez + nz];
    const p2 = [x1 + ex - nx, z1 + ez - nz];
    const p3 = [x0 - ex - nx, z0 - ez - nz];
    positions.push(p0[0]!, y, p0[1]!, p1[0]!, y, p1[1]!, p2[0]!, y, p2[1]!, p0[0]!, y, p0[1]!, p2[0]!, y, p2[1]!, p3[0]!, y, p3[1]!);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geo;
}
