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
  it('creates a closed polygon scope centered on the point', () => {
    const geometry = pointRadiusToGeometry(-33.01, -58.51, 5000) as {
      type: 'Polygon';
      coordinates: [number, number][][];
    };
    const ring = geometry.coordinates[0];
    expect(geometry.type).toBe('Polygon');
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[ring.length - 1]);

    // The ring's OWN vertices sit `radiusMeters` away from the center (see
    // the geodesic-radius tests below) -- a real 5km-radius polygon's first
    // vertex is NOT "close to" the center point, only the ring's centroid
    // is. Asserting the first vertex itself was close to center was a
    // stale expectation from before the radians->degrees unit-conversion
    // fix, when the polygon's real radius was ~57x too small.
    const centroidLon =
      ring.slice(0, -1).reduce((sum, [lon]) => sum + lon, 0) /
      (ring.length - 1);
    const centroidLat =
      ring.slice(0, -1).reduce((sum, [, lat]) => sum + lat, 0) /
      (ring.length - 1);
    expect(centroidLon).toBeCloseTo(-58.51, 2);
    expect(centroidLat).toBeCloseTo(-33.01, 2);
  });

  // Real-bug regression (radians→degrees unit conversion): the polygon's
  // OWN vertices must sit at the real-world geodesic distance requested,
  // not merely "some closed ring near the center". Distance is computed
  // independently here (a plain Haversine formula) rather than reusing any
  // internal helper from the module under test, so a regression in that
  // helper cannot silently pass its own regression test.
  const EARTH_RADIUS_METERS = 6371000;
  function haversineMeters(
    aLat: number,
    aLon: number,
    bLat: number,
    bLon: number,
  ): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLon = toRad(bLon - aLon);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  it('renders vertices at approximately the requested geodesic radius (5km, mid-latitude)', () => {
    const latitude = -34.6;
    const longitude = -58.4;
    const radiusMeters = 5000;
    const geometry = pointRadiusToGeometry(
      latitude,
      longitude,
      radiusMeters,
    ) as { type: 'Polygon'; coordinates: [number, number][][] };

    // Equirectangular/local-circle approximation, not an exact geodesic
    // circle -- a generous but real tolerance (5% of the requested radius),
    // wide enough for the approximation, narrow enough that the ~57.3x
    // (180/π) unit-conversion regression this guards against can never pass.
    const tolerance = radiusMeters * 0.05;
    for (const [lon, lat] of geometry.coordinates[0]) {
      const distance = haversineMeters(latitude, longitude, lat, lon);
      expect(distance).toBeGreaterThan(radiusMeters - tolerance);
      expect(distance).toBeLessThan(radiusMeters + tolerance);
    }
  });

  it('renders vertices at approximately the requested geodesic radius (12km)', () => {
    const latitude = -34.6212;
    const longitude = -58.373;
    const radiusMeters = 12000;
    const geometry = pointRadiusToGeometry(
      latitude,
      longitude,
      radiusMeters,
    ) as { type: 'Polygon'; coordinates: [number, number][][] };

    const tolerance = radiusMeters * 0.05;
    for (const [lon, lat] of geometry.coordinates[0]) {
      const distance = haversineMeters(latitude, longitude, lat, lon);
      expect(distance).toBeGreaterThan(radiusMeters - tolerance);
      expect(distance).toBeLessThan(radiusMeters + tolerance);
    }
  });

  it('compensates longitude spacing by latitude (a degree of longitude shrinks toward the poles)', () => {
    // At higher |latitude|, a degree of longitude covers less real-world
    // distance than a degree of latitude -- the polygon must still land at
    // the same real-world radius in every direction, proving
    // `lonRadiusDegrees`'s `cos(latitude)` compensation is real and not
    // itself broken by the same unit bug.
    const radiusMeters = 8000;
    const highLatitude = 60;
    const geometry = pointRadiusToGeometry(highLatitude, 10, radiusMeters) as {
      type: 'Polygon';
      coordinates: [number, number][][];
    };

    const tolerance = radiusMeters * 0.05;
    // East point (angle = 0 -> pure longitude offset) and north point
    // (angle = π/2 -> pure latitude offset) must both sit at ~radiusMeters.
    const east = geometry.coordinates[0][0];
    const north = geometry.coordinates[0][8]; // segments=32, quarter turn
    expect(
      haversineMeters(highLatitude, 10, highLatitude, east[0]),
    ).toBeGreaterThan(radiusMeters - tolerance);
    expect(
      haversineMeters(highLatitude, 10, highLatitude, east[0]),
    ).toBeLessThan(radiusMeters + tolerance);
    expect(haversineMeters(highLatitude, 10, north[1], 10)).toBeGreaterThan(
      radiusMeters - tolerance,
    );
    expect(haversineMeters(highLatitude, 10, north[1], 10)).toBeLessThan(
      radiusMeters + tolerance,
    );
  });

  it('remains a closed polygon after the unit-conversion fix', () => {
    const geometry = pointRadiusToGeometry(10, 20, 9000) as {
      type: 'Polygon';
      coordinates: [number, number][][];
    };
    expect(geometry.type).toBe('Polygon');
    expect(geometry.coordinates[0][0]).toEqual(
      geometry.coordinates[0][geometry.coordinates[0].length - 1],
    );
  });
});
