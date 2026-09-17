import { GeoEntityKind } from '@prisma/client';
import { AreaRouteAnchorResolverService } from './area-route-anchor-resolver.service';
import { InterpretedAnchor } from '../interfaces/preference-spec.interface';

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
        lookupStreetsWithin: jest.fn(),
        lookupStreetsNear: jest.fn(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-san-telmo' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      const result = await service.resolveArea(areaAnchor, 'ar', {
        latitude: -34.6,
        longitude: -58.38,
      });

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
        lookupStreetsWithin: jest.fn(),
        lookupStreetsNear: jest.fn(),
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
        lookupStreetsWithin: jest.fn(),
        lookupStreetsNear: jest.fn(),
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
        lookupStreetsWithin: jest.fn(),
        lookupStreetsNear: jest.fn(),
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
        lookupStreetsWithin: jest.fn(),
        lookupStreetsNear: jest.fn(),
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
        displayName: 'Catedral San Juan Bautista, San Juan, Argentina',
        importance: 0.199,
        latitude: -31.5375,
        longitude: -68.5364,
      };
      const far = {
        osmType: 'relation' as const,
        osmId: 2,
        addresstype: 'suburb',
        placeRank: 20,
        class: 'place',
        type: 'suburb',
        displayName: 'Catedral San Juan Bautista, Buenos Aires, Argentina',
        importance: 0.208,
        latitude: -34.6037,
        longitude: -58.3816,
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
              geometry: { type: 'Point', coordinates: [-68.5364, -31.5375] },
              tags: {},
            },
          })),
        lookupStreetsWithin: jest.fn(),
        lookupStreetsNear: jest.fn(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-1' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      await service.resolveArea(
        {
          rawName: 'Catedral San Juan Bautista',
          usage: 'unknown',
          priority: 'must',
        },
        undefined,
        { latitude: -31.5375, longitude: -68.5364 },
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
        lookupStreetsWithin: jest.fn(),
        lookupStreetsNear: jest.fn(),
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
        lookupStreetsWithin: jest.fn(),
        lookupStreetsNear: jest.fn(),
      };
      const catalog = { upsertGeoEntity: jest.fn() };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
        nominatim as any,
      );

      await expect(
        service.resolveArea(areaAnchor, undefined, undefined),
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
          lookupStreetsNear:
            mode === 'all-unavailable'
              ? jest.fn().mockRejectedValue(new Error('overpass down'))
              : jest.fn().mockResolvedValue({ status: 'success', value: [] }),
          lookupStreetsWithin: jest.fn(),
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
                            displayName: { text: 'Museo Nacional' },
                            name: 'Museo Nacional',
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
            canonicalName: 'Museo Nacional',
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
          lookupStreetsNear: jest
            .fn()
            .mockResolvedValue({ status: 'success', value: [] }),
          lookupStreetsWithin: jest.fn(),
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

  describe('resolveRoute', () => {
    const caminitoStreet = {
      id: 'osm:way:1',
      name: 'Caminito',
      osmType: 'way' as const,
      osmId: 1,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-58.3634, -34.6382],
          [-58.363, -34.6376],
        ],
      },
      tags: { highway: 'pedestrian' },
    };

    it('resolves via lookupStreetsWithin for AREA_BOUNDARY scope', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [caminitoStreet] }),
        lookupStreetsNear: jest.fn(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-caminito' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
      );

      const result = await service.resolveRoute(routeAnchor, {
        kind: 'AREA_BOUNDARY',
        boundary: { id: 'osm:relation:1', name: 'Buenos Aires' },
      } as any);

      expect(result).toEqual(
        expect.objectContaining({
          resolved: true,
          geoEntityId: 'geo-caminito',
          geometry: caminitoStreet.geometry,
        }),
      );
      expect(osmPlaces.lookupStreetsWithin).toHaveBeenCalled();
      expect(osmPlaces.lookupStreetsNear).not.toHaveBeenCalled();
    });

    it('resolves via lookupStreetsNear for POINT_RADIUS scope, never calling lookupStreetsWithin', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest.fn(),
        lookupStreetsNear: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [caminitoStreet] }),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-caminito' }),
      };
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

      expect(result.resolved).toBe(true);
      expect(osmPlaces.lookupStreetsNear).toHaveBeenCalledWith(
        -34.6,
        -58.4,
        5000,
      );
      expect(osmPlaces.lookupStreetsWithin).not.toHaveBeenCalled();
    });

    it('stays unresolved (a normal outcome) when no street matches the anchor name', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [caminitoStreet] }),
        lookupStreetsNear: jest.fn(),
      };
      const catalog = { upsertGeoEntity: jest.fn() };
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
        {
          kind: 'AREA_BOUNDARY',
          boundary: { id: 'osm:relation:1', name: 'Buenos Aires' },
        } as any,
      );

      expect(result).toEqual(
        expect.objectContaining({ resolved: false, status: 'no_match' }),
      );
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it('never throws when the street lookup itself fails', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest
          .fn()
          .mockRejectedValue(new Error('overpass down')),
        lookupStreetsNear: jest.fn(),
      };
      const catalog = { upsertGeoEntity: jest.fn() };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
      );

      await expect(
        service.resolveRoute(routeAnchor, {
          kind: 'AREA_BOUNDARY',
          boundary: { id: 'osm:relation:1', name: 'Buenos Aires' },
        } as any),
      ).resolves.toMatchObject({ resolved: false, status: 'unavailable' });
    });
  });

  describe('resolveNamedAnchors', () => {
    it('uses linguistic usage only as context and OSM facts as canonical kind', async () => {
      const areaGeometry = {
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
      const routeGeometry = {
        type: 'LineString' as const,
        coordinates: [
          [-58.36, -34.63],
          [-58.35, -34.64],
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
        lookupStreetsWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:way:7',
              name: 'Ruta de los Siete Lagos',
              geometry: routeGeometry,
              tags: {},
            },
          ],
        }),
        lookupStreetsNear: jest.fn(),
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
          status: 'resolved',
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
});
