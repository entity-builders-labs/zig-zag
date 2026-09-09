import { TourGenerationHarness } from './support/harness';
import { osmPoi } from './support/fakes';
import { seedTour } from '../support/seed';

/**
 * The same proposal + evidence delivered on two generation runs (a retry)
 * reconciles to ONE logical Experience against real Postgres: the resolver's
 * SAME/dedupe path and GeoEntity identity reconciliation hold — no duplicate
 * Experience rows, no duplicate GeoEntity for the same external id.
 */
const DEST = { latitude: -34.6, longitude: -58.37 };

describe('tour-generation integration · duplicate delivery', () => {
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

  it('reconciles a re-delivered proposal to a single Experience', async () => {
    const scenario = {
      groundedSearch: {
        evidence: [{ key: 'web:dup:1', title: 'Recoleta cemetery visit' }],
      },
      discoveryExtractor: {
        candidates: [
          {
            name: 'Recoleta Cemetery guided visit',
            description: 'Walk the mausoleums of Recoleta Cemetery.',
            themes: ['history'],
            intents: ['visit'],
            evidenceKeys: ['web:dup:1'],
          },
        ],
      },
      osm: {
        pois: [
          osmPoi(
            'Recoleta Cemetery guided visit',
            DEST.latitude,
            DEST.longitude,
          ),
        ],
      },
    };

    harness.configure(scenario);
    const tour1 = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: ['visit'],
    });
    expect((await harness.generate(tour1)).error?.message ?? 'ok').toBe('ok');

    const nameWhere = {
      canonicalName: 'Recoleta Cemetery guided visit',
    } as const;
    const afterRun1 = await harness.prisma.experience.findMany({
      where: nameWhere,
      include: { components: true },
    });
    expect(afterRun1).toHaveLength(1);
    const geoAfterRun1 = await harness.prisma.geoEntity.count({
      where: { name: 'Recoleta Cemetery guided visit' },
    });

    // ── Re-deliver the identical proposal on a second run ──
    jest.clearAllMocks();
    harness.configure(scenario);
    const tour2 = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: ['visit'],
    });
    expect((await harness.generate(tour2)).error?.message ?? 'ok').toBe('ok');

    const afterRun2 = await harness.prisma.experience.findMany({
      where: nameWhere,
      include: { components: true },
    });
    // One logical Experience, same id, no duplicated components.
    expect(afterRun2).toHaveLength(1);
    expect(afterRun2[0].id).toBe(afterRun1[0].id);
    expect(afterRun2[0].components.length).toBe(afterRun1[0].components.length);

    // No duplicate GeoEntity identity for the same external id.
    expect(
      await harness.prisma.geoEntity.count({
        where: { name: 'Recoleta Cemetery guided visit' },
      }),
    ).toBe(geoAfterRun1);

    // Both tours reference the one persisted Experience.
    const tour2Loaded = await harness.loadTour(tour2);
    expect(
      tour2Loaded.tourExperiences.some(
        (te) => te.experienceId === afterRun1[0].id,
      ),
    ).toBe(true);
  });
});
