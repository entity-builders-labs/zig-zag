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
  const vectors = {
    saveActivityEmbedding: jest.fn(async (indexedActivities: any[]) => ({
      status: 'indexed' as const,
      requestedIds: indexedActivities.map(({ id }) => id),
      indexedIds: indexedActivities.map(({ id }) => id),
      identity: {
        provider: 'ollama' as const,
        model: 'nomic-embed-text',
        dimensions: 256,
        documentVersion: 1,
      },
    })),
  };

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
    vectors,
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

  it('uses Nearby primary-type groups ranked by popularity and records the operation', async () => {
    const api = placesApi('google');
    (api.searchNearby as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 'low',
          name: 'Low rating',
          rating: 3,
          userRatingCount: 10,
          types: ['museum', 'tourist_attraction'],
          location: { latitude: 1, longitude: 2 },
        },
        {
          id: 'accepted',
          name: 'Accepted museum',
          rating: 4.8,
          userRatingCount: 20,
          types: ['museum'],
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
    const { service, activities } = buildService(api);
    activities.create
      .mockResolvedValueOnce({ id: 'activity-low' })
      .mockResolvedValueOnce({ id: 'activity-accepted' });

    const result = await service.crawlAndSaveActivities(
      { latitude: 1, longitude: 2, radius: 1000 },
      { requestedInterests: ['history'], maxProviderCalls: 1 },
    );

    expect(api.searchNearby).toHaveBeenCalledWith(
      expect.objectContaining({
        includedPrimaryTypes: expect.arrayContaining([
          'tourist_attraction',
          'historical_landmark',
        ]),
        rankPreference: 'POPULARITY',
      }),
    );
    expect(result.provenance.receivedCount).toBe(2);
    expect(result.provenance.operations).toEqual([
      expect.objectContaining({
        purpose: 'geographic_coverage',
        providerOperation: 'nearby',
        status: 'succeeded',
        receivedCount: 2,
      }),
    ]);
  });

  it('rejects Text Search results outside the requested crawl radius', async () => {
    const api = placesApi('google');
    const firstResponse = {
      data: [
        {
          id: 'nearby-landmark',
          name: 'Nearby Landmark',
          rating: 4.8,
          userRatingCount: 50,
          types: ['tourist_attraction'],
          location: { latitude: 1.005, longitude: 2 },
        },
        {
          id: 'global-landmark',
          name: 'Global Landmark',
          rating: 4.9,
          userRatingCount: 50,
          types: ['tourist_attraction'],
          location: { latitude: 40.752, longitude: -111.816 },
        },
        {
          id: 'missing-location',
          name: 'Missing Location',
          rating: 4.9,
          userRatingCount: 50,
          types: ['tourist_attraction'],
        },
      ],
      provenance: {
        provider: 'google' as const,
        cacheStatus: 'miss-live' as const,
        requestedCount: 20,
        receivedCount: 3,
      },
    };
    (api.searchText as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce(firstResponse)
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

    const result = await service.crawlAndSaveActivities(
      { latitude: 1, longitude: 2, radius: 1000 },
      {
        destinationLabel: 'Test City',
        requestedInterests: ['history'],
        maxProviderCalls: 2,
      },
    );

    expect(api.searchText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        textQuery: 'top tourist attractions in Test City',
        includedType: 'tourist_attraction',
        strictTypeFiltering: false,
        locationBias: {
          center: { latitude: 1, longitude: 2 },
          radius: 1000,
        },
      }),
    );
    expect(activities.create).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'nearby-landmark' }),
    );
    expect(result.provenance.receivedCount).toBe(3);
    expect(result.provenance.rejectedCountByReason).toEqual({ out_of_area: 2 });
  });

  it('persists source provenance from the selected provider and aggregates cache hits', async () => {
    const api = placesApi('geoapify');
    const { service, prisma } = buildService(api);

    const result = await service.crawlAndSaveActivities(
      {
        latitude: 1,
        longitude: 2,
        radius: 1000,
      },
      { destinationLabel: 'Test City', maxProviderCalls: 3 },
    );

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

    const result = await service.crawlAndSaveActivities(
      { latitude: 1, longitude: 2, radius: 1000 },
      { destinationLabel: 'Test City', maxProviderCalls: 3 },
    );

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
          types: ['museum', 'tourist_attraction'],
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
        seedReceivedCount: 0,
        coverageReceivedCount: 2,
        operationGeographyRejectedCount: 0,
        validatedCount: 1,
        deduplicatedCount: 1,
        acceptedCount: 1,
        persistedCount: 1,
        existingCount: 0,
        embeddedCount: 1,
      }),
    );
    expect(result.provenance.rejectedCountByReason.duplicate_result).toBe(1);
  });

  it('persists a valid place but exposes a failed embedding write truthfully', async () => {
    const api = placesApi('google');
    (api.searchText as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 'museum-1',
          name: 'Museo histórico',
          primaryType: 'tourist_attraction',
          types: ['museum', 'tourist_attraction'],
          rating: 4.7,
          userRatingCount: 250,
          formattedAddress: 'Centro, Córdoba',
          location: { latitude: -31.42, longitude: -64.18 },
        },
      ],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 5,
        receivedCount: 1,
      },
    });
    const { service, activities, vectors } = buildService(api);
    activities.create.mockResolvedValue({ id: 'activity-1' });
    vectors.saveActivityEmbedding.mockRejectedValue(
      new Error('Ollama request failed'),
    );

    const result = await service.crawlAndSaveActivities(
      { latitude: -31.42, longitude: -64.18, radius: 1000 },
      { maxProviderCalls: 1, destinationLabel: 'Córdoba, Argentina' },
    );

    expect(result.activitiesIds).toEqual(['activity-1']);
    expect(result.provenance).toMatchObject({
      persistedCount: 1,
      embeddedCount: 0,
      embeddingWriteStatus: 'failed',
      embeddingFailureReason: 'Ollama request failed',
    });
  });

  it('reports admitted existing activities separately from newly persisted rows', async () => {
    const api = placesApi('google');
    (api.searchNearby as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 'existing-museum',
          name: 'Existing museum',
          primaryType: 'tourist_attraction',
          types: ['tourist_attraction'],
          rating: 4.7,
          userRatingCount: 200,
          formattedAddress: 'San Juan, Argentina',
          location: { latitude: -31.535, longitude: -68.538 },
        },
      ],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 10,
        receivedCount: 1,
      },
    });
    const { service, prisma, activities } = buildService(api);
    prisma.activity.findFirst.mockResolvedValue({ id: 'already-there' });

    const result = await service.crawlAndSaveActivities(
      { latitude: -31.535, longitude: -68.538, radius: 2000 },
      { requestedInterests: ['history'], maxProviderCalls: 1 },
    );

    expect(activities.create).not.toHaveBeenCalled();
    expect(result.provenance).toEqual(
      expect.objectContaining({
        receivedCount: 1,
        identityValidCount: 1,
        admittedCount: 1,
        existingCount: 1,
        persistedCount: 0,
        embeddedCount: 0,
      }),
    );
    expect(result.provenance.rejectedCountByReason.existing_activity).toBe(1);
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

    const requestedTypeGroups = (api.searchNearby as jest.Mock).mock.calls.map(
      ([params]) => params.includedPrimaryTypes,
    );
    expect(requestedTypeGroups).toEqual([['restaurant', 'cafe', 'food_court']]);
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

    const requestedTypeGroups = (api.searchNearby as jest.Mock).mock.calls.map(
      ([params]) => params.includedPrimaryTypes,
    );
    expect(requestedTypeGroups).toEqual([
      expect.arrayContaining(['tourist_attraction', 'historical_landmark']),
      expect.arrayContaining(['museum', 'art_gallery']),
      ['restaurant', 'cafe', 'food_court'],
      expect.arrayContaining(['tourist_attraction', 'historical_landmark']),
      expect.arrayContaining(['museum', 'art_gallery']),
      ['restaurant', 'cafe', 'food_court'],
      expect.arrayContaining(['tourist_attraction', 'historical_landmark']),
      expect.arrayContaining(['museum', 'art_gallery']),
    ]);
  });
});
