import { TourGenerationHarness } from './support/harness';
import { osmPoi } from './support/fakes';
import { seedTour } from '../support/seed';

/**
 * Run 1: empty catalog, acquisition persists Experiences. Run 2: a fresh,
 * compatible Tour request against the SAME database => the catalog is now
 * sufficient, so run 2 makes zero provider calls, creates no duplicate
 * Experience rows, and still builds a Tour from the reused catalog.
 */
const DEST = { latitude: -34.6, longitude: -58.4 };
const DISCOVERED = Array.from(
  { length: 7 },
  (_, i) => `Reused history stop ${i}`,
);

describe('tour-generation integration · catalog-reuse', () => {
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

  it('reuses the persisted catalog on a second compatible request', async () => {
    harness.configure({
      groundedSearch: { evidence: [{ key: 'web:reuse:1' }] },
      discoveryExtractor: {
        candidates: DISCOVERED.map((name) => ({
          name,
          themes: ['history'],
          intents: ['visit'],
          evidenceKeys: ['web:reuse:1'],
        })),
      },
      osm: {
        pois: DISCOVERED.map((name, i) =>
          osmPoi(name, DEST.latitude + i * 0.0005, DEST.longitude + i * 0.0005),
        ),
      },
    });

    const tour1 = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: ['visit'],
    });
    const run1 = await harness.generate(tour1);
    expect(run1.error?.message ?? 'ok').toBe('ok');

    const afterRun1 = await harness.prisma.experience.count({
      where: { status: 'VERIFIED' },
    });
    expect(afterRun1).toBeGreaterThanOrEqual(4);
    expect(
      harness.fakes.discoveryExtractor.extractExperiences,
    ).toHaveBeenCalled();

    // ── Run 2: same DB, new tour, mocks reset ──
    jest.clearAllMocks();
    const tour2 = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: ['visit'],
    });
    const run2 = await harness.generate(tour2);
    expect(run2.error?.message ?? 'ok').toBe('ok');

    const tour2Loaded = await harness.loadTour(tour2);
    const coverage2 = harness
      .traceSteps(tour2Loaded.trace)
      .find((s) => s.stage === 'coverage_analysis');
    expect(coverage2?.coverageReport?.decision?.action).toBe('none');

    // No new provider work on run 2.
    expect(harness.fakes.wikivoyage.fetchArticle).not.toHaveBeenCalled();
    expect(harness.fakes.groundedSearch.search).not.toHaveBeenCalled();
    expect(
      harness.fakes.discoveryExtractor.extractExperiences,
    ).not.toHaveBeenCalled();
    expect(harness.fakes.places.searchNearby).not.toHaveBeenCalled();

    // No duplicate Experience rows; catalog count unchanged.
    const afterRun2 = await harness.prisma.experience.count({
      where: { status: 'VERIFIED' },
    });
    expect(afterRun2).toBe(afterRun1);

    const grouped = await harness.prisma.experience.groupBy({
      by: ['canonicalName'],
      where: { status: 'VERIFIED' },
      _count: { _all: true },
    });
    for (const row of grouped) {
      expect(row._count._all).toBe(1);
    }

    expect(tour2Loaded.tourExperiences.length).toBeGreaterThanOrEqual(1);
  });
});
