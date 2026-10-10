import { TourGenerationHarness } from './support/harness';
import { seedTour, seedVerifiedExperience } from '../support/seed';

/**
 * The deterministic planner routes exclusively through
 * `TRAVEL_ESTIMATE_PROVIDER` (a fixture here — never a real network call).
 * `GreedyDailyPlanningSolver` / `PlanningCandidateNormalizerService` /
 * `TourPlanningFeasibilityValidatorService` all run for real. A real-routing
 * result (`approximate:false`) and an approximate fallback both propagate to
 * `travelFromPrevious`, the routing provider counts and the approximate count.
 */
const DEST = { latitude: -34.6037, longitude: -58.3816 };

async function seedCloseCatalog(
  harness: TourGenerationHarness,
  count = 6,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await seedVerifiedExperience(harness.prisma, {
      canonicalName: `Routing catalog stop ${i}`,
      themes: ['history'],
      traits: ['iconic'],
      intents: ['visit'],
      latitude: DEST.latitude + i * 0.0015,
      longitude: DEST.longitude + i * 0.0012,
      qualityScore: 0.8,
      durationMinutes: 60,
    });
  }
  // A multi-component Experience: routing between it and its neighbours must
  // use its endpoints, not its centroid.
  await seedVerifiedExperience(harness.prisma, {
    canonicalName: 'Two-stop riverside stroll',
    themes: ['history'],
    intents: ['walk'],
    latitude: DEST.latitude,
    longitude: DEST.longitude,
    durationMinutes: 60,
    extraComponents: [
      {
        name: 'Stroll end point',
        latitude: DEST.latitude + 0.01,
        longitude: DEST.longitude,
      },
    ],
  });
}

function dailyPlanningStep(harness: TourGenerationHarness, trace: any): any {
  const step = harness
    .traceSteps(trace)
    .find((s) => s.stage === 'daily_planning' || s.name === 'planning.daily');
  if (!step) return undefined;
  return {
    ...step,
    dailyPlanning: step.dailyPlanning ?? {
      routing: step.facts?.routing,
      approximateTravel: step.facts?.approximateTravel,
    },
  };
}

describe('tour-generation integration · routing boundary', () => {
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

  it('propagates a real-routing estimate (approximate:false) through the plan', async () => {
    await seedCloseCatalog(harness);
    harness.configure({ routing: { provider: 'fixture-real-routing' } });

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: ['visit', 'walk'],
    });
    const outcome = await harness.generate(tourId);
    expect(outcome.error?.message ?? 'ok').toBe('ok');

    // The solver consumed the injected provider — no Geoapify, no network.
    expect(harness.fakes.routing.estimate).toHaveBeenCalled();

    const tour = await harness.loadTour(tourId);
    const routing = dailyPlanningStep(harness, tour.trace).dailyPlanning
      .routing;
    expect(
      routing.providerCounts['fixture-real-routing'],
    ).toBeGreaterThanOrEqual(1);
    expect(routing.approximateEstimateCount).toBe(0);
    expect(routing.fallbackCount).toBe(0);
    expect(
      dailyPlanningStep(harness, tour.trace).dailyPlanning.approximateTravel,
    ).toBe(false);
    expect(routing.internalEstimateCount).toBeGreaterThanOrEqual(1);
    expect(routing.externalEstimateCount).toBeGreaterThanOrEqual(1);

    const legs = await harness.prisma.tourExperience.findMany({
      where: { tourId },
      orderBy: [{ dayNumber: 'asc' }, { order: 'asc' }],
    });
    const withTravel = legs
      .map((l) => l.travelFromPrevious as any)
      .filter((t) => t != null);
    expect(withTravel.length).toBeGreaterThanOrEqual(1);
    for (const leg of withTravel) {
      expect(leg.provider).toBe('fixture-real-routing');
      expect(leg.approximate).toBe(false);
    }

    // A route-shaped Experience is routed by its endpoints, not its centroid:
    // some estimate leg originates/terminates near the far component
    // (DEST.latitude + 0.01), which no centroid of any candidate equals.
    const touchedFarEndpoint = harness.fakes.routing.estimate.mock.calls.some(
      (call) => {
        const from = call[0] as any;
        const to = call[1] as any;
        return (
          Math.abs(from.centroid.lat - (DEST.latitude + 0.01)) < 0.0005 ||
          Math.abs(to.centroid.lat - (DEST.latitude + 0.01)) < 0.0005
        );
      },
    );
    expect(touchedFarEndpoint).toBe(true);

    // Explicitly distinguish the route's internal component leg from travel
    // between Experiences. The solver must send component[0].end ->
    // component[1].start through the same injected provider boundary.
    const internalComponentLeg = harness.fakes.routing.estimate.mock.calls.find(
      (call) => {
        const from = call[0] as any;
        const to = call[1] as any;
        return (
          Math.abs(from.centroid.lat - DEST.latitude) < 0.000001 &&
          Math.abs(from.centroid.lng - DEST.longitude) < 0.000001 &&
          Math.abs(to.centroid.lat - (DEST.latitude + 0.01)) < 0.000001 &&
          Math.abs(to.centroid.lng - DEST.longitude) < 0.000001
        );
      },
    );
    expect(internalComponentLeg).toBeDefined();
    expect(internalComponentLeg![2]).toEqual(
      expect.arrayContaining(['walking', 'public_transport']),
    );
  });

  it('propagates an approximate fallback estimate with its fallbackReason', async () => {
    await seedCloseCatalog(harness);
    harness.configure({
      routing: {
        fallback: true,
        fallbackProvider: 'approximate',
        fallbackReason: 'primary_routing_unavailable',
      },
    });

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: ['visit', 'walk'],
    });
    expect((await harness.generate(tourId)).error?.message ?? 'ok').toBe('ok');

    const tour = await harness.loadTour(tourId);
    const routing = dailyPlanningStep(harness, tour.trace).dailyPlanning
      .routing;
    expect(routing.providerCounts['approximate']).toBeGreaterThanOrEqual(1);
    expect(routing.approximateEstimateCount).toBeGreaterThanOrEqual(1);
    expect(routing.fallbackCount).toBeGreaterThanOrEqual(1);
    expect(
      dailyPlanningStep(harness, tour.trace).dailyPlanning.approximateTravel,
    ).toBe(true);

    const legs = await harness.prisma.tourExperience.findMany({
      where: { tourId },
    });
    const fallbackLeg = legs
      .map((l) => l.travelFromPrevious as any)
      .find((t) => t != null && t.approximate === true);
    expect(fallbackLeg).toBeDefined();
    expect(fallbackLeg.fallbackReason).toBe('primary_routing_unavailable');
    expect(fallbackLeg.provider).toBe('approximate');
  });
});
