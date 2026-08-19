import { overpassElementToGeoJson } from './osm-geometry.util';
import { OverpassElement } from '../interfaces/overpass.interface';

const pt = (lat: number, lon: number) => ({ lat, lon });

describe('overpassElementToGeoJson', () => {
  it('returns null for a node (no line/area geometry)', () => {
    const node: OverpassElement = { type: 'node', id: 1, lat: 0, lon: 0 };
    expect(overpassElementToGeoJson(node)).toBeNull();
  });

  it('returns null for a way with fewer than 2 points', () => {
    const way: OverpassElement = {
      type: 'way',
      id: 1,
      geometry: [pt(0, 0)],
    };
    expect(overpassElementToGeoJson(way)).toBeNull();
  });

  it('maps an open way to a LineString (a street, e.g. Caminito)', () => {
    const way: OverpassElement = {
      type: 'way',
      id: 1,
      geometry: [
        pt(-34.62, -58.37),
        pt(-34.621, -58.371),
        pt(-34.622, -58.372),
      ],
    };
    const result = overpassElementToGeoJson(way);
    expect(result?.type).toBe('LineString');
    expect(result?.coordinates).toEqual([
      [-58.37, -34.62],
      [-58.371, -34.621],
      [-58.372, -34.622],
    ]);
  });

  it('maps a closed way to a Polygon', () => {
    const way: OverpassElement = {
      type: 'way',
      id: 1,
      geometry: [pt(0, 0), pt(0, 1), pt(1, 1), pt(1, 0), pt(0, 0)],
    };
    const result = overpassElementToGeoJson(way);
    expect(result?.type).toBe('Polygon');
    if (result?.type === 'Polygon') {
      expect(result.coordinates).toHaveLength(1); // just the outer ring, no holes
      expect(result.coordinates[0][0]).toEqual(
        result.coordinates[0][result.coordinates[0].length - 1],
      );
    }
  });

  it('returns null for a relation with no outer members', () => {
    const relation: OverpassElement = {
      type: 'relation',
      id: 1,
      members: [
        { type: 'way', ref: 1, role: 'inner', geometry: [pt(0, 0), pt(0, 1)] },
      ],
    };
    expect(overpassElementToGeoJson(relation)).toBeNull();
  });

  it('a single outer ring split across two ways is stitched into one closed Polygon', () => {
    const relation: OverpassElement = {
      type: 'relation',
      id: 1,
      members: [
        {
          type: 'way',
          ref: 1,
          role: 'outer',
          geometry: [pt(0, 0), pt(0, 1), pt(1, 1)],
        },
        {
          type: 'way',
          ref: 2,
          role: 'outer',
          // Shares its start point with the first way's end point.
          geometry: [pt(1, 1), pt(1, 0), pt(0, 0)],
        },
      ],
    };

    const result = overpassElementToGeoJson(relation);
    expect(result?.type).toBe('Polygon');
    if (result?.type === 'Polygon') {
      expect(result.coordinates).toHaveLength(1);
      const ring = result.coordinates[0];
      expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
      expect(ring).toHaveLength(5); // 3 + 3 points, shared endpoint deduped once
    }
  });

  it('an outer ring with an inner ring inside it becomes a Polygon with a hole', () => {
    const outer = [pt(0, 0), pt(0, 10), pt(10, 10), pt(10, 0), pt(0, 0)];
    const inner = [pt(4, 4), pt(4, 6), pt(6, 6), pt(6, 4), pt(4, 4)];

    const relation: OverpassElement = {
      type: 'relation',
      id: 1,
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: outer },
        { type: 'way', ref: 2, role: 'inner', geometry: inner },
      ],
    };

    const result = overpassElementToGeoJson(relation);
    expect(result?.type).toBe('Polygon');
    if (result?.type === 'Polygon') {
      expect(result.coordinates).toHaveLength(2); // outer + 1 hole
    }
  });

  it('two disjoint outer rings (an exclave) become a MultiPolygon, one part per ring', () => {
    const ringA = [pt(0, 0), pt(0, 1), pt(1, 1), pt(1, 0), pt(0, 0)];
    const ringB = [pt(50, 50), pt(50, 51), pt(51, 51), pt(51, 50), pt(50, 50)];

    const relation: OverpassElement = {
      type: 'relation',
      id: 1,
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: ringA },
        { type: 'way', ref: 2, role: 'outer', geometry: ringB },
      ],
    };

    const result = overpassElementToGeoJson(relation);
    expect(result?.type).toBe('MultiPolygon');
    if (result?.type === 'MultiPolygon') {
      expect(result.coordinates).toHaveLength(2);
    }
  });

  it('assigns a hole to the outer ring that actually contains it, not just the first one', () => {
    const ringA = [pt(0, 0), pt(0, 1), pt(1, 1), pt(1, 0), pt(0, 0)];
    const ringB = [pt(50, 50), pt(50, 51), pt(51, 51), pt(51, 50), pt(50, 50)];
    // A hole inside ringB, not ringA.
    const hole = [
      pt(50.2, 50.2),
      pt(50.2, 50.3),
      pt(50.3, 50.3),
      pt(50.3, 50.2),
      pt(50.2, 50.2),
    ];

    const relation: OverpassElement = {
      type: 'relation',
      id: 1,
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: ringA },
        { type: 'way', ref: 2, role: 'outer', geometry: ringB },
        { type: 'way', ref: 3, role: 'inner', geometry: hole },
      ],
    };

    const result = overpassElementToGeoJson(relation);
    expect(result?.type).toBe('MultiPolygon');
    if (result?.type === 'MultiPolygon') {
      const partForA = result.coordinates[0];
      const partForB = result.coordinates[1];
      expect(partForA).toHaveLength(1); // no hole
      expect(partForB).toHaveLength(2); // outer + the hole
    }
  });
});
