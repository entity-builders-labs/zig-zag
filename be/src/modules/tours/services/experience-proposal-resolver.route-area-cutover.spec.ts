import { withDefaultGeographicAuthorization } from '../utils/geographic-validation-authorization.util';
import { GeoEntityKind } from '@prisma/client';
import {
  OsmLookupResult,
  OsmRouteSegment,
  OsmRouteSegmentLookup,
} from '@integrations/osm/services/osm-places.service';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { ExperienceProposalResolverService } from './experience-proposal-resolver.service';

/**
 * Stage 3 production cutover -- ROUTE (catalog-first -> targeted OSM
 * acquisition -> strong-identity correlation -> IdentityVerifier ->
 * multi-identity persistence) and AREA destination compatibility.
 */

// Destination admin boundary ("Buenos Aires", admin_level 8): covers San
// Telmo/Flores, excludes Avellaneda (lon > -58.36) and the Partido de San
// Martín (lat > -34.53).
const DESTINATION_BOUNDARY = {
  id: 'osm:relation:1224652',
  name: 'Buenos Aires',
  osmType: 'relation' as const,
  osmId: 1224652,
  tags: { boundary: 'administrative', admin_level: '8' },
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-58.53, -34.71],
        [-58.36, -34.71],
        [-58.36, -34.53],
        [-58.53, -34.53],
        [-58.53, -34.71],
      ],
    ] as [number, number][][],
  },
};
const DESTINATION: GeographicScope = {
  kind: 'AREA_BOUNDARY',
  boundary: DESTINATION_BOUNDARY,
};
// A narrower entity-resolution anchor (San Telmo) -- never the ROUTE scope.
const SAN_TELMO_ANCHOR: GeographicScope = {
  kind: 'AREA_BOUNDARY',
  boundary: {
    id: 'osm:relation:2223069',
    name: 'San Telmo',
    osmType: 'relation',
    osmId: 2223069,
    tags: { boundary: 'administrative', admin_level: '9' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-58.38, -34.63],
          [-58.365, -34.63],
          [-58.365, -34.61],
          [-58.38, -34.61],
          [-58.38, -34.63],
        ],
      ],
    },
  },
};

const segment = (
  osmId: number,
  nodes: number[],
  points: Array<[number, number]>,
  name = 'Defensa',
): OsmRouteSegment => ({
  externalId: `osm:way:${osmId}`,
  osmId,
  name,
  highway: 'residential',
  nodes,
  geometry: points.map(([lat, lon]) => ({ lat, lon })),
});
const DEFENSA_A = segment(
  48113515,
  [1, 2],
  [
    [-34.625, -58.371],
    [-34.626, -58.371],
  ],
);
const DEFENSA_B = segment(
  47521381,
  [2, 3],
  [
    [-34.626, -58.371],
    [-34.627, -58.371],
  ],
);
const DEFENSA_AVELLANEDA = segment(
  163761817,
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

const routeCandidate = (hintName: string) => ({
  name: 'San Telmo Self-Guided Historical Walk',
  themes: ['history'],
  traits: [] as string[],
  intents: ['walk'],
  componentHints: [
    {
      key: 'street',
      name: hintName,
      role: 'route' as const,
      expectedKind: 'ROUTE' as const,
      evidenceKeys: ['ev-1'],
    },
  ],
  evidenceKeys: ['ev-1'],
  shortReason: 'source-backed walk',
});

const areaCandidate = (hintName: string) => ({
  name: 'Walk',
  themes: ['history'],
  traits: [] as string[],
  intents: ['walk'],
  componentHints: [
    {
      key: 'area',
      name: hintName,
      role: 'area' as const,
      expectedKind: 'AREA' as const,
      evidenceKeys: ['ev-1'],
    },
  ],
  evidenceKeys: ['ev-1'],
  shortReason: 'source-backed walk',
});

function build(
  options: {
    highways?: Record<string, OsmLookupResult<OsmRouteSegmentLookup>>;
    catalogByName?: Record<string, any[]>;
    knownGeoEntityIds?: string[];
    upsertResult?: any;
    nominatimResults?: any[];
    boundaryById?: any;
  } = {},
) {
  const osmPlaces = {
    lookupHighwaysByName: jest.fn(
      async ({ name }: { name: string }) =>
        options.highways?.[name] ?? found([]),
    ),

    lookupPoisNear: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupPoisWithin: jest
      .fn()
      .mockResolvedValue({ status: 'success', value: [] }),
    lookupBoundaryById: jest.fn().mockResolvedValue({
      status: 'success',
      value: options.boundaryById,
    }),
  };
  const catalog = {
    findGeoEntityCandidatesForHint: jest.fn(
      async ({ hintName }: { hintName: string }) => ({
        candidates: options.catalogByName?.[hintName] ?? [],
      }),
    ),
    findGeoEntityIdsByIdentities: jest
      .fn()
      .mockResolvedValue(options.knownGeoEntityIds ?? []),
    upsertGeoEntityWithIdentities: jest.fn().mockResolvedValue(
      options.upsertResult ?? {
        status: 'CREATED',
        geoEntity: { id: 'geo-defensa' },
        attachedExternalIds: [],
      },
    ),
    upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-area' }),
    resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
    persistVerifiedExperience: jest
      .fn()
      .mockResolvedValue({ id: 'exp-1', dedupeDecision: 'NEW' }),
  };
  const nominatim = {
    search: jest.fn().mockResolvedValue(options.nominatimResults ?? []),
  };
  const wikidata = {
    getEntitySummaries: jest.fn(),
    findNearbyPlaces: jest.fn().mockResolvedValue([]),
  };
  const geographicValidator = {
    validate: jest.fn().mockReturnValue({ accepted: true }),
  };
  const service = new ExperienceProposalResolverService(
    osmPlaces as any,
    catalog as any,
    geographicValidator as any,
    undefined,
    nominatim as any,
    undefined,
    wikidata as any,
  );
  return { service, osmPlaces, catalog, nominatim, wikidata };
}

const componentAudit = (result: any) =>
  result.entityResolution.forensicAudit[0].componentAudits[0];
const resolvedEntity = (result: any) => result.resolved[0].resolvedEntities[0];

describe('ExperienceProposalResolverService -- Stage 3 ROUTE/AREA cutover', () => {
  describe('ROUTE', () => {
    it('catalog miss -> TARGETED_ROUTE over the DESTINATION -> persists ONE GeoEntity with every segment identity; no street pool, Nominatim, or Wikidata', async () => {
      const { service, osmPlaces, catalog, nominatim, wikidata } = build({
        highways: {
          Defensa: found([DEFENSA_A, DEFENSA_B, DEFENSA_AVELLANEDA]),
        },
      });

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        destinationCountryCode: 'AR',
        geographicScope: DESTINATION,
        entityResolutionScope: SAN_TELMO_ANCHOR,
        candidates: withDefaultGeographicAuthorization([
          routeCandidate('Defensa Street'),
        ]),
      } as any);

      // One targeted lookup per bounded retrieval variant, nothing else.
      expect(
        osmPlaces.lookupHighwaysByName.mock.calls.map(
          ([query]: any[]) => query.name,
        ),
      ).toEqual(['Defensa Street', 'Defensa']);
      expect(nominatim.search).not.toHaveBeenCalled();
      expect(wikidata.getEntitySummaries).not.toHaveBeenCalled();
      expect(wikidata.findNearbyPlaces).not.toHaveBeenCalled();
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();

      expect(catalog.findGeoEntityIdsByIdentities).toHaveBeenCalledWith(
        'openstreetmap',
        ['osm:way:47521381', 'osm:way:48113515'],
      );
      expect(catalog.upsertGeoEntityWithIdentities).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Defensa',
          kind: GeoEntityKind.ROUTE,
          identities: [
            { provider: 'openstreetmap', externalId: 'osm:way:47521381' },
            { provider: 'openstreetmap', externalId: 'osm:way:48113515' },
          ],
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [-58.371, -34.626],
                [-58.371, -34.627],
              ],
              [
                [-58.371, -34.625],
                [-58.371, -34.626],
              ],
            ],
          },
        }),
      );
      expect(resolvedEntity(result)).toMatchObject({
        status: 'resolved',
        geoEntityId: 'geo-defensa',
        canonicalName: 'Defensa',
      });
      const audit = componentAudit(result);
      expect(audit.attempts.map((a: any) => a.strategy)).toEqual([
        'CATALOG_REUSE',
        'TARGETED_ROUTE',
      ]);
      const targeted = audit.attempts[1];
      expect(targeted.verificationDecision).toBe('VERIFIED');
      expect(targeted.identityEvidence).toContainEqual({
        type: 'STRUCTURED_ROUTE_RESOLUTION',
        provider: 'openstreetmap',
        segmentExternalIds: ['osm:way:47521381', 'osm:way:48113515'],
        destinationCompatibility: 'COMPATIBLE',
        ambiguity: 'SINGLE_CLUSTER',
      });
      expect(targeted.routeResolution).toMatchObject({
        status: 'RESOLVED',
        clusterCount: 2,
        compatibleClusterCount: 1,
        resolvedSegmentCount: 2,
        knownGeoEntityCount: 0,
      });
    });

    it('strong-identity correlation: segments already owned by TWO GeoEntities -> IDENTITY_CONFLICT, fail closed, nothing written', async () => {
      const { service, catalog } = build({
        highways: { Defensa: found([DEFENSA_A, DEFENSA_B]) },
        knownGeoEntityIds: ['geo-1', 'geo-2'],
      });

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: DESTINATION,
        candidates: withDefaultGeographicAuthorization([
          routeCandidate('Defensa'),
        ]),
      } as any);

      expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
      expect(resolvedEntity(result)).toMatchObject({
        status: 'unresolved',
        reason: 'IDENTITY_CONFLICT',
      });
    });

    it('a persistence-time identity conflict (race) also fails closed', async () => {
      const { service } = build({
        highways: { Defensa: found([DEFENSA_A]) },
        upsertResult: {
          status: 'IDENTITY_CONFLICT',
          conflictingGeoEntityIds: ['geo-1', 'geo-2'],
        },
      });

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: DESTINATION,
        candidates: withDefaultGeographicAuthorization([
          routeCandidate('Defensa'),
        ]),
      } as any);

      expect(resolvedEntity(result)).toMatchObject({
        status: 'unresolved',
        reason: 'IDENTITY_CONFLICT',
      });
    });

    it.each([
      [
        'UNAVAILABLE -> OSM_PROVIDER_FAILED (never NOT_FOUND)',
        {
          Defensa: {
            status: 'failed' as const,
            value: { rawCount: 0, segments: [], rejected: [] },
            failureReason: 'timeout',
          },
        },
        'OSM_PROVIDER_FAILED',
      ],
      ['NOT_FOUND -> NO_OSM_MATCH', {}, 'NO_OSM_MATCH'],
      [
        'AMBIGUOUS (two compatible clusters) -> AMBIGUOUS',
        {
          Defensa: found([
            DEFENSA_A,
            segment(
              908381626,
              [50, 51],
              [
                [-34.65, -58.44],
                [-34.651, -58.44],
              ],
            ),
          ]),
        },
        'AMBIGUOUS',
      ],
      [
        'INCOMPATIBLE (only out-of-destination clusters) -> DESTINATION_INCOMPATIBLE',
        { Defensa: found([DEFENSA_AVELLANEDA]) },
        'DESTINATION_INCOMPATIBLE',
      ],
    ])('%s', async (_title, highways, reason) => {
      const { service, catalog } = build({ highways });

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: DESTINATION,
        candidates: withDefaultGeographicAuthorization([
          routeCandidate('Defensa'),
        ]),
      } as any);

      expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
      expect(resolvedEntity(result)).toMatchObject({
        status: 'unresolved',
        reason,
      });
    });

    it('UNAVAILABLE is recorded as a failed TARGETED_ROUTE attempt', async () => {
      const { service } = build({
        highways: {
          Defensa: {
            status: 'failed',
            value: { rawCount: 0, segments: [], rejected: [] },
            failureReason: 'timeout',
          },
        },
      });

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: DESTINATION,
        candidates: withDefaultGeographicAuthorization([
          routeCandidate('Defensa'),
        ]),
      } as any);

      const targeted = componentAudit(result).attempts.find(
        (a: any) => a.strategy === 'TARGETED_ROUTE',
      );
      expect(targeted).toMatchObject({
        executionStatus: 'failed',
        failureReason: 'timeout',
      });
    });

    const catalogDefensa = {
      geoEntityId: 'geo-defensa',
      matchKind: 'CANONICAL_NAME' as const,
      name: 'Defensa',
      kind: GeoEntityKind.ROUTE,
      latitude: -34.626,
      longitude: -58.371,
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [-58.371, -34.625],
            [-58.371, -34.626],
          ],
        ],
      },
      address: null as string | null,
      identities: [
        { provider: 'openstreetmap', externalId: 'osm:way:48113515' },
      ],
    };

    it('catalog-first variant reuse: stored "Defensa", hint "Defensa Street" -> CATALOG_REUSE of the same GeoEntity with ZERO network acquisition', async () => {
      const { service, osmPlaces, catalog } = build({
        catalogByName: { Defensa: [catalogDefensa] },
      });

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: DESTINATION,
        entityResolutionScope: SAN_TELMO_ANCHOR,
        candidates: withDefaultGeographicAuthorization([
          routeCandidate('Defensa Street'),
        ]),
      } as any);

      // Bounded exact lookups, one per retrieval variant, over the
      // DESTINATION scope (a route may extend past the anchor).
      expect(
        catalog.findGeoEntityCandidatesForHint.mock.calls.map(
          ([request]: any[]) => [request.hintName, request.scope],
        ),
      ).toEqual([
        ['Defensa Street', DESTINATION],
        ['Defensa', DESTINATION],
      ]);
      expect(osmPlaces.lookupHighwaysByName).not.toHaveBeenCalled();
      expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
      expect(resolvedEntity(result)).toMatchObject({
        status: 'resolved',
        geoEntityId: 'geo-defensa',
      });
      const audit = componentAudit(result);
      expect(audit.attempts.map((a: any) => a.strategy)).toEqual([
        'CATALOG_REUSE',
      ]);
      expect(audit.attempts[0].identityEvidence).toContainEqual({
        type: 'CATALOG_ROUTE_RETRIEVAL_VARIANT_MATCH',
        retrievalVariant: 'DESIGNATOR_NORMALIZED',
        identityMultiplicity: 'SINGLE',
      });
    });

    it('catalog variants matching TWO canonical ROUTEs are ambiguous -> bounded targeted acquisition, no arbitrary winner', async () => {
      const { service, osmPlaces } = build({
        catalogByName: {
          'San Lorenzo': [
            { ...catalogDefensa, geoEntityId: 'geo-sl-1', name: 'San Lorenzo' },
            {
              ...catalogDefensa,
              geoEntityId: 'geo-sl-2',
              name: 'San Lorenzo',
              latitude: -34.65,
              longitude: -58.44,
            },
          ],
        },
      });

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: DESTINATION,
        candidates: withDefaultGeographicAuthorization([
          routeCandidate('Pasaje San Lorenzo'),
        ]),
      } as any);

      expect(osmPlaces.lookupHighwaysByName).toHaveBeenCalled();
      const audit = componentAudit(result);
      expect(audit.attempts[0]).toMatchObject({
        strategy: 'CATALOG_REUSE',
        poolCandidateCount: 2,
      });
    });

    it('a catalog ROUTE outside the destination boundary is never reused', async () => {
      const { service, osmPlaces } = build({
        catalogByName: {
          Defensa: [
            {
              ...catalogDefensa,
              latitude: -34.645,
              longitude: -58.35,
              geometry: {
                type: 'MultiLineString',
                coordinates: [
                  [
                    [-58.35, -34.645],
                    [-58.35, -34.646],
                  ],
                ],
              },
            },
          ],
        },
      });

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        geographicScope: DESTINATION,
        candidates: withDefaultGeographicAuthorization([
          routeCandidate('Defensa'),
        ]),
      } as any);

      expect(osmPlaces.lookupHighwaysByName).toHaveBeenCalled();
      expect(resolvedEntity(result).geoEntityId).not.toBe('geo-defensa');
    });
  });

  describe('AREA destination compatibility', () => {
    const nominatimArea = (lat: number, lon: number, osmId: number) => ({
      osmType: 'relation',
      osmId,
      addresstype: 'suburb',
      class: 'boundary',
      type: 'administrative',
      placeRank: 20,
      displayName: 'San Martín, Buenos Aires, Argentina',
      importance: 0.4,
      latitude: lat,
      longitude: lon,
    });
    const hydrated = (osmId: number, adminLevel: string) => ({
      id: `osm:relation:${osmId}`,
      name: 'San Martín',
      osmType: 'relation',
      osmId,
      tags: { boundary: 'administrative', admin_level: adminLevel },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-58.6, -34.6],
            [-58.5, -34.6],
            [-58.5, -34.5],
            [-58.6, -34.5],
            [-58.6, -34.6],
          ],
        ],
      },
    });

    it('San Martín -> Partido de General San Martín (outside the destination) is rejected, never persisted', async () => {
      const { service, catalog } = build({
        nominatimResults: [nominatimArea(-34.5755, -58.5373, 9168783)],
        boundaryById: hydrated(9168783, '8'),
      });

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        destinationCountryCode: 'AR',
        geographicScope: DESTINATION,
        candidates: withDefaultGeographicAuthorization([
          areaCandidate('San Martín'),
        ]),
        evidence: [{ key: 'ev-1', snippet: 'Buenos Aires walk' }],
      } as any);

      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(resolvedEntity(result)).toMatchObject({
        status: 'unresolved',
        reason: 'DESTINATION_INCOMPATIBLE',
      });
      const nominatimAttempt = componentAudit(result).attempts.find(
        (a: any) => a.strategy === 'NOMINATIM',
      );
      expect(nominatimAttempt.destinationCompatibility).toEqual({
        verdict: 'INCOMPATIBLE',
        reason: 'OUTSIDE_DESTINATION_BOUNDARY',
      });
    });

    it('an AREA inside the destination still resolves', async () => {
      const { service, catalog } = build({
        nominatimResults: [nominatimArea(-34.62, -58.37, 2223069)],
        boundaryById: hydrated(2223069, '9'),
      });

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        destinationCountryCode: 'AR',
        geographicScope: DESTINATION,
        candidates: withDefaultGeographicAuthorization([
          areaCandidate('San Martín'),
        ]),
        evidence: [{ key: 'ev-1', snippet: 'Buenos Aires walk' }],
      } as any);

      expect(catalog.upsertGeoEntity).toHaveBeenCalled();
      expect(resolvedEntity(result).status).toBe('resolved');
    });

    it('UNKNOWN compatibility (point-scale destination) fails closed -- never treated as compatible', async () => {
      const { service, catalog } = build({
        nominatimResults: [nominatimArea(-34.62, -58.37, 2223069)],
        boundaryById: hydrated(2223069, '9'),
      });

      const result = await service.resolve({
        destinationName: 'Buenos Aires',
        destinationCountryCode: 'AR',
        geographicScope: {
          kind: 'POINT_RADIUS',
          latitude: -34.62,
          longitude: -58.37,
          radiusMeters: 5000,
        },
        candidates: withDefaultGeographicAuthorization([
          areaCandidate('San Martín'),
        ]),
        evidence: [{ key: 'ev-1', snippet: 'Buenos Aires walk' }],
      } as any);

      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(resolvedEntity(result)).toMatchObject({
        status: 'unresolved',
        reason: 'DESTINATION_COMPATIBILITY_UNKNOWN',
      });
    });
  });
});
