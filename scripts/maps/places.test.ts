import { describe, expect, it } from 'vitest';
import { classify, displayName } from './places-config.js';
import { selectPlaces, toCandidates, type OverpassElement } from './fetch-places.js';

const ORIGIN = { lat: 12.9745, lng: 77.6427 };
let nextId = 1;
const node = (lat: number, lon: number, tags: Record<string, string>): OverpassElement => ({ type: 'node', id: nextId++, lat, lon, tags });

describe('classify', () => {
  it('maps OSM tags to categories with a short type label', () => {
    expect(classify({ amenity: 'school' })).toMatchObject({ category: 'schools', kind: 'School' });
    expect(classify({ healthcare: 'hospital' })).toMatchObject({ category: 'hospitals' });
    expect(classify({ railway: 'station', station: 'subway' })).toMatchObject({ category: 'transit', group: 'metro' });
    expect(classify({ railway: 'station' })).toMatchObject({ category: 'transit', group: 'rail' });
    expect(classify({ highway: 'bus_stop' })).toMatchObject({ category: 'transit', group: 'bus_stop' });
    expect(classify({ shop: 'supermarket' })).toMatchObject({ category: 'groceries', kind: 'Supermarket' });
    expect(classify({ leisure: 'park' })).toMatchObject({ category: 'parks' });
    expect(classify({ amenity: 'cafe' })).toMatchObject({ category: 'dining', kind: 'Cafe' });
  });

  it('skips private, closed and unbuilt features', () => {
    expect(classify({ amenity: 'school', access: 'private' })).toBeNull();
    expect(classify({ railway: 'construction', station: 'subway' })).toBeNull();
    expect(classify({ railway: 'station', 'construction:railway': 'station' })).toBeNull();
    expect(classify({ amenity: 'restaurant', 'disused:amenity': 'restaurant' })).toBeNull();
    expect(classify({ shop: 'clothes' })).toBeNull();
  });
});

describe('displayName', () => {
  it('prefers an English name and rejects generic or non-Latin names', () => {
    expect(displayName({ name: 'ಇಂದಿರಾನಗರ', 'name:en': 'Indiranagar' })).toBe('Indiranagar');
    expect(displayName({ name: 'ಇಂದಿರಾನಗರ' })).toBeNull();
    expect(displayName({ name: 'Bus Stop' })).toBeNull();
    expect(displayName({ name: '  Defence   Colony Park ' })).toBe('Defence Colony Park');
  });
});

describe('selectPlaces', () => {
  it('ranks by distance, merges same-name duplicates, and keeps pins apart', () => {
    const els = [
      node(12.975, 77.643, { amenity: 'cafe', name: 'Near Cafe' }),
      node(12.9751, 77.6431, { amenity: 'cafe', name: 'Crowded Cafe' }), // 15 m from the first
      node(12.978, 77.646, { amenity: 'cafe', name: 'Far Cafe' }),
      node(12.9781, 77.6461, { amenity: 'cafe', name: 'far cafe' }), // duplicate name
    ];
    const names = selectPlaces(toCandidates(els, ORIGIN)).map((p) => p.name);
    expect(names).toEqual(['Near Cafe', 'Far Cafe']);
  });

  it('always includes the nearest metro station in transit, ahead of bus stops', () => {
    const els = [
      node(12.9784, 77.6386, { railway: 'station', station: 'subway', name: 'Indiranagar' }),
      ...Array.from({ length: 10 }, (_, i) => node(12.9746 + i * 0.002, 77.6428, { highway: 'bus_stop', name: `Stop ${i}` })),
    ];
    const transit = selectPlaces(toCandidates(els, ORIGIN)).filter((p) => p.category === 'transit');
    expect(transit.some((p) => p.kind === 'Metro station')).toBe(true);
    expect(transit.filter((p) => p.kind === 'Bus stop').length).toBeLessThanOrEqual(4);
    expect(new Set(transit.map((p) => p.id)).size).toBe(transit.length);
    expect(transit[0]!.osmId).toMatch(/^node\/\d+$/);
  });
});
