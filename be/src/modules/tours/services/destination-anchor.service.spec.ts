import { DestinationAnchorService } from './destination-anchor.service';

const polygon = (
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [minLon, minLat] as [number, number],
      [maxLon, minLat] as [number, number],
      [maxLon, maxLat] as [number, number],
      [minLon, maxLat] as [number, number],
      [minLon, minLat] as [number, number],
    ],
  ],
});

describe('DestinationAnchorService', () => {
  const service = new DestinationAnchorService();

  it('keeps a point-scale destination to one bounded anchor', () => {
    const anchors = service.buildAnchors({
      destinationResolution: { scale: 'point', attemptedQueries: [] },
      destinationPoint: { latitude: -34.6, longitude: -58.4 },
      pointRadiusMeters: 20_000,
    });

    expect(anchors).toEqual([
      expect.objectContaining({
        source: 'destination_point',
        latitude: -34.6,
        longitude: -58.4,
        radiusMeters: 5_000,
      }),
    ]);
  });

  it('uses shortlisted real neighborhoods plus the in-boundary destination point', () => {
    const destinationBoundary = {
      id: 'osm:relation:1',
      name: 'Sevilla',
      osmType: 'relation' as const,
      osmId: 1,
      geometry: polygon(-6.1, 37.3, -5.8, 37.5),
      tags: { name: 'Sevilla' },
    };
    const neighborhoods = [
      ['Casco Antiguo', -6.0, 37.38],
      ['Triana', -6.01, 37.39],
      ['Macarena', -5.98, 37.41],
      ['Los Remedios', -6.0, 37.37],
    ].map(([name, longitude, latitude], index) => ({
      id: `osm:relation:${index + 10}`,
      name: name as string,
      osmType: 'relation' as const,
      osmId: index + 10,
      geometry: {
        type: 'Point' as const,
        coordinates: [longitude as number, latitude as number] as [
          number,
          number,
        ],
      },
      tags: { name: name as string },
    }));

    const anchors = service.buildAnchors({
      destinationResolution: {
        scale: 'area',
        attemptedQueries: [],
        areaActivity: {} as any,
        boundary: destinationBoundary,
      },
      destinationPoint: { latitude: 37.389, longitude: -5.984 },
      pointRadiusMeters: 12_000,
      shortlistedNeighborhoods: neighborhoods,
    });

    expect(anchors.map((anchor) => anchor.label)).toEqual([
      'Casco Antiguo',
      'Triana',
      'Macarena',
      'Los Remedios',
      'Sevilla',
    ]);
    expect(anchors.every((anchor) => anchor.radiusMeters <= 5_000)).toBe(true);
  });

  it('does not include a destination point outside the authoritative boundary', () => {
    const boundary = {
      id: 'osm:relation:1',
      name: 'City',
      osmType: 'relation' as const,
      osmId: 1,
      geometry: polygon(0, 0, 4, 4),
      tags: { name: 'City' },
    };
    const neighborhood = {
      id: 'osm:relation:2',
      name: 'Center',
      osmType: 'relation' as const,
      osmId: 2,
      geometry: {
        type: 'Point' as const,
        coordinates: [2, 2] as [number, number],
      },
      tags: { name: 'Center' },
    };

    const anchors = service.buildAnchors({
      destinationResolution: {
        scale: 'area',
        attemptedQueries: [],
        areaActivity: {} as any,
        boundary,
      },
      destinationPoint: { latitude: 10, longitude: 10 },
      pointRadiusMeters: 3_000,
      shortlistedNeighborhoods: [neighborhood],
    });

    expect(anchors).toHaveLength(1);
    expect(anchors[0].label).toBe('Center');
  });
});
