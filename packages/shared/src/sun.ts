// suncalc 2.x is ESM and reports angles in degrees, azimuth clockwise from north.
import * as SunCalc from 'suncalc';
import { DIRECTIONS, type Direction, type PlanFile, type Property, type Room, type Vec2 } from './data.js';

/** India Standard Time offset in minutes. Properties are in Bengaluru. */
export const IST_OFFSET_MIN = 330;

export interface SunPosition {
  /** Degrees clockwise from true north. */
  bearingDeg: number;
  /** Degrees above the horizon (negative = below). */
  altitudeDeg: number;
  /** Unit vector pointing from the scene toward the sun, in model space (x, y, z). */
  modelDir: [number, number, number];
}

/** Date in UTC for a local clock time (0..1439 minutes, IST) on the given calendar day. */
export function istDate(day: Date, minutes: number): Date {
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth();
  const d = day.getUTCDate();
  return new Date(Date.UTC(y, m, d, 0, minutes - IST_OFFSET_MIN));
}

export function sunPosition(property: Pick<Property, 'location' | 'northOffsetDeg'>, day: Date, minutes: number): SunPosition {
  const pos = SunCalc.getPosition(istDate(day, minutes), property.location.lat, property.location.lng);
  const bearingDeg = normDeg(pos.azimuth);
  const altitudeDeg = pos.altitude;
  const modelBearing = toRad(bearingDeg + property.northOffsetDeg);
  const alt = toRad(altitudeDeg);
  const cosAlt = Math.cos(alt);
  return {
    bearingDeg,
    altitudeDeg,
    modelDir: [Math.sin(modelBearing) * cosAlt, Math.sin(alt), -Math.cos(modelBearing) * cosAlt],
  };
}

export interface SunTimes {
  sunriseMin: number;
  sunsetMin: number;
}

export function sunTimes(property: Pick<Property, 'location'>, day: Date): SunTimes {
  const t = SunCalc.getTimes(istDate(day, 12 * 60), property.location.lat, property.location.lng);
  // Bengaluru always has a sunrise and sunset; the fallbacks only guard the types.
  return {
    sunriseMin: t.sunrise ? istMinutes(t.sunrise) : 6 * 60,
    sunsetMin: t.sunset ? istMinutes(t.sunset) : 18 * 60,
  };
}

function istMinutes(d: Date): number {
  return Math.round((((d.getUTCHours() * 60 + d.getUTCMinutes() + IST_OFFSET_MIN) % 1440) + 1440) % 1440);
}

/** True bearing (degrees) of a model-space point as seen from the plan centre. */
export function bearingFromCentre(plan: Pick<PlanFile, 'bounds'>, point: Vec2, northOffsetDeg: number): number {
  const cx = (plan.bounds.minX + plan.bounds.maxX) / 2;
  const cz = (plan.bounds.minZ + plan.bounds.maxZ) / 2;
  const dx = point[0] - cx;
  const dz = point[1] - cz;
  const modelBearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return normDeg(modelBearing - northOffsetDeg);
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]!;
    const [x1, z1] = poly[(i + 1) % poly.length]!;
    const f = x0 * z1 - x1 * z0;
    a += f;
    cx += (x0 + x1) * f;
    cz += (z0 + z1) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  a *= 0.5;
  return [cx / (6 * a), cz / (6 * a)];
}

export function bearingToDirection(bearingDeg: number): Direction {
  return DIRECTIONS[Math.round(normDeg(bearingDeg) / 45) % 8]!;
}

export function roomDirection(plan: Pick<PlanFile, 'bounds'>, room: Pick<Room, 'polygon'>, northOffsetDeg: number): Direction {
  return bearingToDirection(bearingFromCentre(plan, polygonCentroid(room.polygon), northOffsetDeg));
}

/** Angular distance between two bearings, 0..180. */
export function bearingDelta(a: number, b: number): number {
  const d = Math.abs(normDeg(a) - normDeg(b));
  return d > 180 ? 360 - d : d;
}

/** Half-width of the arc of sky a room's outer side can receive direct sun from. */
export const DIRECT_SUN_ARC_DEG = 70;

/**
 * Whether a room is likely to receive direct sun at this moment.
 * A heuristic: the sun is up and its bearing falls within the arc the room faces.
 */
export function roomGetsSun(roomBearingDeg: number, sun: SunPosition): boolean {
  return sun.altitudeDeg > 3 && bearingDelta(roomBearingDeg, sun.bearingDeg) <= DIRECT_SUN_ARC_DEG;
}

/* ------------------------------ Vastu ------------------------------ */

export type VastuVerdict = 'ideal' | 'acceptable' | 'avoid';

/**
 * Traditional Vastu guidance on where each room sits in the home.
 * Presented to buyers as traditional guidance, not as a rule.
 */
export const VASTU_RULES: Partial<Record<Room['kind'], { ideal: Direction[]; acceptable: Direction[] }>> = {
  entrance: { ideal: ['N', 'NE', 'E'], acceptable: ['W', 'NW'] },
  living: { ideal: ['N', 'NE', 'E'], acceptable: ['NW', 'W'] },
  dining: { ideal: ['W', 'E'], acceptable: ['N', 'SE'] },
  kitchen: { ideal: ['SE'], acceptable: ['NW', 'E'] },
  bedroom: { ideal: ['SW'], acceptable: ['S', 'W', 'NW'] },
  bathroom: { ideal: ['NW', 'W'], acceptable: ['S', 'SE'] },
  study: { ideal: ['NE', 'E', 'N'], acceptable: ['W'] },
  balcony: { ideal: ['N', 'E', 'NE'], acceptable: ['NW', 'SE'] },
  utility: { ideal: ['NW', 'SE'], acceptable: ['W', 'S'] },
};

export function vastuVerdict(kind: Room['kind'], dir: Direction): VastuVerdict | null {
  const rule = VASTU_RULES[kind];
  if (!rule) return null;
  if (rule.ideal.includes(dir)) return 'ideal';
  if (rule.acceptable.includes(dir)) return 'acceptable';
  return 'avoid';
}

/* --------------------------- Day, path, windows --------------------------- */

const MS_PER_MIN = 60_000;

/** The calendar day it is in India at `now`, as midnight UTC: the `day` argument for the functions here. */
export function istCalendarDay(now: Date): Date {
  const local = new Date(now.getTime() + IST_OFFSET_MIN * MS_PER_MIN);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** Minutes past local midnight in India at `now`, 0..1439. */
export function istMinutesNow(now: Date): number {
  return istMinutes(now);
}

export interface SunSample {
  minutes: number;
  bearingDeg: number;
  altitudeDeg: number;
}

/** Default sampling step for the sun's arc and room sun windows, in minutes. */
export const SUN_SAMPLE_STEP_MIN = 5;

/** The sun's track across the sky from sunrise to sunset (both ends included). */
export function sunPath(property: Pick<Property, 'location' | 'northOffsetDeg'>, day: Date, stepMin = SUN_SAMPLE_STEP_MIN): SunSample[] {
  const { sunriseMin, sunsetMin } = sunTimes(property, day);
  const out: SunSample[] = [];
  for (let m = sunriseMin; m < sunsetMin; m += stepMin) out.push(sample(m));
  out.push(sample(sunsetMin));
  return out;

  function sample(minutes: number): SunSample {
    const p = sunPosition(property, day, minutes);
    return { minutes, bearingDeg: p.bearingDeg, altitudeDeg: p.altitudeDeg };
  }
}

/** True bearing of a room as seen from the plan centre: the side of the home it sits on. */
export function roomBearing(plan: Pick<PlanFile, 'bounds'>, room: Pick<Room, 'polygon'>, northOffsetDeg: number): number {
  return bearingFromCentre(plan, polygonCentroid(room.polygon), northOffsetDeg);
}

export interface SunWindow {
  startMin: number;
  endMin: number;
}

/** Spans of the day (local minutes) in which `roomGetsSun` holds for the room. */
export function roomSunWindows(
  property: Pick<Property, 'location' | 'northOffsetDeg'>,
  plan: Pick<PlanFile, 'bounds'>,
  room: Pick<Room, 'polygon'>,
  day: Date,
  stepMin = SUN_SAMPLE_STEP_MIN,
): SunWindow[] {
  const bearing = roomBearing(plan, room, property.northOffsetDeg);
  const { sunriseMin, sunsetMin } = sunTimes(property, day);
  const windows: SunWindow[] = [];
  let open: SunWindow | null = null;
  for (let m = sunriseMin; m <= sunsetMin; m += stepMin) {
    if (roomGetsSun(bearing, sunPosition(property, day, m))) {
      if (open) open.endMin = m;
      else open = { startMin: m, endMin: m };
    } else if (open) {
      windows.push(open);
      open = null;
    }
  }
  if (open) windows.push(open);
  return windows;
}

export const SUN_PERIODS = ['morning', 'afternoon', 'evening'] as const;
export type SunPeriod = (typeof SUN_PERIODS)[number];
export const SUN_PERIOD_LABELS: Record<SunPeriod, string> = { morning: 'Morning sun', afternoon: 'Afternoon sun', evening: 'Evening sun' };
/** Local clock boundaries between periods: morning ends at noon, afternoon at 4 PM. */
export const SUN_PERIOD_BOUNDS_MIN = { morningEnd: 12 * 60, afternoonEnd: 16 * 60 } as const;

/** Which parts of the day a room gets direct sun in. */
export function sunPeriods(windows: SunWindow[]): SunPeriod[] {
  const { morningEnd, afternoonEnd } = SUN_PERIOD_BOUNDS_MIN;
  const ranges: Record<SunPeriod, [number, number]> = {
    morning: [0, morningEnd],
    afternoon: [morningEnd, afternoonEnd],
    evening: [afternoonEnd, 24 * 60],
  };
  return SUN_PERIODS.filter((p) => windows.some((w) => w.startMin < ranges[p][1] && w.endMin >= ranges[p][0]));
}

/* ------------------------------ Tour lighting ------------------------------ */

export interface TourSunLight {
  /** Unit vector from the scene toward the sun in model space (x, y, z): place the key light along it. */
  direction: [number, number, number];
  bearingDeg: number;
  altitudeDeg: number;
  /** Direct sunlight strength, 0 (sun down) to 1 (high sun). Scale the key light by this. */
  intensity: number;
  /** Sky fill, from a dim night level to full daylight. Scale the ambient or environment light by this. */
  ambient: number;
  /** 0 is neutral midday white, 1 is deep golden hour or twilight. */
  warmth: number;
  /** Colour temperature of the sunlight in kelvin. */
  kelvin: number;
  /** The sunlight colour as sRGB, each channel 0..1. */
  color: [number, number, number];
  isDay: boolean;
}

/** Altitude at which direct sun reaches full strength. */
const FULL_SUN_ALTITUDE_DEG = 40;
/** Civil twilight: below this the sky gives only the night fill. */
const TWILIGHT_ALTITUDE_DEG = -6;
/** Above this altitude the light is neutral white; below it, it warms toward the horizon. */
const GOLDEN_FADE_ALTITUDE_DEG = 25;
const NIGHT_AMBIENT = 0.08;
const DAY_AMBIENT = 1;
const GOLDEN_KELVIN = 2400;
const MIDDAY_KELVIN = 5800;

/**
 * Lighting for the 3D tour at a local clock time, so the tour follows the Compass view's slider.
 * Pure: the same property, day and minutes always give the same light.
 */
export function sunLightForTour(property: Pick<Property, 'location' | 'northOffsetDeg'>, day: Date, minutes: number): TourSunLight {
  const sun = sunPosition(property, day, minutes);
  const alt = sun.altitudeDeg;
  const intensity = alt <= 0 ? 0 : clamp01(Math.sin(toRad(alt)) / Math.sin(toRad(FULL_SUN_ALTITUDE_DEG)));
  const ambient = NIGHT_AMBIENT + (DAY_AMBIENT - NIGHT_AMBIENT) * clamp01((alt - TWILIGHT_ALTITUDE_DEG) / (FULL_SUN_ALTITUDE_DEG - TWILIGHT_ALTITUDE_DEG));
  const warmth = 1 - clamp01(alt / GOLDEN_FADE_ALTITUDE_DEG);
  const kelvin = Math.round(GOLDEN_KELVIN + (MIDDAY_KELVIN - GOLDEN_KELVIN) * (1 - warmth));
  return {
    direction: sun.modelDir,
    bearingDeg: sun.bearingDeg,
    altitudeDeg: alt,
    intensity,
    ambient,
    warmth,
    kelvin,
    color: kelvinToRgb(kelvin),
    isDay: alt > 0,
  };
}

/** Approximate sRGB colour of a black body at `kelvin` (Tanner Helland's fit, valid 1000–40000 K). */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255)];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function normDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}
