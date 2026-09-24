import { GeoEntityKind } from '@prisma/client';
import { StructuredGeoEntityResolverService } from './structured-geoentity-resolver.service';
import { INominatimApiService } from '@integrations/osm/interfaces/nominatim.interface';
import { IPlacesApiService } from '@integrations/google-places/interfaces/places-api.interface';
import { GeographicScope } from '../interfaces/experience-resolution.interface';

describe('StructuredGeoEntityResolverService', () => {
  const destinationPoint = { latitude: -34.6212, longitude: -58.3731 };
  // Destination admin boundary (CABA-like): San Telmo/Recoleta inside,
  // the Partido de San Martín (-34.575, -58.537) and Córdoba outside.
  const destinationScope: GeographicScope = {
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
            [-58.33, -34.71],
            [-58.33, -34.53],
            [-58.53, -34.53],
            [-58.53, -34.71],
          ],
        ],
      },
    },
  };

  const buildService = (
    nominatim?: Partial<INominatimApiService>,
    placesApi?: Partial<IPlacesApiService>,
  ) =>
    new StructuredGeoEntityResolverService(
      nominatim as INominatimApiService,
      placesApi as IPlacesApiService,
    );

  const area = (
    osmId: number,
    displayName: string,
    latitude: number,
    longitude: number,
  ) => ({
    osmType: 'relation' as const,
    osmId,
    addresstype: 'suburb',
    class: 'boundary',
    type: 'administrative',
    placeRank: 20,
    displayName,
    importance: 0.4,
    latitude,
    longitude,
  });

  describe('AREA', () => {
    it('resolves a single destination-compatible area-scale Nominatim result', async () => {
      const nominatim = {
        search: jest
          .fn()
          .mockResolvedValue([
            area(2223069, 'San Telmo, Buenos Aires, Argentina', -34.62, -58.37),
          ]),
      };

      const result = await buildService(nominatim).resolve({
        name: 'San Telmo',
        expectedKind: 'AREA',
        destinationName: 'Buenos Aires',
        destinationCountryCode: 'AR',
        destinationPoint,
        destinationScope,
      });

      expect(result).toMatchObject({
        status: 'RESOLVED',
        candidate: {
          externalId: 'osm:relation:2223069',
          kind: GeoEntityKind.AREA,
          destinationCompatibility: { verdict: 'COMPATIBLE' },
        },
      });
    });

    it('reports NOT_FOUND when no result is area-scale eligible', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'node' as const,
            osmId: 1,
            addresstype: 'house',
            class: 'building',
            displayName: 'Some building',
            importance: 0.1,
          },
        ]),
      };

      const result = await buildService(nominatim).resolve({
        name: 'Nonexistent Area',
        expectedKind: 'AREA',
        destinationName: 'Buenos Aires',
        destinationScope,
      });

      expect(result).toEqual({ status: 'NOT_FOUND' });
    });

    it('never RESOLVES a single structurally-eligible AREA outside the destination (San Martín -> Partido de General San Martín)', async () => {
      const nominatim = {
        search: jest
          .fn()
          .mockResolvedValue([
            area(
              9168783,
              'Ciudad del Libertador General San Martín, Partido de General San Martín',
              -34.5755,
              -58.5373,
            ),
          ]),
      };

      const result = await buildService(nominatim).resolve({
        name: 'San Martín',
        expectedKind: 'AREA',
        destinationName: 'Buenos Aires',
        destinationScope,
      });

      expect(result.status).toBe('INCOMPATIBLE');
      if (result.status === 'INCOMPATIBLE') {
        expect(result.reason).toContain('OUTSIDE_DESTINATION_BOUNDARY');
        expect(result.rejected).toHaveLength(1);
      }
    });

    it('never RESOLVES an AREA without a destination admin boundary (UNKNOWN is not compatible)', async () => {
      const nominatim = {
        search: jest
          .fn()
          .mockResolvedValue([
            area(2223069, 'San Telmo, Buenos Aires', -34.62, -58.37),
          ]),
      };

      const result = await buildService(nominatim).resolve({
        name: 'San Telmo',
        expectedKind: 'AREA',
        destinationName: 'Buenos Aires',
      });

      expect(result.status).toBe('AMBIGUOUS');
      if (result.status === 'AMBIGUOUS') {
        expect(result.reason).toBe('DESTINATION_COMPATIBILITY_UNKNOWN');
      }
    });

    it('drops an out-of-destination homonym and RESOLVES the single compatible AREA', async () => {
      const nominatim = {
        search: jest
          .fn()
          .mockResolvedValue([
            area(111, 'Recoleta, Buenos Aires', -34.58, -58.39),
            area(222, 'Recoleta, Córdoba', -31.4, -64.18),
          ]),
      };

      const result = await buildService(nominatim).resolve({
        name: 'Recoleta',
        expectedKind: 'AREA',
        destinationName: 'Buenos Aires',
        destinationScope,
      });

      expect(result).toMatchObject({
        status: 'RESOLVED',
        candidate: { externalId: 'osm:relation:111' },
      });
    });
  });

  describe('PLACE', () => {
    it('resolves a single geographically and categorically compatible Places result', async () => {
      const placesApi = {
        provider: 'geoapify' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'geoapify-zanjon',
              name: 'El Zanjón de Granados (historic ruins)',
              displayName: { text: 'El Zanjón de Granados (historic ruins)' },
              location: { latitude: -34.6167, longitude: -58.3718 },
              types: ['entertainment.museum'],
              primaryType: 'entertainment.museum',
            },
          ],
          provenance: {
            provider: 'geoapify' as const,
            cacheStatus: 'miss-live' as const,
            requestedCount: 5,
            receivedCount: 1,
          },
        }),
      };
      const service = buildService(undefined, placesApi);

      const result = await service.resolve({
        name: 'El Zanjón de Granados',
        expectedKind: 'PLACE',
        destinationName: 'Buenos Aires, Argentina',
        destinationPoint,
      });

      expect(placesApi.searchText).toHaveBeenCalledWith({
        textQuery: 'El Zanjón de Granados',
        maxResultCount: 5,
        locationBias: {
          center: destinationPoint,
          radius: expect.any(Number),
        },
      });
      expect(result).toMatchObject({
        status: 'RESOLVED',
        candidate: {
          externalId: 'geoapify:geoapify-zanjon',
          kind: GeoEntityKind.PLACE,
        },
      });
    });

    it('excludes accommodation-category results as structurally incompatible (Recoleta Cemetery vs Hotel Urban Suites Recoleta)', async () => {
      const placesApi = {
        provider: 'geoapify' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'geoapify-cemetery',
              name: 'Cementerio de la Recoleta',
              displayName: { text: 'Cementerio de la Recoleta' },
              location: { latitude: -34.5875, longitude: -58.3931 },
              types: ['tourism.sights.cemetery'],
              primaryType: 'tourism.sights.cemetery',
            },
            {
              id: 'geoapify-hotel',
              name: 'Hotel Urban Suites Recoleta',
              displayName: { text: 'Hotel Urban Suites Recoleta' },
              location: { latitude: -34.5877, longitude: -58.3928 },
              types: ['accommodation.hotel'],
              primaryType: 'accommodation.hotel',
            },
          ],
          provenance: {
            provider: 'geoapify' as const,
            cacheStatus: 'miss-live' as const,
            requestedCount: 5,
            receivedCount: 2,
          },
        }),
      };
      const service = buildService(undefined, placesApi);

      const result = await service.resolve({
        name: 'Recoleta Cemetery',
        expectedKind: 'PLACE',
        destinationName: 'Buenos Aires, Argentina',
        destinationPoint,
      });

      expect(result).toMatchObject({
        status: 'RESOLVED',
        candidate: { externalId: 'geoapify:geoapify-cemetery' },
      });
    });

    it('excludes results outside the destination bias radius as geographically incompatible', async () => {
      const farAway = { latitude: -31.4201, longitude: -64.1888 }; // Cordoba
      const placesApi = {
        provider: 'geoapify' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'geoapify-far',
              name: 'Something Far',
              displayName: { text: 'Something Far' },
              location: farAway,
              types: ['tourism.attraction'],
              primaryType: 'tourism.attraction',
            },
          ],
          provenance: {
            provider: 'geoapify' as const,
            cacheStatus: 'miss-live' as const,
            requestedCount: 5,
            receivedCount: 1,
          },
        }),
      };
      const service = buildService(undefined, placesApi);

      const result = await service.resolve({
        name: 'Something Far',
        expectedKind: 'PLACE',
        destinationName: 'Buenos Aires, Argentina',
        destinationPoint,
      });

      expect(result).toEqual({ status: 'NOT_FOUND' });
    });

    it('reports AMBIGUOUS when multiple structurally/geographically compatible results survive (Plaza Dorrego: park + cafe + school all named similarly)', async () => {
      const placesApi = {
        provider: 'geoapify' as const,
        searchText: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'geoapify-plaza',
              name: 'Plaza Dorrego',
              displayName: { text: 'Plaza Dorrego' },
              location: { latitude: -34.6205, longitude: -58.3718 },
              types: ['leisure.park'],
              primaryType: 'leisure.park',
            },
            {
              id: 'geoapify-cafe',
              name: 'Café Plaza Dorrego',
              displayName: { text: 'Café Plaza Dorrego' },
              location: { latitude: -34.6206, longitude: -58.3714 },
              types: ['catering.cafe'],
              primaryType: 'catering.cafe',
            },
          ],
          provenance: {
            provider: 'geoapify' as const,
            cacheStatus: 'miss-live' as const,
            requestedCount: 5,
            receivedCount: 2,
          },
        }),
      };
      const service = buildService(undefined, placesApi);

      const result = await service.resolve({
        name: 'Plaza Dorrego',
        expectedKind: 'PLACE',
        destinationName: 'Buenos Aires, Argentina',
        destinationPoint,
      });

      expect(result.status).toBe('AMBIGUOUS');
    });
  });

  describe('ROUTE', () => {
    it('is not resolved here: ROUTE belongs to TargetedRouteResolverService (no Nominatim bare-name path)', async () => {
      const nominatim = { search: jest.fn() };

      const result = await buildService(nominatim).resolve({
        name: 'Defensa',
        expectedKind: 'ROUTE',
        destinationName: 'Buenos Aires',
        destinationScope,
      });

      expect(result.status).toBe('INCOMPATIBLE');
      expect(nominatim.search).not.toHaveBeenCalled();
    });
  });
});
