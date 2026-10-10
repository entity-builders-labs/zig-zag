import {
  OsmLookupResult,
  OsmPlacesService,
  OsmRouteSegment,
  OsmRouteSegmentLookup,
} from '@integrations/osm/services/osm-places.service';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { boundingBoxToCenterRadius } from '../utils/geometry-search-area.util';
import { TargetedRouteResolverService } from './targeted-route-resolver.service';

// Destination admin boundary: covers San Telmo (lon < -58.36) and Flores,
// excludes Avellaneda (lon -58.35).
const DESTINATION: GeographicScope = {
  kind: 'AREA_BOUNDARY',
  boundary: {
    id: 'osm:relation:1224652',
    name: 'Buenos Aires',
    osmType: 'relation',
    osmId: 1224652,
    tags: { boundary: 'administrative', admin_level: '8' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-58.53, -34.71],
          [-58.36, -34.71],
          [-58.36, -34.53],
          [-58.53, -34.53],
          [-58.53, -34.71],
        ],
      ],
    },
  },
};
const ACQUISITION = boundingBoxToCenterRadius(
  (DESTINATION as any).boundary.geometry,
);

const segment = (
  osmId: number,
  name: string,
  nodes: number[],
  points: Array<[number, number]>,
): OsmRouteSegment => ({
  externalId: `osm:way:${osmId}`,
  osmId,
  name,
  highway: 'residential',
  nodes,
  geometry: points.map(([lat, lon]) => ({ lat, lon })),
});

// San Telmo "Defensa" (two connected ways) and an Avellaneda "Defensa".
const SAN_TELMO_A = segment(
  48113515,
  'Defensa',
  [1, 2],
  [
    [-34.625, -58.371],
    [-34.626, -58.371],
  ],
);
const SAN_TELMO_B = segment(
  47521381,
  'Defensa',
  [2, 3],
  [
    [-34.626, -58.371],
    [-34.627, -58.371],
  ],
);
const AVELLANEDA = segment(
  163761817,
  'Defensa',
  [7, 8],
  [
    [-34.645, -58.35],
    [-34.646, -58.35],
  ],
);

const found = (
  segments: OsmRouteSegment[],
): OsmLookupResult<OsmRouteSegmentLookup> => ({
  status: 'success',
  value: { rawCount: segments.length, segments, rejected: [] },
});

describe('TargetedRouteResolverService', () => {
  const build = (
    byName: Record<string, OsmLookupResult<OsmRouteSegmentLookup>>,
  ) => {
    const osmPlaces = {
      lookupHighwaysByName: jest.fn(
        async ({ name }: { name: string }) => byName[name] ?? found([]),
      ),
    };
    return {
      osmPlaces,
      service: new TargetedRouteResolverService(
        osmPlaces as unknown as OsmPlacesService,
      ),
    };
  };

  it('acquires with a targeted highway-by-name lookup per retrieval variant, centered on and covering the DESTINATION boundary', async () => {
    const { service, osmPlaces } = build({
      Defensa: found([SAN_TELMO_A, SAN_TELMO_B]),
    });

    const result = await service.resolve({
      name: 'Defensa Street',
      destination: DESTINATION,
    });

    expect(osmPlaces.lookupHighwaysByName.mock.calls).toEqual([
      [
        {
          name: 'Defensa Street',
          latitude: ACQUISITION.latitude,
          longitude: ACQUISITION.longitude,
          radiusMeters: Math.ceil(ACQUISITION.radiusMeters),
        },
      ],
      [
        {
          name: 'Defensa',
          latitude: ACQUISITION.latitude,
          longitude: ACQUISITION.longitude,
          radiusMeters: Math.ceil(ACQUISITION.radiusMeters),
        },
      ],
    ]);
    expect(result.variants).toEqual([
      expect.objectContaining({
        variant: 'RAW',
        name: 'Defensa Street',
        rawCount: 0,
      }),
      expect.objectContaining({
        variant: 'DESIGNATOR_NORMALIZED',
        name: 'Defensa',
        rawCount: 2,
        acceptedCount: 2,
      }),
    ]);
    expect(result.acquisitionQueryCount).toBe(2);
  });

  it('RESOLVES one real multi-way street inside the destination, excluding a same-name street in another admin unit', async () => {
    const { service } = build({
      Defensa: found([SAN_TELMO_A, SAN_TELMO_B, AVELLANEDA]),
    });

    const result = await service.resolve({
      name: 'Defensa',
      destination: DESTINATION,
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.resolved?.segmentExternalIds).toEqual([
      'osm:way:47521381',
      'osm:way:48113515',
    ]);
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters.map((c) => c.compatibility.verdict).sort()).toEqual([
      'COMPATIBLE',
      'INCOMPATIBLE',
    ]);
  });

  it('is AMBIGUOUS for two disconnected same-name clusters both inside the destination -- never picks by proximity', async () => {
    const flores = segment(
      908381626,
      'Defensa',
      [50, 51],
      [
        [-34.65, -58.44],
        [-34.651, -58.44],
      ],
    );
    const { service } = build({
      Defensa: found([SAN_TELMO_A, SAN_TELMO_B, flores]),
    });

    const result = await service.resolve({
      name: 'Defensa',
      destination: DESTINATION,
    });

    expect(result.status).toBe('AMBIGUOUS');
    expect(result.reason).toBe('MULTIPLE_COMPATIBLE_CLUSTERS');
    expect(result.resolved).toBeUndefined();
    expect(result.compatibleClusterCount).toBe(2);
  });

  it('is INCOMPATIBLE (not RESOLVED) when every acquired cluster is outside the destination admin unit', async () => {
    const { service } = build({ Defensa: found([AVELLANEDA]) });

    const result = await service.resolve({
      name: 'Defensa',
      destination: DESTINATION,
    });

    expect(result.status).toBe('INCOMPATIBLE');
  });

  it('is NOT_FOUND when no variant acquires any route object (a POI name never becomes a ROUTE)', async () => {
    const { service } = build({});

    const result = await service.resolve({
      name: 'Plaza Dorrego',
      destination: DESTINATION,
    });

    expect(result.status).toBe('NOT_FOUND');
    expect(result.clusters).toEqual([]);
  });

  it('is UNAVAILABLE (never NOT_FOUND, never RESOLVED) when any variant lookup fails', async () => {
    const { service } = build({
      'Defensa Street': {
        status: 'failed',
        value: { rawCount: 0, segments: [], rejected: [] },
        failureReason: 'timeout',
      },
      Defensa: found([SAN_TELMO_A]),
    });

    const result = await service.resolve({
      name: 'Defensa Street',
      destination: DESTINATION,
    });

    expect(result.status).toBe('UNAVAILABLE');
    expect(result.reason).toBe('ACQUISITION_PROVIDER_FAILED');
  });

  it('never RESOLVES for a point-scale destination: compatibility is UNKNOWN without an admin boundary (fail closed)', async () => {
    const { service, osmPlaces } = build({ Defensa: found([SAN_TELMO_A]) });

    const result = await service.resolve({
      name: 'Defensa',
      destination: {
        kind: 'POINT_RADIUS',
        latitude: -34.62,
        longitude: -58.37,
        radiusMeters: 5000,
      },
    });

    expect(osmPlaces.lookupHighwaysByName).toHaveBeenCalledWith({
      name: 'Defensa',
      latitude: -34.62,
      longitude: -58.37,
      radiusMeters: 5000,
    });

    expect(result.status).toBe('AMBIGUOUS');
    expect(result.reason).toBe('DESTINATION_COMPATIBILITY_UNKNOWN');
  });

  it('deduplicates a way returned by both retrieval variants', async () => {
    const { service } = build({
      'Pasaje San Lorenzo': found([SAN_TELMO_A]),
      'San Lorenzo': found([SAN_TELMO_A]),
    });

    const result = await service.resolve({
      name: 'Pasaje San Lorenzo',
      destination: DESTINATION,
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.resolved?.segmentExternalIds).toEqual(['osm:way:48113515']);
  });

  it('decides compatibility from the hydrated destination boundary -- no admin lookup network call at all', async () => {
    const { service, osmPlaces } = build({
      Defensa: found([SAN_TELMO_A, SAN_TELMO_B, AVELLANEDA]),
    });

    const result = await service.resolve({
      name: 'Defensa',
      destination: DESTINATION,
    });

    expect(result.status).toBe('RESOLVED');
    expect(osmPlaces.lookupHighwaysByName).toHaveBeenCalledTimes(1);
    expect(Object.keys(osmPlaces)).toEqual(['lookupHighwaysByName']);
  });

  it("carries each segment's real geometry for MultiLineString persistence, never a synthetic joined line", async () => {
    const { service } = build({ Defensa: found([SAN_TELMO_A, SAN_TELMO_B]) });

    const result = await service.resolve({
      name: 'Defensa',
      destination: DESTINATION,
    });

    expect(result.resolved?.segments.map((s) => s.coordinates)).toEqual([
      [
        [-58.371, -34.626],
        [-58.371, -34.627],
      ],
      [
        [-58.371, -34.625],
        [-58.371, -34.626],
      ],
    ]);
  });
});
