import { describe, expect, it } from 'vitest';
import type { CommuteFile, CustomRoute } from '@ave/shared';
import { selectRoute } from './activeRoute';

const commute: CommuteFile = {
  propertyId: 'apt-test',
  origin: { lat: 12.97, lng: 77.64 },
  note: 'Estimates without heavy traffic.',
  routes: [
    {
      id: 'airport',
      label: 'Airport',
      category: 'airport',
      destination: { name: 'Kempegowda International Airport', lat: 13.2, lng: 77.71 },
      distanceKm: 34.6,
      durationMin: 41,
      geometry: [
        [77.64, 12.97],
        [77.71, 13.2],
      ],
      source: 'test',
    },
    {
      id: 'office',
      label: 'Office in Koramangala',
      category: 'office',
      destination: { name: 'Jyoti Nivas College Road, Koramangala', lat: 12.93, lng: 77.61 },
      distanceKm: 6.1,
      durationMin: 16,
      geometry: [
        [77.64, 12.97],
        [77.61, 12.93],
      ],
      source: 'test',
      propertyId: 'office-test',
    },
  ],
};

const custom: CustomRoute = {
  name: 'Whitefield',
  destination: { lat: 12.97, lng: 77.75 },
  distanceKm: 14.2,
  durationMin: 33,
  geometry: [
    [77.64, 12.97],
    [77.75, 12.97],
  ],
};

describe('selectRoute', () => {
  it('shows nothing until a destination is chosen', () => {
    expect(selectRoute(commute, { destinationId: null, custom: null })).toEqual({ status: 'none' });
  });

  it('resolves a preset, carrying the other property id', () => {
    const s = selectRoute(commute, { destinationId: 'office', custom: null });
    expect(s.status).toBe('route');
    if (s.status !== 'route') return;
    expect(s.route.kind).toBe('preset');
    expect(s.route.propertyId).toBe('office-test');
    expect(s.route.distanceKm).toBe(6.1);
  });

  it('shows a live custom route when no preset is set', () => {
    const s = selectRoute(commute, { destinationId: null, custom });
    expect(s.status === 'route' && s.route.kind === 'custom' && s.route.label === 'Whitefield').toBe(true);
  });

  it('prefers a preset id over a custom route', () => {
    const s = selectRoute(commute, { destinationId: 'airport', custom });
    expect(s.status === 'route' && s.route.key).toBe('preset:airport');
  });

  it('reports an unknown preset id instead of drawing nothing silently', () => {
    expect(selectRoute(commute, { destinationId: 'moon', custom: null })).toEqual({ status: 'missing', destinationId: 'moon' });
  });
});
