import type { Property, Room } from '@ave/shared';

export interface Level {
  index: number;
  name: string;
  floorY: number;
  planImage: string;
}

/** Name of the only level of a single-level property. */
const SINGLE_LEVEL_NAME = 'Floor plan';

/** A property's levels, lowest first. Single-level properties get one level built from `planImage`. */
export function propertyLevels(property: Pick<Property, 'levels' | 'planImage'>): Level[] {
  if (property.levels?.length) return [...property.levels].sort((a, b) => a.floorY - b.floorY);
  return [{ index: 0, name: SINGLE_LEVEL_NAME, floorY: 0, planImage: property.planImage }];
}

export function roomLevel(room: Pick<Room, 'level'>): number {
  return room.level ?? 0;
}

/** The level a camera at height `y` is standing on: the highest floor at or below eye level. */
export function levelAtHeight(levels: Level[], y: number): Level {
  let best = levels[0]!;
  for (const l of levels) if (l.floorY <= y && l.floorY >= best.floorY) best = l;
  return best;
}
