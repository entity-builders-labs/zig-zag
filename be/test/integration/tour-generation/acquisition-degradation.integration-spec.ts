import { TourGenerationHarness } from './support/harness';
import { osmPoi } from './support/fakes';
import { seedTour } from '../support/seed';

/**
 * Multi-source failure semantics, provider-neutral. One source failing while
 * the rest stay sufficient still yields a Tour; the trace / executionSummary
 * truthfully name which provider was attempted and which failed. When EVERY
 * attempted source fails and the catalog is empty, generation fails with a
 * retryable signal. Google Places holds no special failure authority.
 */
const DEST = { latitude: -34.6, longitude: -58.4 };

const groundableWeb = {
  groundedSearch: { evidence: [{ key: 'web:deg:1' }] },
  discoveryExtractor: {
    candidates: Array.from({ length: 5 }, (_, i) => ({
      name: `Resilient history stop ${i}`,
      themes: ['history'],
      intents: ['visit'],
      evidenceKeys: ['web:deg:1'],
    })),
  },
  osm: {
    pois: Array.from({ length: 5 }, (_, i) =>
      osmPoi(
        `Resilient history stop ${i}`,
        DEST.latitude + i * 0.0005,
        DEST.longitude + i * 0.0005,
      ),
    ),
  },
};

async function newTour(harness: TourGenerationHarness): Promise<string> {
  return seedTour(harness.prisma, {
    destinationLabel: 'Buenos Aires',
    latitude: DEST.latitude,
    longitude: DEST.longitude,
    radiusMeters: 12000,
    days: 1,
    interests: ['history'],
    intents: ['visit'],
  });
}

describe('tour-generation integration · acquisition degradation', () => {
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

  const survives: Array<{
    name: string;
    failing: string;
    scenario: Parameters<TourGenerationHarness['configure']>[0];
  }> = [
    {
      name: 'Wikivoyage fails, web + OSM sufficient',
      failing: 'wikivoyage',
      scenario: { ...groundableWeb, wikivoyage: { status: 'failed' } },
    },
    {
      name: 'Google Places quota fails, other sources sufficient',
      failing: 'google_places',
      scenario: { ...groundableWeb, places: { fail: true } },
    },
  ];

  for (const testCase of survives) {
    it(`completes when ${testCase.name}`, async () => {
      harness.configure(testCase.scenario);
      const tourId = await newTour(harness);
      const outcome = await harness.generate(tourId);
      expect(outcome.error?.message ?? 'ok').toBe('ok');

      const tour = await harness.loadTour(tourId);
      expect(tour.generationStatus).toBe('completed');
      expect(tour.tourExperiences.length).toBeGreaterThanOrEqual(1);

      const acq = tour.executionSummary.acquisition;
      expect(acq.providersAttempted).toEqual(
        expect.arrayContaining([testCase.failing]),
      );
      expect(acq.providersFailed).toEqual(
        expect.arrayContaining([testCase.failing]),
      );
      // Something other than the failed provider carried the run.
      expect(acq.providersFailed.length).toBeLessThan(
        acq.providersAttempted.length,
      );
    });
  }

  it('fails with a retryable signal when every attempted source fails and the catalog is empty', async () => {
    harness.configure({
      wikivoyage: { status: 'failed' },
      places: { fail: true },
      osm: { failFeatures: true, failPois: true, failStreets: true },
      groundedSearch: { fail: true },
    });
    const tourId = await newTour(harness);
    const outcome = await harness.generate(tourId);

    expect(outcome.ok).toBe(false);
    expect(outcome.error?.retryable).toBe(true);

    const tour = await harness.loadTour(tourId);
    expect(tour.generationStatus).toBe('failed');
    expect(
      await harness.prisma.experience.count({ where: { status: 'VERIFIED' } }),
    ).toBe(0);

    const tourRecord = await harness.prisma.tour.findUnique({
      where: { id: tourId },
    });
    const trace = (tourRecord?.metadata as any)?.generationTrace;
    expect(trace).toBeDefined();
    expect(trace.version).toBe(5);
    expect(trace.result.status).toBe('FAILED');
    expect(trace.result.outcome).toBe('GENERATION_FAILED');
    expect(trace.result.reason).toContain('Coverage insuficiente');
    expect(trace.steps.length).toBeGreaterThanOrEqual(1);
    expect(
      trace.steps.some((s: any) => s.name === 'preference.interpretation'),
    ).toBe(true);
    expect(trace.steps.some((s: any) => s.name === 'coverage.analysis')).toBe(
      true,
    );
  });
});
