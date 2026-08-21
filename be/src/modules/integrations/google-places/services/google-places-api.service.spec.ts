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
    });

    expect(result.data[0]).toEqual(
      expect.objectContaining({ id: 'google-place-1', name: 'Museo de Arte' }),
    );
    expect(result.provenance).toEqual({
      provider: 'google',
      cacheStatus: 'miss-live',
      requestedCount: 10,
      receivedCount: 1,
    });
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
