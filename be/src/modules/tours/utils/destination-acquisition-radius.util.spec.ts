import { destinationAcquisitionRadiusMeters } from './destination-acquisition-radius.util';

describe('destinationAcquisitionRadiusMeters', () => {
  const point = { latitude: -34.6, longitude: -58.4 };

  it('covers the whole destination boundary: distance from the point to its farthest bbox corner', () => {
    // bbox corners ~0.1 deg away in both axes -> ~14.5 km at this latitude.
    const radius = destinationAcquisitionRadiusMeters(point, {
      type: 'Polygon',
      coordinates: [
        [
          [-58.5, -34.7],
          [-58.3, -34.7],
          [-58.3, -34.5],
          [-58.5, -34.5],
          [-58.5, -34.7],
        ],
      ],
    });

    expect(radius).toBeGreaterThan(14_000);
    expect(radius).toBeLessThan(15_000);
  });

  it('uses every MultiPolygon ring', () => {
    const radius = destinationAcquisitionRadiusMeters(point, {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [-58.41, -34.61],
            [-58.39, -34.61],
            [-58.39, -34.59],
            [-58.41, -34.61],
          ],
        ],
        [
          [
            [-58.6, -34.6],
            [-58.59, -34.6],
            [-58.59, -34.59],
            [-58.6, -34.6],
          ],
        ],
      ],
    });

    expect(radius).toBeGreaterThan(18_000);
  });

  it('is undefined (unknown, not a guessed default) without an area boundary', () => {
    expect(
      destinationAcquisitionRadiusMeters(point, undefined),
    ).toBeUndefined();
    expect(
      destinationAcquisitionRadiusMeters(point, {
        type: 'Point',
        coordinates: [-58.4, -34.6],
      }),
    ).toBeUndefined();
  });

  it('is capped at the shared 50 km destination scale', () => {
    const radius = destinationAcquisitionRadiusMeters(point, {
      type: 'Polygon',
      coordinates: [
        [
          [-60, -36],
          [-57, -36],
          [-57, -33],
          [-60, -36],
        ],
      ],
    });

    expect(radius).toBe(50_000);
  });
});
