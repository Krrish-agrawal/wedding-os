import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PlanFileSchema, RoomsFileSchema, type PlanFile, type Room, type Vec2 } from './data.js';
import {
  formatFeetInches,
  pointLevel,
  runLevel,
  pathTouchesPolygon,
  planTotals,
  pointInPolygon,
  resolveCompassOverlay,
  resolveRoomId,
  roomDimensions,
  roomFacts,
  roomFactsSentence,
  totalSeats,
  wetRoomIds,
} from './plan.js';

const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

const ROOMS: Pick<Room, 'id' | 'name' | 'polygon' | 'seats'>[] = [
  { id: 'bed', name: 'Bedroom', polygon: rect(0, 0, 4, 3) },
  { id: 'bath', name: 'Bathroom', polygon: rect(4, 0, 6, 2) },
  { id: 'living', name: 'Living room', polygon: rect(-5, 0, 0, 4), seats: 4 },
];

const p = (id: string, kind: string, x: number, z: number, roomId: string | null = null) => ({ id, kind, x, z, roomId });

const PLAN = {
  electrical: {
    points: [
      ...[0.3, 1, 2, 3, 3.7, 3.7].map((x, i) => p(`s${i}`, 'socket', x, 0.2, 'bed')),
      p('ac1', 'ac', 2, 0.1, 'bed'),
      p('l1', 'light', 1, 1.5, 'bed'),
      p('l2', 'light', 3, 1.5), // no roomId: found by position
      p('sw1', 'switchboard', 3.8, 2.8, 'bed'),
      p('db', 'db', -4.8, 3.8, 'living'),
      p('l3', 'light', -2.5, 2),
    ],
    circuits: [{ id: 'c1', name: 'Lights', path: [[-4.8, 3.8], [1, 1.5]] as Vec2[] }],
  },
  plumbing: {
    fixtures: [p('wc', 'wc', 5.5, 1.5, 'bath'), p('basin', 'basin', 4.5, 0.4, 'bath'), p('shaft', 'shaft', 5.9, 0.1, 'bath')],
    lines: [
      { id: 'cold', kind: 'cold', path: [[5.9, 0.1], [4.5, 0.4]] as Vec2[] },
      { id: 'hot', kind: 'hot', path: [[5.9, 0.1], [5.9, 1.9]] as Vec2[] },
    ],
  },
} as unknown as Pick<PlanFile, 'electrical' | 'plumbing'>;

describe('roomFacts', () => {
  it('counts what a room has, by explicit room id or by position', () => {
    const f = roomFacts(PLAN, ROOMS[0]!, ROOMS);
    expect(f.electrical.map((c) => [c.kind, c.count])).toEqual([
      ['socket', 6],
      ['ac', 1],
      ['light', 2],
      ['switchboard', 1],
    ]);
    expect(f.plumbing).toEqual([]);
    expect(f.lines).toEqual({ cold: false, hot: false, drain: false });
  });

  it('writes the spoken line without wiring infrastructure', () => {
    const f = roomFacts(PLAN, ROOMS[0]!, ROOMS);
    expect(roomFactsSentence(f, 'electrical')).toBe('Bedroom: 6 sockets, 1 AC point and 2 light points');
    expect(roomFactsSentence(f, 'plumbing')).toBe('Bedroom: no plumbing');
  });

  it('notes supply lines that run through a wet room', () => {
    const f = roomFacts(PLAN, ROOMS[1]!, ROOMS);
    expect(f.plumbing.map((c) => c.text)).toEqual(['1 WC', '1 wash basin', '1 plumbing shaft']);
    expect(f.lines).toEqual({ cold: true, hot: true, drain: false });
    expect(roomFactsSentence(f, 'plumbing')).toBe('Bathroom: 1 WC, 1 wash basin and hot and cold water');
    expect(roomFactsSentence(f, 'electrical')).toBe('Bathroom: no electrical points marked');
  });

  it('handles a room with nothing on a layer', () => {
    const empty = { id: 'store', name: 'Store', polygon: rect(10, 10, 11, 11) };
    const f = roomFacts(PLAN, empty, [...ROOMS, empty]);
    expect(f.electrical).toEqual([]);
    expect(f.plumbing).toEqual([]);
  });

  it('totals the whole plan', () => {
    const t = planTotals(PLAN);
    expect(t.electrical.find((c) => c.kind === 'light')?.count).toBe(3);
    expect(t.electrical.find((c) => c.kind === 'socket')?.text).toBe('6 sockets');
    expect(t.plumbing.map((c) => c.kind)).toEqual(['wc', 'basin', 'shaft']);
  });

  it('lists wet rooms in rooms.json order', () => {
    expect(wetRoomIds(PLAN, ROOMS)).toEqual(['bath']);
  });
});

describe('geometry', () => {
  it('tests points against polygons', () => {
    expect(pointInPolygon([1, 1], rect(0, 0, 2, 2))).toBe(true);
    expect(pointInPolygon([3, 1], rect(0, 0, 2, 2))).toBe(false);
    const l: Vec2[] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
    expect(pointInPolygon([1.5, 1.5], l)).toBe(false);
    expect(pointInPolygon([0.5, 1.5], l)).toBe(true);
  });

  it('resolves a point to its room', () => {
    expect(resolveRoomId({ x: 5, z: 1, roomId: null }, ROOMS)).toBe('bath');
    expect(resolveRoomId({ x: 5, z: 1, roomId: 'bed' }, ROOMS)).toBe('bed');
    expect(resolveRoomId({ x: 50, z: 1, roomId: null }, ROOMS)).toBeNull();
  });

  it('detects a pipe crossing a room even with no vertex inside', () => {
    expect(pathTouchesPolygon([[-1, 1], [3, 1]], rect(0, 0, 2, 2))).toBe(true);
    expect(pathTouchesPolygon([[-1, 3], [3, 3]], rect(0, 0, 2, 2))).toBe(false);
  });

  it('formats sizes the way Indian plans do', () => {
    expect(formatFeetInches(3.42)).toBe(`11'3"`);
    expect(formatFeetInches(3.048)).toBe(`10'0"`);
    expect(roomDimensions(rect(0, 0, 3.42, 3.048))).toBe(`11'3" × 10'0"`);
    expect(roomDimensions([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]])).toBeNull();
  });
});

describe('levels', () => {
  const upper = { id: 'mezz', name: 'Mezzanine', polygon: rect(4, 0, 6, 2), level: 1 };
  const rooms = [...ROOMS, upper];

  it('puts a point on its room\'s level unless it names its own', () => {
    expect(pointLevel({ roomId: 'mezz' }, rooms)).toBe(1);
    expect(pointLevel({ roomId: 'bed' }, rooms)).toBe(0);
    expect(pointLevel({ roomId: null, level: 1 }, rooms)).toBe(1);
    expect(pointLevel({ roomId: null }, rooms)).toBe(0);
    expect(runLevel({})).toBe(0);
    expect(runLevel({ level: 1 })).toBe(1);
  });

  it('finds a loose point\'s room on its own level only', () => {
    expect(resolveRoomId({ x: 5, z: 1, roomId: null, level: 1 }, rooms)).toBe('mezz');
    expect(resolveRoomId({ x: 5, z: 1, roomId: null, level: 0 }, rooms)).toBe('bath');
  });

  it('ignores pipes on other levels when describing a room', () => {
    const f = roomFacts(PLAN, upper, rooms);
    expect(f.lines).toEqual({ cold: false, hot: false, drain: false });
  });
});

describe('compass overlays', () => {
  it('swaps Vastu and seating by property kind', () => {
    expect(resolveCompassOverlay('sale', 'vastu')).toBe('vastu');
    expect(resolveCompassOverlay('lease', 'vastu')).toBe('seating');
    expect(resolveCompassOverlay('sale', 'seating')).toBe('vastu');
    expect(resolveCompassOverlay('lease', 'sun')).toBe('sun');
  });

  it('adds up seats', () => {
    expect(totalSeats(ROOMS)).toBe(4);
  });
});

/** Points mounted on a wall may sit on the room outline; allow this much outside it, in metres. */
const WALL_TOLERANCE_M = 0.2;

function distanceToPolygon([px, pz]: Vec2, poly: Vec2[]): number {
  if (pointInPolygon([px, pz], poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]!;
    const [x1, z1] = poly[(i + 1) % poly.length]!;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(px - (x0 + t * dx), pz - (z0 + t * dz)));
  }
  return best;
}

describe('plan.json for every property', () => {
  const root = new URL('../../../data/properties/', import.meta.url);
  const ids = readdirSync(root);
  const load = (id: string, file: string) => JSON.parse(readFileSync(new URL(`${id}/${file}`, root), 'utf8'));

  for (const id of ids) {
    it(`${id}: every point sits in the room it names`, () => {
      const plan = PlanFileSchema.parse(load(id, 'plan.json'));
      const rooms = RoomsFileSchema.parse(load(id, 'rooms.json')).rooms;
      const byId = new Map(rooms.map((r) => [r.id, r]));
      const stray: string[] = [];
      for (const pt of [...plan.electrical.points, ...plan.plumbing.fixtures]) {
        if (!pt.roomId) continue;
        const room = byId.get(pt.roomId);
        if (!room || distanceToPolygon([pt.x, pt.z], room.polygon) > WALL_TOLERANCE_M) stray.push(pt.id);
      }
      expect(stray).toEqual([]);
    });

    it(`${id}: ids are unique within each layer`, () => {
      const plan = PlanFileSchema.parse(load(id, 'plan.json'));
      const ids = [
        ...plan.electrical.points.map((x) => x.id),
        ...plan.electrical.circuits.map((x) => x.id),
        ...plan.plumbing.fixtures.map((x) => x.id),
        ...plan.plumbing.lines.map((x) => x.id),
      ];
      expect(new Set(ids).size).toBe(ids.length);
    });
  }
});
