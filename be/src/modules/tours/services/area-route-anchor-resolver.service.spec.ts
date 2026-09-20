import { GeoEntityKind } from '@prisma/client';
import { AreaRouteAnchorResolverService } from './area-route-anchor-resolver.service';
import { InterpretedAnchor } from '../interfaces/preference-spec.interface';
import { normalizeGeoName } from '../utils/nominatim-match.util';

// No global IdentityVerifier mock. The anchor resolver integration
// tests exercise the REAL IdentityVerifier so the selected-candidate →
// verification → persistence path is genuinely tested. Transport/provider
// dependencies (Nominatim, Places, OSM, Wikidata, Catalog) are still
// mocked per-test, but the identity policy itself is real.

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

      // Single OSM way -> identityMultiplicity UNKNOWN -> no independent
      // corroboration -> fail closed (not persisted).
      expect(result).toEqual(
        expect.objectContaining({
          resolved: false,
          status: 'no_match',
          reason: 'IDENTITY_NOT_VERIFIED',
        }),
      );
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
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

      // Single OSM way -> identityMultiplicity UNKNOWN -> no independent
      // corroboration -> fail closed (not persisted).
      expect(result.resolved).toBe(false);
      expect((result as { resolved: false; reason?: string }).reason).toBe(
        'IDENTITY_NOT_VERIFIED',
      );
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
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
          status: 'unresolved',
          unresolvedReason: 'IDENTITY_NOT_VERIFIED',
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
            displayName: 'San Telmo, La Plata, Argentina',
            importance: 0.25,
            latitude: -34.92,
            longitude: -57.95,
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

      const result = await service.resolveArea(areaAnchor, 'ar', {
        latitude: -34.6,
        longitude: -58.38,
      });

      // 2+ exact-name identities → exactNameAmbiguous = true
      // → real verifier cannot verify on exact-name alone → not persisted.
      expect(result).toEqual(
        expect.objectContaining({ resolved: false, status: 'no_match' }),
      );
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it('multiple same-name OSM ways must not by themselves create identity ambiguity', async () => {
      // An OSM street/path can legitimately be represented by multiple
      // way elements (split at intersections, tag changes, geometry
      // boundaries, etc.). N same-name OSM ways != N distinct real-world
      // identities. ROUTE resolution must still succeed.
      const osmPlaces = {
        lookupStreetsWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
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
            },
            {
              id: 'osm:way:2',
              name: 'Caminito',
              osmType: 'way' as const,
              osmId: 2,
              geometry: {
                type: 'LineString' as const,
                coordinates: [
                  [-58.37, -34.64],
                  [-58.369, -34.639],
                ],
              },
              tags: { highway: 'residential' },
            },
          ],
        }),
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

      // Multiple same-name ways must NOT prevent resolution, but
      // identity multiplicity is UNKNOWN for raw OSM ways. Without
      // independent corroboration, verification fails closed.
      expect(result).toEqual(
        expect.objectContaining({
          resolved: false,
          status: 'no_match',
          reason: 'IDENTITY_NOT_VERIFIED',
        }),
      );
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it('ROUTE fuzzy match stays fail-closed for one raw OSM way', async () => {
      // The raw route candidate is selected by existing fuzzy name matching.
      // Raw OSM ROUTE multiplicity stays UNKNOWN/UNKNOWN and fails closed.
      const osmPlaces = {
        lookupStreetsWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:way:1',
              name: 'Defensa',
              osmType: 'way' as const,
              osmId: 1,
              geometry: {
                type: 'LineString' as const,
                coordinates: [
                  [-58.3634, -34.6382],
                  [-58.363, -34.6376],
                ],
              },
              tags: { highway: 'pedestrian', 'name:en': 'Defensa Street' },
            },
          ],
        }),
        lookupStreetsNear: jest.fn(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-defensa' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
      );

      const primaryName = 'Defensa';
      const hintName = 'Defensa Street';
      // Primary MUST NOT equal hint.
      expect(normalizeGeoName(primaryName)).not.toBe(normalizeGeoName(hintName));

      const result = await service.resolveRoute(
        {
          rawName: 'Defensa Street',
          usage: 'unknown',
          priority: 'soft',
        },
        {
          kind: 'AREA_BOUNDARY',
          boundary: { id: 'osm:relation:1', name: 'Buenos Aires' },
        } as any,
      );

      // No raw-way count or metadata may manufacture route uniqueness.
      expect(result).toEqual(
        expect.objectContaining({
          resolved: false,
          status: 'no_match',
          reason: 'IDENTITY_NOT_VERIFIED',
        }),
      );
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    // Two same-name raw OSM ways with alias must still be UNKNOWN/UNKNOWN.
    it('ROUTE fuzzy match stays fail-closed for two raw OSM ways', async () => {
      const osmPlaces = {
        lookupStreetsWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:way:1',
              name: 'Defensa',
              osmType: 'way' as const,
              osmId: 1,
              geometry: {
                type: 'LineString' as const,
                coordinates: [
                  [-58.3634, -34.6382],
                  [-58.363, -34.6376],
                ],
              },
              tags: { highway: 'pedestrian', 'name:en': 'Defensa Street' },
            },
            {
              id: 'osm:way:2',
              name: 'Defensa',
              osmType: 'way' as const,
              osmId: 2,
              geometry: {
                type: 'LineString' as const,
                coordinates: [
                  [-58.37, -34.64],
                  [-58.369, -34.639],
                ],
              },
              tags: { highway: 'residential', 'name:en': 'Defensa Street' },
            },
          ],
        }),
        lookupStreetsNear: jest.fn(),
      };
      const catalog = {
        upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-defensa' }),
      };
      const service = new AreaRouteAnchorResolverService(
        osmPlaces as any,
        catalog as any,
      );

      const result = await service.resolveRoute(
        {
          rawName: 'Defensa Street',
          usage: 'unknown',
          priority: 'soft',
        },
        {
          kind: 'AREA_BOUNDARY',
          boundary: { id: 'osm:relation:1', name: 'Buenos Aires' },
        } as any,
      );

      // Two raw ways still do not establish route identity multiplicity.
      expect(result).toEqual(
        expect.objectContaining({
          resolved: false,
          status: 'no_match',
          reason: 'IDENTITY_NOT_VERIFIED',
        }),
      );
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });
  });

    it('Case E: duplicate exact Places names → ambiguous → not persisted', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([]),
        reverse: jest.fn(),
      };
      const osmPlaces = {
        lookupBoundaryById: jest.fn(),
        lookupStreetsNear: jest.fn().mockResolvedValue({
          status: 'success',
          value: [],
        }),
        lookupStreetsWithin: jest.fn(),
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
        lookupStreetsNear: jest.fn().mockResolvedValue({
          status: 'success',
          value: [],
        }),
        lookupStreetsWithin: jest.fn(),
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
        lookupStreetsNear: jest.fn().mockResolvedValue({
          status: 'success',
          value: [],
        }),
        lookupStreetsWithin: jest.fn(),
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
        lookupStreetsNear: jest.fn().mockResolvedValue({
          status: 'success',
          value: [],
        }),
        lookupStreetsWithin: jest.fn(),
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
        lookupStreetsNear: jest.fn().mockResolvedValue({
          status: 'success',
          value: [],
        }),
        lookupStreetsWithin: jest.fn(),
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
            displayName: 'San Telmo, La Plata, Argentina',
            importance: 0.25,
            latitude: -34.92,
            longitude: -57.95,
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

      const result = await service.resolveArea(areaAnchor, 'ar', {
        latitude: -34.6,
        longitude: -58.38,
      });

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

      await service.resolveArea(areaAnchor, 'ar', {
        latitude: -34.6,
        longitude: -58.38,
      });

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
        lookupStreetsNear: jest.fn().mockResolvedValue({
          status: 'success',
          value: [],
        }),
        lookupStreetsWithin: jest.fn(),
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
        lookupStreetsNear: jest.fn().mockResolvedValue({
          status: 'success',
          value: [],
        }),
        lookupStreetsWithin: jest.fn(),
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
      const { IdentityVerifier } = await import(
        './identity-verifier.service'
      );
      const verifySpy = jest.spyOn(
        IdentityVerifier.prototype,
        'verify',
      );

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
});
