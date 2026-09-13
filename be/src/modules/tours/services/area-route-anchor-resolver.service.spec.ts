import { GeoEntityKind } from '@prisma/client';
import { AreaRouteAnchorResolverService } from './area-route-anchor-resolver.service';
import { AnchoredPlace } from '../interfaces/preference-spec.interface';

describe('AreaRouteAnchorResolverService', () => {
  const areaAnchor: AnchoredPlace = {
    rawName: 'San Telmo',
    kind: 'area',
    priority: 'must',
  };
  const routeAnchor: AnchoredPlace = {
    rawName: 'Caminito',
    kind: 'route',
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

      expect(result).toEqual({
        resolved: true,
        geoEntityId: 'geo-san-telmo',
        geometry: boundaryGeometry,
      });
      expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: GeoEntityKind.AREA,
          externalId: 'osm:relation:42',
        }),
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

      expect(result).toEqual({ resolved: false });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it('stays unresolved for a bare node match (no real polygon boundary)', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'node',
            osmId: 1,
            addresstype: 'suburb',
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

      expect(result).toEqual({ resolved: false });
      expect(osmPlaces.lookupBoundaryById).not.toHaveBeenCalled();
    });

    it('stays unresolved (no crash) when lookupBoundaryById fails', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation',
            osmId: 42,
            addresstype: 'suburb',
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

      expect(result).toEqual({ resolved: false });
      expect(catalog.upsertGeoEntity).not.toHaveBeenCalled();
    });

    it('exercises real destination-proximity biasing (reuses bestNominatimMatch)', async () => {
      const near = {
        osmType: 'relation' as const,
        osmId: 1,
        addresstype: 'suburb',
        displayName: 'Catedral San Juan Bautista, San Juan, Argentina',
        importance: 0.199,
        latitude: -31.5375,
        longitude: -68.5364,
      };
      const far = {
        osmType: 'relation' as const,
        osmId: 2,
        addresstype: 'suburb',
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
          kind: 'area',
          priority: 'must',
        },
        undefined,
        { latitude: -31.5375, longitude: -68.5364 },
      );

      expect(osmPlaces.lookupBoundaryById).toHaveBeenCalledWith('relation', 1);
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
      ).resolves.toEqual({ resolved: false });
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

    it('resolves via lookupStreetsWithin when no destinationPointRadius is given', async () => {
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

      const result = await service.resolveRoute(
        routeAnchor,
        { id: 'osm:relation:1', name: 'Buenos Aires' } as any,
        undefined,
      );

      expect(result).toEqual({
        resolved: true,
        geoEntityId: 'geo-caminito',
        geometry: caminitoStreet.geometry,
      });
      expect(osmPlaces.lookupStreetsWithin).toHaveBeenCalled();
      expect(osmPlaces.lookupStreetsNear).not.toHaveBeenCalled();
    });

    it('resolves via lookupStreetsNear when destinationPointRadius is present, never calling lookupStreetsWithin', async () => {
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

      const result = await service.resolveRoute(routeAnchor, undefined, {
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
          kind: 'route',
          priority: 'must',
        },
        { id: 'osm:relation:1', name: 'Buenos Aires' } as any,
        undefined,
      );

      expect(result).toEqual({ resolved: false });
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
        service.resolveRoute(
          routeAnchor,
          { id: 'osm:relation:1', name: 'Buenos Aires' } as any,
          undefined,
        ),
      ).resolves.toEqual({ resolved: false });
    });
  });
});
