import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GeoapifyPlacesApiService } from './geoapify-places-api.service';
import { PlacesApiRequestError } from '../interfaces/places-api.interface';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GeoapifyPlacesApiService', () => {
  let service: GeoapifyPlacesApiService;

  const mockConfigService = {
    get: jest.fn((key: string) =>
      key === 'GEOAPIFY_API_KEY' ? 'test-api-key' : undefined,
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeoapifyPlacesApiService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<GeoapifyPlacesApiService>(GeoapifyPlacesApiService);
    jest.clearAllMocks();
  });

  describe('searchNearby', () => {
    it('builds the request with a mapped category and a lon,lat circle filter', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { features: [] } });

      await service.searchNearby({
        latitude: -34.6037,
        longitude: -58.3816,
        radius: 2000,
        includedPrimaryTypes: ['museum'],
        maxResultCount: 10,
      });

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.geoapify.com/v2/places',
        {
          params: {
            categories: 'entertainment.museum',
            filter: 'circle:-58.3816,-34.6037,2000',
            limit: 10,
            apiKey: 'test-api-key',
          },
          timeout: 5000,
        },
      );
    });

    it('maps a Geoapify feature to PlaceData, echoing back the requested type', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          features: [
            {
              properties: {
                place_id: 'geoapify-place-1',
                name: 'Museo Nacional',
                formatted: 'Av. Siempre Viva 123, Buenos Aires',
                lat: -34.6,
                lon: -58.38,
              },
            },
          ],
        },
      });

      const results = await service.searchNearby({
        latitude: -34.6037,
        longitude: -58.3816,
        radius: 2000,
        includedPrimaryTypes: ['museum'],
      });

      expect(results.data).toEqual([
        {
          id: 'geoapify-place-1',
          name: 'Museo Nacional',
          displayName: { text: 'Museo Nacional' },
          formattedAddress: 'Av. Siempre Viva 123, Buenos Aires',
          location: { latitude: -34.6, longitude: -58.38 },
          types: ['museum'],
          rating: undefined,
          userRatingCount: undefined,
        },
      ]);
      expect(results.provenance).toEqual({
        provider: 'geoapify',
        cacheStatus: 'miss-live',
        requestedCount: 20,
        receivedCount: 1,
      });
    });

    it('returns an empty array when no category mapping exists for the requested type', async () => {
      const results = await service.searchNearby({
        latitude: -34.6037,
        longitude: -58.3816,
        radius: 2000,
        includedPrimaryTypes: ['unmapped_type'],
      });

      expect(results.data).toEqual([]);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('searchText', () => {
    // Round 2 correction: this method used to be a documented no-op stub
    // ("Geoapify has no descriptive Text Search capability"). Live-confirmed
    // against the real Geoapify Autocomplete API (2026-09-17) that it DOES
    // support named-venue search via `type=amenity` — the stub premise was
    // wrong, not a real product limitation. See
    // docs/superpowers/characterization/2026-09-15-composite-experience-adversarial-review.md
    // Root Cause #3.
    it('builds the request against the Autocomplete endpoint with text/type=amenity/a hard circle filter/proximity bias, when locationBias is provided', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { results: [] } });

      await service.searchText({
        textQuery: 'MALBA Museum',
        maxResultCount: 5,
        locationBias: {
          center: { latitude: -34.6037, longitude: -58.3816 },
          radius: 50000,
        },
      });

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.geoapify.com/v1/geocode/autocomplete',
        {
          params: {
            text: 'MALBA Museum',
            type: 'amenity',
            filter: 'circle:-58.3816,-34.6037,50000',
            bias: 'proximity:-58.3816,-34.6037',
            limit: 5,
            format: 'json',
            apiKey: 'test-api-key',
          },
          timeout: 5000,
        },
      );
    });

    it('maps a real Autocomplete result shape to PlaceData (live-captured MALBA fixture)', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          results: [
            {
              name: 'Museo de Arte Latinoamericano de Buenos Aires (MALBA)',
              lat: -34.5768817,
              lon: -58.4033919,
              formatted:
                'Museo de Arte Latinoamericano de Buenos Aires (MALBA), Avenida Presidente Figueroa Alcorta 3415, Palermo, C1425 CLA Buenos Aires, Argentina',
              category: 'entertainment.museum',
              place_id: 'geoapify-malba-place-id',
            },
          ],
        },
      });

      const results = await service.searchText({
        textQuery: 'MALBA Museum',
        locationBias: {
          center: { latitude: -34.6037, longitude: -58.3816 },
          radius: 50000,
        },
      });

      expect(results.data).toEqual([
        {
          id: 'geoapify-malba-place-id',
          name: 'Museo de Arte Latinoamericano de Buenos Aires (MALBA)',
          displayName: {
            text: 'Museo de Arte Latinoamericano de Buenos Aires (MALBA)',
          },
          formattedAddress:
            'Museo de Arte Latinoamericano de Buenos Aires (MALBA), Avenida Presidente Figueroa Alcorta 3415, Palermo, C1425 CLA Buenos Aires, Argentina',
          location: { latitude: -34.5768817, longitude: -58.4033919 },
          types: ['entertainment.museum'],
          primaryType: 'entertainment.museum',
          rating: undefined,
          userRatingCount: undefined,
          priceLevel: undefined,
          openingHoursWeekdayText: undefined,
        },
      ]);
    });

    it('falls back to an empty types array when the raw result carries no category (real API responses always have one for amenity results, but the mapper must not assume it)', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          results: [
            {
              name: 'Uncategorized result',
              lat: -34.6,
              lon: -58.38,
              place_id: 'geoapify-place-3',
            },
          ],
        },
      });

      const results = await service.searchText({
        textQuery: 'Uncategorized result',
        locationBias: {
          center: { latitude: -34.6037, longitude: -58.3816 },
          radius: 50000,
        },
      });

      expect(results.data[0].types).toEqual([]);
      expect(results.data[0].primaryType).toBeUndefined();
    });

    it("echoes back the requested includedType, matching searchNearby's convention", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          results: [
            {
              name: 'Some Museum',
              lat: -34.6,
              lon: -58.38,
              place_id: 'geoapify-place-2',
            },
          ],
        },
      });

      const results = await service.searchText({
        textQuery: 'Some Museum',
        includedType: 'museum',
        locationBias: {
          center: { latitude: -34.6037, longitude: -58.3816 },
          radius: 50000,
        },
      });

      expect(results.data[0].types).toEqual(['museum']);
    });

    it('fails closed — never searches globally without a locationBias (live-confirmed: an unscoped query can rank a same-named place in a different country first)', async () => {
      const results = await service.searchText({
        textQuery: 'San Ignacio Church',
      });

      expect(results.data).toEqual([]);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('reports provider provenance on request failure', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('network error'));

      await expect(
        service.searchText({
          textQuery: 'MALBA Museum',
          locationBias: {
            center: { latitude: -34.6037, longitude: -58.3816 },
            radius: 50000,
          },
        }),
      ).rejects.toMatchObject<Partial<PlacesApiRequestError>>({
        provenance: {
          provider: 'geoapify',
          cacheStatus: 'miss-live',
          requestedCount: 5,
          receivedCount: 0,
        },
      });
    });
  });

  describe('getPlaceDetails', () => {
    it('maps contact.phone and website to nationalPhoneNumber/websiteUri', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          features: [
            {
              properties: {
                place_id: 'geoapify-place-1',
                name: 'Museo Nacional',
                contact: { phone: '+54 11 1234-5678' },
                website: 'https://example.com',
              },
            },
          ],
        },
      });

      const details = await service.getPlaceDetails('geoapify-place-1');

      expect(details.data).toEqual({
        id: 'geoapify-place-1',
        name: 'Museo Nacional',
        nationalPhoneNumber: '+54 11 1234-5678',
        websiteUri: 'https://example.com',
      });
    });

    it('wraps the raw OSM opening_hours string into weekdayText-shaped array', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          features: [
            {
              properties: {
                place_id: 'geoapify-place-1',
                name: 'Museo Nacional',
                opening_hours: 'Mo-Fr 09:00-18:00; Sa 10:00-14:00',
              },
            },
          ],
        },
      });

      const details = await service.getPlaceDetails('geoapify-place-1');

      expect(details.data.openingHoursWeekdayText).toEqual([
        'Mo-Fr 09:00-18:00; Sa 10:00-14:00',
      ]);
    });

    it('reports provider provenance on request failure', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('network error'));

      await expect(
        service.getPlaceDetails('geoapify-place-1'),
      ).rejects.toMatchObject<Partial<PlacesApiRequestError>>({
        provenance: {
          provider: 'geoapify',
          cacheStatus: 'miss-live',
          requestedCount: 1,
          receivedCount: 0,
        },
      });
    });
  });
});
