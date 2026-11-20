import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { CameraPath, makePose, poseFromShot } from './cameraPath';
import type { Level } from './levels';
import { CollisionMap, cutawayFor, planRoute } from './route';
import { sectionSegments } from './section';

const LEVELS: Level[] = [{ index: 0, name: 'Floor', floorY: 0, planImage: '' }];

/** A 3 m high wall along x = 0 from z = −5 to z = 1, leaving a doorway north of z = 1. */
function wallWithDoorway(): Group {
  const g = new Group();
  const wall = new Mesh(new BoxGeometry(0.1, 3, 6), new MeshBasicMaterial());
  wall.position.set(0, 1.5, -2);
  g.add(wall);
  g.updateMatrixWorld(true);
  return g;
}

describe('sectionSegments', () => {
  it('cuts a box wall into its outline at the given height', () => {
    const segs = sectionSegments(wallWithDoorway(), 1.5);
    expect(segs.length).toBeGreaterThan(0);
    for (const [x0, , x1] of segs) {
      expect(Math.abs(x0)).toBeLessThanOrEqual(0.05 + 1e-6);
      expect(Math.abs(x1)).toBeLessThanOrEqual(0.05 + 1e-6);
    }
  });
});

describe('planRoute', () => {
  const collision = new CollisionMap(wallWithDoorway(), LEVELS);
  const cutaway = cutawayFor(LEVELS);
  const from = new Vector3(-2, 1.6, -2);
  const to = new Vector3(2, 1.6, -2);
  const doorway: [number, number, number] = [0, 1.6, 2.5];

  it('sees the wall between the two rooms', () => {
    expect(collision.blocked(from, to)).toBe(true);
    expect(collision.blocked(from, new Vector3(-2, 1.6, 2.5))).toBe(false);
  });

  it('routes through the authored doorway instead of the wall', () => {
    expect(planRoute({ from, fromChain: [], to, toChain: [doorway], cutaway, collision })).toEqual([doorway]);
  });

  it('drops chain points that a straight walk can skip', () => {
    const a = new Vector3(2, 1.6, 0);
    const b = new Vector3(2, 1.6, -3);
    expect(planRoute({ from: a, fromChain: [doorway], to: b, toChain: [doorway], cutaway, collision })).toEqual([]);
  });

  it('rises above the cutaway for the overview and drops into rooms from above', () => {
    const overview = new Vector3(5, 15, 10);
    const up = planRoute({ from, fromChain: [doorway], to: overview, toChain: [], cutaway, collision });
    expect(up).toHaveLength(1);
    expect(up[0]![1]).toBeGreaterThan(cutaway.triggerY);
    const down = planRoute({ from: overview, fromChain: [], to, toChain: [doorway], cutaway, collision });
    expect(down[0]![0]).toBe(to.x);
    expect(down[0]![2]).toBe(to.z);
  });
});

describe('CameraPath', () => {
  it('starts and ends exactly on the given poses and passes through via points', () => {
    const from = poseFromShot({ position: [-2, 1.6, -2], target: [-2, 1.4, -5], fov: 60 });
    const to = poseFromShot({ position: [2, 1.6, -2], target: [4, 1, -2], fov: 50 });
    const path = new CameraPath(from, [[0, 1.6, 2.5]], to);
    const p = makePose();
    path.sample(0, p);
    expect(p.position.distanceTo(from.position)).toBeLessThan(1e-6);
    path.sample(1, p);
    expect(p.position.distanceTo(to.position)).toBeLessThan(1e-6);
    expect(p.fov).toBeCloseTo(50);
    let nearest = Infinity;
    for (let t = 0; t <= 1; t += 0.01) nearest = Math.min(nearest, path.sample(t, p).position.distanceTo(new Vector3(0, 1.6, 2.5)));
    expect(nearest).toBeLessThan(0.05);
    expect(path.duration).toBeGreaterThan(0);
  });
});
