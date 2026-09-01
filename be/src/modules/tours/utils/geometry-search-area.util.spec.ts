import {
  boundingBoxToCenterRadius,
  pointRadiusToGeometry,
} from './geometry-search-area.util';

describe('boundingBoxToCenterRadius', () => {
  it('centers on the midpoint of a Polygon bounding box', () => {
    const result = boundingBoxToCenterRadius({
      type: 'Polygon',
      coordinates: [
        [
          [-58.53, -34.7],
          [-58.33, -34.7],
          [-58.33, -34.53],
          [-58.53, -34.53],
          [-58.53, -34.7],
        ],
      ],
    });

    expect(result.latitude).toBeCloseTo(-34.615, 2);
    expect(result.longitude).toBeCloseTo(-58.43, 2);
    expect(result.radiusMeters).toBeGreaterThan(0);
  });

  it('covers every ring across a MultiPolygon (exclaves), not just the first', () => {
    const result = boundingBoxToCenterRadius({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [-58.4, -34.6],
            [-58.39, -34.6],
            [-58.39, -34.59],
            [-58.4, -34.59],
            [-58.4, -34.6],
          ],
        ],
        [
          [
            [-58.3, -34.5],
            [-58.29, -34.5],
            [-58.29, -34.49],
            [-58.3, -34.49],
            [-58.3, -34.5],
          ],
        ],
      ],
    });

    // The radius must be large enough to span both disjoint exclaves, not
    // just the first polygon's own tiny bounding box.
    // First polygon alone would give ~668m radius; both polygons give ~7924m.
    expect(result.radiusMeters).toBeGreaterThan(7000);
  });

  it('returns a radius large enough that every corner is actually inside it', () => {
    const geometry: import('@integrations/osm/utils/osm-geometry.util').GeoJsonGeometry =
      {
        type: 'Polygon',
        coordinates: [
          [
            [-58.53, -34.7],
            [-58.33, -34.7],
            [-58.33, -34.53],
            [-58.53, -34.53],
            [-58.53, -34.7],
          ],
        ],
      };
    const { latitude, longitude, radiusMeters } =
      boundingBoxToCenterRadius(geometry);

    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const haversine = (
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number,
    ) => {
      const R = 6371000;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };

    for (const [lon, lat] of geometry.coordinates[0]) {
      expect(haversine(latitude, longitude, lat, lon)).toBeLessThanOrEqual(
        radiusMeters + 1,
      );
    }
  });

  it('covers all bounding box corners for non-rectangular geometries', () => {
    // Diamond-shaped polygon where northernmost and easternmost points are different vertices
    // The bbox corners can be farther than any single geometry vertex
    const geometry: import('@integrations/osm/utils/osm-geometry.util').GeoJsonGeometry =
      {
        type: 'Polygon',
        coordinates: [
          [
            [-58.4, -34.55], // west
            [-58.35, -34.6], // south
            [-58.3, -34.55], // east
            [-58.35, -34.5], // north
            [-58.4, -34.55], // close ring
          ],
        ],
      };
    const { latitude, longitude, radiusMeters } =
      boundingBoxToCenterRadius(geometry);

    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const haversine = (
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number,
    ) => {
      const R = 6371000;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };

    // Test that all 4 bbox corners are covered
    const bboxCorners = [
      [-58.4, -34.6], // southwest
      [-58.4, -34.5], // northwest
      [-58.3, -34.6], // southeast
      [-58.3, -34.5], // northeast
    ];

    for (const [lon, lat] of bboxCorners) {
      expect(haversine(latitude, longitude, lat, lon)).toBeLessThanOrEqual(
        radiusMeters + 1,
      );
    }
  });
});

describe('pointRadiusToGeometry', () => {
  it('creates a closed polygon scope around a point', () => {
    const geometry = pointRadiusToGeometry(-33.01, -58.51, 5000) as {
      type: 'Polygon';
      coordinates: [number, number][][];
    };
    expect(geometry.type).toBe('Polygon');
    expect(geometry.coordinates[0]).toHaveLength(33);
    expect(geometry.coordinates[0][0]).toEqual(
      geometry.coordinates[0][geometry.coordinates[0].length - 1],
    );
    expect(geometry.coordinates[0][0][0]).toBeCloseTo(-58.51, 2);
    expect(geometry.coordinates[0][0][1]).toBeCloseTo(-33.01, 2);
  });
});
