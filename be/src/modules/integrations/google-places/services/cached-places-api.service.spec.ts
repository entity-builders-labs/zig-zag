import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { CachedPlacesApiService } from './cached-places-api.service';
import {
  IPlacesApiService,
  PlaceData,
  PlacesApiRequestError,
  PlacesProvider,
} from '../interfaces/places-api.interface';

function realPlacesApi(provider: PlacesProvider): IPlacesApiService {
  return {
    provider,
    getStatus: () => ({
      provider,
      available: true,
      cacheEnabled: false,
    }),
    searchNearby: jest.fn(async () => ({
      data: [{ id: `${provider}-place` }],
      provenance: {
        provider,
        cacheStatus: 'miss-live' as const,
        requestedCount: 10,
        receivedCount: 1,
      },
    })),
    searchText: jest.fn(async () => ({
      data: [] as PlaceData[],
      provenance: {
        provider,
        cacheStatus: 'miss-live' as const,
        requestedCount: 5,
        receivedCount: 0,
      },
    })),
    getPlaceDetails: jest.fn(async () => ({
      data: { id: `${provider}-place` },
      provenance: {
        provider,
        cacheStatus: 'miss-live' as const,
        requestedCount: 1,
        receivedCount: 1,
      },
    })),
  };
}

function cachedService(
  storagePath: string,
  mode: string,
  realService: IPlacesApiService,
): CachedPlacesApiService {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'STORAGE_PATH') return storagePath;
      if (key === 'MOCK_MAPS_MODE') return mode;
      return undefined;
    }),
  } as unknown as ConfigService;
  return new CachedPlacesApiService(config, realService);
}

describe('CachedPlacesApiService', () => {
  let storagePath: string;

  beforeEach(() => {
    storagePath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'zigzag-places-cache-'),
    );
  });

  afterEach(() => {
    fs.rmSync(storagePath, { recursive: true, force: true });
  });

  const params = {
    latitude: 37.389,
    longitude: -5.984,
    radius: 2000,
    includedPrimaryTypes: ['museum'],
    maxResultCount: 10,
  };

  it('keeps Google and Geoapify in separate cache namespaces', async () => {
    const google = realPlacesApi('google');
    await cachedService(storagePath, 'write', google).searchNearby(params);

    const geoapify = realPlacesApi('geoapify');
    const geoapifyStrict = cachedService(storagePath, 'strict', geoapify);

    await expect(geoapifyStrict.searchNearby(params)).rejects.toMatchObject<
      Partial<PlacesApiRequestError>
    >({
      provenance: expect.objectContaining({
        provider: 'geoapify',
        cacheStatus: 'strict-miss',
      }),
    });
    expect(geoapify.searchNearby).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.join(storagePath, 'maps-cache'))[0]).toMatch(
      /^google-v3-searchNearby-/,
    );
  });

  it('normalizes object key order when computing a cache key', async () => {
    const real = realPlacesApi('google');
    await cachedService(storagePath, 'write', real).searchNearby(params);

    const strict = cachedService(storagePath, 'strict', real);
    const result = await strict.searchNearby({
      maxResultCount: 10,
      includedPrimaryTypes: ['museum'],
      radius: 2000,
      longitude: -5.984,
      latitude: 37.389,
    });

    expect(result.provenance.cacheStatus).toBe('hit');
    expect(real.searchNearby).toHaveBeenCalledTimes(1);
  });

  it('calls the selected provider on a read-mode cache miss without writing', async () => {
    const real = realPlacesApi('google');
    const result = await cachedService(storagePath, 'read', real).searchNearby(
      params,
    );

    expect(result.provenance.cacheStatus).toBe('miss-live');
    expect(real.searchNearby).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(path.join(storagePath, 'maps-cache'))).toEqual([]);
  });

  it('never calls the real provider on a strict-mode cache miss', async () => {
    const real = realPlacesApi('google');
    const service = cachedService(storagePath, 'strict', real);

    await expect(service.searchNearby(params)).rejects.toMatchObject({
      provenance: expect.objectContaining({
        provider: 'google',
        cacheStatus: 'strict-miss',
        requestedCount: 10,
        receivedCount: 0,
      }),
    });
    expect(real.searchNearby).not.toHaveBeenCalled();
  });

  it('rejects an unknown cache mode during startup', () => {
    const real = realPlacesApi('google');

    expect(() => cachedService(storagePath, 'sometimes', real)).toThrow(
      'Invalid MOCK_MAPS_MODE',
    );
  });
});
