/**
 * Preset commute destinations. Coordinates come from OpenStreetMap (ids noted for provenance)
 * and were looked up once through Nominatim and Overpass; the router snaps each to the nearest road.
 * The nearest metro station and the other property are added per property by precompute-routes.ts.
 */
import type { CommuteRoute } from '@ave/shared';

export interface PresetDestination {
  id: string;
  label: string;
  category: CommuteRoute['category'];
  name: string;
  lat: number;
  lng: number;
  /** Where the point came from. */
  osm: string;
}

export const FIXED_DESTINATIONS: PresetDestination[] = [
  {
    id: 'airport',
    label: 'Airport',
    category: 'airport',
    name: 'Kempegowda International Airport, Terminal 1',
    lat: 13.20049,
    lng: 77.71098,
    osm: 'way/60046909',
  },
  {
    id: 'majestic-bus-station',
    label: 'Majestic bus station',
    category: 'bus',
    name: 'Kempegowda Bus Station (Majestic)',
    lat: 12.97818,
    lng: 77.57219,
    osm: 'way/239832511',
  },
  {
    id: 'city-railway-station',
    label: 'City railway station',
    category: 'rail',
    name: 'KSR Bengaluru City railway station',
    lat: 12.97817,
    lng: 77.56956,
    osm: 'node/2669084978',
  },
  {
    id: 'mg-road',
    label: 'MG Road',
    category: 'cbd',
    name: 'MG Road (central business district)',
    lat: 12.97539,
    lng: 77.6065,
    osm: 'node/7132452575',
  },
  {
    id: 'manyata-tech-park',
    label: 'Manyata Tech Park',
    category: 'techpark',
    name: 'Manyata Tech Park, Nagavara',
    lat: 13.04829,
    lng: 77.6211,
    osm: 'way/34121900',
  },
  {
    id: 'embassy-techvillage',
    label: 'Embassy TechVillage (ORR)',
    category: 'techpark',
    name: 'Embassy TechVillage, Outer Ring Road',
    lat: 12.93069,
    lng: 77.69142,
    osm: 'way/232970396',
  },
  {
    id: 'electronic-city',
    label: 'Electronic City',
    category: 'techpark',
    name: 'Electronic City Phase 1',
    lat: 12.84968,
    lng: 77.66497,
    osm: 'node/459501900',
  },
];

/** Id of the route to the nearest metro station. */
export const METRO_ROUTE_ID = 'nearest-metro';
