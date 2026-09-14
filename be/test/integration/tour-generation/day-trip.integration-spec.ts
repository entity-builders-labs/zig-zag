import { TourGenerationHarness } from './support/harness';
import { osmPoi } from './support/fakes';
import { seedTour, seedVerifiedExperience } from '../support/seed';

/**
 * A `day_trip` intent from a Buenos Aires base: acquisition discovers and
 * resolves a day-trip Experience, it is persisted inside the destination
 * scope, the base destination is unchanged, and the planner places it in a
 * valid day rather than swapping it for an arbitrary nearby POI.
 */
const DEST = { latitude: -34.6037, longitude: -58.3816 };

describe('tour-generation integration · day trip', () => {
  let harness: TourGenerationHarness;

  beforeAll(async () => {
    harness = await TourGenerationHarness.create();
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await harness.reset();
  });

  it('acquires, resolves and plans a day-trip Experience without moving the base', async () => {
    // A couple of ordinary catalog POIs — the day-trip candidate must not be
    // silently replaced by one of these.
    for (let i = 0; i < 2; i++) {
      await seedVerifiedExperience(harness.prisma, {
        canonicalName: `City centre landmark ${i}`,
        themes: ['history'],
        intents: ['visit'],
        latitude: DEST.latitude + i * 0.001,
        longitude: DEST.longitude + i * 0.001,
        qualityScore: 0.7,
      });
    }

    harness.configure({
      groundedSearch: {
        evidence: [{ key: 'web:daytrip:1', title: 'Tigre Delta day trip' }],
      },
      discoveryExtractor: {
        candidates: [
          {
            name: 'Tigre Delta boat day trip',
            description:
              'A full-day excursion to the Paraná Delta from Buenos Aires.',
            themes: ['nature'],
            intents: ['day_trip'],
            suggestedDurationMinutes: 300,
            evidenceKeys: ['web:daytrip:1'],
          },
        ],
      },
      osm: {
        pois: [
          osmPoi(
            'Tigre Delta boat day trip',
            DEST.latitude + 0.0006,
            DEST.longitude + 0.0006,
          ),
        ],
      },
    });
    // Cutover M4: the accepted candidate now converges through real
    // evidence-only classification (ExperienceAcquisitionService
    // .materializeExecution()) before its intents/themes persist. The fake
    // LLM must return a genuine, evidence-grounded verdict citing the real
    // evidenceKey this request's discovery evidence carries -- never a
    // magic passthrough of the candidate's own unverified claim.
    harness.fakes.langChain.generateChatResponse.mockResolvedValue(
      JSON.stringify({
        themes: ['nature'],
        intents: ['day_trip'],
        traits: [],
        reasoningEvidence: [
          {
            facet: 'theme:nature',
            evidenceKeys: ['web:daytrip:1'],
            reason: 'Evidence describes a full-day nature excursion.',
          },
          {
            facet: 'intent:day_trip',
            evidenceKeys: ['web:daytrip:1'],
            reason: 'Evidence describes a full-day excursion from the base.',
          },
        ],
      }),
    );

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 15000,
      days: 1,
      interests: ['nature'],
      intents: ['day_trip'],
    });

    const outcome = await harness.generate(tourId);
    expect(outcome.error?.message ?? 'ok').toBe('ok');

    // Base destination unchanged.
    const tourRow = await harness.prisma.tour.findUniqueOrThrow({
      where: { id: tourId },
    });
    expect((tourRow.metadata as any).generationRequest.destination.label).toBe(
      'Buenos Aires',
    );

    // The day-trip Experience was persisted and grounded within scope.
    const dayTrip = await harness.prisma.experience.findFirst({
      where: {
        canonicalName: 'Tigre Delta boat day trip',
        status: 'VERIFIED',
      },
      include: { components: { include: { geoEntity: true } } },
    });
    expect(dayTrip).not.toBeNull();
    expect(dayTrip!.components.length).toBeGreaterThanOrEqual(1);
    expect(dayTrip!.components.every((c) => c.geoEntityId != null)).toBe(true);
    expect((dayTrip!.metadata as any).intents).toEqual(
      expect.arrayContaining(['day_trip']),
    );

    // Planned into a valid day, referenced by a TourExperience — not replaced.
    const tour = await harness.loadTour(tourId);
    const plannedForDayTrip = tour.tourExperiences.find(
      (te) => te.experienceId === dayTrip!.id,
    );
    expect(plannedForDayTrip).toBeDefined();
    expect(plannedForDayTrip!.dayNumber).toBeGreaterThanOrEqual(1);
  });
});
