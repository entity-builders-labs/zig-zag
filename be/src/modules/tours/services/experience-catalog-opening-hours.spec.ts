import { ExperienceCatalogService } from './experience-catalog.service';
import { parseOpeningHours } from '../utils/normalized-opening-hours.util';

describe('ExperienceCatalogService opening hours', () => {
  it('normalizes Google weekday descriptions and persists them on Experience', async () => {
    const openingHours = parseOpeningHours([
      'Monday: 9:00 AM – 6:00 PM',
      'Tuesday: Closed',
    ]);

    const tx: any = {
      $executeRaw: jest.fn(),
      experience: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async (args: any) => ({
          id: 'experience-museum-1',
          ...args.data,
        })),
      },
    };
    const prisma: any = {
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const experience = await service.persistVerifiedExperience({
      canonicalName: 'Museo de Prueba',
      description: 'Buenos Aires',
      latitude: -34.6037,
      longitude: -58.3816,
      durationMinutes: 90,
      qualityScore: 4.7,
      openingHours,
      metadata: { source: 'places_acquisition', provider: 'google' },
      components: [{ geoEntityId: 'geo-museum-1', role: 'venue' }],
      evidence: [{ source: 'google_places', title: 'Museo de Prueba' }],
    });

    expect((experience as any).openingHours).toEqual({
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
    expect(tx.experience.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
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
      }),
    );
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
