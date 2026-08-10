import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GeoapifyPlacesApiService } from './geoapify-places-api.service';

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
        includedTypes: ['museum'],
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
        includedTypes: ['museum'],
      });

      expect(results).toEqual([
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
    });

    it('returns an empty array when no category mapping exists for the requested type', async () => {
      const results = await service.searchNearby({
        latitude: -34.6037,
        longitude: -58.3816,
        radius: 2000,
        includedTypes: ['unmapped_type'],
      });

      expect(results).toEqual([]);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe('searchText', () => {
    it('approximates a category search for the hiking_trail fallback query', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { features: [] } });

      await service.searchText({
        textQuery: 'hiking trail hiking trekking trail nature',
        latitude: -34.6037,
        longitude: -58.3816,
        radius: 5000,
      });

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.geoapify.com/v2/places',
        expect.objectContaining({
          params: expect.objectContaining({
            categories: 'natural.forest,natural.protected_area',
          }),
        }),
      );
    });

    it('returns an empty array when no keyword approximation matches', async () => {
      const results = await service.searchText({
        textQuery: 'something completely unrelated',
        latitude: -34.6037,
        longitude: -58.3816,
      });

      expect(results).toEqual([]);
      expect(mockedAxios.get).not.toHaveBeenCalled();
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

      expect(details).toEqual({
        id: 'geoapify-place-1',
        name: 'Museo Nacional',
        nationalPhoneNumber: '+54 11 1234-5678',
        websiteUri: 'https://example.com',
      });
    });

    it('returns an empty object on request failure instead of throwing', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('network error'));

      const details = await service.getPlaceDetails('geoapify-place-1');

      expect(details).toEqual({});
    });
  });
});
