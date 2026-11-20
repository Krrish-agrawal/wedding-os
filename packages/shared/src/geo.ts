/** Small geometry helpers for map data. Coordinates are [lng, lat] pairs in GeoJSON order. */

export type LngLatPair = [number, number];

const EARTH_RADIUS_M = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Projects [lng, lat] to local planar metres around a reference latitude.
 * Accurate enough for simplifying city-scale routes.
 */
function toLocalMetres(p: LngLatPair, refLatRad: number): [number, number] {
  return [p[0] * DEG_TO_RAD * EARTH_RADIUS_M * Math.cos(refLatRad), p[1] * DEG_TO_RAD * EARTH_RADIUS_M];
}

function pointSegmentDistanceSq(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/**
 * Douglas-Peucker simplification with a tolerance in metres. Always keeps the first and last point.
 * Iterative, so long routes cannot overflow the stack.
 */
export function simplifyPath(points: LngLatPair[], toleranceM: number): LngLatPair[] {
  if (points.length <= 2) return points.slice();
  const refLat = (points.reduce((s, p) => s + p[1], 0) / points.length) * DEG_TO_RAD;
  const local = points.map((p) => toLocalMetres(p, refLat));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const tolSq = toleranceM * toleranceM;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxSq = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = pointSegmentDistanceSq(local[i]!, local[first]!, local[last]!);
      if (d > maxSq) {
        maxSq = d;
        index = i;
      }
    }
    if (index !== -1 && maxSq > tolSq) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/**
 * Simplifies a path, raising the tolerance until it has at most `maxPoints` points.
 * Coordinates are rounded to `decimals` places (5 is about 1 m).
 */
export function simplifyToBudget(
  points: LngLatPair[],
  opts: { toleranceM: number; maxPoints: number; decimals?: number },
): LngLatPair[] {
  const TOLERANCE_GROWTH = 1.5;
  const MAX_ROUNDS = 20;
  let tolerance = opts.toleranceM;
  let out = simplifyPath(points, tolerance);
  for (let round = 0; out.length > opts.maxPoints && round < MAX_ROUNDS; round++) {
    tolerance *= TOLERANCE_GROWTH;
    out = simplifyPath(points, tolerance);
  }
  const factor = 10 ** (opts.decimals ?? 5);
  const rounded = out.map(([lng, lat]) => [Math.round(lng * factor) / factor, Math.round(lat * factor) / factor] as LngLatPair);
  // Rounding can make neighbours identical; drop exact repeats.
  return rounded.filter((p, i) => i === 0 || p[0] !== rounded[i - 1]![0] || p[1] !== rounded[i - 1]![1]);
}

/** Bounding box of [lng, lat] points as [[minLng, minLat], [maxLng, maxLat]], or null for an empty list. */
export function boundsOf(points: LngLatPair[]): [LngLatPair, LngLatPair] | null {
  if (!points.length) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
