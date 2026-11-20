import { Color, MathUtils } from 'three';
import { sunPosition, type Property } from '@ave/shared';

/**
 * Natural, bright interior lighting shared by the tour and the studio renders: a procedural room
 * environment for soft fill and reflections, a sky/ground hemisphere, and a directional sun that
 * follows the Compass view's time of day. The models have no baked lighting, so time of day shifts
 * the sun's direction, warmth and the exposure rather than casting hard shadows.
 */
export const LIGHT = {
  exposure: 1.0,
  environmentIntensity: 0.85,
  hemisphere: { sky: '#ffffff', ground: '#e8dfd2', intensity: 0.55 },
  sun: { maxIntensity: 1.6, noonColor: '#fff6ea', lowColor: '#ffc68a' },
  /** Sun altitude (degrees) at which light is fully neutral; lower is warmer. */
  warmBelowDeg: 25,
  /** Exposure and environment at night, when interiors are lit artificially. */
  night: { exposure: 0.82, environmentIntensity: 0.7, tint: '#ffe2bf' },
  /** Distance of the sun light from the scene centre, metres. Only direction matters. */
  sunDistance: 30,
} as const;

/** Background behind windows when nothing is modelled there. */
export const SKY_COLOUR = '#dfeaf3';

export interface Daylight {
  /** Unit vector from the scene towards the sun, in model space. */
  sunDir: [number, number, number];
  sunIntensity: number;
  sunColor: Color;
  hemisphereIntensity: number;
  environmentIntensity: number;
  exposure: number;
}

/** Lighting for a local clock time (minutes after midnight, IST) on the given day. */
export function daylightFor(property: Pick<Property, 'location' | 'northOffsetDeg'>, minutes: number, day: Date = new Date()): Daylight {
  const sun = sunPosition(property, day, minutes);
  const up = MathUtils.clamp(sun.altitudeDeg / LIGHT.warmBelowDeg, 0, 1);
  const daylight = MathUtils.clamp((sun.altitudeDeg + 4) / 10, 0, 1);
  const sunColor = new Color(LIGHT.sun.lowColor).lerp(new Color(LIGHT.sun.noonColor), up);
  return {
    sunDir: sun.modelDir,
    sunIntensity: LIGHT.sun.maxIntensity * daylight * (0.55 + 0.45 * up),
    sunColor,
    hemisphereIntensity: MathUtils.lerp(LIGHT.hemisphere.intensity * 0.6, LIGHT.hemisphere.intensity, daylight),
    environmentIntensity: MathUtils.lerp(LIGHT.night.environmentIntensity, LIGHT.environmentIntensity, daylight),
    exposure: MathUtils.lerp(LIGHT.night.exposure, LIGHT.exposure, daylight),
  };
}
