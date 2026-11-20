import { describe, expect, it } from 'vitest';
import { PlanFileSchema, pointInPolygon, roomFacts, type Room, type Vec2 } from '@ave/shared';
import { draftPlan } from './draft';

const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const room = (id: string, kind: Room['kind'], polygon: Vec2[], seats?: number): Room => ({ id, name: id, kind, polygon, areaSqft: 100, features: [], ...(seats ? { seats } : {}) });

const HOME: Room[] = [
  room('living', 'living', rect(-4, -3, 1, 3)),
  room('kitchen', 'kitchen', rect(1, -3, 4, 0)),
  room('bedroom', 'bedroom', rect(1, 0, 4, 3)),
  room('bath', 'bathroom', rect(4, 0, 6, 3)),
];
const OFFICE: Room[] = [room('work', 'workspace', rect(-5, -3, 2, 3), 8), room('pantry', 'pantry', rect(2, -3, 4, 0)), room('meet', 'meeting', rect(2, 0, 4, 3))];

const BOUNDS = { minX: -6, maxX: 7, minZ: -4, maxZ: 4 };
/** Wall-mounted points may sit just outside the room outline. */
const WALL_TOLERANCE_M = 0.2;

function nearRoom(p: { x: number; z: number }, poly: Vec2[]): boolean {
  if (pointInPolygon([p.x, p.z], poly)) return true;
  const xs = poly.map((q) => q[0]);
  const zs = poly.map((q) => q[1]);
  return p.x >= Math.min(...xs) - WALL_TOLERANCE_M && p.x <= Math.max(...xs) + WALL_TOLERANCE_M && p.z >= Math.min(...zs) - WALL_TOLERANCE_M && p.z <= Math.max(...zs) + WALL_TOLERANCE_M;
}

describe('draftPlan', () => {
  const home = draftPlan({ kind: 'sale', entranceFacing: 'W', northOffsetDeg: 0 }, HOME);

  it('produces a valid plan file', () => {
    expect(() => PlanFileSchema.parse({ bounds: BOUNDS, ...home })).not.toThrow();
  });

  it('puts one distribution board on the entrance side', () => {
    const dbs = home.electrical.points.filter((p) => p.kind === 'db');
    expect(dbs).toHaveLength(1);
    expect(dbs[0]!.roomId).toBe('living');
    expect(dbs[0]!.x).toBeLessThan(-3.5);
  });

  it('gives every room lights, sockets or power, and a switchboard', () => {
    for (const r of HOME) {
      const kinds = roomFacts(home, r, HOME).electrical.map((c) => c.kind);
      expect(kinds).toContain('light');
      expect(kinds).toContain('switchboard');
      expect(kinds.some((k) => k === 'socket' || k === 'power_socket')).toBe(true);
    }
  });

  it('places AC points on external walls of bedrooms and living rooms', () => {
    const acs = home.electrical.points.filter((p) => p.kind === 'ac');
    expect(acs.map((a) => a.roomId).sort()).toEqual(['bedroom', 'living']);
    const bedAc = acs.find((a) => a.roomId === 'bedroom')!;
    // The bedroom's only outside wall is along z = 3.
    expect(bedAc.z).toBeGreaterThan(2.7);
  });

  it('keeps every point in or on its room', () => {
    const byId = new Map(HOME.map((r) => [r.id, r]));
    for (const p of [...home.electrical.points, ...home.plumbing.fixtures]) expect(nearRoom(p, byId.get(p.roomId!)!.polygon)).toBe(true);
  });

  it('plumbs wet rooms to a shaft and leaves dry rooms dry', () => {
    const bath = roomFacts(home, HOME[3]!, HOME);
    expect(bath.plumbing.map((c) => c.kind)).toEqual(expect.arrayContaining(['wc', 'basin', 'shower', 'water_heater']));
    expect(bath.lines).toEqual({ cold: true, hot: true, drain: true });
    expect(roomFacts(home, HOME[1]!, HOME).plumbing.map((c) => c.kind)).toContain('sink');
    expect(roomFacts(home, HOME[0]!, HOME).plumbing).toEqual([]);
    const shafts = home.plumbing.fixtures.filter((f) => f.kind === 'shaft');
    expect(shafts.length).toBeGreaterThanOrEqual(1);
    for (const line of home.plumbing.lines.filter((l) => l.kind !== 'hot')) {
      const ends = [line.path[0]!, line.path[line.path.length - 1]!];
      expect(shafts.some((s) => ends.some((e) => e[0] === s.x && e[1] === s.z))).toBe(true);
    }
  });

  it('routes every circuit from the distribution board with straight runs', () => {
    const db = home.electrical.points.find((p) => p.kind === 'db')!;
    for (const c of home.electrical.circuits) {
      expect(c.path[0]).toEqual([db.x, db.z]);
      for (let i = 1; i < c.path.length; i++) {
        const [a, b] = [c.path[i - 1]!, c.path[i]!];
        expect(Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9).toBe(true);
      }
    }
  });

  it('gives office desks a power and a data point each', () => {
    const office = draftPlan({ kind: 'lease', entranceFacing: 'W', northOffsetDeg: 0 }, OFFICE);
    const desks = office.electrical.points.filter((p) => p.roomId === 'work' && p.label === 'Desk');
    expect(desks.filter((p) => p.kind === 'power_socket')).toHaveLength(8);
    expect(desks.filter((p) => p.kind === 'data')).toHaveLength(8);
    expect(office.electrical.points.some((p) => p.kind === 'fan')).toBe(false);
    expect(roomFacts(office, OFFICE[1]!, OFFICE).plumbing.map((c) => c.kind)).toContain('sink');
  });

  it('drafts each level of a multi-level office on its own', () => {
    const rooms: Room[] = [...OFFICE, { ...room('mezz', 'workspace', rect(-5, -3, -1, 0), 4), level: 1 }];
    const plan = draftPlan({ kind: 'lease', entranceFacing: 'W', northOffsetDeg: 0, levels: [{ index: 0, name: 'Ground', floorY: 0, planImage: 'a' }, { index: 1, name: 'Mezzanine', floorY: 2.6, planImage: 'b' }] }, rooms);
    const upper = plan.electrical.circuits.filter((c) => c.level === 1);
    expect(upper.length).toBeGreaterThan(0);
    expect(upper.filter((c) => /^(Lights|Sockets)/.test(c.name)).every((c) => c.name.endsWith('· Mezzanine'))).toBe(true);
    expect(plan.electrical.circuits.filter((c) => c.level === undefined).length).toBeGreaterThan(0);
    expect(plan.electrical.points.filter((p) => p.kind === 'db')).toHaveLength(1);
    expect(plan.electrical.points.find((p) => p.kind === 'db')!.roomId).not.toBe('mezz');
    expect(roomFacts(plan, rooms[3]!, rooms).electrical.map((c) => c.kind)).toEqual(expect.arrayContaining(['light', 'power_socket', 'data', 'switchboard']));
  });

  it('gives unique ids', () => {
    const all = [...home.electrical.points, ...home.electrical.circuits, ...home.plumbing.fixtures, ...home.plumbing.lines].map((x) => x.id);
    expect(new Set(all).size).toBe(all.length);
  });
});
