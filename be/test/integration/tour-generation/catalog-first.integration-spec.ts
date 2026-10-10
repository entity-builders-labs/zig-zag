import { TourGenerationHarness } from './support/harness';
import { seedTour, seedVerifiedExperience } from '../support/seed';

/**
 * A sufficient VERIFIED catalog for the request => the preference-facet
 * coverage authority (FacetRetrievalService/preference-sufficiency.util.ts,
 * cutover M2) decides `none` and the acquisition loop never runs => ZERO
 * calls to every faked external transport. Proves catalog-first is real,
 * not a mocked branch.
 */
const DEST = { latitude: -34.6037, longitude: -58.3816 };

describe('tour-generation integration · catalog-first', () => {
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

  it('plans directly from a sufficient catalog and calls no provider', async () => {
    for (let i = 0; i < 8; i++) {
      await seedVerifiedExperience(harness.prisma, {
        canonicalName: `Casco histórico stop ${i}`,
        description: 'A verified historic landmark in the old town.',
        themes: ['history'],
        traits: ['iconic'],
        intents: ['visit'],
        latitude: DEST.latitude + i * 0.0006,
        longitude: DEST.longitude + i * 0.0006,
        // Canonical scale is 0..5 (DEFAULT_QUALITY_FLOOR = 3.0,
        // preference-strong-match.util.ts) -- explicitly strong, not the
        // stale 0..1-scale placeholder this fixture used to carry.
        qualityScore: 4.5,
        durationMinutes: 75,
      });
    }

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: ['visit'],
    });

    const outcome = await harness.generate(tourId);
    expect(outcome.error?.message ?? 'ok').toBe('ok');

    const tour = await harness.loadTour(tourId);
    expect(tour.generationStatus).toBe('completed');

    const coverage = harness
      .traceSteps(tour.trace)
      .find(
        (s) =>
          s.stage === 'coverage_analysis' || s.name === 'coverage.analysis',
      );
    // Canonical preference-first coverage result (cutover M2 cleanup) --
    // no legacy `coverageReport` projection is produced by the live path.
    expect(coverage?.coverageReport).toBeUndefined();
    expect(['none', 'SUFFICIENT']).toContain(coverage?.decision?.outcome);
    expect(coverage?.outputs?.sufficient ?? coverage?.output?.sufficient).toBe(
      true,
    );

    // Zero external transport calls — catalog-first short-circuit.
    expect(harness.fakes.wikivoyage.fetchArticle).not.toHaveBeenCalled();
    expect(harness.fakes.osm.lookupPoisNear).not.toHaveBeenCalled();
    expect(harness.fakes.osm.lookupFeaturesNear).not.toHaveBeenCalled();
    expect(harness.fakes.places.searchNearby).not.toHaveBeenCalled();
    expect(harness.fakes.places.searchText).not.toHaveBeenCalled();
    expect(harness.fakes.groundedSearch.search).not.toHaveBeenCalled();
    expect(
      harness.fakes.discoveryExtractor.extractExperiences,
    ).not.toHaveBeenCalled();

    // No acquisition step, and a Tour was still planned from the catalog.
    expect(
      harness
        .traceSteps(tour.trace)
        .some(
          (s) => s.stage === 'discovery' || s.name?.startsWith('acquisition.'),
        ),
    ).toBe(false);
    expect(tour.tourExperiences.length).toBeGreaterThanOrEqual(1);
  });
});
