import {
  buildPointFootprint,
  footprintDistanceMeters,
} from './spatial-footprint.util';

describe('buildPointFootprint', () => {
  it('builds a POINT footprint from lat/lng', () => {
    expect(buildPointFootprint(-34.6, -58.4)).toEqual({
      type: 'POINT',
      centroid: { lat: -34.6, lng: -58.4 },
    });
  });
});

describe('footprintDistanceMeters', () => {
  it('returns 0 for identical points', () => {
    const a = buildPointFootprint(-34.6, -58.4);
    expect(footprintDistanceMeters(a, a)).toBe(0);
  });

  it('returns a positive distance in meters for distinct points', () => {
    const a = buildPointFootprint(-34.6037, -58.3816); // Buenos Aires
    const b = buildPointFootprint(-34.6158, -58.3734); // ~1.4km away
    const distance = footprintDistanceMeters(a, b);
    expect(distance).toBeGreaterThan(1000);
    expect(distance).toBeLessThan(2000);
  });
});
