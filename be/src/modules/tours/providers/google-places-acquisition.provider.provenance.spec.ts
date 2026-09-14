import {
  IPlacesApiService,
  PlaceData,
  PlacesProvider,
} from '@integrations/google-places/interfaces/places-api.interface';
import { GooglePlacesAcquisitionProvider } from './google-places-acquisition.provider';

describe('GooglePlacesAcquisitionProvider provenance', () => {
  const destination = {
    latitude: -34.6037,
    longitude: -58.3816,
    radiusMeters: 5000,
  };

  const place: PlaceData = {
    id: 'provider-place-1',
    displayName: { text: 'Museo de prueba' },
    formattedAddress: 'Buenos Aires, Argentina',
    location: { latitude: -34.6, longitude: -58.38 },
    rating: 4.7,
    userRatingCount: 123,
    primaryType: 'museum',
    types: ['museum', 'tourist_attraction'],
    openingHoursWeekdayText: ['Monday: 10:00 AM – 6:00 PM'],
    websiteUri: 'https://museum.example.com',
    priceLevel: 'PRICE_LEVEL_MODERATE',
    businessStatus: 'OPERATIONAL',
    editorialSummary: { text: 'A preserved editorial summary.' },
    primaryTypeDisplayName: { text: 'Museum' },
  };

  function makePlacesApi(
    provider: PlacesProvider,
  ): jest.Mocked<IPlacesApiService> {
    return {
      provider,
      searchNearby: jest.fn().mockResolvedValue({
        data: [place],
        provenance: {
          provider,
          cacheStatus: 'miss-live',
          requestedCount: 1,
          receivedCount: 1,
        },
      }),
      searchText: jest.fn(),
      getPlaceDetails: jest.fn(),
      getStatus: jest.fn(),
    } as any;
  }

  it('preserves Google as the evidence source when Google produced the result', async () => {
    const placesApi = makePlacesApi('google');
    const provider = new GooglePlacesAcquisitionProvider(placesApi);

    const result = await provider.acquire(destination);

    expect(result.status).toBe('success');
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toEqual(
      expect.objectContaining({
        provider: 'google_places',
        externalId: 'provider-place-1',
        evidenceKey: 'google_places:provider-place-1',
        evidenceType: 'place',
      }),
    );
  });

  it('uses Geoapify provenance when Geoapify produced the result and preserves B1 evidence', async () => {
    const placesApi = makePlacesApi('geoapify');
    const provider = new GooglePlacesAcquisitionProvider(placesApi);

    const result = await provider.acquire(destination);

    expect(result.status).toBe('success');
    expect(result.value).toHaveLength(1);

    const observation = result.value[0];
    expect(observation.provider).toBe('geoapify');
    expect(observation.evidenceKey).toBe('geoapify:provider-place-1');
    expect(observation.provider).not.toBe('google_places');
    expect(observation.evidenceKey).not.toContain('google');
    expect(observation).toEqual(
      expect.objectContaining({
        externalId: 'provider-place-1',
        evidenceType: 'place',
        title: 'Museo de prueba',
        description: 'Buenos Aires, Argentina',
        geo: { latitude: -34.6, longitude: -58.38 },
        standaloneEligible: true,
      }),
    );
    expect(observation.sourceUrl).toBe('https://museum.example.com');
    expect(observation.metadata).toEqual(
      expect.objectContaining({
        rating: 4.7,
        userRatingCount: 123,
        primaryType: 'museum',
        types: ['museum', 'tourist_attraction'],
        openingHoursWeekdayText: ['Monday: 10:00 AM – 6:00 PM'],
        priceLevel: 'PRICE_LEVEL_MODERATE',
        businessStatus: 'OPERATIONAL',
        editorialSummary: 'A preserved editorial summary.',
        primaryTypeDisplayName: 'Museum',
      }),
    );
  });

  it('keeps graceful failure behavior for the effective Places provider', async () => {
    const placesApi = makePlacesApi('geoapify');
    placesApi.searchNearby.mockRejectedValueOnce(
      new Error('Places provider temporarily unavailable'),
    );
    const provider = new GooglePlacesAcquisitionProvider(placesApi);

    const result = await provider.acquire(destination);

    expect(result).toEqual({
      status: 'failed',
      value: [],
      failureReason: 'Places provider temporarily unavailable',
    });
  });
});
