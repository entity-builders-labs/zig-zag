import { TourGenerationHarness } from './support/harness';
import { osmPoi } from './support/fakes';
import { seedTour } from '../support/seed';

/**
 * The full productive path, empty catalog → materialized Tour, against real
 * Postgres. Acquisition returns BOTH a structured source result (Wikivoyage
 * SEE listing) and a web SourcePlan result (grounded evidence → discovery
 * extractor), and every internal layer between coverage and TourExperience
 * materialization runs for real.
 */
const DEST = { latitude: -34.6083, longitude: -58.3712 };

describe('tour-generation integration · canonical orchestration', () => {
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

  it('acquires from a structured source AND a web SourcePlan, persists, re-queries and plans a Tour', async () => {
    harness.configure({
      wikivoyage: {
        status: 'ok',
        title: 'Buenos Aires',
        entries: [
          {
            name: 'Museo Histórico Nacional',
            sectionType: 'SEE',
            lat: DEST.latitude,
            long: DEST.longitude,
            description: 'National history museum in Parque Lezama.',
          },
        ],
      },
      groundedSearch: {
        evidence: [
          {
            key: 'web:ev:history-walk-1',
            title: 'A history walk through San Telmo',
            snippet: 'Casa Mínima and the old colonial quarter.',
          },
        ],
      },
      discoveryExtractor: {
        candidates: [
          {
            name: 'San Telmo colonial history walk',
            themes: ['history'],
            intents: ['visit'],
            evidenceKeys: ['web:ev:history-walk-1'],
          },
        ],
      },
      osm: {
        pois: [
          osmPoi('Museo Histórico Nacional', DEST.latitude, DEST.longitude),
          osmPoi(
            'San Telmo colonial history walk',
            DEST.latitude + 0.0004,
            DEST.longitude + 0.0004,
          ),
        ],
      },
    });

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 2,
      interests: ['history'],
      intents: ['visit'],
    });

    const outcome = await harness.generate(tourId);
    expect(outcome.error?.message ?? 'ok').toBe('ok');
    expect(outcome.ok).toBe(true);

    // ── Real Postgres persistence ──
    const verified = await harness.prisma.experience.findMany({
      where: { status: 'VERIFIED' },
      include: { components: { include: { geoEntity: true } } },
    });
    expect(verified.length).toBeGreaterThanOrEqual(1);
    const names = verified.map((e) => e.canonicalName);
    expect(names).toEqual(
      expect.arrayContaining(['San Telmo colonial history walk']),
    );
    for (const experience of verified) {
      expect(experience.components.length).toBeGreaterThanOrEqual(1);
      expect(experience.components.every((c) => c.geoEntityId != null)).toBe(
        true,
      );
      expect(
        experience.components.every((c) => c.geoEntity?.kind === 'PLACE'),
      ).toBe(true);
    }

    // ── Both acquisition channels were exercised ──
    expect(harness.fakes.wikivoyage.fetchArticle).toHaveBeenCalled();
    expect(harness.fakes.groundedSearch.search).toHaveBeenCalled();
    expect(
      harness.fakes.discoveryExtractor.extractExperiences,
    ).toHaveBeenCalled();

    // ── Trace + executionSummary reflect the real acquisition ──
    const tour = await harness.loadTour(tourId);
    expect(tour.generationStatus).toBe('completed');

    const acquisitionSteps = harness
      .traceSteps(tour.trace)
      .filter((s) => s.component === 'ExperienceAcquisitionService');
    expect(acquisitionSteps.length).toBeGreaterThanOrEqual(1);
    expect(acquisitionSteps[0].stage).toBe('discovery');
    // No legacy "Places crawl" step on the canonical path.
    expect(
      harness.traceSteps(tour.trace).some((s) => s.stage === 'places_crawl'),
    ).toBe(false);

    expect(tour.executionSummary).toBeDefined();
    expect(tour.executionSummary.acquisition).toBeDefined();
    expect(tour.executionSummary.acquisition.passes).toBeGreaterThanOrEqual(1);
    expect(
      tour.executionSummary.acquisition.webCandidateCount +
        tour.executionSummary.acquisition.structuredCandidateCount,
    ).toBeGreaterThanOrEqual(1);

    // ── The re-queried catalog fed ranking + planner ──
    expect(tour.tourExperiences.length).toBeGreaterThanOrEqual(1);
    const plannedIds = new Set(
      tour.tourExperiences.map((te) => te.experienceId),
    );
    expect(verified.some((e) => plannedIds.has(e.id))).toBe(true);
    for (const te of tour.tourExperiences) {
      expect(te.dayNumber).toBeGreaterThanOrEqual(1);
      expect(te.components.length).toBeGreaterThanOrEqual(1);
    }
  });
});
