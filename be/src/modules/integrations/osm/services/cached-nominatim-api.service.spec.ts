import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { CachedNominatimApiService } from './cached-nominatim-api.service';
import { INominatimApiService } from '../interfaces/nominatim.interface';

describe('CachedNominatimApiService', () => {
  let realService: jest.Mocked<INominatimApiService>;
  let service: CachedNominatimApiService;
  const cacheDir = fs.mkdtempSync('/tmp/nominatim-cache-test-');

  beforeEach(() => {
    realService = { search: jest.fn() };
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'STORAGE_PATH') return cacheDir.replace(/\/osm-cache$/, '');
        if (key === 'MOCK_MAPS_MODE') return 'write';
        return undefined;
      }),
    } as unknown as ConfigService;
    service = new CachedNominatimApiService(configService, realService);
  });

  it('calls the real service and caches the result on a cache miss (write mode default)', async () => {
    realService.search.mockResolvedValue([
      { osmType: 'relation', osmId: 1, addresstype: 'city', displayName: 'Test City', importance: 0.9 },
    ]);

    const result = await service.search('Test City');

    expect(realService.search).toHaveBeenCalledWith('Test City');
    expect(result[0].addresstype).toBe('city');
  });

  it('does not call the real service twice for the same query', async () => {
    realService.search.mockResolvedValue([]);

    await service.search('Repeated Query');
    await service.search('Repeated Query');

    expect(realService.search).toHaveBeenCalledTimes(1);
  });
});
