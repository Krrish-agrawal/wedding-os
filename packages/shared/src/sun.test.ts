import { describe, expect, it } from 'vitest';
import type { PlanFile, Room } from './data.js';
import {
  VASTU_RULES,
  bearingDelta,
  bearingFromCentre,
  bearingToDirection,
  istCalendarDay,
  kelvinToRgb,
  polygonCentroid,
  roomDirection,
  roomGetsSun,
  roomSunWindows,
  sunLightForTour,
  sunPath,
  sunPeriods,
  sunPosition,
  sunTimes,
  vastuVerdict,
} from './sun.js';

/** A point in Indiranagar, Bengaluru. */
const BLR = { location: { lat: 12.9719, lng: 77.6412 }, northOffsetDeg: 0 };
const NOV_20 = new Date(Date.UTC(2026, 10, 20));
const JUN_21 = new Date(Date.UTC(2026, 5, 21));
const DEC_21 = new Date(Date.UTC(2026, 11, 21));
const hm = (h: number, m = 0) => h * 60 + m;

const PLAN: Pick<PlanFile, 'bounds'> = { bounds: { minX: -5, maxX: 5, minZ: -4, maxZ: 4 } };
const square = (cx: number, cz: number, half = 1): Room['polygon'] => [
  [cx - half, cz - half],
  [cx + half, cz - half],
  [cx + half, cz + half],
  [cx - half, cz + half],
];

describe('sunTimes in Bengaluru', () => {
  it('puts November sunrise around 6:20 AM and sunset around 5:50 PM IST', () => {
    const t = sunTimes(BLR, NOV_20);
    expect(t.sunriseMin).toBeGreaterThanOrEqual(hm(6, 10));
    expect(t.sunriseMin).toBeLessThanOrEqual(hm(6, 30));
    expect(t.sunsetMin).toBeGreaterThanOrEqual(hm(17, 40));
    expect(t.sunsetMin).toBeLessThanOrEqual(hm(18, 0));
  });

  it('gives the longest day at the June solstice and a later sunrise in December', () => {
    const jun = sunTimes(BLR, JUN_21);
    const dec = sunTimes(BLR, DEC_21);
    expect(jun.sunriseMin).toBeGreaterThanOrEqual(hm(5, 45));
    expect(jun.sunriseMin).toBeLessThanOrEqual(hm(6, 5));
    expect(jun.sunsetMin).toBeGreaterThanOrEqual(hm(18, 40));
    expect(jun.sunsetMin).toBeLessThanOrEqual(hm(18, 55));
    expect(dec.sunriseMin).toBeGreaterThanOrEqual(hm(6, 25));
    expect(dec.sunriseMin).toBeLessThanOrEqual(hm(6, 45));
    expect(jun.sunsetMin - jun.sunriseMin).toBeGreaterThan(dec.sunsetMin - dec.sunriseMin);
  });
});

describe('sunPosition', () => {
  it('rises in the east-south-east and stands in the south at midday in November', () => {
    const morning = sunPosition(BLR, NOV_20, hm(7));
    expect(morning.bearingDeg).toBeGreaterThan(100);
    expect(morning.bearingDeg).toBeLessThan(125);
    expect(morning.altitudeDeg).toBeGreaterThan(0);
    const noon = sunPosition(BLR, NOV_20, hm(12, 15));
    expect(bearingDelta(noon.bearingDeg, 180)).toBeLessThan(15);
    expect(noon.altitudeDeg).toBeGreaterThan(50);
    expect(noon.altitudeDeg).toBeLessThan(62);
  });

  it('passes north of overhead at midday in June (Bengaluru is south of the Tropic of Cancer)', () => {
    const noon = sunPosition(BLR, JUN_21, hm(12, 15));
    expect(noon.altitudeDeg).toBeGreaterThan(75);
    expect(bearingDelta(noon.bearingDeg, 0)).toBeLessThan(45);
  });

  it('is below the horizon at night', () => {
    expect(sunPosition(BLR, NOV_20, hm(22)).altitudeDeg).toBeLessThan(0);
  });

  it('rotates the model-space direction by the north offset', () => {
    // Pick a moment with the sun close to due east.
    const east = sunPath(BLR, JUN_21).find((s) => s.altitudeDeg > 10 && bearingDelta(s.bearingDeg, 90) < 25)!;
    const plain = sunPosition(BLR, JUN_21, east.minutes);
    // With no offset, east is model +X.
    expect(plain.modelDir[0]).toBeGreaterThan(0.8 * Math.cos((plain.altitudeDeg * Math.PI) / 180));
    // True north along model +X puts east along model +Z.
    const turned = sunPosition({ ...BLR, northOffsetDeg: 90 }, JUN_21, east.minutes);
    expect(turned.modelDir[2]).toBeGreaterThan(0.8 * Math.cos((turned.altitudeDeg * Math.PI) / 180));
    expect(Math.hypot(...turned.modelDir)).toBeCloseTo(1, 6);
  });
});

describe('bearings and directions', () => {
  it('reads model -Z as north when there is no offset', () => {
    expect(bearingFromCentre(PLAN, [0, -3], 0)).toBeCloseTo(0);
    expect(bearingFromCentre(PLAN, [3, 0], 0)).toBeCloseTo(90);
    expect(bearingFromCentre(PLAN, [0, 3], 0)).toBeCloseTo(180);
    expect(bearingFromCentre(PLAN, [-3, 0], 0)).toBeCloseTo(270);
  });

  it('applies the north offset clockwise', () => {
    // True north lies along model +X, so model -Z (up on the plan) is west.
    expect(bearingFromCentre(PLAN, [0, -3], 90)).toBeCloseTo(270);
    expect(bearingFromCentre(PLAN, [3, 0], 90)).toBeCloseTo(0);
    expect(bearingFromCentre(PLAN, [0, -3], -45)).toBeCloseTo(45);
  });

  it('measures from the plan centre, not the origin', () => {
    const offCentre: Pick<PlanFile, 'bounds'> = { bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 8 } };
    expect(bearingFromCentre(offCentre, [9, 4], 0)).toBeCloseTo(90);
  });

  it('snaps bearings to the eight directions', () => {
    expect(bearingToDirection(0)).toBe('N');
    expect(bearingToDirection(22)).toBe('N');
    expect(bearingToDirection(23)).toBe('NE');
    expect(bearingToDirection(135)).toBe('SE');
    expect(bearingToDirection(250)).toBe('W');
    expect(bearingToDirection(359)).toBe('N');
    expect(bearingToDirection(-90)).toBe('W');
  });

  it('gives a room the direction of its centroid', () => {
    expect(roomDirection(PLAN, { polygon: square(3.5, 2.5) }, 0)).toBe('SE');
    expect(roomDirection(PLAN, { polygon: square(-3.5, 2.5) }, 0)).toBe('SW');
    expect(roomDirection(PLAN, { polygon: square(-3.5, 2.5) }, 90)).toBe('SE');
  });

  it('finds the centroid of an L-shaped room', () => {
    const l: Room['polygon'] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
    const [cx, cz] = polygonCentroid(l);
    expect(cx).toBeCloseTo(5 / 6);
    expect(cz).toBeCloseTo(5 / 6);
  });

  it('measures the short way round between bearings', () => {
    expect(bearingDelta(350, 10)).toBeCloseTo(20);
    expect(bearingDelta(90, 270)).toBeCloseTo(180);
  });
});

describe('direct sun', () => {
  const eastRoom = { polygon: square(4, 0) };
  const westRoom = { polygon: square(-4, 0) };

  it('reaches an east-side room in the morning and a west-side room in the afternoon', () => {
    const morning = sunPosition(BLR, NOV_20, hm(8));
    const afternoon = sunPosition(BLR, NOV_20, hm(16));
    expect(roomGetsSun(90, morning)).toBe(true);
    expect(roomGetsSun(270, morning)).toBe(false);
    expect(roomGetsSun(270, afternoon)).toBe(true);
    expect(roomGetsSun(90, afternoon)).toBe(false);
    expect(roomGetsSun(90, sunPosition(BLR, NOV_20, hm(21)))).toBe(false);
  });

  it('turns that into windows across the day', () => {
    const east = roomSunWindows(BLR, PLAN, eastRoom, NOV_20);
    const west = roomSunWindows(BLR, PLAN, westRoom, NOV_20);
    expect(east).toHaveLength(1);
    expect(east[0]!.startMin).toBeLessThan(hm(7));
    expect(east[0]!.endMin).toBeLessThan(hm(12));
    expect(sunPeriods(east)).toEqual(['morning']);
    expect(west).toHaveLength(1);
    expect(west[0]!.startMin).toBeGreaterThan(hm(12));
    expect(sunPeriods(west)).toEqual(['afternoon', 'evening']);
  });

  it('samples the arc from sunrise to sunset', () => {
    const path = sunPath(BLR, NOV_20);
    const t = sunTimes(BLR, NOV_20);
    expect(path[0]!.minutes).toBe(t.sunriseMin);
    expect(path[path.length - 1]!.minutes).toBe(t.sunsetMin);
    expect(Math.max(...path.map((s) => s.altitudeDeg))).toBeGreaterThan(50);
  });
});

describe('istCalendarDay', () => {
  it('rolls over at midnight in India, not UTC', () => {
    expect(istCalendarDay(new Date('2026-11-20T20:00:00Z')).toISOString()).toBe('2026-11-21T00:00:00.000Z');
    expect(istCalendarDay(new Date('2026-11-20T10:00:00Z')).toISOString()).toBe('2026-11-20T00:00:00.000Z');
  });
});

describe('sunLightForTour', () => {
  it('is bright and neutral at midday', () => {
    const l = sunLightForTour(BLR, NOV_20, hm(12, 15));
    expect(l.isDay).toBe(true);
    expect(l.intensity).toBeGreaterThan(0.95);
    expect(l.warmth).toBeLessThan(0.05);
    expect(l.kelvin).toBeGreaterThan(5500);
    expect(l.ambient).toBeGreaterThan(0.9);
    expect(Math.hypot(...l.direction)).toBeCloseTo(1, 6);
    expect(l.direction[1]).toBeGreaterThan(0.8);
  });

  it('is low and golden just after sunrise', () => {
    const { sunriseMin } = sunTimes(BLR, NOV_20);
    const l = sunLightForTour(BLR, NOV_20, sunriseMin + 20);
    expect(l.intensity).toBeGreaterThan(0);
    expect(l.intensity).toBeLessThan(0.4);
    expect(l.warmth).toBeGreaterThan(0.7);
    expect(l.color[0]).toBeGreaterThan(l.color[2]);
  });

  it('has no direct sun at night', () => {
    const l = sunLightForTour(BLR, NOV_20, hm(23));
    expect(l.isDay).toBe(false);
    expect(l.intensity).toBe(0);
    expect(l.ambient).toBeLessThan(0.1);
    expect(l.warmth).toBe(1);
  });

  it('maps colour temperature to sRGB', () => {
    const white = kelvinToRgb(6600);
    expect(white[0]).toBeGreaterThan(0.95);
    expect(white[1]).toBeGreaterThan(0.95);
    expect(white[2]).toBeGreaterThan(0.95);
    const warm = kelvinToRgb(2400);
    expect(warm[0]).toBe(1);
    expect(warm[2]).toBeLessThan(0.5);
  });
});

describe('Vastu verdicts', () => {
  it('follows the rule table', () => {
    expect(vastuVerdict('kitchen', 'SE')).toBe('ideal');
    expect(vastuVerdict('kitchen', 'NW')).toBe('acceptable');
    expect(vastuVerdict('kitchen', 'NE')).toBe('avoid');
    expect(vastuVerdict('bedroom', 'SW')).toBe('ideal');
    expect(vastuVerdict('bedroom', 'NE')).toBe('avoid');
    expect(vastuVerdict('entrance', 'E')).toBe('ideal');
    expect(vastuVerdict('bathroom', 'S')).toBe('acceptable');
  });

  it('has no verdict for rooms the tradition does not place', () => {
    expect(vastuVerdict('workspace', 'N')).toBeNull();
    expect(vastuVerdict('other', 'SW')).toBeNull();
  });

  it('never lists a direction as both ideal and acceptable', () => {
    for (const rule of Object.values(VASTU_RULES)) {
      for (const d of rule!.ideal) expect(rule!.acceptable).not.toContain(d);
    }
  });
});
