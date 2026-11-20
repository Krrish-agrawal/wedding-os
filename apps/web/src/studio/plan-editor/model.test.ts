import { describe, expect, it } from 'vitest';
import type { Room, Vec2 } from '@ave/shared';
import { cleanPath, layersOnLevel, moveAttached, nextId, nextVertex, validate, type Layers } from './model';

const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const rooms: Room[] = [
  { id: 'a', name: 'A', kind: 'living', polygon: rect(0, 0, 4, 4), areaSqft: 100, features: [] },
  { id: 'm', name: 'M', kind: 'workspace', polygon: rect(0, 0, 4, 4), areaSqft: 100, features: [], level: 1 },
];
const bounds = { minX: -1, maxX: 5, minZ: -1, maxZ: 5 };

function layers(): Layers {
  return {
    electrical: {
      points: [
        { id: 'db', kind: 'db', x: 0.2, z: 0.2, roomId: 'a' },
        { id: 'lt-1', kind: 'light', x: 2, z: 2, roomId: 'a' },
        { id: 'lt-2', kind: 'light', x: 2, z: 2, roomId: 'm' },
      ],
      circuits: [
        { id: 'c-1', name: 'Lights', path: [[0.2, 0.2], [2, 0.2], [2, 2]] },
        { id: 'c-2', name: 'Upper', path: [[0, 0], [2, 2]], level: 1 },
      ],
    },
    plumbing: { fixtures: [], lines: [] },
  };
}

describe('plan editor model', () => {
  it('draws straight legs unless asked not to', () => {
    expect(nextVertex([0, 0], [3.02, 0.4], false)).toEqual([3, 0]);
    expect(nextVertex([0, 0], [0.4, 3.02], false)).toEqual([0, 3]);
    expect(nextVertex([0, 0], [0.42, 3.02], true)).toEqual([0.4, 3]);
    expect(nextVertex(null, [1.234, 2.26], false)).toEqual([1.25, 2.25]);
  });

  it('drops repeated vertices from a double-click', () => {
    expect(cleanPath([[0, 0], [1, 0], [1, 0], [1, 1]])).toEqual([[0, 0], [1, 0], [1, 1]]);
  });

  it('drags attached runs with a symbol and keeps their legs straight', () => {
    const l = layers();
    moveAttached(l, [2, 2], [3, 2.5], 0);
    expect(l.electrical.circuits[0]!.path).toEqual([[0.2, 0.2], [3, 0.2], [3, 2.5]]);
    // A run on another level is left alone.
    expect(l.electrical.circuits[1]!.path).toEqual([[0, 0], [2, 2]]);
  });

  it('keeps a neighbouring corner that sits on another symbol', () => {
    const l = layers();
    moveAttached(l, [2, 0.2], [2.5, 0.2], 0);
    expect(l.electrical.circuits[0]!.path[0]).toEqual([0.2, 0.2]);
  });

  it('picks the next free id per kind', () => {
    expect(nextId(layers(), 'light')).toBe('lt-3');
    expect(nextId(layers(), 'circuit')).toBe('c-3');
  });

  it('splits layers by level', () => {
    const one = layersOnLevel(layers(), 1, rooms);
    expect(one.electrical.points.map((p) => p.id)).toEqual(['lt-2']);
    expect(one.electrical.circuits.map((c) => c.id)).toEqual(['c-2']);
  });

  it('reports duplicate ids and unknown rooms as errors', () => {
    const l = layers();
    l.electrical.points.push({ id: 'db', kind: 'socket', x: 1, z: 1, roomId: 'nowhere' });
    const errors = validate(l, bounds, rooms).filter((i) => i.level === 'error').map((i) => i.text);
    expect(errors.some((t) => t.includes('Duplicate ids: db'))).toBe(true);
    expect(errors.some((t) => t.includes('unknown room "nowhere"'))).toBe(true);
  });
});
