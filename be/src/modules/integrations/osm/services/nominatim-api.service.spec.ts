import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NominatimApiService } from './nominatim-api.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('NominatimApiService', () => {
  let service: NominatimApiService;

  beforeEach(() => {
    const configService = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    service = new NominatimApiService(configService);
  });

  it('maps a Nominatim response into NominatimResult[]', async () => {
    mockedAxios.get.mockResolvedValue({
      data: [
        {
          osm_type: 'relation',
          osm_id: 1224652,
          addresstype: 'city',
          display_name: 'Buenos Aires, Comuna 1, Ciudad Autónoma de Buenos Aires, Argentina',
          importance: 0.783,
        },
      ],
    });

    const result = await service.search('Buenos Aires');

    expect(result).toEqual([
      {
        osmType: 'relation',
        osmId: 1224652,
        addresstype: 'city',
        displayName: 'Buenos Aires, Comuna 1, Ciudad Autónoma de Buenos Aires, Argentina',
        importance: 0.783,
      },
    ]);
  });

  it('sends a self-identifying User-Agent (Nominatim usage policy) and a bounded limit', async () => {
    mockedAxios.get.mockResolvedValue({ data: [] });

    await service.search('Barcelona');

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org/search'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': expect.any(String) }),
        params: expect.objectContaining({ q: 'Barcelona', format: 'jsonv2', limit: 5 }),
      }),
    );
  });

  it('returns an empty array (not a throw) when the request fails', async () => {
    mockedAxios.get.mockRejectedValue(new Error('network down'));

    const result = await service.search('Barcelona');

    expect(result).toEqual([]);
  });

  it('returns an empty array (not a throw) on timeout', async () => {
    mockedAxios.get.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));

    const result = await service.search('Barcelona');

    expect(result).toEqual([]);
  });
});
