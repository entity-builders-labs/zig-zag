import { Test, TestingModule } from '@nestjs/testing';
import { GooglePlacesAcquisitionProvider } from './google-places-acquisition.provider';
import {
  IPlacesApiService,
  PlaceData,
} from '@integrations/google-places/interfaces/places-api.interface';

describe('GooglePlacesAcquisitionProvider', () => {
  let provider: GooglePlacesAcquisitionProvider;
  let placesApiMock: jest.Mocked<IPlacesApiService>;

  beforeEach(async () => {
    placesApiMock = {
      provider: 'google',
      searchNearby: jest.fn(),
      searchText: jest.fn(),
      getPlaceDetails: jest.fn(),
      getStatus: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GooglePlacesAcquisitionProvider,
        {
          provide: 'PlacesApiService',
          useValue: placesApiMock,
        },
      ],
    }).compile();

    provider = module.get<GooglePlacesAcquisitionProvider>(
      GooglePlacesAcquisitionProvider,
    );
  });

  it('1. maps valid Google Places result to SourceObservation with correct evidence identity and finite coordinates', async () => {
    const mockPlace: PlaceData = {
      id: 'ChIJ123456789',
      displayName: { text: 'Museo Nacional de Bellas Artes' },
      formattedAddress: 'Av. del Libertador 1473, Buenos Aires',
      location: { latitude: -34.583889, longitude: -58.393056 },
      rating: 4.8,
      userRatingCount: 15420,
      primaryType: 'museum',
      types: [
        'museum',
        'tourist_attraction',
        'point_of_interest',
        'establishment',
      ],
    };

    placesApiMock.searchNearby.mockResolvedValueOnce({
      data: [mockPlace],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 1,
        receivedCount: 1,
      },
    });

    const result = await provider.acquire({
      latitude: -34.6037,
      longitude: -58.3816,
      radiusMeters: 5000,
    });

    expect(result.status).toBe('success');
    expect(result.value).toHaveLength(1);

    const obs = result.value[0];
    expect(obs.provider).toBe('google_places');
    expect(obs.externalId).toBe('ChIJ123456789');
    expect(obs.evidenceKey).toBe('google_places:ChIJ123456789');
    expect(obs.evidenceType).toBe('place');
    expect(obs.title).toBe('Museo Nacional de Bellas Artes');
    expect(obs.description).toBe('Av. del Libertador 1473, Buenos Aires');
    expect(obs.geo).toEqual({
      latitude: -34.583889,
      longitude: -58.393056,
    });
    expect(obs.metadata).toEqual({
      rating: 4.8,
      userRatingCount: 15420,
      primaryType: 'museum',
      types: [
        'museum',
        'tourist_attraction',
        'point_of_interest',
        'establishment',
      ],
      openingHoursWeekdayText: undefined,
    });
  });

  it('2. rejects or omits invalid coordinates (NaN, Infinity, lat outside [-90, 90], lon outside [-180, 180])', async () => {
    const invalidCoordsPlaces: PlaceData[] = [
      {
        id: 'place_nan',
        displayName: { text: 'Place NaN' },
        primaryType: 'museum',
        location: { latitude: NaN, longitude: -58.3816 },
      },
      {
        id: 'place_inf',
        displayName: { text: 'Place Inf' },
        primaryType: 'museum',
        location: { latitude: -34.6037, longitude: Infinity },
      },
      {
        id: 'place_lat_high',
        displayName: { text: 'Place Lat High' },
        primaryType: 'museum',
        location: { latitude: 95.0, longitude: -58.3816 },
      },
      {
        id: 'place_lon_low',
        displayName: { text: 'Place Lon Low' },
        primaryType: 'museum',
        location: { latitude: -34.6037, longitude: -190.0 },
      },
    ];

    placesApiMock.searchNearby.mockResolvedValueOnce({
      data: invalidCoordsPlaces,
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 4,
        receivedCount: 4,
      },
    });

    const result = await provider.acquire({
      latitude: -34.6037,
      longitude: -58.3816,
    });

    expect(result.status).toBe('success');
    expect(result.value).toHaveLength(4);

    for (const obs of result.value) {
      expect(obs.geo).toBeUndefined();
    }
  });

  it('3. returns success with [] when search returns no places', async () => {
    placesApiMock.searchNearby.mockResolvedValueOnce({
      data: [],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 0,
        receivedCount: 0,
      },
    });

    const result = await provider.acquire({
      latitude: -34.6037,
      longitude: -58.3816,
    });

    expect(result.status).toBe('success');
    expect(result.value).toEqual([]);
  });

  it('4. returns failed with failureReason when Google Places integration throws', async () => {
    placesApiMock.searchNearby.mockRejectedValueOnce(
      new Error('Places API quota exceeded (OVER_QUERY_LIMIT)'),
    );

    const result = await provider.acquire({
      latitude: -34.6037,
      longitude: -58.3816,
    });

    expect(result.status).toBe('failed');
    expect(result.value).toEqual([]);
    expect(result.failureReason).toBe(
      'Places API quota exceeded (OVER_QUERY_LIMIT)',
    );
  });

  it('5. does not infer themes/traits/intents or structured facets', async () => {
    const wineryPlace: PlaceData = {
      id: 'place_winery_1',
      displayName: { text: 'Bodega Catena Zapata' },
      formattedAddress: 'Mendoza, Argentina',
      location: { latitude: -33.15, longitude: -68.9 },
      primaryType: 'winery',
      types: ['winery', 'tourist_attraction'],
    };

    placesApiMock.searchNearby.mockResolvedValueOnce({
      data: [wineryPlace],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 1,
        receivedCount: 1,
      },
    });

    const result = await provider.acquire({
      latitude: -33.15,
      longitude: -68.9,
    });

    expect(result.status).toBe('success');
    expect(result.value).toHaveLength(1);
    const obs = result.value[0];

    // Raw observation must not carry inferred themes/traits/intents
    expect((obs as any).themes).toBeUndefined();
    expect((obs as any).traits).toBeUndefined();
    expect((obs as any).intents).toBeUndefined();
    expect((obs as any).winery_scale).toBeUndefined();
    expect((obs as any).nature_type).toBeUndefined();
    expect((obs as any).local_character).toBeUndefined();
    expect((obs as any).tourism_intensity).toBeUndefined();
  });

  it('6. does not admit broad point_of_interest/establishment-only or commercial excluded results unless a reviewed allowed type is present', async () => {
    const rawPlaces: PlaceData[] = [
      {
        id: 'place_generic_poi',
        displayName: { text: 'Generic POI' },
        primaryType: 'point_of_interest',
        types: ['point_of_interest', 'establishment'],
      },
      {
        id: 'place_gas',
        displayName: { text: 'YPF Gas Station' },
        primaryType: 'gas_station',
        types: ['gas_station', 'point_of_interest', 'establishment'],
      },
      {
        id: 'place_bank',
        displayName: { text: 'Banco de la Nacion' },
        primaryType: 'bank',
        types: ['bank', 'atm', 'finance', 'establishment'],
      },
      {
        id: 'place_supermarket',
        displayName: { text: 'Carrefour Market' },
        primaryType: 'supermarket',
        types: ['supermarket', 'grocery_or_supermarket', 'store'],
      },
      {
        id: 'place_valid_museum',
        displayName: { text: 'Museo Historico' },
        primaryType: 'museum',
        types: ['museum', 'point_of_interest', 'establishment'],
        location: { latitude: -34.6, longitude: -58.38 },
      },
    ];

    placesApiMock.searchNearby.mockResolvedValueOnce({
      data: rawPlaces,
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 5,
        receivedCount: 5,
      },
    });

    const result = await provider.acquire({
      latitude: -34.6037,
      longitude: -58.3816,
    });

    expect(result.status).toBe('success');
    // Only the valid museum should be admitted
    expect(result.value).toHaveLength(1);
    expect(result.value[0].externalId).toBe('place_valid_museum');
  });

  it('uses searchText when coordinates are not provided but destinationName/query is present', async () => {
    placesApiMock.searchText.mockResolvedValueOnce({
      data: [
        {
          id: 'place_bariloche_park',
          displayName: { text: 'Parque Nacional Nahuel Huapi' },
          primaryType: 'national_park',
          types: ['national_park', 'park', 'tourist_attraction'],
          location: { latitude: -41.15, longitude: -71.3 },
        },
      ],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 1,
        receivedCount: 1,
      },
    });

    const result = await provider.acquire({
      destinationName: 'San Carlos de Bariloche',
    });

    expect(placesApiMock.searchText).toHaveBeenCalledWith({
      textQuery: 'San Carlos de Bariloche',
      maxResultCount: 5,
    });
    expect(result.status).toBe('success');
    expect(result.value).toHaveLength(1);
    expect(result.value[0].externalId).toBe('place_bariloche_park');
  });
});
