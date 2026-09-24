import {
  OsmLookupResult,
  OsmPlacesService,
  OsmRouteSegment,
  OsmRouteSegmentLookup,
} from '@integrations/osm/services/osm-places.service';
import {
  DestinationAdminCompatibilityService,
  DestinationCompatibilityResult,
} from './destination-admin-compatibility.service';
import {
  TargetedRouteResolverService,
  TargetedRouteDestination,
} from './targeted-route-resolver.service';

const DESTINATION: TargetedRouteDestination = {
  name: 'Ciudad Autónoma de Buenos Aires',
  countryCode: 'AR',
  point: { latitude: -34.6037, longitude: -58.3816 },
  acquisitionRadiusMeters: 20000,
  boundary: { osmType: 'relation', osmId: 3082668, adminLevel: 4 },
};

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

const verdict = (
  v: DestinationCompatibilityResult['verdict'],
  reason: DestinationCompatibilityResult['reason'],
): DestinationCompatibilityResult => ({
  verdict: v,
  reason,
  candidateHierarchy: [],
});
const compatible = verdict('COMPATIBLE', 'WITHIN_DESTINATION_ADMIN_UNIT');
const incompatible = verdict('INCOMPATIBLE', 'OUTSIDE_DESTINATION_ADMIN_UNIT');
const unknown = verdict('UNKNOWN', 'ADMIN_LOOKUP_FAILED');

const found = (
  segments: OsmRouteSegment[],
): OsmLookupResult<OsmRouteSegmentLookup> => ({
  status: 'success',
  value: { rawCount: segments.length, segments, rejected: [] },
});

describe('TargetedRouteResolverService', () => {
  const build = (
    byName: Record<string, OsmLookupResult<OsmRouteSegmentLookup>>,
    compatibilityByLon: (longitude: number) => DestinationCompatibilityResult,
  ) => {
    const osmPlaces = {
      lookupHighwaysByName: jest.fn(
        async ({ name }: { name: string }) => byName[name] ?? found([]),
      ),
    };
    const compatibility = {
      evaluate: jest.fn(async (p: { longitude: number }) =>
        compatibilityByLon(p.longitude),
      ),
    };
    return {
      osmPlaces,
      compatibility,
      service: new TargetedRouteResolverService(
        osmPlaces as unknown as OsmPlacesService,
        compatibility as unknown as DestinationAdminCompatibilityService,
      ),
    };
  };
  const cabaIsWestOf = (lon: number) =>
    lon < -58.36 ? compatible : incompatible;

  it('acquires with a targeted, destination-centered highway-by-name lookup per retrieval variant', async () => {
    const { service, osmPlaces } = build(
      { Defensa: found([SAN_TELMO_A, SAN_TELMO_B]) },
      cabaIsWestOf,
    );

    const result = await service.resolve({
      name: 'Defensa Street',
      destination: DESTINATION,
    });

    expect(osmPlaces.lookupHighwaysByName.mock.calls).toEqual([
      [
        {
          name: 'Defensa Street',
          latitude: -34.6037,
          longitude: -58.3816,
          radiusMeters: 20000,
        },
      ],
      [
        {
          name: 'Defensa',
          latitude: -34.6037,
          longitude: -58.3816,
          radiusMeters: 20000,
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
    const { service } = build(
      { Defensa: found([SAN_TELMO_A, SAN_TELMO_B, AVELLANEDA]) },
      cabaIsWestOf,
    );

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
    const { service } = build(
      { Defensa: found([SAN_TELMO_A, SAN_TELMO_B, flores]) },
      () => compatible,
    );

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
    const { service } = build({ Defensa: found([AVELLANEDA]) }, cabaIsWestOf);

    const result = await service.resolve({
      name: 'Defensa',
      destination: DESTINATION,
    });

    expect(result.status).toBe('INCOMPATIBLE');
  });

  it('is NOT_FOUND when no variant acquires any route object (a POI name never becomes a ROUTE)', async () => {
    const { service, compatibility } = build({}, cabaIsWestOf);

    const result = await service.resolve({
      name: 'Plaza Dorrego',
      destination: DESTINATION,
    });

    expect(result.status).toBe('NOT_FOUND');
    expect(result.clusters).toEqual([]);
    expect(compatibility.evaluate).not.toHaveBeenCalled();
  });

  it('is UNAVAILABLE (never NOT_FOUND, never RESOLVED) when any variant lookup fails', async () => {
    const { service } = build(
      {
        'Defensa Street': {
          status: 'failed',
          value: { rawCount: 0, segments: [], rejected: [] },
          failureReason: 'timeout',
        },
        Defensa: found([SAN_TELMO_A]),
      },
      () => compatible,
    );

    const result = await service.resolve({
      name: 'Defensa Street',
      destination: DESTINATION,
    });

    expect(result.status).toBe('UNAVAILABLE');
    expect(result.reason).toBe('ACQUISITION_PROVIDER_FAILED');
  });

  it('never RESOLVES when destination compatibility is UNKNOWN for a cluster (fail closed)', async () => {
    const { service } = build({ Defensa: found([SAN_TELMO_A]) }, () => unknown);

    const result = await service.resolve({
      name: 'Defensa',
      destination: DESTINATION,
    });

    expect(result.status).toBe('AMBIGUOUS');
    expect(result.reason).toBe('DESTINATION_COMPATIBILITY_UNKNOWN');
  });

  it('deduplicates a way returned by both retrieval variants', async () => {
    const { service } = build(
      {
        'Pasaje San Lorenzo': found([SAN_TELMO_A]),
        'San Lorenzo': found([SAN_TELMO_A]),
      },
      () => compatible,
    );

    const result = await service.resolve({
      name: 'Pasaje San Lorenzo',
      destination: DESTINATION,
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.resolved?.segmentExternalIds).toEqual(['osm:way:48113515']);
  });

  it('stops evaluating a cluster at its first COMPATIBLE segment and reports the probe count', async () => {
    const { service, compatibility } = build(
      { Defensa: found([SAN_TELMO_A, SAN_TELMO_B]) },
      () => compatible,
    );

    const result = await service.resolve({
      name: 'Defensa',
      destination: DESTINATION,
    });

    expect(compatibility.evaluate).toHaveBeenCalledTimes(1);
    expect(result.adminLookupCount).toBe(1);
  });

  it('passes an explicit continuity gap through to segment grouping', async () => {
    const gapped = segment(
      99,
      'Defensa',
      [40, 41],
      [
        [-34.62718, -58.371],
        [-34.628, -58.371],
      ],
    );
    const { service } = build(
      { Defensa: found([SAN_TELMO_A, SAN_TELMO_B, gapped]) },
      () => compatible,
    );

    const strict = await service.resolve({
      name: 'Defensa',
      destination: DESTINATION,
    });
    const tolerant = await service.resolve({
      name: 'Defensa',
      destination: DESTINATION,
      continuityGapMeters: 60,
    });

    expect(strict.status).toBe('AMBIGUOUS');
    expect(tolerant.status).toBe('RESOLVED');
  });
});
