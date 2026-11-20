import {
  DIRECTIONS,
  pointInPolygon,
  polygonAreaM2,
  polygonBounds,
  roomLevelOf,
  roomsBounds,
  type Box2,
  type Circuit,
  type ElectricalKind,
  type ElectricalPoint,
  type PlanFile,
  type PlumbingFixture,
  type PlumbingKind,
  type PlumbingLine,
  type Property,
  type Room,
  type Vec2,
} from '@ave/shared';

/**
 * Drafts the electrical and plumbing layers from rooms.json with ordinary building logic, as a
 * starting point to correct in the plan editor against the model:
 * - the distribution board sits beside the main door;
 * - a switchboard sits beside each room's door;
 * - every room has light points and sockets; fans in living spaces and bedrooms of a home;
 * - AC points on an external wall; kitchens get power sockets for appliances;
 * - office desks get a power and a data point each;
 * - wet areas (kitchen, bathroom, utility, pantry) get fixtures piped to a shaft on an external wall.
 */

type Draft = Pick<PlanFile, 'electrical' | 'plumbing'>;
type Seg = [Vec2, Vec2];

/** Geometry tolerances and offsets, in metres. */
const EPS = 0.05;
const MIN_DOOR_M = 0.75;
const DOOR_HALF_M = 0.45;
const WALL_INSET_M = 0.12;
const FIXTURE_INSET_M = 0.35;
const CORNER_CLEAR_M = 0.3;
const SNAP_M = 0.05;
/** A desk's data point sits this far beside its power point. */
const DESK_DATA_OFFSET_M = 0.3;
/** One ceiling light per this much floor, at least one. */
const LIGHT_AREA_M2 = 9;
const CIRCUIT_MAX_POINTS = { lights: 10, sockets: 8 } as const;

/** Breaker ratings, indicative, by circuit type. */
const RATING = { lights: '6 A', sockets: '10 A', power: '16 A', ac: '20 A' } as const;

interface Spec {
  fans: number;
  sockets: number;
  power: number;
  ac: number;
  data: number;
  /** Desk positions get a power and a data point each (offices). */
  desks: boolean;
}

const HOME_SPEC: Partial<Record<Room['kind'], Partial<Spec>>> = {
  entrance: { sockets: 1 },
  living: { fans: 1, sockets: 5, power: 1, ac: 1, data: 1 },
  dining: { fans: 1, sockets: 2 },
  kitchen: { sockets: 2, power: 4 },
  bedroom: { fans: 1, sockets: 5, ac: 1 },
  bathroom: { power: 1 },
  balcony: { sockets: 1 },
  study: { fans: 1, sockets: 3, data: 1, ac: 1 },
  utility: { power: 1 },
  other: { sockets: 1 },
};

const OFFICE_SPEC: Partial<Record<Room['kind'], Partial<Spec>>> = {
  entrance: { sockets: 1 },
  reception: { sockets: 2, data: 1, ac: 1 },
  workspace: { sockets: 2, ac: 1, desks: true },
  meeting: { sockets: 2, power: 1, data: 2, ac: 1 },
  cabin: { sockets: 2, data: 1, ac: 1 },
  lounge: { sockets: 2, ac: 1 },
  pantry: { sockets: 1, power: 3 },
  bathroom: {},
  utility: { power: 1 },
  other: { sockets: 1 },
};

const WET_KINDS = new Set<Room['kind']>(['kitchen', 'bathroom', 'utility', 'pantry']);
/** Fixtures that drain to the shaft, and fixtures fed hot water by a heater in the same room. */
const DRAINED = new Set<PlumbingKind>(['wc', 'basin', 'shower', 'sink', 'washing_machine', 'floor_trap']);
const HEATED = new Set<PlumbingKind>(['shower', 'basin', 'sink']);
/** Rooms people walk through: doors from other rooms usually open onto these. */
const CIRCULATION = new Set<Room['kind']>(['entrance', 'living', 'dining', 'reception', 'workspace', 'lounge']);

const snap = (v: number) => Math.round(v / SNAP_M) * SNAP_M;
const pt = (x: number, z: number): Vec2 => [Number(snap(x).toFixed(2)), Number(snap(z).toFixed(2))];

function edges(poly: Vec2[]): Seg[] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]!] as Seg);
}

function segLength([a, b]: Seg): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function lerp([a, b]: Seg, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Unit normal of an edge pointing into the room. */
function inward(poly: Vec2[], s: Seg): Vec2 {
  const [a, b] = s;
  const len = segLength(s) || 1;
  const n: Vec2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  const mid = lerp(s, 0.5);
  return pointInPolygon([mid[0] + n[0] * 0.1, mid[1] + n[1] * 0.1], poly) ? n : [-n[0], -n[1]];
}

/** A point on an edge, `along` metres from its start, pushed `inset` metres into the room. */
function onWall(poly: Vec2[], s: Seg, along: number, inset = WALL_INSET_M): Vec2 {
  const t = Math.min(1, Math.max(0, along / (segLength(s) || 1)));
  const p = lerp(s, t);
  const n = inward(poly, s);
  return pt(p[0] + n[0] * inset, p[1] + n[1] * inset);
}

/** The overlapping stretch of two collinear axis-aligned edges, if long enough for a door. */
function overlap(s: Seg, t: Seg): Seg | null {
  const vertical = (q: Seg) => Math.abs(q[0][0] - q[1][0]) < EPS;
  const horizontal = (q: Seg) => Math.abs(q[0][1] - q[1][1]) < EPS;
  if (vertical(s) && vertical(t) && Math.abs(s[0][0] - t[0][0]) < EPS) {
    const lo = Math.max(Math.min(s[0][1], s[1][1]), Math.min(t[0][1], t[1][1]));
    const hi = Math.min(Math.max(s[0][1], s[1][1]), Math.max(t[0][1], t[1][1]));
    return hi - lo >= MIN_DOOR_M ? [[s[0][0], lo], [s[0][0], hi]] : null;
  }
  if (horizontal(s) && horizontal(t) && Math.abs(s[0][1] - t[0][1]) < EPS) {
    const lo = Math.max(Math.min(s[0][0], s[1][0]), Math.min(t[0][0], t[1][0]));
    const hi = Math.min(Math.max(s[0][0], s[1][0]), Math.max(t[0][0], t[1][0]));
    return hi - lo >= MIN_DOOR_M ? [[lo, s[0][1]], [hi, s[0][1]]] : null;
  }
  return null;
}

interface Door {
  /** Wall stretch the door sits in, in this room. */
  wall: Seg;
  other: Room;
}

function doorsOf(room: Room, rooms: Room[]): Door[] {
  const out: Door[] = [];
  for (const other of rooms) {
    if (other.id === room.id) continue;
    for (const e of edges(room.polygon)) for (const f of edges(other.polygon)) {
      const o = overlap(e, f);
      if (o) out.push({ wall: o, other });
    }
  }
  // Doors onto circulation spaces first: that is where people walk in.
  return out.sort((a, b) => Number(CIRCULATION.has(b.other.kind)) - Number(CIRCULATION.has(a.other.kind)) || segLength(b.wall) - segLength(a.wall));
}

function onFootprintEdge(s: Seg, f: Box2): boolean {
  const [a, b] = s;
  const vx = Math.abs(a[0] - b[0]) < EPS;
  const hz = Math.abs(a[1] - b[1]) < EPS;
  return (vx && (Math.abs(a[0] - f.minX) < EPS || Math.abs(a[0] - f.maxX) < EPS)) || (hz && (Math.abs(a[1] - f.minZ) < EPS || Math.abs(a[1] - f.maxZ) < EPS));
}

function externalWalls(room: Room, f: Box2): Seg[] {
  return edges(room.polygon)
    .filter((e) => onFootprintEdge(e, f))
    .sort((a, b) => segLength(b) - segLength(a));
}

/** Bearing an edge's outward normal points to, given the north offset. */
function outwardBearing(room: Room, s: Seg, northOffsetDeg: number): number {
  const n = inward(room.polygon, s);
  const modelBearing = (Math.atan2(-n[0], n[1]) * 180) / Math.PI;
  return (((modelBearing - northOffsetDeg) % 360) + 360) % 360;
}

function angularGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Evenly spread `n` points along the room's walls, clear of corners and doors. */
function alongWalls(room: Room, n: number, avoid: Seg[], prefer?: Seg[]): Vec2[] {
  if (n <= 0) return [];
  const walls = (prefer?.length ? prefer : edges(room.polygon)).filter((e) => segLength(e) > 2 * CORNER_CLEAR_M);
  const usable = walls.map((e) => ({ e, len: segLength(e) - 2 * CORNER_CLEAR_M }));
  const total = usable.reduce((s, u) => s + u.len, 0);
  if (total <= 0) return [];
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    let d = ((i + 0.5) / n) * total;
    for (const u of usable) {
      if (d <= u.len) {
        const p = onWall(room.polygon, u.e, CORNER_CLEAR_M + d);
        // Slide off a door opening if it landed in one.
        const blocked = avoid.find((door) => Math.hypot(p[0] - lerp(door, 0.5)[0], p[1] - lerp(door, 0.5)[1]) < DOOR_HALF_M + WALL_INSET_M);
        out.push(blocked ? onWall(room.polygon, u.e, Math.min(segLength(u.e) - CORNER_CLEAR_M, CORNER_CLEAR_M + d + 2 * DOOR_HALF_M)) : p);
        break;
      }
      d -= u.len;
    }
  }
  return out;
}

/** A grid of `n` points inside the room (ceiling lights, desks), kept inside the polygon. */
function grid(room: Room, n: number, insetShare: number): Vec2[] {
  if (n <= 0) return [];
  const b = polygonBounds(room.polygon);
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const cols = Math.max(1, Math.round(Math.sqrt((n * w) / Math.max(d, EPS))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const out: Vec2[] = [];
  for (let r = 0; r < rows && out.length < n; r++) {
    for (let c = 0; c < cols && out.length < n; c++) {
      const x = b.minX + w * insetShare + ((c + 0.5) / cols) * w * (1 - 2 * insetShare);
      const z = b.minZ + d * insetShare + ((r + 0.5) / rows) * d * (1 - 2 * insetShare);
      if (pointInPolygon([x, z], room.polygon)) out.push(pt(x, z));
    }
  }
  return out;
}

/** An L-shaped run between two points, turning where it stays inside the rooms if it can. */
function lRoute(a: Vec2, b: Vec2, rooms: Room[]): Vec2[] {
  if (Math.abs(a[0] - b[0]) < EPS || Math.abs(a[1] - b[1]) < EPS) return [a, b];
  const c1: Vec2 = [b[0], a[1]];
  const c2: Vec2 = [a[0], b[1]];
  const inside = (p: Vec2) => rooms.some((r) => pointInPolygon(p, r.polygon));
  return [a, inside(c1) || !inside(c2) ? c1 : c2, b];
}

/** Nearest-neighbour order starting from `from`. */
function chain<T extends { x: number; z: number }>(from: Vec2, items: T[]): T[] {
  const left = [...items];
  const out: T[] = [];
  let cur = from;
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) {
      if (Math.hypot(left[i]!.x - cur[0], left[i]!.z - cur[1]) < Math.hypot(left[best]!.x - cur[0], left[best]!.z - cur[1])) best = i;
    }
    const [next] = left.splice(best, 1);
    out.push(next!);
    cur = [next!.x, next!.z];
  }
  return out;
}

function routeThrough(from: Vec2, pts: { x: number; z: number }[], rooms: Room[]): Vec2[] {
  const path: Vec2[] = [from];
  for (const p of pts) {
    const leg = lRoute(path[path.length - 1]!, [p.x, p.z], rooms);
    path.push(...leg.slice(1));
  }
  return path;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

class Ids {
  private used = new Set<string>();
  next(prefix: string): string {
    let i = 1;
    while (this.used.has(`${prefix}-${i}`)) i++;
    const id = `${prefix}-${i}`;
    this.used.add(id);
    return id;
  }
}

const PREFIX: Record<ElectricalKind | PlumbingKind, string> = {
  db: 'db',
  switchboard: 'sb',
  socket: 'skt',
  power_socket: 'pwr',
  light: 'lt',
  ac: 'ac',
  fan: 'fan',
  data: 'data',
  ev: 'ev',
  wc: 'wc',
  basin: 'basin',
  shower: 'shower',
  sink: 'sink',
  washing_machine: 'wm',
  water_heater: 'heater',
  shaft: 'shaft',
  floor_trap: 'trap',
  tap: 'tap',
};

export function draftPlan(property: Pick<Property, 'kind' | 'entranceFacing' | 'northOffsetDeg' | 'levels'>, rooms: Room[]): Draft {
  const ids = new Ids();
  const f = roomsBounds(rooms);
  const specs = property.kind === 'lease' ? OFFICE_SPEC : HOME_SPEC;
  const points: ElectricalPoint[] = [];
  const fixtures: PlumbingFixture[] = [];
  const add = (kind: ElectricalKind, p: Vec2, room: Room, label?: string) => {
    points.push({ id: ids.next(PREFIX[kind]), kind, x: p[0], z: p[1], roomId: room.id, ...(label ? { label } : {}) });
  };
  const addFixture = (kind: PlumbingKind, p: Vec2, room: Room) => {
    fixtures.push({ id: ids.next(PREFIX[kind]), kind, x: p[0], z: p[1], roomId: room.id });
  };

  const levelOf = (r: Room) => roomLevelOf(r);
  const sameLevel = (r: Room) => rooms.filter((x) => levelOf(x) === levelOf(r));
  const levels = [...new Set(rooms.map(levelOf))].sort((a, b) => a - b);
  const ground = levels[0] ?? 0;
  /** Level 0 stays implicit in the file; items on other levels say which level they are on. */
  const tag = (level: number) => (level === 0 ? {} : { level });

  /* Main door and distribution board, on the lowest level. */
  const entranceBearing = DIRECTIONS.indexOf(property.entranceFacing) * (360 / DIRECTIONS.length);
  const doorCandidates = rooms
    .filter((r) => levelOf(r) === ground && (r.kind === 'entrance' || CIRCULATION.has(r.kind)))
    .flatMap((r) => externalWalls(r, f).map((e) => ({ r, e, gap: angularGap(outwardBearing(r, e, property.northOffsetDeg), entranceBearing) })))
    .sort((a, b) => Number(b.r.kind === 'entrance') - Number(a.r.kind === 'entrance') || a.gap - b.gap);
  const mainDoor = doorCandidates[0] ?? null;
  if (mainDoor) {
    const len = segLength(mainDoor.e);
    add('db', onWall(mainDoor.r.polygon, mainDoor.e, Math.min(len - CORNER_CLEAR_M, len / 2 + DOOR_HALF_M + 2 * CORNER_CLEAR_M)), mainDoor.r);
  } else {
    const r = rooms.find((x) => levelOf(x) === ground) ?? rooms[0]!;
    add('db', onWall(r.polygon, edges(r.polygon)[0]!, CORNER_CLEAR_M), r);
  }
  const db = points[0]!;

  /* Per room points. */
  for (const room of rooms) {
    const spec: Spec = { fans: 0, sockets: 1, power: 0, ac: 0, data: 0, desks: false, ...(specs[room.kind] ?? {}) };
    const doors = doorsOf(room, sameLevel(room));
    const doorWalls = doors.map((d) => d.wall);
    if (mainDoor && mainDoor.r.id === room.id) doorWalls.push(mainDoor.e);
    const outside = externalWalls(room, f);
    const area = polygonAreaM2(room.polygon);

    // Switchboard beside the door people use most, or on the first wall if the room has no door found.
    const door = doors[0]?.wall ?? (mainDoor?.r.id === room.id ? mainDoor.e : null);
    if (door) {
      const len = segLength(door);
      add('switchboard', onWall(room.polygon, door, Math.min(len - CORNER_CLEAR_M / 2, len / 2 + DOOR_HALF_M + CORNER_CLEAR_M / 2)), room);
    } else {
      add('switchboard', onWall(room.polygon, edges(room.polygon)[0]!, CORNER_CLEAR_M), room);
    }

    // Ceiling: lights, with a fan at the centre in homes.
    const lights = Math.max(1, Math.round(area / LIGHT_AREA_M2));
    if (spec.fans > 0) {
      for (const p of grid(room, spec.fans, 0.3)) add('fan', p, room);
      for (const p of grid(room, Math.max(2, lights), 0.2)) add('light', p, room);
    } else {
      for (const p of grid(room, lights, 0.2)) add('light', p, room);
    }

    // AC on the longest external wall.
    for (let i = 0; i < spec.ac; i++) {
      const wall = outside[0] ?? edges(room.polygon).sort((a, b) => segLength(b) - segLength(a))[0]!;
      add('ac', onWall(room.polygon, wall, segLength(wall) * ((i + 1) / (spec.ac + 1))), room);
    }

    for (const p of alongWalls(room, spec.sockets, doorWalls)) add('socket', p, room);
    // Kitchens and pantries put appliance power on the counter wall (an outside wall if there is one).
    for (const p of alongWalls(room, spec.power, doorWalls, room.kind === 'kitchen' || room.kind === 'pantry' ? outside : undefined)) add('power_socket', p, room);
    for (const p of alongWalls(room, spec.data, doorWalls)) add('data', p, room);

    if (spec.desks && (room.seats ?? 0) > 0) {
      for (const p of grid(room, room.seats!, 0.12)) {
        add('power_socket', p, room, 'Desk');
        add('data', pt(p[0] + DESK_DATA_OFFSET_M, p[1]), room, 'Desk');
      }
    }
  }

  /* Plumbing: fixtures in wet rooms, one shaft per cluster of touching wet rooms on a level. */
  const wet = rooms.filter((r) => WET_KINDS.has(r.kind));
  for (const room of wet) placeFixtures(room, sameLevel(room), f, addFixture);

  const lines: PlumbingLine[] = [];
  for (const level of levels) {
    const onLevel = rooms.filter((r) => levelOf(r) === level);
    for (const cluster of clusterRooms(wet.filter((r) => levelOf(r) === level), onLevel)) {
      const host = cluster.find((r) => r.kind === 'bathroom') ?? cluster[0]!;
      const wall = externalWalls(host, f)[0] ?? edges(host.polygon)[0]!;
      const shaftAt = onWall(host.polygon, wall, CORNER_CLEAR_M + WALL_INSET_M, FIXTURE_INSET_M - WALL_INSET_M);
      addFixture('shaft', shaftAt, host);
      const members = new Set(cluster.map((r) => r.id));
      const here = fixtures.filter((x) => x.roomId && members.has(x.roomId) && x.kind !== 'shaft');
      for (const x of here) {
        if (x.kind !== 'floor_trap') lines.push({ id: ids.next('cold'), kind: 'cold', path: lRoute(shaftAt, [x.x, x.z], onLevel), ...tag(level) });
        if (DRAINED.has(x.kind)) lines.push({ id: ids.next('drain'), kind: 'drain', path: lRoute([x.x, x.z], shaftAt, onLevel), ...tag(level) });
      }
      for (const heater of here.filter((x) => x.kind === 'water_heater')) {
        for (const x of here.filter((y) => y.roomId === heater.roomId && HEATED.has(y.kind))) {
          lines.push({ id: ids.next('hot'), kind: 'hot', path: lRoute([heater.x, heater.z], [x.x, x.z], onLevel), ...tag(level) });
        }
      }
    }
  }

  /* Circuits: from the distribution board on its level, from a riser by the board on other levels. */
  const circuits: Circuit[] = [];
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  for (const level of levels) {
    const onLevel = rooms.filter((r) => levelOf(r) === level);
    const mine = points.filter((p) => p.kind !== 'db' && levelOf(roomById.get(p.roomId!)!) === level);
    const from: Vec2 = [db.x, db.z];
    const levelName = property.levels?.find((l) => l.index === level)?.name;
    const suffix = level !== ground && levelName ? ` · ${levelName}` : '';
    const named = (base: string, i: number, n: number) => `${base}${n > 1 ? ` ${i + 1}` : ''}${suffix}`;
    const ceiling = chain(from, mine.filter((p) => p.kind === 'light' || p.kind === 'fan'));
    chunk(ceiling, CIRCUIT_MAX_POINTS.lights).forEach((group, i, all) => {
      circuits.push({ id: ids.next('c'), name: named('Lights and fans', i, all.length), rating: RATING.lights, path: routeThrough(from, group, onLevel), ...tag(level) });
    });
    const sockets = chain(from, mine.filter((p) => p.kind === 'socket'));
    chunk(sockets, CIRCUIT_MAX_POINTS.sockets).forEach((group, i, all) => {
      circuits.push({ id: ids.next('c'), name: named('Sockets', i, all.length), rating: RATING.sockets, path: routeThrough(from, group, onLevel), ...tag(level) });
    });
    for (const room of onLevel) {
      const power = mine.filter((p) => p.kind === 'power_socket' && p.roomId === room.id);
      if (power.length) circuits.push({ id: ids.next('c'), name: `${room.name} power`, rating: RATING.power, path: routeThrough(from, chain(from, power), onLevel), ...tag(level) });
      for (const ac of mine.filter((p) => p.kind === 'ac' && p.roomId === room.id)) {
        circuits.push({ id: ids.next('c'), name: `AC · ${room.name}`, rating: RATING.ac, path: routeThrough(from, [ac], onLevel), ...tag(level) });
      }
    }
  }

  return { electrical: { points, circuits }, plumbing: { fixtures, lines } };
}

function clusterRooms(wet: Room[], all: Room[]): Room[][] {
  const groups: Room[][] = [];
  const seen = new Set<string>();
  for (const r of wet) {
    if (seen.has(r.id)) continue;
    const group: Room[] = [];
    const stack = [r];
    seen.add(r.id);
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      for (const d of doorsOf(cur, all)) {
        if (!seen.has(d.other.id) && wet.some((w) => w.id === d.other.id)) {
          seen.add(d.other.id);
          stack.push(d.other);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

function placeFixtures(room: Room, rooms: Room[], f: Box2, add: (k: PlumbingKind, p: Vec2, r: Room) => void) {
  const doors = doorsOf(room, rooms).map((d) => d.wall);
  const outside = externalWalls(room, f);
  const walls = edges(room.polygon).sort((a, b) => segLength(b) - segLength(a));
  // The back wall: an outside wall, else the longest wall without a door.
  const back = outside[0] ?? walls.find((w) => !doors.some((d) => overlap(w, d))) ?? walls[0]!;
  const len = segLength(back);
  const at = (share: number, inset = FIXTURE_INSET_M) => onWall(room.polygon, back, len * share, inset);

  switch (room.kind) {
    case 'bathroom':
      add('shower', at(0.2, 0.5), room);
      add('floor_trap', at(0.2, 0.9), room);
      add('water_heater', at(0.2, WALL_INSET_M), room);
      add('wc', at(0.55), room);
      add('basin', at(0.85, 0.3), room);
      break;
    case 'kitchen':
      add('sink', at(0.5, 0.3), room);
      break;
    case 'utility':
      add('washing_machine', at(0.3), room);
      add('tap', at(0.7, WALL_INSET_M), room);
      add('floor_trap', at(0.7, 0.6), room);
      break;
    case 'pantry':
      add('sink', at(0.5, 0.3), room);
      break;
    default:
      break;
  }
}
