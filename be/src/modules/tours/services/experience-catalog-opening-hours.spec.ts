import { ExperienceCatalogService } from './experience-catalog.service';

describe('ExperienceCatalogService opening hours', () => {
  it('normalizes Google weekday descriptions and persists them on Experience', async () => {
    const placesApi: any = {
      searchNearby: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'museum-1',
            displayName: { text: 'Museo de Prueba' },
            formattedAddress: 'Buenos Aires',
            location: { latitude: -34.6037, longitude: -58.3816 },
            primaryType: 'museum',
            types: ['museum'],
            rating: 4.7,
            openingHoursWeekdayText: [
              'Monday: 9:00 AM – 6:00 PM',
              'Tuesday: Closed',
            ],
          },
        ],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 1,
        },
      }),
    };
    const service = new ExperienceCatalogService({} as any, placesApi);
    jest
      .spyOn(service, 'upsertGeoEntity')
      .mockResolvedValue({ id: 'geo-museum-1' } as any);
    const persist = jest
      .spyOn(service, 'persistVerifiedExperience')
      .mockImplementation(async (input: any) => ({
        id: 'experience-museum-1',
        canonicalName: input.canonicalName,
        latitude: input.latitude,
        longitude: input.longitude,
        openingHours: input.openingHours,
        components: [],
        dedupeDecision: 'NEW',
      } as any));

    const result = await service.acquireNearbyAsExperiences({
      latitude: -34.6037,
      longitude: -58.3816,
      radius: 5000,
    });

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        openingHours: {
          status: 'known',
          rangesByWeekday: {
            1: [
              {
                startMinutesFromMidnight: 540,
                endMinutesFromMidnight: 1080,
              },
            ],
            2: [],
          },
        },
      }),
    );
    expect(result.experiences[0].openingHours).toEqual({
      status: 'known',
      rangesByWeekday: {
        1: [
          {
            startMinutesFromMidnight: 540,
            endMinutesFromMidnight: 1080,
          },
        ],
        2: [],
      },
    });
  });

  it('returns canonical opening hours from catalog retrieval without metadata fallback', async () => {
    const openingHours = {
      status: 'known',
      rangesByWeekday: {
        1: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 900 }],
      },
    };
    const prisma: any = {
      experience: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'experience-1',
            canonicalName: 'Museo con horario',
            description: null,
            durationMinutes: 60,
            price: null,
            qualityScore: 4.5,
            latitude: -34.6037,
            longitude: -58.3816,
            openingHours,
            metadata: {},
            components: [],
            traits: [],
          },
        ]),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findVerifiedWithin(
      -34.6037,
      -58.3816,
      5000,
      10,
    );

    expect(result).toHaveLength(1);
    expect(result[0].openingHours).toEqual(openingHours);
    expect(result[0].metadata).not.toHaveProperty('openingHours');
  });
});
