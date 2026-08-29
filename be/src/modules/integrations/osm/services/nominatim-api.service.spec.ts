import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NominatimApiService } from './nominatim-api.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('NominatimApiService', () => {
  let service: NominatimApiService;

  beforeEach(() => {
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    service = new NominatimApiService(configService);
  });

  it('maps a Nominatim response into NominatimResult[]', async () => {
    mockedAxios.get.mockResolvedValue({
      data: [
        {
          osm_type: 'relation',
          osm_id: 1224652,
          addresstype: 'city',
          display_name:
            'Buenos Aires, Comuna 1, Ciudad Autónoma de Buenos Aires, Argentina',
          importance: 0.783,
          lat: '-34.6037',
          lon: '-58.3816',
          address: {
            city: 'Buenos Aires',
            country: 'Argentina',
            country_code: 'ar',
          },
        },
      ],
    });

    const result = await service.search('Buenos Aires');

    expect(result).toEqual([
      {
        osmType: 'relation',
        osmId: 1224652,
        addresstype: 'city',
        displayName:
          'Buenos Aires, Comuna 1, Ciudad Autónoma de Buenos Aires, Argentina',
        importance: 0.783,
        latitude: -34.6037,
        longitude: -58.3816,
        address: {
          city: 'Buenos Aires',
          town: undefined,
          village: undefined,
          municipality: undefined,
          cityDistrict: undefined,
          stateDistrict: undefined,
          county: undefined,
          borough: undefined,
          suburb: undefined,
          state: undefined,
          country: 'Argentina',
          countryCode: 'AR',
        },
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
        params: expect.objectContaining({
          q: 'Barcelona',
          format: 'jsonv2',
          limit: 5,
          addressdetails: 1,
        }),
      }),
    );
  });

  it('throws when the request fails so callers can distinguish failure from no matches', async () => {
    mockedAxios.get.mockRejectedValue(new Error('network down'));

    await expect(service.search('Barcelona')).rejects.toThrow('network down');
  });

  it('throws on timeout so callers can report provider degradation', async () => {
    mockedAxios.get.mockRejectedValue(
      Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }),
    );

    await expect(service.search('Barcelona')).rejects.toThrow('timeout');
  });

  it('reverse geocodes at settlement level with address details', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        osm_type: 'relation',
        osm_id: 2929054,
        addresstype: 'city',
        display_name: 'Montevideo, Uruguay',
        importance: 0.7,
        lat: '-34.9059',
        lon: '-56.1913',
        address: {
          city: 'Montevideo',
          state_district: 'Montevideo Department',
          country: 'Uruguay',
          country_code: 'uy',
        },
      },
    });

    const result = await service.reverse(-34.9059, -56.1913);

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/reverse'),
      expect.objectContaining({
        params: expect.objectContaining({
          lat: -34.9059,
          lon: -56.1913,
          zoom: 10,
          addressdetails: 1,
        }),
      }),
    );
    expect(result).toMatchObject({
      osmId: 2929054,
      latitude: -34.9059,
      longitude: -56.1913,
      address: {
        city: 'Montevideo',
        stateDistrict: 'Montevideo Department',
        countryCode: 'UY',
      },
    });
  });

  it('throws when reverse geocoding fails', async () => {
    mockedAxios.get.mockRejectedValue(new Error('network down'));

    await expect(service.reverse(1, 2)).rejects.toThrow('network down');
  });
});
