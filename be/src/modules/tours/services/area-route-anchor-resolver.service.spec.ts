import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { GeoEntityKind } from '@prisma/client';
import { AreaRouteAnchorResolverService } from './area-route-anchor-resolver.service';
import { InterpretedAnchor } from '../interfaces/preference-spec.interface';

// No global IdentityVerifier mock. The anchor resolver integration
// tests exercise the REAL IdentityVerifier so the selected-candidate →
// verification → persistence path is genuinely tested. Transport/provider
// dependencies (Nominatim, Places, OSM, Wikidata, Catalog) are still
// mocked per-test, but the identity policy itself is real.

// The resolved destination every anchor must be compatible with (the single
// destination policy): a Buenos Aires admin boundary covering the fixtures.
const BUENOS_AIRES_DESTINATION: GeographicScope = {
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
          [-58.55, -34.75],
          [-58.3, -34.75],
          [-58.3, -34.5],
          [-58.55, -34.5],
          [-58.55, -34.75],
        ],
      ],
    },
  },
};

const noHighways = () =>
  jest.fn().mockResolvedValue({
    status: 'success',
    value: { rawCount: 0, segments: [], rejected: [] },
  });

describe('AreaRouteAnchorResolverService', () => {
  const areaAnchor: InterpretedAnchor = {
    rawName: 'San Telmo',
    usage: 'unknown',
    priority: 'must',
  };
  const routeAnchor: InterpretedAnchor = {
    rawName: 'Caminito',
    usage: 'unknown',
    priority: 'soft',
  };

  describe('resolveArea', () => {
    it('never resolves an AREA anchor outside the resolved destination (San Martín -> Partido de General San Martín)', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 9168783,
            addresstype: 'city',
            placeRank: 16,
            class: 'boundary',
            type: 'administrative',
            displayName:
              'Ciudad del Libertador General San Martín, Partido de General San Martín',
            importance: 0.4,
            latitude: -34.4755,
            longitude: -58.5373,
          },
        ]),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'success',
          value: {
            id: 'osm:relation:9168783',
            name: 'Ciudad del Libertador General San Martín',
            osmType: 'relation',
            osmId: 9168783,
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-58.56, -34.49],
                  [-58.52, -34.49],
                  [-58.52, -34.46],
                  [-58.56, -34.46],
                  [-58.56, -34.49],
                ],
              ],
            },
            tags: { boundary: 'administrative', admin_level: '8' },
          },
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = { upsertGeoEntity: jest.fn() };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      const result = await service.resolveArea(
        { rawName: 'San Martín', usage: 'unknown', priority: 'must' },
        'ar',
        undefined,
        BUENOS_AIRES_DESTINATION,
      );

      expect(result).toEqual({
        resolved: false,
        status: 'no_match',
        reason: 'DESTINATION_INCOMPATIBLE',
      });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it('resolves a real Nominatim way/relation match into a persisted AREA GeoEntity', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 42,
            addresstype: 'suburb',
            placeRank: 20,
            class: 'place',
            type: 'suburb',
            displayName: 'San Telmo, Buenos Aires, Argentina',
            importance: 0.3,
            latitude: -34.62,
            longitude: -58.37,
          },
        ]),
        reverse: jest.fn(),
      };
      const boundaryGeometry = {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-58.38, -34.63],
            [-58.36, -34.63],
            [-58.36, -34.61],
            [-58.38, -34.61],
            [-58.38, -34.63],
          ],
        ],
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'success',
          value: {
            id: 'osm:relation:42',
            name: 'San Telmo',
            osmType: 'relation',
            osmId: 42,
            geometry: boundaryGeometry,
            tags: { boundary: 'administrative' },
          },
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-san-telmo' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      const result = await service.resolveArea(
        areaAnchor,
        'ar',
        {
          latitude: -34.6,
          longitude: -58.38,
        },
        BUENOS_AIRES_DESTINATION,
      );

      // Unique exact name match → real verifier returns VERIFIED.
      expect(result).toEqual(
        expect.objectContaining({
          resolved: true,
          geoEntityId: 'geo-san-telmo',
          geometry: boundaryGeometry,
        }),
      );
      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: GeoEntityKind.AREA,
          externalId: 'osm:relation:42',
        }),
      );
    });

    it('carries the full OsmCandidate boundary (osmType/osmId included) forward, not just its geometry (Task A6)', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 42,
            addresstype: 'suburb',
            placeRank: 20,
            class: 'place',
            type: 'suburb',
            displayName: 'San Telmo, Buenos Aires, Argentina',
            importance: 0.3,
            latitude: -34.62,
            longitude: -58.37,
          },
        ]),
        reverse: jest.fn(),
      };
      const boundaryGeometry = {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-58.38, -34.63],
            [-58.36, -34.63],
            [-58.36, -34.61],
            [-58.38, -34.61],
            [-58.38, -34.63],
          ],
        ],
      };
      const osmBoundary = {
        id: 'osm:relation:42',
        name: 'San Telmo',
        osmType: 'relation' as const,
        osmId: 42,
        geometry: boundaryGeometry,
        tags: { boundary: 'administrative' },
      };
      const osmPlaces = {
        lookupBoundaryById: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: osmBoundary }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-san-telmo' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      const resolved = await service.resolveNamedAnchors(
        [{ rawName: 'San Telmo', usage: 'geographic_scope', priority: 'must' }],
        {
          destinationCountryCode: 'ar',
          geographicScope: {
            kind: 'AREA_BOUNDARY',
            boundary: osmBoundary as any,
          },
        },
      );

      expect(resolved[0]).toEqual(
        expect.objectContaining({ status: 'resolved', osmBoundary }),
      );
    });

    it('stays unresolved when Nominatim has no match', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn(),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = { upsertGeoEntity: jest.fn() };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      const result = await service.resolveArea(
        areaAnchor,
        undefined,
        undefined,
        BUENOS_AIRES_DESTINATION,
      );

      expect(result).toEqual(
        expect.objectContaining({ resolved: false, status: 'no_match' }),
      );
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it('stays unresolved for a bare node match (no real polygon boundary)', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'node',
            osmId: 1,
            addresstype: 'suburb',
            placeRank: 20,
            displayName: 'San Telmo, Buenos Aires, Argentina',
            importance: 0.1,
            latitude: -34.62,
            longitude: -58.37,
          },
        ]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn(),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = { upsertGeoEntity: jest.fn() };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      const result = await service.resolveArea(
        areaAnchor,
        undefined,
        undefined,
        BUENOS_AIRES_DESTINATION,
      );

      expect(result).toEqual(
        expect.objectContaining({ resolved: false, status: 'no_match' }),
      );
      expect(osmPlaces.lookupBoundaryById).not.toHaveBeenCalled();
    });

    it('stays unresolved (no crash) when lookupBoundaryById fails', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 42,
            addresstype: 'suburb',
            class: 'place',
            type: 'suburb',
            displayName: 'San Telmo, Buenos Aires, Argentina',
            importance: 0.3,
            latitude: -34.62,
            longitude: -58.37,
          },
        ]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'failed',
          value: null,
          failureReason: 'boom',
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = { upsertGeoEntity: jest.fn() };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      const result = await service.resolveArea(
        areaAnchor,
        undefined,
        undefined,
        BUENOS_AIRES_DESTINATION,
      );

      expect(result).toEqual(
        expect.objectContaining({ resolved: false, status: 'no_match' }),
      );
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it('exercises real destination-proximity biasing (reuses bestNominatimMatch)', async () => {
      const near = {
        osmType: 'relation' as const,
        osmId: 1,
        addresstype: 'suburb',
        placeRank: 20,
        class: 'place',
        type: 'suburb',
        displayName:
          'Catedral San Juan Bautista, Mataderos, Buenos Aires, Argentina',
        importance: 0.199,
        latitude: -34.66,
        longitude: -58.51,
      };
      const far = {
        osmType: 'relation' as const,
        osmId: 2,
        addresstype: 'suburb',
        placeRank: 20,
        class: 'place',
        type: 'suburb',
        displayName:
          'Catedral San Juan Bautista, Retiro, Buenos Aires, Argentina',
        importance: 0.208,
        latitude: -34.59,
        longitude: -58.37,
      };
      const nominatim = {
        search: jest.fn().mockResolvedValue([far, near]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest
          .fn()
          .mockImplementation(async (_type, osmId) => ({
            status: 'success',
            value: {
              id: `osm:relation:${osmId}`,
              name: 'Catedral',
              osmType: 'relation',
              osmId,
              geometry: { type: 'Point', coordinates: [-58.51, -34.66] },
              tags: {},
            },
          })),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      // Two Nominatim results share the same normalized name →
      // exact-name ambiguity → real verifier requires independent corroboration.
      // Without Wikidata, verification fails — but the proximity
      // selection itself is still exercised.
      await service.resolveArea(
        {
          rawName: 'Catedral San Juan Bautista',
          usage: 'unknown',
          priority: 'must',
        },
        undefined,
        { latitude: -34.66, longitude: -58.51 },
        BUENOS_AIRES_DESTINATION,
      );

      expect(osmPlaces.lookupBoundaryById).toHaveBeenCalledWith('relation', 1);
    });

    // Cutover M3.5 -- single source of policy truth: the same
    // isAreaScaleEligible predicate DestinationResolutionService uses now
    // also gates this resolver, so a country/state-scale (or otherwise
    // non-urban/admin) match is rejected here too, never just for the
    // whole-trip destination.
    it('stays unresolved for a country-scale match even though it is a real way/relation (too broad for an anchor)', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 99,
            addresstype: 'country',
            class: 'boundary',
            type: 'administrative',
            displayName: 'Argentina',
            importance: 0.9,
          },
        ]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn(),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = { upsertGeoEntity: jest.fn() };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      const result = await service.resolveArea(
        { rawName: 'Argentina', usage: 'geographic_scope', priority: 'must' },
        undefined,
        undefined,
        BUENOS_AIRES_DESTINATION,
      );

      expect(result).toEqual(
        expect.objectContaining({ resolved: false, status: 'no_match' }),
      );
      expect(osmPlaces.lookupBoundaryById).not.toHaveBeenCalled();
    });

    it('never throws when Nominatim search itself rejects', async () => {
      const nominatim = {
        search: jest.fn().mockRejectedValue(new Error('boom')),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn(),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = { upsertGeoEntity: jest.fn() };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      await expect(
        service.resolveArea(
          areaAnchor,
          undefined,
          undefined,
          BUENOS_AIRES_DESTINATION,
        ),
      ).resolves.toMatchObject({ resolved: false, status: 'unavailable' });
    });

    it.each([
      ['Nominatim unavailable + Places match', 'places-match', 'resolved'],
      [
        'Nominatim unavailable + Places no-match',
        'places-no-match',
        'unresolved',
      ],
      ['all providers unavailable', 'all-unavailable', 'unresolved'],
      ['both providers searched and no-match', 'both-no-match', 'unresolved'],
    ])(
      '%s keeps provider failure distinct from semantic no-match',
      async (_label, mode, expectedStatus) => {
        const nominatim = {
          search:
            mode === 'both-no-match'
              ? jest.fn().mockResolvedValue([])
              : jest.fn().mockRejectedValue(new Error('nominatim down')),
          reverse: jest.fn(),
        };
        const osmPlaces = {
          lookupBoundaryById: jest.fn(),

          lookupHighwaysByName: noHighways(),
        };
        const places = {
          provider: 'google' as const,
          searchText:
            mode === 'all-unavailable'
              ? jest.fn().mockRejectedValue(new Error('places down'))
              : jest.fn().mockResolvedValue({
                  data:
                    mode === 'places-match'
                      ? [
                          {
                            id: 'ChIJmuseum',
                            // FIX: name must match the anchor for the real
                            // verifier to return VERIFIED via exact-name.
                            displayName: { text: 'San Telmo' },
                            name: 'San Telmo',
                            location: { latitude: -34.6, longitude: -58.4 },
                            primaryType: 'museum',
                            types: ['museum', 'point_of_interest'],
                          },
                        ]
                      : [],
                }),
        };
        const catalog = {
          upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-place' }),
        };
        const service = new AreaRouteAnchorResolverService(
          osmPlaces as any,
          catalog as any,
          nominatim as any,
          places as any,
        );

        const [result] = await service.resolveNamedAnchors([areaAnchor], {
          geographicScope: {
            kind: 'POINT_RADIUS',
            latitude: -34.6,
            longitude: -58.4,
            radiusMeters: 10_000,
          },
        });

        expect(result.status).toBe(expectedStatus);
        if (mode === 'places-match') {
          expect(result).toMatchObject({
            status: 'resolved',
            kind: 'venue',
            canonicalName: 'San Telmo',
          });
        }
        if (mode === 'both-no-match') {
          expect(result).toMatchObject({
            status: 'unresolved',
            unresolvedReason: 'NO_CONFIDENT_GEO_ENTITY_MATCH',
          });
        }
        if (mode === 'places-no-match' || mode === 'all-unavailable') {
          expect(result).toMatchObject({
            status: 'unresolved',
            unresolvedReason: expect.stringContaining(
              'GEO_PROVIDER_UNAVAILABLE:',
            ),
          });
        }
      },
    );

    it('does not turn a Places locality into a venue merely because it has coordinates', async () => {
      const service = new AreaRouteAnchorResolverService(
        {
          lookupBoundaryById: jest.fn(),

          lookupHighwaysByName: noHighways(),
        } as any,
        { upsertGeoEntity: jest.fn() } as any,
        {
          search: jest.fn().mockResolvedValue([]),
          reverse: jest.fn(),
        } as any,
        {
          provider: 'google',
          searchText: jest.fn().mockResolvedValue({
            data: [
              {
                id: 'locality-1',
                displayName: { text: 'San Telmo' },
                location: { latitude: -34.62, longitude: -58.37 },
                primaryType: 'locality',
                types: ['locality', 'political'],
              },
            ],
          }),
        } as any,
      );

      const [result] = await service.resolveNamedAnchors([areaAnchor], {
        geographicScope: {
          kind: 'POINT_RADIUS',
          latitude: -34.6,
          longitude: -58.4,
          radiusMeters: 10_000,
        },
      });

      expect(result).toMatchObject({
        status: 'unresolved',
        unresolvedReason: 'NO_CONFIDENT_GEO_ENTITY_MATCH',
      });
    });
  });

  describe('resolveRoute (shared targeted ROUTE path)', () => {
    const way = (
      osmId: number,
      nodes: number[],
      points: Array<[number, number]>,
      name = 'Caminito',
    ) => ({
      externalId: `osm:way:${osmId}`,
      osmId,
      name,
      highway: 'pedestrian',
      nodes,
      geometry: points.map(([lat, lon]) => ({ lat, lon })),
    });
    const highways = (segments: any[]) =>
      jest.fn().mockResolvedValue({
        status: 'success',
        value: { rawCount: segments.length, segments, rejected: [] },
      });
    const catalogFor = (knownGeoEntityIds: string[] = []) => ({
      upsertGeoEntity: jest.fn(),
      findGeoEntityIdsByIdentities: jest
        .fn()
        .mockResolvedValue(knownGeoEntityIds),
      upsertGeoEntityWithIdentities: jest.fn().mockResolvedValue({
        status: 'CREATED',
        geoEntity: { id: 'geo-caminito' },
        attachedExternalIds: [],
      }),
    });

    it('resolves one real multi-way street inside the destination as ONE multi-identity ROUTE GeoEntity', async () => {
      const osmPlaces = {
        lookupHighwaysByName: highways([
          way(
            1,
            [1, 2],
            [
              [-34.6382, -58.3634],
              [-34.6376, -58.363],
            ],
          ),
          way(
            2,
            [2, 3],
            [
              [-34.6376, -58.363],
              [-34.637, -58.3626],
            ],
          ),
        ]),
      };
      const catalog = catalogFor();
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
      );

      const result = await service.resolveRoute(
        routeAnchor,
        BUENOS_AIRES_DESTINATION,
      );

      expect(result).toMatchObject({
        resolved: true,
        kind: 'route',
        geoEntityId: 'geo-caminito',
        canonicalName: 'Caminito',
        geometry: { type: 'MultiLineString' },
      });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(catalog.upsertGeoEntityWithIdentities).toHaveBeenCalledWith(
        expect.objectContaining({
          identities: [
            { provider: 'openstreetmap', externalId: 'osm:way:1' },
            { provider: 'openstreetmap', externalId: 'osm:way:2' },
          ],
        }),
      );
    });

    it('never resolves on a point-scale destination (compatibility UNKNOWN), acquiring over the destination radius', async () => {
      const osmPlaces = {
        lookupHighwaysByName: highways([
          way(
            1,
            [1, 2],
            [
              [-34.6382, -58.3634],
              [-34.6376, -58.363],
            ],
          ),
        ]),
      };
      const catalog = catalogFor();
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
      );

      const result = await service.resolveRoute(routeAnchor, {
        kind: 'POINT_RADIUS',
        latitude: -34.6,
        longitude: -58.4,
        radiusMeters: 5000,
      });

      expect(result).toMatchObject({
        resolved: false,
        status: 'no_match',
        reason: 'TARGETED_ROUTE_AMBIGUOUS',
      });
      expect(osmPlaces.lookupHighwaysByName).toHaveBeenCalledWith({
        name: 'Caminito',
        latitude: -34.6,
        longitude: -58.4,
        radiusMeters: 5000,
      });
      expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
    });

    it('two disconnected same-name streets inside the destination stay unresolved (no proximity winner)', async () => {
      const osmPlaces = {
        lookupHighwaysByName: highways([
          way(
            1,
            [1, 2],
            [
              [-34.6382, -58.3634],
              [-34.6376, -58.363],
            ],
          ),
          way(
            2,
            [8, 9],
            [
              [-34.65, -58.44],
              [-34.651, -58.44],
            ],
          ),
        ]),
      };
      const catalog = catalogFor();
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
      );

      const result = await service.resolveRoute(
        routeAnchor,
        BUENOS_AIRES_DESTINATION,
      );

      expect(result).toMatchObject({
        resolved: false,
        reason: 'TARGETED_ROUTE_AMBIGUOUS',
      });
      expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
    });

    it('stays unresolved (a normal outcome) when no street matches the anchor name', async () => {
      const osmPlaces = { lookupHighwaysByName: highways([]) };
      const catalog = catalogFor();
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
      );

      const result = await service.resolveRoute(
        {
          rawName: 'Ruta del Vino de Mendoza',
          usage: 'unknown',
          priority: 'must',
        },
        BUENOS_AIRES_DESTINATION,
      );

      expect(result).toEqual(
        expect.objectContaining({
          resolved: false,
          status: 'no_match',
          reason: 'TARGETED_ROUTE_NOT_FOUND',
        }),
      );
    });

    it('reports provider failure as unavailable, never as no_match', async () => {
      const osmPlaces = {
        lookupHighwaysByName: jest.fn().mockResolvedValue({
          status: 'failed',
          value: { rawCount: 0, segments: [], rejected: [] },
          failureReason: 'overpass down',
        }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalogFor() as any,
      );

      await expect(
        service.resolveRoute(routeAnchor, BUENOS_AIRES_DESTINATION),
      ).resolves.toMatchObject({ resolved: false, status: 'unavailable' });
    });

    it('fails closed on a strong-identity conflict (segments already owned by two GeoEntities)', async () => {
      const osmPlaces = {
        lookupHighwaysByName: highways([
          way(
            1,
            [1, 2],
            [
              [-34.6382, -58.3634],
              [-34.6376, -58.363],
            ],
          ),
        ]),
      };
      const catalog = catalogFor(['geo-1', 'geo-2']);
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
      );

      const result = await service.resolveRoute(
        routeAnchor,
        BUENOS_AIRES_DESTINATION,
      );

      expect(result).toMatchObject({
        resolved: false,
        reason: 'IDENTITY_CONFLICT',
      });
      expect(catalog.upsertGeoEntityWithIdentities).not.toHaveBeenCalled();
    });
  });

  describe('resolveNamedAnchors', () => {
    it('uses linguistic usage only as context and OSM facts as canonical kind', async () => {
      // The fixture boundary is named Buenos Aires, so its geometry must
      // actually cover central Buenos Aires — including both San Telmo
      // (-34.62, -58.37) and MALBA (-34.578, -58.403). A boundary too
      // small for its own claimed city would make the canonical
      // destination-compatibility policy (Bitácora F1) correctly reject a
      // venue that genuinely belongs to the destination.
      const areaGeometry = {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-58.47, -34.66],
            [-58.35, -34.66],
            [-58.35, -34.55],
            [-58.47, -34.55],
            [-58.47, -34.66],
          ],
        ],
      };
      const nominatim = {
        search: jest.fn().mockImplementation(async (name: string) => {
          if (name === 'San Telmo')
            return [
              {
                osmType: 'relation',
                osmId: 42,
                addresstype: 'suburb',
                placeRank: 20,
                class: 'place',
                type: 'suburb',
                displayName: 'San Telmo, Buenos Aires, Argentina',
                importance: 0.3,
                latitude: -34.62,
                longitude: -58.37,
              },
            ];
          if (name === 'MALBA')
            return [
              {
                osmType: 'node',
                osmId: 99,
                addresstype: 'museum',
                placeRank: 30,
                class: 'tourism',
                type: 'museum',
                displayName: 'MALBA, Buenos Aires, Argentina',
                importance: 0.5,
                latitude: -34.578,
                longitude: -58.403,
              },
            ];
          return [];
        }),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'success',
          value: {
            id: 'osm:relation:42',
            name: 'San Telmo',
            osmType: 'relation',
            osmId: 42,
            geometry: areaGeometry,
            tags: {},
          },
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockImplementation(async (input) => ({
          id: `geo-${input.kind.toLowerCase()}`,
        })),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );
      const resolved = await service.resolveNamedAnchors(
        [
          {
            rawName: 'San Telmo',
            usage: 'geographic_scope',
            priority: 'must',
          },
          {
            rawName: 'MALBA',
            usage: 'specific_destination',
            priority: 'soft',
          },
          {
            rawName: 'Ruta de los Siete Lagos',
            usage: 'named_path',
            priority: 'must',
          },
          {
            rawName: 'Un lugar ambiguo',
            usage: 'unknown',
            priority: 'soft',
          },
        ],
        {
          geographicScope: {
            kind: 'AREA_BOUNDARY',
            boundary: {
              id: 'scope',
              name: 'Buenos Aires',
              osmType: 'relation',
              osmId: 1,
              geometry: areaGeometry,
              tags: {},
            } as any,
          },
          destinationCountryCode: 'ar',
          destinationPoint: { latitude: -34.6, longitude: -58.38 },
        },
      );

      expect(resolved).toEqual([
        expect.objectContaining({
          rawName: 'San Telmo',
          usage: 'geographic_scope',
          priority: 'must',
          status: 'resolved',
          canonicalName: 'San Telmo',
        }),
        expect.objectContaining({
          rawName: 'MALBA',
          usage: 'specific_destination',
          status: 'resolved',
          canonicalName: 'MALBA',
        }),
        expect.objectContaining({
          rawName: 'Ruta de los Siete Lagos',
          usage: 'named_path',
          status: 'unresolved',
          // No highway way with that exact name in the destination.
          unresolvedReason: 'NO_CONFIDENT_GEO_ENTITY_MATCH',
        }),
        expect.objectContaining({
          rawName: 'Un lugar ambiguo',
          usage: 'unknown',
          status: 'unresolved',
          unresolvedReason: 'NO_CONFIDENT_GEO_ENTITY_MATCH',
        }),
      ]);
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'EXPERIENCE' }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Exact-name ambiguity propagation in anchor resolution
  // ──────────────────────────────────────────────────────────────

  describe('exact-name ambiguity in anchor acquisition', () => {
    it('Case C: duplicate exact Nominatim AREA names → ambiguous → not persisted', async () => {
      // Two Nominatim results with the same normalized display name.
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 10,
            addresstype: 'suburb',
            placeRank: 20,
            class: 'place',
            type: 'suburb',
            displayName: 'San Telmo, Buenos Aires, Argentina',
            importance: 0.3,
            latitude: -34.62,
            longitude: -58.37,
          },
          {
            osmType: 'relation',
            osmId: 20,
            addresstype: 'suburb',
            placeRank: 20,
            class: 'place',
            type: 'suburb',
            // A second exact-name area INSIDE the destination: genuine
            // ambiguity (an out-of-destination homonym would not count).
            displayName: 'San Telmo, Palermo, Buenos Aires, Argentina',
            importance: 0.25,
            latitude: -34.58,
            longitude: -58.43,
          },
        ]),
        reverse: jest.fn(),
      };
      const boundaryGeometry = {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-58.38, -34.63],
            [-58.36, -34.63],
            [-58.36, -34.61],
            [-58.38, -34.61],
            [-58.38, -34.63],
          ],
        ],
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'success',
          value: {
            id: 'osm:relation:10',
            name: 'San Telmo',
            osmType: 'relation',
            osmId: 10,
            geometry: boundaryGeometry,
            tags: { boundary: 'administrative' },
          },
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      const result = await service.resolveArea(
        areaAnchor,
        'ar',
        {
          latitude: -34.6,
          longitude: -58.38,
        },
        BUENOS_AIRES_DESTINATION,
      );

      // 2+ exact-name identities → exactNameAmbiguous = true
      // → real verifier cannot verify on exact-name alone → not persisted.
      expect(result).toEqual(
        expect.objectContaining({ resolved: false, status: 'no_match' }),
      );
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it('Case E: duplicate exact Places names → ambiguous → not persisted', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn(),

        lookupHighwaysByName: noHighways(),
      };
      const places = {
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'ChIJ-place1',
              displayName: { text: 'San Telmo' },
              name: 'San Telmo',
              location: { latitude: -34.62, longitude: -58.37 },
              primaryType: 'museum',
              types: ['museum', 'point_of_interest'],
            },
            {
              id: 'ChIJ-place2',
              displayName: { text: 'San Telmo' },
              name: 'San Telmo',
              location: { latitude: -34.92, longitude: -57.95 },
              primaryType: 'museum',
              types: ['museum', 'point_of_interest'],
            },
          ],
        }),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
        places as any,
      );

      const [result] = await service.resolveNamedAnchors([areaAnchor], {
        geographicScope: {
          kind: 'POINT_RADIUS',
          latitude: -34.6,
          longitude: -58.4,
          radiusMeters: 10_000,
        },
      });

      // 2+ Places results with same normalized name → ambiguous.
      expect(result).toMatchObject({
        status: 'unresolved',
        unresolvedReason: 'IDENTITY_NOT_VERIFIED',
      });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it('Case F: fuzzy candidate without corroboration → not verified', async () => {
      // Nominatim returns a result whose name is only a fuzzy match
      // (not exact) to the anchor hint.
      const nominatim = {
        search: jest.fn().mockResolvedValue([]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn(),

        lookupHighwaysByName: noHighways(),
      };
      const places = {
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'ChIJ-fuzzy',
              displayName: { text: 'San Telmo Bar' },
              name: 'San Telmo Bar',
              location: { latitude: -34.62, longitude: -58.37 },
              primaryType: 'bar',
              types: ['bar', 'point_of_interest'],
            },
          ],
        }),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
        places as any,
      );

      // Anchor 'San Telmo' vs candidate 'San Telmo Bar' — fuzzy match
      // only, no exact name → real verifier returns INSUFFICIENT_EVIDENCE.
      const [result] = await service.resolveNamedAnchors(
        [
          {
            rawName: 'San Telmo',
            usage: 'specific_destination',
            priority: 'must',
          },
        ],
        {
          geographicScope: {
            kind: 'POINT_RADIUS',
            latitude: -34.6,
            longitude: -58.4,
            radiusMeters: 10_000,
          },
        },
      );

      expect(result).toMatchObject({
        status: 'unresolved',
        unresolvedReason: 'IDENTITY_NOT_VERIFIED',
      });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it('Case G: Wikidata unavailable but local exact-name sufficient → resolved', async () => {
      // Single exact-name Places candidate (not ambiguous) with
      // Wikidata unavailable — the real verifier still returns VERIFIED
      // because exact-name alone is sufficient when the pool has no
      // ambiguity.
      const nominatim = {
        search: jest.fn().mockResolvedValue([]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn(),

        lookupHighwaysByName: noHighways(),
      };
      const places = {
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'ChIJ-exact',
              displayName: { text: 'San Telmo' },
              name: 'San Telmo',
              location: { latitude: -34.62, longitude: -58.37 },
              primaryType: 'museum',
              types: ['museum', 'point_of_interest'],
            },
          ],
        }),
      };
      // Wikidata throws → WIKIDATA_UNAVAILABLE evidence.
      const wikidata = {
        getEntitySummaries: jest
          .fn()
          .mockRejectedValue(new Error('wikidata down')),
        findNearbyPlaces: jest
          .fn()
          .mockRejectedValue(new Error('wikidata down')),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
        places as any,
        wikidata as any,
      );

      const [result] = await service.resolveNamedAnchors([areaAnchor], {
        geographicScope: {
          kind: 'POINT_RADIUS',
          latitude: -34.6,
          longitude: -58.4,
          radiusMeters: 10_000,
        },
      });

      // Single unambiguous exact-name match → verifier returns VERIFIED
      // on the first pass (no Wikidata needed).
      expect(result.status).toBe('resolved');
      expect(catalog.upsertGeoEntity).toHaveBeenCalled();
    });

    it('Case G corrected: local evidence insufficient + Wikidata unavailable → not persisted', async () => {
      // Fuzzy-only Places result (name does not exactly match anchor).
      const nominatim = {
        search: jest.fn().mockResolvedValue([]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn(),

        lookupHighwaysByName: noHighways(),
      };
      const places = {
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'ChIJ-fuzzy',
              displayName: { text: 'San Telmo Bar' },
              name: 'San Telmo Bar',
              location: { latitude: -34.62, longitude: -58.37 },
              primaryType: 'bar',
              types: ['bar', 'point_of_interest'],
            },
          ],
        }),
      };
      // Wikidata throws → WIKIDATA_UNAVAILABLE evidence.
      const wikidata = {
        getEntitySummaries: jest
          .fn()
          .mockRejectedValue(new Error('wikidata down')),
        findNearbyPlaces: jest
          .fn()
          .mockRejectedValue(new Error('wikidata down')),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
        places as any,
        wikidata as any,
      );

      const [result] = await service.resolveNamedAnchors([areaAnchor], {
        geographicScope: {
          kind: 'POINT_RADIUS',
          latitude: -34.6,
          longitude: -58.4,
          radiusMeters: 10_000,
        },
      });

      // Fuzzy-only match → no exact-name evidence → first verify()
      // returns INSUFFICIENT_EVIDENCE. Then Wikidata unavailable →
      // second verify() returns INSUFFICIENT_EVIDENCE.
      expect(result).toMatchObject({
        status: 'unresolved',
        unresolvedReason: 'IDENTITY_NOT_VERIFIED',
      });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it('Case H: candidate exists + identity fails + provider unavailable → IDENTITY_NOT_VERIFIED', async () => {
      // Nominatim unavailable, Places returns a fuzzy-only match
      // (name mismatch), so verification fails. The unresolvedReason
      // must be IDENTITY_NOT_VERIFIED, not GEO_PROVIDER_UNAVAILABLE.
      const nominatim = {
        search: jest.fn().mockRejectedValue(new Error('nominatim down')),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn(),

        lookupHighwaysByName: noHighways(),
      };
      const places = {
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'ChIJ-fuzzy',
              displayName: { text: 'San Telmo Bar' },
              name: 'San Telmo Bar',
              location: { latitude: -34.62, longitude: -58.37 },
              primaryType: 'bar',
              types: ['bar', 'point_of_interest'],
            },
          ],
        }),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
        places as any,
      );

      const [result] = await service.resolveNamedAnchors([areaAnchor], {
        geographicScope: {
          kind: 'POINT_RADIUS',
          latitude: -34.6,
          longitude: -58.4,
          radiusMeters: 10_000,
        },
      });

      // verification failed → IDENTITY_NOT_VERIFIED, not
      // GEO_PROVIDER_UNAVAILABLE.
      expect(result).toMatchObject({
        status: 'unresolved',
        unresolvedReason: 'IDENTITY_NOT_VERIFIED',
      });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Nominatim AREA boundary-hydration regression
  // ──────────────────────────────────────────────────────────────

  describe('Nominatim AREA boundary-hydration regression', () => {
    it('5A: two exact AREA candidates → MULTIPLE → hydration preserves MULTIPLE → not persisted', async () => {
      // Two exact-name Nominatim AREA candidates. The selected one
      // hydrates its boundary, but multiplicity must remain MULTIPLE.
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 10,
            addresstype: 'suburb',
            placeRank: 20,
            class: 'place',
            type: 'suburb',
            displayName: 'San Telmo, Buenos Aires, Argentina',
            importance: 0.3,
            latitude: -34.62,
            longitude: -58.37,
          },
          {
            osmType: 'relation',
            osmId: 20,
            addresstype: 'suburb',
            placeRank: 20,
            class: 'place',
            type: 'suburb',
            // A second exact-name area INSIDE the destination: genuine
            // ambiguity (an out-of-destination homonym would not count).
            displayName: 'San Telmo, Palermo, Buenos Aires, Argentina',
            importance: 0.25,
            latitude: -34.58,
            longitude: -58.43,
          },
        ]),
        reverse: jest.fn(),
      };
      const boundaryGeometry = {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-58.38, -34.63],
            [-58.36, -34.63],
            [-58.36, -34.61],
            [-58.38, -34.61],
            [-58.38, -34.63],
          ],
        ],
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'success',
          value: {
            id: 'osm:relation:10',
            name: 'San Telmo',
            osmType: 'relation',
            osmId: 10,
            geometry: boundaryGeometry,
            tags: { boundary: 'administrative' },
          },
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      const result = await service.resolveArea(
        areaAnchor,
        'ar',
        {
          latitude: -34.6,
          longitude: -58.38,
        },
        BUENOS_AIRES_DESTINATION,
      );

      // Two exact-name AREA candidates -> exactName = MULTIPLE.
      // Boundary hydration MUST preserve MULTIPLE.
      expect(result).toEqual(
        expect.objectContaining({ resolved: false, status: 'no_match' }),
      );
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      // Hydration WAS called.
      expect(osmPlaces.lookupBoundaryById).toHaveBeenCalledWith('relation', 10);
    });

    it('5B: single exact AREA candidate → SINGLE → boundary hydrates → persisted', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 42,
            addresstype: 'suburb',
            placeRank: 20,
            class: 'place',
            type: 'suburb',
            displayName: 'San Telmo, Buenos Aires, Argentina',
            importance: 0.3,
            latitude: -34.62,
            longitude: -58.37,
          },
        ]),
        reverse: jest.fn(),
      };
      const boundaryGeometry = {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-58.38, -34.63],
            [-58.36, -34.63],
            [-58.36, -34.61],
            [-58.38, -34.61],
            [-58.38, -34.63],
          ],
        ],
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'success',
          value: {
            id: 'osm:relation:42',
            name: 'San Telmo',
            osmType: 'relation',
            osmId: 42,
            geometry: boundaryGeometry,
            tags: { boundary: 'administrative' },
          },
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-san-telmo' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      const result = await service.resolveArea(
        areaAnchor,
        'ar',
        {
          latitude: -34.6,
          longitude: -58.38,
        },
        BUENOS_AIRES_DESTINATION,
      );

      // Single exact AREA candidate -> exactName = SINGLE.
      // Boundary hydrates and persists.
      expect(result).toEqual(
        expect.objectContaining({
          resolved: true,
          geoEntityId: 'geo-san-telmo',
          geometry: boundaryGeometry,
        }),
      );
      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: GeoEntityKind.AREA,
          externalId: 'osm:relation:42',
        }),
      );
      // Hydration WAS called.
      expect(osmPlaces.lookupBoundaryById).toHaveBeenCalledWith('relation', 42);
    });
  });
  // ──────────────────────────────────────────────────────────────

  describe('candidate→persistence regression', () => {
    it('persisted payload matches canonical EntityCandidate fields exactly', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 42,
            addresstype: 'suburb',
            placeRank: 20,
            class: 'place',
            type: 'suburb',
            displayName: 'San Telmo, Buenos Aires, Argentina',
            importance: 0.3,
            latitude: -34.62,
            longitude: -58.37,
          },
        ]),
        reverse: jest.fn(),
      };
      const boundaryGeometry = {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-58.38, -34.63],
            [-58.36, -34.63],
            [-58.36, -34.61],
            [-58.38, -34.61],
            [-58.38, -34.63],
          ],
        ],
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'success',
          value: {
            id: 'osm:relation:42',
            name: 'San Telmo',
            osmType: 'relation',
            osmId: 42,
            geometry: boundaryGeometry,
            tags: { boundary: 'administrative', name: 'San Telmo' },
          },
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-san-telmo' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      await service.resolveArea(
        areaAnchor,
        'ar',
        {
          latitude: -34.6,
          longitude: -58.38,
        },
        BUENOS_AIRES_DESTINATION,
      );

      // The payload passed to upsertGeoEntity MUST exactly match the
      // canonical EntityCandidate fields — no second representation
      // capable of diverging.
      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith({
        name: 'San Telmo',
        kind: GeoEntityKind.AREA,
        provider: 'openstreetmap',
        externalId: 'osm:relation:42',
        latitude: expect.closeTo(-34.622, 3),
        longitude: expect.closeTo(-58.372, 3),
        geometry: boundaryGeometry,
        metadata: { tags: { boundary: 'administrative', name: 'San Telmo' } },
      });
    });

    it('Places-sourced candidate persists canonicalPlacesExternalId format', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn(),

        lookupHighwaysByName: noHighways(),
      };
      const places = {
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'ChIJmuseum123',
              displayName: { text: 'San Telmo Museum' },
              name: 'San Telmo Museum',
              location: { latitude: -34.62, longitude: -58.37 },
              primaryType: 'museum',
              types: ['museum', 'point_of_interest'],
            },
          ],
        }),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
        places as any,
      );

      // Use 'San Telmo Museum' as anchor so the name matches exactly.
      const [result] = await service.resolveNamedAnchors(
        [
          {
            rawName: 'San Telmo Museum',
            usage: 'specific_destination',
            priority: 'must',
          },
        ],
        {
          geographicScope: {
            kind: 'POINT_RADIUS',
            latitude: -34.6,
            longitude: -58.4,
            radiusMeters: 10_000,
          },
        },
      );

      expect(result).toMatchObject({ status: 'resolved' });
      // externalId must use canonicalPlacesExternalId format.
      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: 'google_places:ChIJmuseum123',
          provider: 'google_places',
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Truthful resolution strategy
  // ──────────────────────────────────────────────────────────────

  describe('resolution strategy', () => {
    it('uses ANCHOR_RESOLUTION strategy, not LOCAL_OSM_POOL', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn(),

        lookupHighwaysByName: noHighways(),
      };
      const places = {
        provider: 'google' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'ChIJ-test',
              displayName: { text: 'San Telmo' },
              name: 'San Telmo',
              location: { latitude: -34.62, longitude: -58.37 },
              primaryType: 'museum',
              types: ['museum', 'point_of_interest'],
            },
          ],
        }),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      };

      // Spy on IdentityVerifier to inspect the strategy passed to verify.
      const { IdentityVerifier } = await import('./identity-verifier.service');
      const verifySpy = jest.spyOn(IdentityVerifier.prototype, 'verify');

      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
        places as any,
      );

      await service.resolveNamedAnchors([areaAnchor], {
        geographicScope: {
          kind: 'POINT_RADIUS',
          latitude: -34.6,
          longitude: -58.4,
          radiusMeters: 10_000,
        },
      });

      expect(verifySpy).toHaveBeenCalled();
      const firstCall = verifySpy.mock.calls[0];
      expect(firstCall[1].strategy).toBe('ANCHOR_RESOLUTION');

      verifySpy.mockRestore();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // OSM Wikidata evidence propagation (regression: IDENTITY_EVIDENCE_PROPAGATION_GAP)
  // ──────────────────────────────────────────────────────────────

  describe('OSM Wikidata QID propagation into EntityCandidate', () => {
    it('resolves ambiguous exact-name AREA anchor when OSM boundary carries valid Wikidata QID', async () => {
      // Reproduces the live RW1 "caminata histórica por San Telmo" failure:
      // - Two Nominatim results with same normalized exact name "San Telmo"
      //   → exactName multiplicity = MULTIPLE
      // - The selected boundary (osm:relation:2223069) has tags.wikidata = "Q1026688"
      // - Before fix: wikidataQid never reaches EntityCandidate → IdentityVerifier
      //   falls back to NEARBY → REJECTED → anchor unresolved
      // - After fix: wikidataQid propagates → IdentityVerifier VERIFIED via OWN_QID
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 2223069,
            addresstype: 'suburb',
            placeRank: 20,
            class: 'place',
            type: 'suburb',
            displayName: 'San Telmo, Buenos Aires, Argentina',
            importance: 0.3,
            latitude: -34.62,
            longitude: -58.37,
          },
          {
            osmType: 'relation',
            osmId: 999999,
            addresstype: 'suburb',
            placeRank: 20,
            class: 'place',
            type: 'suburb',
            // A second exact-name area INSIDE the destination: genuine
            // ambiguity (an out-of-destination homonym would not count).
            displayName: 'San Telmo, Palermo, Buenos Aires, Argentina',
            importance: 0.25,
            latitude: -34.58,
            longitude: -58.43,
          },
        ]),
        reverse: jest.fn(),
      };
      const boundaryGeometry = {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-58.38, -34.63],
            [-58.36, -34.63],
            [-58.36, -34.61],
            [-58.38, -34.61],
            [-58.38, -34.63],
          ],
        ],
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'success',
          value: {
            id: 'osm:relation:2223069',
            name: 'San Telmo',
            osmType: 'relation',
            osmId: 2223069,
            geometry: boundaryGeometry,
            tags: { boundary: 'administrative', wikidata: 'Q1026688' },
          },
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-san-telmo' }),
      };
      // Wikidata must be available and return the entity summary for Q1026688
      // confirming the San Telmo identity.
      // getEntitySummaries returns a Map<qid, WikidataEntitySummary>
      const wikidata = {
        getEntitySummaries: jest
          .fn()
          .mockResolvedValue(
            new Map([
              [
                'Q1026688',
                { qid: 'Q1026688', label: 'San Telmo', aliases: [] },
              ],
            ]),
          ),
        findNearbyPlaces: jest.fn().mockResolvedValue([]),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
        undefined,
        wikidata as any,
      );

      const result = await service.resolveArea(
        areaAnchor,
        'ar',
        {
          latitude: -34.6,
          longitude: -58.38,
        },
        BUENOS_AIRES_DESTINATION,
      );

      // AFTER FIX: should be resolved and persisted
      expect(result).toEqual(
        expect.objectContaining({
          resolved: true,
          status: 'match',
          geoEntityId: 'geo-san-telmo',
          kind: 'area',
          externalId: 'osm:relation:2223069',
        }),
      );
      expect(catalog.upsertGeoEntity).toHaveBeenCalled();

      // Wikidata.getEntitySummaries must be called with the QID from the OSM tags
      expect(wikidata.getEntitySummaries).toHaveBeenCalledWith(['Q1026688']);
      // NEARBY fallback must NOT be called (proves OWN_QID path was used)
      expect(wikidata.findNearbyPlaces).not.toHaveBeenCalled();
    });

    it('stays unresolved when OSM boundary has malformed/multi-QID wikidata tag', async () => {
      // Multiple QIDs in the tag must NOT verify (fail-closed)
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 2223069,
            addresstype: 'suburb',
            placeRank: 20,
            class: 'place',
            type: 'suburb',
            displayName: 'San Telmo, Buenos Aires, Argentina',
            importance: 0.3,
            latitude: -34.62,
            longitude: -58.37,
          },
          {
            osmType: 'relation',
            osmId: 999999,
            addresstype: 'suburb',
            placeRank: 20,
            class: 'place',
            type: 'suburb',
            // A second exact-name area INSIDE the destination: genuine
            // ambiguity (an out-of-destination homonym would not count).
            displayName: 'San Telmo, Palermo, Buenos Aires, Argentina',
            importance: 0.25,
            latitude: -34.58,
            longitude: -58.43,
          },
        ]),
        reverse: jest.fn(),
      };
      const boundaryGeometry = {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-58.38, -34.63],
            [-58.36, -34.63],
            [-58.36, -34.61],
            [-58.38, -34.61],
            [-58.38, -34.63],
          ],
        ],
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'success',
          value: {
            id: 'osm:relation:2223069',
            name: 'San Telmo',
            osmType: 'relation',
            osmId: 2223069,
            geometry: boundaryGeometry,
            tags: { boundary: 'administrative', wikidata: 'Q123;Q456' },
          },
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-san-telmo' }),
      };
      const wikidata = {
        getEntitySummaries: jest.fn().mockResolvedValue([]),
        findNearbyPlaces: jest.fn().mockResolvedValue([]),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
        undefined,
        wikidata as any,
      );

      const result = await service.resolveArea(
        areaAnchor,
        'ar',
        {
          latitude: -34.6,
          longitude: -58.38,
        },
        BUENOS_AIRES_DESTINATION,
      );

      // Malformed QID → no wikidataQid → NEARBY fallback attempted → still fails
      // because NEARBY doesn't match both hint + candidate
      expect(result).toEqual(
        expect.objectContaining({ resolved: false, status: 'no_match' }),
      );
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // RW3-F1/F3: destination compatibility outranks incompatible
  // homonyms; bounded Bitácora candidate facts
  // ──────────────────────────────────────────────────────────────

  describe('RW3-F1/F3: destination-compatible candidates outrank incompatible homonyms', () => {
    // A homonymous village ~300km OUTSIDE the destination. Before
    // Bitácora F1 it silently killed the real in-destination venue
    // through cross-branch "ambiguity".
    const farAwayBoundaryGeometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-6.5, 38.6],
          [-6.1, 38.6],
          [-6.1, 38.8],
          [-6.5, 38.8],
          [-6.5, 38.6],
        ],
      ],
    };
    // Málaga-province-like destination boundary, big enough to contain
    // the real Caminito del Rey viewpoint (36.92, -4.77).
    const malagaScope: GeographicScope = {
      kind: 'AREA_BOUNDARY',
      boundary: {
        id: 'osm:relation:347835',
        name: 'Málaga',
        osmType: 'relation',
        osmId: 347835,
        tags: { admin_level: '6' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-5.6, 36.5],
              [-4.3, 36.5],
              [-4.3, 37.0],
              [-5.6, 37.0],
              [-5.6, 36.5],
            ],
          ],
        },
      },
    };
    const caminitoAnchor: InterpretedAnchor = {
      rawName: 'Caminito del Rey',
      usage: 'specific_destination',
      priority: 'must',
    };
    // Area-eligible Nominatim homonym far outside Málaga.
    const farVillageNominatim = [
      {
        osmType: 'relation',
        osmId: 900,
        addresstype: 'village',
        placeRank: 18,
        class: 'place',
        type: 'village',
        displayName: 'Caminito del Rey, Badajoz, Extremadura, España',
        importance: 0.62,
        latitude: 38.7,
        longitude: -6.3,
      },
    ];
    const farVillageBoundary = {
      id: 'osm:relation:900',
      name: 'Caminito del Rey',
      osmType: 'relation' as const,
      osmId: 900,
      geometry: farAwayBoundaryGeometry,
      tags: { boundary: 'administrative', admin_level: '8' },
    };
    const inDestinationVenuePlaces = {
      provider: 'google',
      searchText: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'place-caminito',
            displayName: { text: 'Caminito del Rey' },
            name: 'Caminito del Rey',
            location: { latitude: 36.92, longitude: -4.77 },
            primaryType: 'tourist_attraction',
            types: ['tourist_attraction', 'point_of_interest'],
          },
        ],
      }),
    };
    it('selects the compatible in-destination venue and records the incompatible homonym as rejected evidence', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue(farVillageNominatim),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'success',
          value: farVillageBoundary,
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-caminito' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
        inDestinationVenuePlaces as any,
      );

      const [result] = await service.resolveNamedAnchors([caminitoAnchor], {
        geographicScope: malagaScope,
        destinationCountryCode: 'es',
      });

      expect(result).toEqual(
        expect.objectContaining({
          status: 'resolved',
          kind: 'venue',
          canonicalName: 'Caminito del Rey',
        }),
      );
      // The homonym was discovered but recorded as REJECTED — it never
      // became selectable and never killed the real venue.
      expect(result.candidateFacts).toEqual([
        expect.objectContaining({
          branch: 'area',
          discoveryStatus: 'rejected',
          eligibility: 'REJECTED_DESTINATION_INCOMPATIBLE',
          canonicalName: 'Caminito del Rey',
          compatibility: {
            verdict: 'INCOMPATIBLE',
            reason: 'OUTSIDE_DESTINATION_BOUNDARY',
          },
        }),
        expect.objectContaining({
          branch: 'route',
          eligibility: 'NO_CANDIDATE',
        }),
        expect.objectContaining({
          branch: 'place',
          discoveryStatus: 'match',
          eligibility: 'ELIGIBLE',
          decision: 'SELECTED',
          compatibility: {
            verdict: 'COMPATIBLE',
            reason: 'WITHIN_DESTINATION_BOUNDARY',
          },
        }),
      ]);
    });
    it('fails honestly with DESTINATION_INCOMPATIBLE when only out-of-destination homonyms were discovered', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue(farVillageNominatim),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'success',
          value: farVillageBoundary,
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = { upsertGeoEntity: jest.fn() };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      const [result] = await service.resolveNamedAnchors([caminitoAnchor], {
        geographicScope: malagaScope,
        destinationCountryCode: 'es',
      });

      expect(result).toEqual(
        expect.objectContaining({
          status: 'unresolved',
          unresolvedReason: 'DESTINATION_INCOMPATIBLE',
        }),
      );
      expect(result.candidateFacts).toEqual([
        expect.objectContaining({
          branch: 'area',
          discoveryStatus: 'rejected',
          eligibility: 'REJECTED_DESTINATION_INCOMPATIBLE',
        }),
        expect.objectContaining({
          branch: 'route',
          eligibility: 'NO_CANDIDATE',
        }),
        expect.objectContaining({
          branch: 'place',
          eligibility: 'NO_CANDIDATE',
        }),
      ]);
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });
    it('keeps genuine ambiguity among destination-compatible identities unresolved (fail-closed)', async () => {
      // A homonymous village INSIDE the destination (area branch) plus
      // the real attraction venue (Places branch): two compatible
      // identities with the same name — a genuinely ambiguous choice.
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 901,
            addresstype: 'village',
            placeRank: 18,
            class: 'place',
            type: 'village',
            displayName: 'Caminito del Rey, Ardales, Málaga, España',
            importance: 0.62,
            latitude: 36.88,
            longitude: -4.8,
          },
        ]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'success',
          value: {
            id: 'osm:relation:901',
            name: 'Caminito del Rey',
            osmType: 'relation' as const,
            osmId: 901,
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-4.85, 36.85],
                  [-4.75, 36.85],
                  [-4.75, 36.91],
                  [-4.85, 36.91],
                  [-4.85, 36.85],
                ],
              ],
            },
            tags: { boundary: 'administrative', admin_level: '8' },
          },
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = { upsertGeoEntity: jest.fn() };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
        inDestinationVenuePlaces as any,
      );

      const [result] = await service.resolveNamedAnchors([caminitoAnchor], {
        geographicScope: malagaScope,
        destinationCountryCode: 'es',
      });

      expect(result).toEqual(
        expect.objectContaining({
          status: 'unresolved',
          unresolvedReason: 'NO_CONFIDENT_GEO_ENTITY_MATCH',
        }),
      );
      expect(result.candidateFacts).toEqual([
        expect.objectContaining({
          branch: 'area',
          eligibility: 'ELIGIBLE',
          decision: 'AMBIGUOUS_IDENTITY',
        }),
        expect.objectContaining({
          branch: 'route',
          eligibility: 'NO_CANDIDATE',
        }),
        expect.objectContaining({
          branch: 'place',
          eligibility: 'ELIGIBLE',
          decision: 'AMBIGUOUS_IDENTITY',
        }),
      ]);
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });
  });

  describe('same-branch homonyms: destination compatibility before ranking', () => {
    // Real-world shape: a common street/place name repeated across the
    // country. Provider order/importance favors a homonym OUTSIDE the
    // destination; a compatible same-name candidate follows it.
    const anchor: InterpretedAnchor = {
      rawName: 'Caminito',
      usage: 'named_path',
      priority: 'must',
    };
    const street = (
      osmId: number,
      displayName: string,
      latitude: number,
      longitude: number,
      importance: number,
    ) => ({
      osmType: 'way',
      osmId,
      addresstype: 'road',
      placeRank: 26,
      class: 'highway',
      type: 'pedestrian',
      displayName,
      importance,
      latitude,
      longitude,
    });
    const outsideEzeiza = street(
      269972048,
      'Caminito, La Unión, Partido de Ezeiza, Buenos Aires, Argentina',
      -34.8878,
      -58.5384,
      0.4,
    );
    const outsideMerlo = street(
      205650907,
      'Caminito, San Antonio de Padua, Partido de Merlo, Buenos Aires, Argentina',
      -34.655,
      -58.7119,
      0.39,
    );
    const insideLaBoca = street(
      144844726,
      'Caminito, La Boca, Ciudad Autónoma de Buenos Aires, Argentina',
      -34.6394,
      -58.3626,
      0.2,
    );
    const insideOther = street(
      999000111,
      'Caminito, Villa Lugano, Ciudad Autónoma de Buenos Aires, Argentina',
      -34.68,
      -58.47,
      0.1,
    );
    const build = (results: unknown[], placesApi?: unknown) => {
      const nominatim = {
        search: jest.fn().mockResolvedValue(results),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn(),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-caminito' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
        placesApi as any,
      );
      return { service, catalog };
    };
    const resolve = (service: AreaRouteAnchorResolverService) =>
      service.resolveNamedAnchors([anchor], {
        geographicScope: BUENOS_AIRES_DESTINATION,
        destinationCountryCode: 'ar',
      });

    it('A1: selects the compatible homonym even when an incompatible one ranks first', async () => {
      const { service, catalog } = build([outsideEzeiza, insideLaBoca]);

      const [result] = await resolve(service);

      expect(result).toEqual(
        expect.objectContaining({
          status: 'resolved',
          kind: 'venue',
          externalId: 'osm:way:144844726',
        }),
      );
      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: 'osm:way:144844726' }),
      );
      const placeFacts = result.candidateFacts?.filter(
        (fact) => fact.branch === 'place',
      );
      expect(placeFacts).toEqual([
        expect.objectContaining({
          eligibility: 'ELIGIBLE',
          decision: 'SELECTED',
          externalId: 'osm:way:144844726',
          compatibility: {
            verdict: 'COMPATIBLE',
            reason: 'WITHIN_DESTINATION_BOUNDARY',
          },
        }),
        expect.objectContaining({
          discoveryStatus: 'rejected',
          eligibility: 'REJECTED_DESTINATION_INCOMPATIBLE',
          externalId: 'osm:way:269972048',
          compatibility: {
            verdict: 'INCOMPATIBLE',
            reason: 'OUTSIDE_DESTINATION_BOUNDARY',
          },
        }),
      ]);
    });

    it('A2: outside homonyms do not make the single compatible identity ambiguous', async () => {
      // 3 raw exact-name matches, 1 destination-compatible: identity
      // multiplicity is judged on the compatible pool (SINGLE), so the
      // real identity verifies instead of failing as MULTIPLE.
      const { service, catalog } = build([
        outsideEzeiza,
        outsideMerlo,
        insideLaBoca,
      ]);

      const [result] = await resolve(service);

      expect(result).toEqual(
        expect.objectContaining({
          status: 'resolved',
          externalId: 'osm:way:144844726',
        }),
      );
      expect(catalog.upsertGeoEntity).toHaveBeenCalledTimes(1);
      expect(
        result.candidateFacts?.filter(
          (fact) => fact.eligibility === 'REJECTED_DESTINATION_INCOMPATIBLE',
        ),
      ).toHaveLength(2);
    });

    it('A3: two compatible same-name identities stay ambiguous (fail-closed)', async () => {
      const { service, catalog } = build([
        outsideEzeiza,
        insideLaBoca,
        insideOther,
      ]);

      const [result] = await resolve(service);

      expect(result.status).toBe('unresolved');
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it('A4: only incompatible homonyms -> DESTINATION_INCOMPATIBLE, no wrong-geography fallback', async () => {
      const { service, catalog } = build([outsideEzeiza, outsideMerlo]);

      const [result] = await resolve(service);

      expect(result).toEqual(
        expect.objectContaining({
          status: 'unresolved',
          unresolvedReason: 'DESTINATION_INCOMPATIBLE',
        }),
      );
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
      expect(
        result.candidateFacts
          ?.filter((fact) => fact.branch === 'place')
          .map((fact) => [fact.eligibility, fact.externalId]),
      ).toEqual([
        ['REJECTED_DESTINATION_INCOMPATIBLE', 'osm:way:269972048'],
        ['REJECTED_DESTINATION_INCOMPATIBLE', 'osm:way:205650907'],
      ]);
    });

    it('A5: Places item zero outside the destination does not hide a compatible item', async () => {
      const place = (id: string, latitude: number, longitude: number) => ({
        id,
        displayName: { text: 'Caminito' },
        name: 'Caminito',
        location: { latitude, longitude },
        primaryType: 'tourist_attraction',
        types: ['tourist_attraction', 'point_of_interest'],
      });
      const placesApi = {
        provider: 'google',
        searchText: jest.fn().mockResolvedValue({
          data: [
            place('place-ezeiza', -34.8878, -58.5384),
            place('place-la-boca', -34.6394, -58.3626),
          ],
        }),
      };
      const { service, catalog } = build([], placesApi);

      const [result] = await resolve(service);

      expect(result).toEqual(
        expect.objectContaining({ status: 'resolved', kind: 'venue' }),
      );
      expect(result.status === 'resolved' && result.externalId).toContain(
        'place-la-boca',
      );
      expect(catalog.upsertGeoEntity).toHaveBeenCalledTimes(1);
      expect(
        result.candidateFacts
          ?.filter((fact) => fact.branch === 'place')
          .map((fact) => fact.eligibility),
      ).toEqual(['ELIGIBLE', 'REJECTED_DESTINATION_INCOMPATIBLE']);
    });
    it('A1/A2 (area branch): an outside homonym ranked first neither wins nor creates ambiguity', async () => {
      const suburb = (
        osmId: number,
        displayName: string,
        latitude: number,
        longitude: number,
        importance: number,
      ) => ({
        osmType: 'relation',
        osmId,
        addresstype: 'suburb',
        placeRank: 20,
        class: 'place',
        type: 'suburb',
        displayName,
        importance,
        latitude,
        longitude,
      });
      const nominatim = {
        search: jest
          .fn()
          .mockResolvedValue([
            suburb(20, 'San Telmo, La Plata, Argentina', -34.92, -57.95, 0.4),
            suburb(
              10,
              'San Telmo, Buenos Aires, Argentina',
              -34.62,
              -58.37,
              0.3,
            ),
          ]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn().mockResolvedValue({
          status: 'success',
          value: {
            id: 'osm:relation:10',
            name: 'San Telmo',
            osmType: 'relation',
            osmId: 10,
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-58.38, -34.63],
                  [-58.36, -34.63],
                  [-58.36, -34.61],
                  [-58.38, -34.61],
                  [-58.38, -34.63],
                ],
              ],
            },
            tags: { boundary: 'administrative', admin_level: '10' },
          },
        }),
        lookupHighwaysByName: noHighways(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-san-telmo' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      const [result] = await service.resolveNamedAnchors(
        [{ rawName: 'San Telmo', usage: 'geographic_scope', priority: 'soft' }],
        {
          geographicScope: BUENOS_AIRES_DESTINATION,
          destinationCountryCode: 'ar',
          destinationPoint: { latitude: -34.92, longitude: -57.95 },
        },
      );

      expect(osmPlaces.lookupBoundaryById).toHaveBeenCalledWith('relation', 10);
      expect(osmPlaces.lookupBoundaryById).not.toHaveBeenCalledWith(
        'relation',
        20,
      );
      expect(result).toEqual(
        expect.objectContaining({
          status: 'resolved',
          kind: 'area',
          externalId: 'osm:relation:10',
        }),
      );
      expect(
        result.candidateFacts?.filter((fact) => fact.branch === 'area'),
      ).toEqual([
        expect.objectContaining({ decision: 'SELECTED' }),
        expect.objectContaining({
          eligibility: 'REJECTED_DESTINATION_INCOMPATIBLE',
          externalId: 'osm:relation:20',
        }),
      ]);
    });
  });

  describe('regional AREA anchors (spec 2026-10-02 Part II, PD1 / §P2-5 #10)', () => {
    // A real town ~90 km from the destination, the only in-country match.
    const regionalTown = {
      osmType: 'relation',
      osmId: 5550001,
      addresstype: 'town',
      placeRank: 16,
      class: 'boundary',
      type: 'administrative',
      displayName: 'Regional Town, Province, Argentina',
      importance: 0.4,
      latitude: -35.4,
      longitude: -58.4,
    };
    const regionalBoundary = {
      id: 'osm:relation:5550001',
      name: 'Regional Town',
      osmType: 'relation',
      osmId: 5550001,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-58.5, -35.5],
            [-58.3, -35.5],
            [-58.3, -35.3],
            [-58.5, -35.3],
            [-58.5, -35.5],
          ],
        ],
      },
      tags: { boundary: 'administrative', admin_level: '8' },
    };
    const build = (results: any[]) => {
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-regional' }),
        upsertGeoEntityWithIdentities: jest.fn().mockResolvedValue({
          status: 'CREATED',
          geoEntity: { id: 'geo-regional' },
          attachedExternalIds: [],
        }),
        findGeoEntityIdsByIdentities: jest.fn().mockResolvedValue([]),
      };
      return new AreaRouteAnchorResolverService(
        {
          lookupBoundaryById: jest
            .fn()
            .mockResolvedValue({ status: 'success', value: regionalBoundary }),
          lookupHighwaysByName: noHighways(),
        } as any,
        catalog as any,
        {
          search: jest.fn().mockResolvedValue(results),
          reverse: jest.fn(),
        } as any,
      );
    };
    const anchor = (usage: InterpretedAnchor['usage']): InterpretedAnchor => ({
      rawName: 'Regional Town',
      usage,
      priority: 'must',
    });

    it('a geographic_scope anchor with exactly one in-country area-scale match beyond the destination resolves as a regional AREA anchor', async () => {
      const [result] = await build([regionalTown]).resolveNamedAnchors(
        [anchor('geographic_scope')],
        {
          destinationCountryCode: 'ar',
          geographicScope: BUENOS_AIRES_DESTINATION,
        },
      );
      expect(result).toMatchObject({
        status: 'resolved',
        kind: 'area',
        canonicalName: 'Regional Town',
        geoEntityId: 'geo-regional',
      });
    });

    it('any other usage keeps the destination-bounded contract (Bitácora F1)', async () => {
      const [result] = await build([regionalTown]).resolveNamedAnchors(
        [anchor('unknown')],
        {
          destinationCountryCode: 'ar',
          geographicScope: BUENOS_AIRES_DESTINATION,
        },
      );
      expect(result).toMatchObject({
        status: 'unresolved',
        unresolvedReason: 'DESTINATION_INCOMPATIBLE',
      });
    });

    it('out-of-destination homonyms fail closed -- never nearest-wins', async () => {
      const [result] = await build([
        regionalTown,
        { ...regionalTown, osmId: 5550002, latitude: -36.9, longitude: -60.3 },
      ]).resolveNamedAnchors([anchor('geographic_scope')], {
        destinationCountryCode: 'ar',
        geographicScope: BUENOS_AIRES_DESTINATION,
      });
      expect(result.status).toBe('unresolved');
    });
  });
});
