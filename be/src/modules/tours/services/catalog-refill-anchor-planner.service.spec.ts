import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { CatalogRefillAnchorPlanner } from './catalog-refill-anchor-planner.service';
import { DestinationResolution } from './destination-resolution.service';

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

const area = (
  id: number,
  longitude: number,
  latitude: number,
): OsmCandidate => ({
  id: `osm:relation:${id}`,
  name: `Area ${id}`,
  osmType: 'relation',
  osmId: id,
  geometry: { type: 'Point', coordinates: [longitude, latitude] },
  tags: { name: `Area ${id}`, admin_level: '9' },
});

describe('CatalogRefillAnchorPlanner', () => {
  const mockPrisma = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ count: BigInt(0) }]),
  } as any;
  const planner = new CatalogRefillAnchorPlanner(mockPrisma);

  beforeEach(() => {
    mockPrisma.$queryRawUnsafe.mockReset();
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: BigInt(0) }]);
  });

  it('keeps a point-scale destination to one bounded anchor', async () => {
    const anchors = await planner.plan({
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

  it('puts the selected in-boundary destination point first', async () => {
    const anchors = await planner.plan({
      destinationResolution: {
        scale: 'area',
        attemptedQueries: [],
        areaActivity: {} as any,
        boundary: {
          id: 'osm:relation:1',
          name: 'City',
          osmType: 'relation',
          osmId: 1,
          geometry: polygon(-3, -3, 3, 3),
          tags: { name: 'City', admin_level: '8' },
        },
      },
      destinationPoint: { latitude: 0, longitude: 0 },
      pointRadiusMeters: 12_000,
      coverageAreas: [area(10, 0.1, 0), area(20, 1, 0)],
    });

    expect(anchors[0]).toMatchObject({
      id: 'destination-point',
      source: 'destination_point',
      radiusMeters: 5_000,
    });
  });

  it('orders by POI density descending, tie-breaking by proximity and id', async () => {
    const destinationResolution: DestinationResolution = {
      scale: 'area' as const,
      attemptedQueries: [],
      areaActivity: {} as any,
      boundary: {
        id: 'osm:relation:1',
        name: 'City',
        osmType: 'relation' as const,
        osmId: 1,
        geometry: polygon(-3, -3, 3, 3),
        tags: { name: 'City', admin_level: '8' },
      },
    };
    const coverageAreas = [
      area(10, 0.1, 0), // closest ~11km
      area(20, 1, 0), // tied second ~111km
      area(30, -1, 0), // tied second ~111km
      area(40, 0, 2), // farthest ~222km
    ];

    const input = {
      destinationResolution,
      destinationPoint: { latitude: 0, longitude: 0 },
      pointRadiusMeters: 2_500,
    };

    const anchors = await planner.plan({ ...input, coverageAreas });

    // All Point geometries => POI density 0 for all.
    // selectByPOIDensity sorts by proximity to (0,0) with id tie-break.
    expect(anchors.map(({ id }) => id)).toEqual([
      'destination-point',
      'osm:relation:10',
      'osm:relation:20',
      'osm:relation:30',
      'osm:relation:40',
    ]);
  });

  it('deduplicates OSM identity and coordinates and excludes centers outside the parent', async () => {
    const duplicate = area(10, 1, 1);
    const sameCoordinates = area(11, 1, 1);
    const outside = area(12, 20, 20);

    mockPrisma.$queryRawUnsafe
      .mockReset()
      .mockResolvedValue([{ count: BigInt(0) }]);

    const anchors = await planner.plan({
      destinationResolution: {
        scale: 'area',
        attemptedQueries: [],
        areaActivity: {} as any,
        boundary: {
          id: 'osm:relation:1',
          name: 'City',
          osmType: 'relation',
          osmId: 1,
          geometry: polygon(-3, -3, 3, 3),
          tags: { name: 'City', admin_level: '8' },
        },
      },
      destinationPoint: { latitude: 0, longitude: 0 },
      pointRadiusMeters: 2_500,
      coverageAreas: [duplicate, { ...duplicate }, sameCoordinates, outside],
    });

    expect(anchors.map(({ id }) => id)).toEqual([
      'destination-point',
      'osm:relation:10',
    ]);
  });

  it('does not fabricate a minimum anchor quota when child areas are absent', async () => {
    const anchors = await planner.plan({
      destinationResolution: {
        scale: 'area',
        attemptedQueries: [],
        areaActivity: {} as any,
        boundary: {
          id: 'osm:relation:1',
          name: 'City',
          osmType: 'relation',
          osmId: 1,
          geometry: polygon(-3, -3, 3, 3),
          tags: { name: 'City', admin_level: '8' },
        },
      },
      destinationPoint: { latitude: 0, longitude: 0 },
      pointRadiusMeters: 2_500,
      coverageAreas: [],
    });

    expect(anchors).toHaveLength(1);
    expect(anchors[0].source).toBe('destination_point');
  });

  it('caps the complete plan at eight anchors', async () => {
    mockPrisma.$queryRawUnsafe
      .mockReset()
      .mockResolvedValue([{ count: BigInt(0) }]);
    const anchors = await planner.plan({
      destinationResolution: {
        scale: 'area',
        attemptedQueries: [],
        areaActivity: {} as any,
        boundary: {
          id: 'osm:relation:1',
          name: 'City',
          osmType: 'relation',
          osmId: 1,
          geometry: polygon(-20, -20, 20, 20),
          tags: { name: 'City', admin_level: '8' },
        },
      },
      destinationPoint: { latitude: 0, longitude: 0 },
      pointRadiusMeters: 2_500,
      coverageAreas: Array.from({ length: 20 }, (_, index) =>
        area(index + 10, index - 10, index % 3),
      ),
    });

    expect(anchors).toHaveLength(8);
  });
});
