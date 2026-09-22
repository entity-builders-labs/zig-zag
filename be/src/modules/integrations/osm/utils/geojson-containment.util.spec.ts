import {
  geometryContainsPoint,
  distancePointToPolygonBoundaryMeters,
} from './geojson-containment.util';
import { GeoJsonGeometry } from './osm-geometry.util';

describe('geometryContainsPoint', () => {
  it('accepts a point inside a polygon and rejects one outside', () => {
    const polygon: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
      ],
    };

    expect(geometryContainsPoint(polygon, 2, 2)).toBe(true);
    expect(geometryContainsPoint(polygon, 5, 2)).toBe(false);
  });

  it('rejects a point inside a polygon hole', () => {
    const polygonWithHole: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
          [0, 0],
        ],
        [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
          [1, 1],
        ],
      ],
    };

    expect(geometryContainsPoint(polygonWithHole, 2, 2)).toBe(false);
    expect(geometryContainsPoint(polygonWithHole, 4, 4)).toBe(true);
  });

  it('does not treat points or lines as containment boundaries', () => {
    expect(
      geometryContainsPoint({ type: 'Point', coordinates: [1, 2] }, 1, 2),
    ).toBe(false);
    expect(
      geometryContainsPoint(
        {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        0.5,
        0.5,
      ),
    ).toBe(false);
  });
});

describe('distancePointToPolygonBoundaryMeters', () => {
  const squarePolygon: GeoJsonGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  };

  it('returns 0 for a point inside the polygon', () => {
    expect(distancePointToPolygonBoundaryMeters(squarePolygon, 5, 5)).toBe(0);
  });

  it('returns 0 for a point on the polygon boundary', () => {
    expect(distancePointToPolygonBoundaryMeters(squarePolygon, 5, 0)).toBe(0);
    expect(distancePointToPolygonBoundaryMeters(squarePolygon, 10, 5)).toBe(0);
  });

  it('returns positive finite meters for a point just outside the polygon', () => {
    const distance = distancePointToPolygonBoundaryMeters(squarePolygon, 11, 5);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(120_000); // ~1 degree at this latitude
    expect(Number.isFinite(distance)).toBe(true);
  });

  it('returns larger distance for a point farther outside', () => {
    const near = distancePointToPolygonBoundaryMeters(squarePolygon, 11, 5);
    const far = distancePointToPolygonBoundaryMeters(squarePolygon, 20, 5);
    expect(far).toBeGreaterThan(near);
  });

  it('handles MultiPolygon by returning minimum distance', () => {
    const multiPolygon: GeoJsonGeometry = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
            [0, 0],
          ],
        ],
        [
          [
            [20, 20],
            [24, 20],
            [24, 24],
            [20, 24],
            [20, 20],
          ],
        ],
      ],
    };

    // Point near first polygon
    const d1 = distancePointToPolygonBoundaryMeters(multiPolygon, 2, 5);
    // Point near second polygon
    const d2 = distancePointToPolygonBoundaryMeters(multiPolygon, 22, 22);

    expect(d1).toBeGreaterThan(0);
    expect(d1).toBeLessThan(120_000);
    expect(d2).toBe(0); // inside second polygon
  });

  it('handles polygon with hole correctly', () => {
    const polygonWithHole: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
          [3, 3],
        ],
      ],
    };

    // Point in hole: outside the polygon, distance to hole boundary
    const holeDistance = distancePointToPolygonBoundaryMeters(
      polygonWithHole,
      5,
      5,
    );
    expect(holeDistance).toBeGreaterThan(0);

    // Point inside outer ring but outside hole: inside polygon
    expect(distancePointToPolygonBoundaryMeters(polygonWithHole, 2, 2)).toBe(0);

    // Point outside outer ring
    const outerDistance = distancePointToPolygonBoundaryMeters(
      polygonWithHole,
      15,
      5,
    );
    expect(outerDistance).toBeGreaterThan(0);
  });

  it('returns Infinity for non-polygon geometries', () => {
    expect(
      distancePointToPolygonBoundaryMeters(
        { type: 'Point', coordinates: [1, 2] },
        1,
        2,
      ),
    ).toBe(Infinity);
    expect(
      distancePointToPolygonBoundaryMeters(
        {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        0.5,
        0.5,
      ),
    ).toBe(Infinity);
  });

  it('returns finite deterministic meters for all finite points', () => {
    const distances = [
      distancePointToPolygonBoundaryMeters(squarePolygon, -180, -90),
      distancePointToPolygonBoundaryMeters(squarePolygon, 180, 90),
      distancePointToPolygonBoundaryMeters(squarePolygon, 0, 0),
    ];
    for (const d of distances) {
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });
});
