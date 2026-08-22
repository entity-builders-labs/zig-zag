import { GooglePlacesService } from './google-places.service';
import {
  IPlacesApiService,
  PlacesApiRequestError,
} from './interfaces/places-api.interface';
import { CatalogCandidateValidatorService } from '@activities/services/catalog-candidate-validator.service';

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
  const vectors = { saveActivityEmbedding: jest.fn() };

  return {
    service: new GooglePlacesService(
      prisma as any,
      activities as any,
      vectors as any,
      new CatalogCandidateValidatorService(),
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

  it('rejects Text Search results outside the requested crawl radius', async () => {
    const api = placesApi('google');
    (api.searchText as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 'nearby-landmark',
          name: 'Nearby Landmark',
          rating: 4.8,
          location: { latitude: 1.005, longitude: 2 },
        },
        {
          id: 'global-landmark',
          name: 'Global Landmark',
          rating: 4.9,
          location: { latitude: 40.752, longitude: -111.816 },
        },
        {
          id: 'missing-location',
          name: 'Missing Location',
          rating: 4.9,
        },
      ],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 20,
        receivedCount: 3,
      },
    });
    const { service } = buildService(api);

    const result = await service.searchNearbyPlaces(
      { latitude: 1, longitude: 2, radius: 1000 },
      {
        type: 'point_of_interest',
        keyword: 'historic landmark',
        minRating: 4,
        preferredTime: 'day',
      },
    );

    expect(api.searchText).toHaveBeenCalled();
    expect(result.places.map((place) => place.placeId)).toEqual([
      'nearby-landmark',
    ]);
    expect(result.provenance.receivedCount).toBe(3);
    expect(result.rejectedCountByReason).toEqual({ out_of_area: 2 });
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

  it('keeps an independent configured Text Search result when a Nearby operation exhausts quota', async () => {
    const api = placesApi('google');
    const quotaError = new PlacesApiRequestError(
      'daily quota exhausted',
      {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 20,
        receivedCount: 0,
      },
      undefined,
      'quota_exhausted',
      'searchNearby',
    );
    (api.searchNearby as jest.Mock).mockRejectedValue(quotaError);
    (api.searchText as jest.Mock)
      .mockResolvedValueOnce({
        data: [
          {
            id: 'google-landmark-1',
            name: 'Historic Landmark',
            rating: 4.8,
            userRatingCount: 100,
            types: ['tourist_attraction'],
            location: { latitude: 1, longitude: 2 },
          },
        ],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 1,
        },
      })
      .mockResolvedValue({
        data: [],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 0,
        },
      });
    const { service, activities } = buildService(api);
    activities.create.mockResolvedValue({ id: 'activity-1' });

    const result = await service.crawlAndSaveActivities({
      latitude: 1,
      longitude: 2,
      radius: 1000,
    });

    expect(api.searchText).toHaveBeenCalled();
    expect(activities.create).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'google-landmark-1' }),
    );
    expect(result.activitiesIds).toEqual(['activity-1']);
    expect(result.provenance.rejectedCountByReason).toEqual(
      expect.objectContaining({ provider_request_failed: expect.any(Number) }),
    );
  });

  it('preserves the quota error when independent operations return no valid candidates', async () => {
    const api = placesApi('google');
    const quotaError = new PlacesApiRequestError(
      'daily quota exhausted',
      {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 20,
        receivedCount: 0,
      },
      undefined,
      'quota_exhausted',
      'searchNearby',
    );
    (api.searchNearby as jest.Mock).mockRejectedValue(quotaError);

    const { service } = buildService(api);

    await expect(
      service.crawlAndSaveActivities({
        latitude: 1,
        longitude: 2,
        radius: 1000,
      }),
    ).rejects.toMatchObject({ code: 'quota_exhausted' });
  });

  it('searches representative anchors and deduplicates the same provider identity before persistence', async () => {
    const api = placesApi('google');
    (api.searchNearby as jest.Mock).mockImplementation(async (params) => ({
      data: [
        {
          id: 'shared-place',
          name: 'Museo compartido',
          rating: 4.8,
          userRatingCount: 250,
          types: ['museum'],
          formattedAddress: 'Centro, Sevilla',
          location: {
            latitude: params.latitude,
            longitude: params.longitude,
          },
        },
      ],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 5,
        receivedCount: 1,
      },
    }));
    const { service, activities } = buildService(api);
    activities.create.mockResolvedValue({ id: 'activity-1' });

    const result = await service.crawlAndSaveActivities(
      { latitude: 37.39, longitude: -5.99, radius: 5000 },
      {
        requestedInterests: ['history'],
        maxProviderCalls: 2,
        maxResultsPerCall: 5,
        anchors: [
          {
            id: 'casco',
            label: 'Casco Antiguo',
            latitude: 37.39,
            longitude: -5.99,
            radiusMeters: 2500,
          },
          {
            id: 'triana',
            label: 'Triana',
            latitude: 37.39,
            longitude: -6.0,
            radiusMeters: 2500,
          },
        ],
      },
    );

    expect(api.searchNearby).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ latitude: 37.39, longitude: -5.99 }),
    );
    expect(api.searchNearby).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ latitude: 37.39, longitude: -6.0 }),
    );
    expect(activities.create).toHaveBeenCalledTimes(1);
    expect(result.provenance).toEqual(
      expect.objectContaining({
        providerCallCount: 2,
        receivedCount: 2,
        validatedCount: 1,
        deduplicatedCount: 1,
        acceptedCount: 1,
        embeddedCount: 1,
      }),
    );
    expect(result.provenance.rejectedCountByReason.duplicate_result).toBe(1);
  });

  it('rejects empty names and never sends them to ActivitiesService.create', async () => {
    const api = placesApi('google');
    (api.searchNearby as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 'blank-name',
          name: '   ',
          types: ['museum'],
          formattedAddress: 'Sevilla',
          location: { latitude: 37.39, longitude: -5.99 },
        },
      ],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 5,
        receivedCount: 1,
      },
    });
    const { service, activities } = buildService(api);

    const result = await service.crawlAndSaveActivities(
      { latitude: 37.39, longitude: -5.99, radius: 2000 },
      { requestedInterests: ['history'], maxProviderCalls: 1 },
    );

    expect(activities.create).not.toHaveBeenCalled();
    expect(result.provenance.rejectedCountByReason.empty_name).toBe(1);
    expect(result.provenance.acceptedCount).toBe(0);
  });

  it('rejects a provider-confirmed permanent closure before persistence', async () => {
    const api = placesApi('google');
    (api.searchNearby as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 'closed-museum',
          name: 'Museo cerrado definitivamente',
          types: ['museum'],
          formattedAddress: 'Sevilla',
          businessStatus: 'CLOSED_PERMANENTLY',
          location: { latitude: 37.39, longitude: -5.99 },
        },
      ],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 5,
        receivedCount: 1,
      },
    });
    const { service, activities } = buildService(api);

    const result = await service.crawlAndSaveActivities(
      { latitude: 37.39, longitude: -5.99, radius: 2000 },
      { requestedInterests: ['history'], maxProviderCalls: 1 },
    );

    expect(activities.create).not.toHaveBeenCalled();
    expect(result.provenance.rejectedCountByReason.permanently_closed).toBe(1);
  });

  it('rejects a high-rated result outside the destination boundary', async () => {
    const api = placesApi('google');
    (api.searchNearby as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 'outside-city',
          name: 'Famous Museum Outside',
          rating: 5,
          userRatingCount: 5000,
          types: ['museum'],
          formattedAddress: 'Outside',
          location: { latitude: 1.01, longitude: 0.99 },
        },
      ],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 5,
        receivedCount: 1,
      },
    });
    const { service, activities } = buildService(api);

    const result = await service.crawlAndSaveActivities(
      { latitude: 0.99, longitude: 0.99, radius: 5000 },
      {
        requestedInterests: ['history'],
        maxProviderCalls: 1,
        destinationBoundary: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
      },
    );

    expect(activities.create).not.toHaveBeenCalled();
    expect(
      result.provenance.rejectedCountByReason.outside_destination_boundary,
    ).toBe(1);
  });

  it('uses requested interests to avoid unrelated category calls', async () => {
    const api = placesApi('google');
    const { service } = buildService(api);

    await service.crawlAndSaveActivities(
      { latitude: 1, longitude: 2, radius: 1000 },
      {
        requestedInterests: ['food'],
        maxProviderCalls: 2,
      },
    );

    const requestedTypes = (api.searchNearby as jest.Mock).mock.calls.map(
      ([params]) => params.includedTypes[0],
    );
    expect(requestedTypes).toEqual(['restaurant', 'cafe']);
  });

  it('shares a bounded multi-anchor budget across every requested category', async () => {
    const api = placesApi('google');
    const { service } = buildService(api);
    const anchors = ['casco', 'triana', 'macarena', 'remedios'].map(
      (id, index) => ({
        id,
        label: id,
        latitude: 37.37 + index * 0.01,
        longitude: -6,
        radiusMeters: 2000,
      }),
    );

    await service.crawlAndSaveActivities(
      { latitude: 37.39, longitude: -5.99, radius: 5000 },
      {
        requestedInterests: ['history', 'food'],
        anchors,
        maxProviderCalls: 8,
      },
    );

    const requestedTypes = (api.searchNearby as jest.Mock).mock.calls.map(
      ([params]) => params.includedTypes[0],
    );
    expect(requestedTypes).toEqual([
      'tourist_attraction',
      'restaurant',
      'tourist_attraction',
      'restaurant',
      'tourist_attraction',
      'restaurant',
      'tourist_attraction',
      'restaurant',
    ]);
  });
});
