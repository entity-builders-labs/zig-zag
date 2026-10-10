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
    // Stage 3 PLACE cutover (spikes/stage3-place-provider-search-
    // characterization-2026-09-25/assessment.md): Forward Geocoding with the
    // hint as free-form `text`, NO `type`, a hard circle `filter` and a
    // proximity `bias` found 11/12 PLACE hints vs 8/12 for the former
    // Autocomplete + `type=amenity` shape (which could not match "Mafalda
    // Statue" and dropped `landuse=cemetery`/untagged building ways).
    const bias = {
      center: { latitude: -34.6037, longitude: -58.3816 },
      radius: 50000,
    };

    it('uses /v1/geocode/search with free-form text, no type, a hard circle filter and a proximity bias', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { results: [] } });

      await service.searchText({
        textQuery: 'Mafalda Statue',
        maxResultCount: 3,
        locationBias: bias,
      });

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      const [url, config] = mockedAxios.get.mock.calls[0];
      expect(url).toBe('https://api.geoapify.com/v1/geocode/search');
      expect(config).toEqual({
        params: {
          text: 'Mafalda Statue',
          filter: 'circle:-58.3816,-34.6037,50000',
          bias: 'proximity:-58.3816,-34.6037',
          limit: 3,
          format: 'json',
          apiKey: 'test-api-key',
        },
        timeout: 5000,
      });
      // Never a structured field mixed with free-form text, never `type`.
      const params = (config as { params: Record<string, unknown> }).params;
      for (const forbidden of [
        'type',
        'name',
        'street',
        'city',
        'country',
        'postcode',
      ]) {
        expect(params).not.toHaveProperty(forbidden);
      }
    });

    it('sends the hint text unchanged', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { results: [] } });

      await service.searchText({
        textQuery: '  Recoleta Cemetery ',
        locationBias: bias,
      });

      expect(
        (mockedAxios.get.mock.calls[0][1] as { params: { text: string } })
          .params.text,
      ).toBe('  Recoleta Cemetery ');
    });

    it('maps a real Forward Geocoding result (live-captured Mafalda row) faithfully, without inventing Google-style types', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          results: [
            {
              datasource: {
                sourcename: 'openstreetmap',
                attribution: '© OpenStreetMap contributors',
                license: 'Open Database License',
                url: 'https://www.openstreetmap.org/copyright',
              },
              name: 'Mafalda, Susanita and Manolito',
              country_code: 'ar',
              lon: -58.3716913,
              lat: -34.6159617,
              formatted:
                'Mafalda, Susanita and Manolito, Defensa 800, San Telmo, 1065 Buenos Aires, Argentina',
              result_type: 'amenity',
              rank: {
                importance: 0.00008279926756690345,
                popularity: 7.953640848669934,
                confidence: 0,
                match_type: 'full_match',
              },
              place_id: '5197da9c94932f4dc0-opaque',
            },
          ],
        },
      });

      const results = await service.searchText({
        textQuery: 'Mafalda Statue',
        locationBias: bias,
      });

      expect(results.data).toEqual([
        {
          id: '5197da9c94932f4dc0-opaque',
          name: 'Mafalda, Susanita and Manolito',
          displayName: { text: 'Mafalda, Susanita and Manolito' },
          formattedAddress:
            'Mafalda, Susanita and Manolito, Defensa 800, San Telmo, 1065 Buenos Aires, Argentina',
          location: { latitude: -34.6159617, longitude: -58.3716913 },
          // No category declared on this row -> no type invented.
          types: [],
          primaryType: undefined,
          featureClass: 'point_of_interest',
          rating: undefined,
          userRatingCount: undefined,
          priceLevel: undefined,
          openingHoursWeekdayText: undefined,
        },
      ]);
      // An opaque search id never yields an identity by parsing.
      expect(results.data[0].sourceIdentities).toBeUndefined();
    });

    it('preserves the declared category as the provider type', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          results: [
            {
              name: 'Farmacia de la Estrella',
              lat: -34.6102605,
              lon: -58.3721513,
              result_type: 'amenity',
              category:
                'commercial.health_and_beauty.pharmacy;healthcare.pharmacy',
              place_id: 'farmacia-opaque',
            },
          ],
        },
      });

      const results = await service.searchText({
        textQuery: 'Farmacia la Estrella',
        locationBias: bias,
      });

      expect(results.data[0].types).toEqual([
        'commercial.health_and_beauty.pharmacy;healthcare.pharmacy',
      ]);
      expect(results.data[0].primaryType).toBe(
        'commercial.health_and_beauty.pharmacy;healthcare.pharmacy',
      );
      expect(results.data[0].featureClass).toBe('point_of_interest');
    });

    it.each([
      ['street', undefined, 'street'],
      ['building', undefined, 'building'],
      ['postcode', undefined, 'postcode'],
      ['suburb', undefined, 'administrative_area'],
      ['district', undefined, 'administrative_area'],
      ['city', 'administrative', 'administrative_area'],
      ['county', undefined, 'administrative_area'],
      ['state', undefined, 'administrative_area'],
      ['country', undefined, 'administrative_area'],
      // Live-captured: "Plaza Dorrego" bus stops and the "345 - Plaza
      // Mafalda" bike dock are amenities named after the landmark they
      // serve.
      ['amenity', 'public_transport.bus', 'transport_stop'],
      ['amenity', 'rental.bicycle', 'transport_stop'],
      ['amenity', 'leisure.park', 'point_of_interest'],
      ['amenity', undefined, 'point_of_interest'],
      ['unknown', undefined, undefined],
      [undefined, undefined, undefined],
    ])(
      'normalizes result_type=%s category=%s to featureClass=%s',
      async (resultType, category, expected) => {
        mockedAxios.get.mockResolvedValueOnce({
          data: {
            results: [
              {
                name: 'X',
                lat: -34.6,
                lon: -58.38,
                place_id: 'p',
                ...(resultType ? { result_type: resultType } : {}),
                ...(category ? { category } : {}),
              },
            ],
          },
        });

        const results = await service.searchText({
          textQuery: 'X',
          locationBias: bias,
        });

        expect(results.data[0].featureClass).toBe(expected);
      },
    );

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
          locationBias: bias,
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

    it('declares that Place Details can expose source identities', () => {
      expect(service.declaresSourceIdentitiesInDetails).toBe(true);
    });

    it('maps explicit OSM osm_type/osm_id and the Wikidata QID (live-captured Mafalda details) to source identities', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          features: [
            {
              properties: {
                place_id: '5196da9c94932f-details-opaque',
                name: 'Mafalda, Susanita y Manolito',
                categories: ['tourism', 'tourism.attraction'],
                datasource: {
                  sourcename: 'openstreetmap',
                  raw: {
                    name: 'Mafalda, Susanita y Manolito',
                    osm_id: 2472979623,
                    amenity: 'bench',
                    tourism: 'attraction',
                    alt_name: 'Mafalda',
                    osm_type: 'n',
                    wikidata: 'Q111038841',
                    artwork_type: 'sculpture',
                  },
                },
                wiki_and_media: { wikidata: 'Q111038841' },
              },
            },
          ],
        },
      });

      const details = await service.getPlaceDetails('5197da9c-search-opaque');

      expect(details.data.sourceIdentities).toEqual([
        { provider: 'openstreetmap', externalId: 'osm:node:2472979623' },
        { provider: 'wikidata', externalId: 'Q111038841' },
      ]);
    });

    it.each([
      ['w', 183842128, 'osm:way:183842128'],
      ['r', 1224652, 'osm:relation:1224652'],
    ])(
      'maps osm_type=%s to the canonical OSM namespace',
      async (osmType, osmId, expected) => {
        mockedAxios.get.mockResolvedValueOnce({
          data: {
            features: [
              {
                properties: {
                  place_id: 'p',
                  datasource: {
                    sourcename: 'openstreetmap',
                    raw: { osm_type: osmType, osm_id: osmId },
                  },
                },
              },
            ],
          },
        });

        const details = await service.getPlaceDetails('p');

        expect(details.data.sourceIdentities).toEqual([
          { provider: 'openstreetmap', externalId: expected },
        ]);
      },
    );

    it('maps an OSM identity without Wikidata (Farmacia: no QID is UNKNOWN, not a contradiction)', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          features: [
            {
              properties: {
                place_id: 'p',
                datasource: {
                  sourcename: 'openstreetmap',
                  raw: {
                    osm_type: 'n',
                    osm_id: 3348573778,
                    amenity: 'pharmacy',
                  },
                },
              },
            },
          ],
        },
      });

      const details = await service.getPlaceDetails('p');

      expect(details.data.sourceIdentities).toEqual([
        { provider: 'openstreetmap', externalId: 'osm:node:3348573778' },
      ]);
    });

    it('never derives an identity from the opaque place_id, a non-OSM datasource, or malformed OSM/QID fields', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          features: [
            {
              properties: {
                // Hex-encodes "openstreetmap:venue:node/2472979623" -- still
                // opaque to us.
                place_id:
                  '51...6f70656e7374726565746d61703a76656e75653a6e6f64652f32343732393739363233',
                datasource: {
                  sourcename: 'whosonfirst',
                  raw: { osm_type: 'n', osm_id: 1 },
                },
                wiki_and_media: { wikidata: 'not-a-qid' },
              },
            },
          ],
        },
      });
      const nonOsm = await service.getPlaceDetails('p');
      expect(nonOsm.data.sourceIdentities).toBeUndefined();

      mockedAxios.get.mockResolvedValueOnce({
        data: {
          features: [
            {
              properties: {
                place_id: 'p',
                datasource: {
                  sourcename: 'openstreetmap',
                  raw: { osm_type: 'x', osm_id: 'abc' },
                },
              },
            },
          ],
        },
      });
      const malformed = await service.getPlaceDetails('p');
      expect(malformed.data.sourceIdentities).toBeUndefined();
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
