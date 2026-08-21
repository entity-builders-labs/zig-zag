import { GooglePlacesService } from './google-places.service';
import { IPlacesApiService } from './interfaces/places-api.interface';

function placesApi(provider: 'google' | 'geoapify'): IPlacesApiService {
  const provenance = {
    provider,
    cacheStatus: 'hit' as const,
    requestedCount: 20,
    receivedCount: 0,
  };
  return {
    provider,
    getStatus: () => ({
      provider,
      available: true,
      cacheEnabled: true,
      cacheMode: 'strict',
    }),
    searchNearby: jest.fn().mockResolvedValue({ data: [], provenance }),
    searchText: jest.fn().mockResolvedValue({ data: [], provenance }),
    getPlaceDetails: jest.fn().mockResolvedValue({
      data: {},
      provenance: { ...provenance, requestedCount: 1 },
    }),
  };
}

function buildService(api: IPlacesApiService) {
  const prisma = {
    knownActivityType: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    source: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'source-id' }),
    },
    activity: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const activities = { create: jest.fn() };
  const ai = { generateCompletionResponse: jest.fn() };
  const vectors = { saveActivityEmbedding: jest.fn() };

  return {
    service: new GooglePlacesService(
      prisma as any,
      activities as any,
      ai as any,
      vectors as any,
      api,
    ),
    prisma,
    activities,
  };
}

describe('GooglePlacesService provider provenance', () => {
  it('delegates provider status from the selected adapter', () => {
    const { service } = buildService(placesApi('geoapify'));

    expect(service.getProviderStatus()).toEqual({
      provider: 'geoapify',
      available: true,
      cacheEnabled: true,
      cacheMode: 'strict',
    });
  });

  it('reports raw and low-rating counts for a search request', async () => {
    const api = placesApi('google');
    (api.searchNearby as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 'low',
          name: 'Low rating',
          rating: 3,
          location: { latitude: 1, longitude: 2 },
        },
        {
          id: 'accepted',
          name: 'Accepted museum',
          rating: 4.8,
          location: { latitude: 1, longitude: 2 },
        },
      ],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 20,
        receivedCount: 2,
      },
    });
    const { service } = buildService(api);

    const result = await service.searchNearbyPlaces(
      { latitude: 1, longitude: 2, radius: 1000 },
      {
        type: 'museum',
        keyword: 'museum',
        minRating: 4,
        preferredTime: 'day',
      },
    );

    expect(result.places.map((place) => place.placeId)).toEqual(['accepted']);
    expect(result.provenance.receivedCount).toBe(2);
    expect(result.rejectedCountByReason).toEqual({ low_rating: 1 });
  });

  it('persists source provenance from the selected provider and aggregates cache hits', async () => {
    const api = placesApi('geoapify');
    const { service, prisma } = buildService(api);

    const result = await service.crawlAndSaveActivities({
      latitude: 1,
      longitude: 2,
      radius: 1000,
    });

    expect(prisma.source.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'geoapify',
        baseUrl: 'https://www.geoapify.com',
      }),
    });
    expect(result.provenance.provider).toBe('geoapify');
    expect(result.provenance.cacheStatus).toBe('hit');
    expect(result.provenance.acceptedCount).toBe(0);
    expect(result.fromCache).toBe(true);
  });
});
