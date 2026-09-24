import { GeoEntityKind } from '@prisma/client';
import { StructuredGeoEntityResolverService } from './structured-geoentity-resolver.service';
import { INominatimApiService } from '@integrations/osm/interfaces/nominatim.interface';
import { IPlacesApiService } from '@integrations/google-places/interfaces/places-api.interface';

describe('StructuredGeoEntityResolverService', () => {
  const destinationPoint = { latitude: -34.6212, longitude: -58.3731 };

  const buildService = (
    nominatim?: Partial<INominatimApiService>,
    placesApi?: Partial<IPlacesApiService>,
  ) =>
    new StructuredGeoEntityResolverService(
      nominatim as INominatimApiService,
      placesApi as IPlacesApiService,
    );

  describe('AREA', () => {
    it('resolves a single area-scale-eligible Nominatim result', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation' as const,
            osmId: 1224652,
            addresstype: 'suburb',
            class: 'place',
            type: 'suburb',
            placeRank: 20,
            displayName: 'San Telmo, Buenos Aires, Argentina',
            importance: 0.4,
            latitude: -34.62,
            longitude: -58.37,
          },
        ]),
      };
      const service = buildService(nominatim);

      const result = await service.resolve({
        name: 'San Telmo',
        expectedKind: 'AREA',
        destinationName: 'Buenos Aires, Argentina',
        destinationCountryCode: 'AR',
        destinationPoint,
      });

      expect(nominatim.search).toHaveBeenCalledWith('San Telmo', {
        countryCode: 'AR',
        bias: destinationPoint,
      });
      expect(result).toMatchObject({
        status: 'RESOLVED',
        candidate: {
          externalId: 'osm:relation:1224652',
          canonicalName: 'San Telmo, Buenos Aires, Argentina',
          kind: GeoEntityKind.AREA,
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
      const service = buildService(nominatim);

      const result = await service.resolve({
        name: 'Nonexistent Area',
        expectedKind: 'AREA',
        destinationName: 'Buenos Aires, Argentina',
      });

      expect(result).toEqual({ status: 'NOT_FOUND' });
    });

    it('reports AMBIGUOUS when two structurally distinct areas both qualify', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'relation' as const,
            osmId: 111,
            addresstype: 'suburb',
            class: 'place',
            type: 'suburb',
            placeRank: 20,
            displayName: 'Recoleta, Buenos Aires, Argentina',
            importance: 0.4,
          },
          {
            osmType: 'relation' as const,
            osmId: 222,
            addresstype: 'suburb',
            class: 'place',
            type: 'suburb',
            placeRank: 20,
            displayName: 'Recoleta, Cordoba, Argentina',
            importance: 0.3,
          },
        ]),
      };
      const service = buildService(nominatim);

      const result = await service.resolve({
        name: 'Recoleta',
        expectedKind: 'AREA',
        destinationName: 'Buenos Aires, Argentina',
      });

      expect(result.status).toBe('AMBIGUOUS');
      if (result.status === 'AMBIGUOUS') {
        expect(result.candidates).toHaveLength(2);
      }
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
    it('resolves multiple highway-class segments sharing the same name and locality as ONE route identity (a street is rarely a single OSM way)', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'way' as const,
            osmId: 1,
            addresstype: 'road',
            class: 'highway',
            type: 'living_street',
            displayName: 'Defensa, San Telmo, Buenos Aires, Argentina',
            importance: 0.05,
            latitude: -34.62,
            longitude: -58.372,
            address: { suburb: 'San Telmo', city: 'Buenos Aires' },
          },
          {
            osmType: 'way' as const,
            osmId: 2,
            addresstype: 'road',
            class: 'highway',
            type: 'secondary',
            displayName: 'Defensa, San Telmo, Buenos Aires, Argentina',
            importance: 0.05,
            latitude: -34.618,
            longitude: -58.371,
            address: { suburb: 'San Telmo', city: 'Buenos Aires' },
          },
        ]),
      };
      const service = buildService(nominatim);

      const result = await service.resolve({
        name: 'Defensa Street',
        expectedKind: 'ROUTE',
        destinationName: 'Buenos Aires, Argentina',
        destinationCountryCode: 'AR',
        destinationPoint,
      });

      // The key regression fix: Nominatim IS queried for ROUTE, unlike
      // today's resolveViaNominatim early return.
      expect(nominatim.search).toHaveBeenCalled();
      expect(result).toMatchObject({
        status: 'RESOLVED',
        candidate: { kind: GeoEntityKind.ROUTE },
      });
    });

    it('excludes non-highway structural types (a "place" class result never satisfies a ROUTE hint)', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'node' as const,
            osmId: 9,
            addresstype: 'suburb',
            class: 'place',
            type: 'suburb',
            displayName: 'Defensa (a neighborhood, not a street)',
            importance: 0.2,
          },
        ]),
      };
      const service = buildService(nominatim);

      const result = await service.resolve({
        name: 'Defensa Street',
        expectedKind: 'ROUTE',
        destinationName: 'Buenos Aires, Argentina',
      });

      expect(result).toEqual({ status: 'NOT_FOUND' });
    });

    it('reports AMBIGUOUS when the same street name resolves to two genuinely different real streets in different localities (countrywide collision)', async () => {
      const nominatim = {
        search: jest.fn().mockResolvedValue([
          {
            osmType: 'way' as const,
            osmId: 1,
            addresstype: 'road',
            class: 'highway',
            type: 'residential',
            displayName: 'Defensa, Lomas de Zamora, Buenos Aires, Argentina',
            importance: 0.05,
            address: { town: 'Lomas de Zamora' },
          },
          {
            osmType: 'way' as const,
            osmId: 2,
            addresstype: 'road',
            class: 'highway',
            type: 'living_street',
            displayName: 'Defensa, San Telmo, Buenos Aires, Argentina',
            importance: 0.05,
            address: { suburb: 'San Telmo' },
          },
        ]),
      };
      const service = buildService(nominatim);

      const result = await service.resolve({
        name: 'Defensa Street',
        expectedKind: 'ROUTE',
        destinationName: 'Buenos Aires, Argentina',
        destinationPoint,
      });

      expect(result.status).toBe('AMBIGUOUS');
    });
  });
});
