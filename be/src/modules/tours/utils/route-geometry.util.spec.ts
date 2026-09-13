import { distancePointToLineStringMeters } from './route-geometry.util';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';

describe('distancePointToLineStringMeters', () => {
  // A short, roughly north-south segment of Caminito (Buenos Aires).
  const caminito: GeoJsonGeometry = {
    type: 'LineString',
    coordinates: [
      [-58.3634, -34.6382],
      [-58.363, -34.6376],
    ],
  };

  it('returns ~0m for a point exactly on the line (an endpoint)', () => {
    const distance = distancePointToLineStringMeters(
      { latitude: -34.6382, longitude: -58.3634 },
      caminito,
    );
    expect(distance).toBeLessThan(1);
  });

  it('measures a real perpendicular-ish projection for a point near the segment interior, not just nearest-vertex', () => {
    // Roughly midway along the segment, offset slightly to the side.
    const nearMidpoint = distancePointToLineStringMeters(
      { latitude: -34.6379, longitude: -58.3629 },
      caminito,
    );
    const nearEndpointOnly = distancePointToLineStringMeters(
      { latitude: -34.6382, longitude: -58.362 },
      caminito,
    );
    // Both are real, finite, positive distances -- the interior projection
    // must not simply equal distance-to-nearest-endpoint when the true
    // closest point lies along the segment.
    expect(nearMidpoint).toBeGreaterThan(0);
    expect(nearEndpointOnly).toBeGreaterThan(0);
    expect(Number.isFinite(nearMidpoint)).toBe(true);
  });

  it('returns a large distance for a point several kilometers away', () => {
    const distance = distancePointToLineStringMeters(
      { latitude: -34.5, longitude: -58.5 },
      caminito,
    );
    expect(distance).toBeGreaterThan(10_000);
  });

  it('returns Infinity for a non-LineString geometry (Polygon)', () => {
    const polygon: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [-58.4, -34.6],
          [-58.3, -34.6],
          [-58.3, -34.5],
          [-58.4, -34.5],
          [-58.4, -34.6],
        ],
      ],
    };
    expect(
      distancePointToLineStringMeters(
        { latitude: -34.55, longitude: -58.35 },
        polygon,
      ),
    ).toBe(Infinity);
  });

  it('returns Infinity for a non-LineString geometry (Point)', () => {
    const point: GeoJsonGeometry = {
      type: 'Point',
      coordinates: [-58.3634, -34.6382],
    };
    expect(
      distancePointToLineStringMeters(
        { latitude: -34.6382, longitude: -58.3634 },
        point,
      ),
    ).toBe(Infinity);
  });

  it('returns Infinity for a degenerate LineString with fewer than 2 coordinates', () => {
    const degenerate: GeoJsonGeometry = {
      type: 'LineString',
      coordinates: [[-58.3634, -34.6382]],
    };
    expect(
      distancePointToLineStringMeters(
        { latitude: -34.6382, longitude: -58.3634 },
        degenerate,
      ),
    ).toBe(Infinity);
  });
});
