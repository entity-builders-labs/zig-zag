import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NominatimApiService } from './nominatim-api.service';
import { isAreaScaleEligible } from '../../../tours/utils/nominatim-match.util';

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
          category: 'boundary',
          type: 'administrative',
          display_name:
            'Buenos Aires, Comuna 1, Ciudad Autónoma de Buenos Aires, Argentina',
          importance: 0.783,
          place_rank: 16,
          address_rank: 16,
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
        class: 'boundary',
        type: 'administrative',
        displayName:
          'Buenos Aires, Comuna 1, Ciudad Autónoma de Buenos Aires, Argentina',
        importance: 0.783,
        placeRank: 16,
        addressRank: 16,
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

  it('normalizes the real JSONv2 category field into the AREA policy classification', async () => {
    mockedAxios.get.mockResolvedValue({
      data: [
        {
          osm_type: 'relation',
          osm_id: 42,
          addresstype: 'suburb',
          category: 'place',
          type: 'suburb',
          place_rank: 20,
          display_name: 'San Telmo, Buenos Aires, Argentina',
          importance: 0.3,
          lat: '-34.62',
          lon: '-58.37',
        },
      ],
    });

    const [result] = await service.search('San Telmo');

    expect(result).toMatchObject({
      osmType: 'relation',
      class: 'place',
      type: 'suburb',
      placeRank: 20,
    });
    expect(result).not.toHaveProperty('category');
    expect(isAreaScaleEligible(result)).toBe(true);
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

  it('sends countrycodes when a countryCode option is passed', async () => {
    mockedAxios.get.mockResolvedValue({ data: [] });

    await service.search('Cerro Alcázar', { countryCode: 'AR' });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org/search'),
      expect.objectContaining({
        params: expect.objectContaining({
          q: 'Cerro Alcázar',
          countrycodes: 'ar',
        }),
      }),
    );
  });

  it('omits countrycodes entirely when no countryCode option is passed', async () => {
    mockedAxios.get.mockResolvedValue({ data: [] });

    await service.search('Barcelona');

    const call = mockedAxios.get.mock.calls[0];
    expect(call[1].params).not.toHaveProperty('countrycodes');
  });

  it('sends a soft viewbox bias around the destination point when a bias option is passed', async () => {
    mockedAxios.get.mockResolvedValue({ data: [] });

    await service.search('Catedral', {
      bias: { latitude: -34.6037, longitude: -58.3816 },
    });

    // The last call, not calls[0] — this spec's other tests share the same
    // mocked axios.get and never reset its call history between tests.
    const call = mockedAxios.get.mock.calls.at(-1)!;
    expect(typeof call[1].params.viewbox).toBe('string');
    expect(call[1].params.viewbox.split(',')).toHaveLength(4);
    // Deliberately soft: no `bounded` param, so a real match outside the
    // box is never hard-excluded, only deprioritized against a same-named
    // homonym elsewhere in the country.
    expect(call[1].params).not.toHaveProperty('bounded');
  });

  it('omits viewbox entirely when no bias option is passed', async () => {
    mockedAxios.get.mockResolvedValue({ data: [] });

    await service.search('Barcelona');

    const call = mockedAxios.get.mock.calls.at(-1)!;
    expect(call[1].params).not.toHaveProperty('viewbox');
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
        category: 'boundary',
        type: 'administrative',
        place_rank: 16,
        address_rank: 16,
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
      class: 'boundary',
      type: 'administrative',
      placeRank: 16,
      addressRank: 16,
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
