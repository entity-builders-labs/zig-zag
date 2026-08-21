import { boundingBoxToCenterRadius } from './geometry-search-area.util';

describe('boundingBoxToCenterRadius', () => {
  it('centers on the midpoint of a Polygon bounding box', () => {
    const result = boundingBoxToCenterRadius({
      type: 'Polygon',
      coordinates: [[[-58.53, -34.70], [-58.33, -34.70], [-58.33, -34.53], [-58.53, -34.53], [-58.53, -34.70]]],
    });

    expect(result.latitude).toBeCloseTo(-34.615, 2);
    expect(result.longitude).toBeCloseTo(-58.43, 2);
    expect(result.radiusMeters).toBeGreaterThan(0);
  });

  it('covers every ring across a MultiPolygon (exclaves), not just the first', () => {
    const result = boundingBoxToCenterRadius({
      type: 'MultiPolygon',
      coordinates: [
        [[[-58.40, -34.60], [-58.39, -34.60], [-58.39, -34.59], [-58.40, -34.59], [-58.40, -34.60]]],
        [[[-58.30, -34.50], [-58.29, -34.50], [-58.29, -34.49], [-58.30, -34.49], [-58.30, -34.50]]],
      ],
    });

    // The radius must be large enough to span both disjoint exclaves, not
    // just the first polygon's own tiny bounding box.
    // First polygon alone would give ~668m radius; both polygons give ~7924m.
    expect(result.radiusMeters).toBeGreaterThan(7000);
  });

  it('returns a radius large enough that every corner is actually inside it', () => {
    const geometry: import('@integrations/osm/utils/osm-geometry.util').GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [[[-58.53, -34.70], [-58.33, -34.70], [-58.33, -34.53], [-58.53, -34.53], [-58.53, -34.70]]],
    };
    const { latitude, longitude, radiusMeters } = boundingBoxToCenterRadius(geometry);

    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371000;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };

    for (const [lon, lat] of geometry.coordinates[0]) {
      expect(haversine(latitude, longitude, lat, lon)).toBeLessThanOrEqual(radiusMeters + 1);
    }
  });
});
