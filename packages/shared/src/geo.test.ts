import { describe, expect, it } from 'vitest';
import { boundsOf, simplifyPath, simplifyToBudget, type LngLatPair } from './geo.js';

/** A path along a straight line with a tiny zig-zag, plus one real corner. */
function zigzag(n: number): LngLatPair[] {
  const pts: LngLatPair[] = [];
  for (let i = 0; i < n; i++) pts.push([77.6 + i * 0.0001, 12.97 + (i % 2 ? 0.000001 : 0)]);
  for (let i = 1; i < n; i++) pts.push([77.6 + (n - 1) * 0.0001, 12.97 + i * 0.0001]);
  return pts;
}

describe('simplifyPath', () => {
  it('keeps the ends and the corner, drops sub-metre wiggles', () => {
    const path = zigzag(50);
    const out = simplifyPath(path, 5);
    expect(out[0]).toEqual(path[0]);
    expect(out[out.length - 1]).toEqual(path[path.length - 1]);
    expect(out).toContainEqual(path[49]);
    expect(out.length).toBeLessThanOrEqual(4);
  });

  it('returns short paths unchanged', () => {
    const two: LngLatPair[] = [
      [77.6, 12.9],
      [77.7, 13.0],
    ];
    expect(simplifyPath(two, 10)).toEqual(two);
  });
});

describe('simplifyToBudget', () => {
  it('raises the tolerance until the point budget is met, and rounds', () => {
    const wiggly: LngLatPair[] = Array.from({ length: 400 }, (_, i) => [77.6 + i * 0.0005, 12.97 + Math.sin(i / 3) * 0.001]);
    const out = simplifyToBudget(wiggly, { toleranceM: 1, maxPoints: 50 });
    expect(out.length).toBeLessThanOrEqual(50);
    for (const [lng, lat] of out) {
      expect(Number(lng.toFixed(5))).toBe(lng);
      expect(Number(lat.toFixed(5))).toBe(lat);
    }
  });
});

describe('boundsOf', () => {
  it('spans every point', () => {
    expect(
      boundsOf([
        [77.6, 12.9],
        [77.7, 12.95],
        [77.65, 13.2],
      ]),
    ).toEqual([
      [77.6, 12.9],
      [77.7, 13.2],
    ]);
    expect(boundsOf([])).toBeNull();
  });
});
