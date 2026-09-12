import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GooglePlacesApiService } from './google-places-api.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GooglePlacesApiService', () => {
  const config = {
    get: jest.fn((key: string) =>
      key === 'GOOGLE_MAPS_API_KEY' ? 'test-google-key' : undefined,
    ),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clamps oversized nearby pools to Google API limit', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { places: [] } });
    const service = new GooglePlacesApiService(config);
    await service.searchNearby({
      latitude: 1,
      longitude: 2,
      radius: 1000,
      maxResultCount: 250,
    });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ maxResultCount: 20 }),
      expect.anything(),
    );
  });

  it('reports Google availability without exposing the key', () => {
    const service = new GooglePlacesApiService(config);

    expect(service.getStatus()).toEqual({
      provider: 'google',
      available: true,
      cacheEnabled: false,
    });
    expect(JSON.stringify(service.getStatus())).not.toContain(
      'test-google-key',
    );
  });

  it('returns live request provenance with mapped places', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        places: [
          {
            id: 'google-place-1',
            displayName: { text: 'Museo de Arte' },
            location: { latitude: 1, longitude: 2 },
            primaryType: 'museum',
            businessStatus: 'CLOSED_PERMANENTLY',
          },
        ],
      },
    });
    const service = new GooglePlacesApiService(config);

    const result = await service.searchNearby({
      latitude: 1,
      longitude: 2,
      radius: 1000,
      maxResultCount: 10,
      includedPrimaryTypes: ['museum', 'art_gallery'],
      rankPreference: 'POPULARITY',
    });

    expect(result.data[0]).toEqual(
      expect.objectContaining({
        id: 'google-place-1',
        name: 'Museo de Arte',
        primaryType: 'museum',
        businessStatus: 'CLOSED_PERMANENTLY',
      }),
    );
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        includedPrimaryTypes: ['museum', 'art_gallery'],
        rankPreference: 'POPULARITY',
        locationRestriction: {
          circle: {
            center: { latitude: 1, longitude: 2 },
            radius: 1000,
          },
        },
      }),
      expect.objectContaining({
        timeout: 5000,
        headers: expect.objectContaining({
          'X-Goog-FieldMask': expect.stringContaining('places.businessStatus'),
        }),
      }),
    );
    expect(result.provenance).toEqual({
      provider: 'google',
      cacheStatus: 'miss-live',
      requestedCount: 10,
      receivedCount: 1,
    });
  });

  it('keeps optional editorialSummary mapping without requesting the paid field in baseline searches', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        places: [
          {
            id: 'google-place-2',
            displayName: { text: 'Museo de Arte' },
            location: { latitude: 1, longitude: 2 },
            primaryType: 'museum',
            websiteUri: 'https://museo.example.com',
            editorialSummary: { text: 'A landmark fine-arts museum.' },
            primaryTypeDisplayName: { text: 'Art museum' },
          },
        ],
      },
    });
    const service = new GooglePlacesApiService(config);

    const result = await service.searchNearby({
      latitude: 1,
      longitude: 2,
      radius: 1000,
    });

    // Keep the mapping contract so a future selective enrichment path can
    // preserve editorialSummary when it intentionally obtains the field.
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        websiteUri: 'https://museo.example.com',
        editorialSummary: { text: 'A landmark fine-arts museum.' },
        primaryTypeDisplayName: { text: 'Art museum' },
      }),
    );

    const [, , requestConfig] = mockedAxios.post.mock.calls[0];
    const fieldMask = (requestConfig as any).headers['X-Goog-FieldMask'];
    expect(fieldMask).toContain('places.websiteUri');
    expect(fieldMask).toContain('places.primaryTypeDisplayName');
    expect(fieldMask).not.toContain('places.editorialSummary');
  });

  it('sends a singular Text Search type with strictness and a destination rectangle', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { places: [] } });
    const service = new GooglePlacesApiService(config);

    await service.searchText({
      textQuery: 'top tourist attractions in Rosario, Argentina',
      includedType: 'tourist_attraction',
      strictTypeFiltering: false,
      locationRestriction: {
        low: { latitude: -33.1, longitude: -60.8 },
        high: { latitude: -32.8, longitude: -60.5 },
      },
      maxResultCount: 10,
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining(':searchText'),
      {
        textQuery: 'top tourist attractions in Rosario, Argentina',
        includedType: 'tourist_attraction',
        strictTypeFiltering: false,
        locationRestriction: {
          rectangle: {
            low: { latitude: -33.1, longitude: -60.8 },
            high: { latitude: -32.8, longitude: -60.5 },
          },
        },
        maxResultCount: 10,
      },
      expect.any(Object),
    );

    const [, , requestConfig] = mockedAxios.post.mock.calls[0];
    const fieldMask = (requestConfig as any).headers['X-Goog-FieldMask'];
    expect(fieldMask).not.toContain('places.editorialSummary');
  });

  it('attaches truthful provenance to provider failures', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('network down'));
    const service = new GooglePlacesApiService(config);

    await expect(
      service.searchText({ textQuery: 'museum', maxResultCount: 5 }),
    ).rejects.toMatchObject({
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 5,
        receivedCount: 0,
      },
    });
  });

  it('classifies daily quota exhaustion and short-circuits repeated requests', async () => {
    const windowStartSeconds = Math.floor(Date.now() / 1000);
    const expectedUnavailableUntil = new Date(
      (windowStartSeconds + 24 * 60 * 60) * 1000,
    ).toISOString();
    mockedAxios.post.mockRejectedValueOnce({
      message: 'Request failed with status code 429',
      response: {
        status: 429,
        data: {
          error: {
            status: 'RESOURCE_EXHAUSTED',
            details: [
              {
                metadata: {
                  quota_unit: '1/d/{project}',
                  quota_limit: 'SearchNearbyRequestPerDayPerProject',
                  window_start_time: windowStartSeconds.toString(),
                },
              },
            ],
          },
        },
      },
    });
    const service = new GooglePlacesApiService(config);
    const params = { latitude: 1, longitude: 2, radius: 1000 };

    await expect(service.searchNearby(params)).rejects.toMatchObject({
      code: 'quota_exhausted',
      operation: 'searchNearby',
    });
    expect(service.getStatus()).toEqual(
      expect.objectContaining({
        provider: 'google',
        available: false,
        degradedReason: 'quota_exhausted',
        unavailableUntil: expectedUnavailableUntil,
      }),
    );

    await expect(service.searchNearby(params)).rejects.toMatchObject({
      code: 'quota_exhausted',
      operation: 'searchNearby',
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('reports an unavailable configured provider without making a request', async () => {
    const missingKeyConfig = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new GooglePlacesApiService(missingKeyConfig);

    expect(service.getStatus().available).toBe(false);
    await expect(
      service.searchNearby({ latitude: 1, longitude: 2, radius: 1000 }),
    ).rejects.toMatchObject({
      provenance: expect.objectContaining({
        provider: 'google',
        cacheStatus: 'miss-live',
        receivedCount: 0,
      }),
    });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
