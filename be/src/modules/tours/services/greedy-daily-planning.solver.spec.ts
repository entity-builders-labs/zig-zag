import { GreedyDailyPlanningSolver } from './greedy-daily-planning.solver';
import {
  DailyPlanningInput,
  PlanningExperienceCandidate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import {
  TransportationMode,
  TravelPace,
} from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';

function realishTravelEstimateProvider(): TravelEstimateProvider {
  return {
    estimate: jest.fn(async (from, to) => {
      const dLat = to.centroid.lat - from.centroid.lat;
      const dLng = to.centroid.lng - from.centroid.lng;
      const distanceMeters = Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
      return {
        mode: TransportationMode.WALKING,
        durationMinutes: (distanceMeters / 1000 / 4.5) * 60,
        distanceMeters,
        walkingMinutes: (distanceMeters / 1000 / 4.5) * 60,
        walkingDistanceMeters: distanceMeters,
        approximate: true,
        provider: 'approximate',
      };
    }),
  };
}

const policy: DailyPlanningPolicy = {
  paceTargets: {
    relaxed: { preferredExperiencesMin: 2, preferredExperiencesMax: 4 },
    moderate: { preferredExperiencesMin: 3, preferredExperiencesMax: 5 },
    fast: { preferredExperiencesMin: 4, preferredExperiencesMax: 7 },
  },
  travel: {
    detourFactor: 1.3,
    walkingSpeedKmh: 5,
    bikeSpeedKmh: 15,
    carUrbanSpeedKmh: 25,
  },
  internalWalking: { unknownFallbackMinutes: 20 },
  compositeDefaultDurationMinutes: 90,
  scoring: {
    semanticWeight: 1,
    qualityWeight: 0.5,
    dayBalanceWeight: 0.25,
  },
  localImprovement: { maxIterations: 20 },
  backfill: {
    minimumUsefulResidualMinutes: 60,
    maxReservoirPromotionAttempts: 50,
    maxAcquisitionPasses: 1,
  },
  window: { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1200 },
};

function baseInput(
  overrides: Partial<DailyPlanningInput> = {},
): DailyPlanningInput {
  return {
    destination: {} as any,
    requestedDays: 2,
    candidates: [],
    mobility: {
      allowedTransportationModes: [TransportationMode.WALKING],
      maxWalkingDistancePerDayMeters: 10000,
      maxContinuousWalkingDistanceMeters: 3000,
      travelPace: TravelPace.MODERATE,
      accessibilityNeeds: [],
    },
    travelPace: TravelPace.MODERATE,
    planningWindow: policy.window,
    startDates: [],
    ...overrides,
  };
}

function candidate(
  id: string,
  semanticScore = 0.5,
): PlanningExperienceCandidate {
  const stableOffset =
    Array.from(id).reduce(
      (sum, character) => sum + character.charCodeAt(0),
      0,
    ) % 10;
  const footprint = {
    type: 'POINT' as const,
    centroid: { lat: 0, lng: stableOffset * 0.0001 },
  };
  return {
    experienceId: id,
    title: id,
    durationMinutes: 60,
    spatialFootprint: footprint,
    startFootprint: footprint,
    endFootprint: footprint,
    componentFootprints: [],
    semanticScore,
  };
}

describe('GreedyDailyPlanningSolver', () => {
  it('produces exactly the requested number of day buckets', async () => {
    const solver = new GreedyDailyPlanningSolver(
      realishTravelEstimateProvider(),
      policy,
    );
    const solution = await solver.solve(
      baseInput({
        requestedDays: 3,
        candidates: [candidate('a'), candidate('b')],
      }),
    );
    expect(solution.days).toHaveLength(3);
  });

  it('returns partial utilization instead of fabricating candidates when input is insufficient', async () => {
    const solver = new GreedyDailyPlanningSolver(
      realishTravelEstimateProvider(),
      policy,
    );
    const solution = await solver.solve(
      baseInput({ requestedDays: 3, candidates: [candidate('only-one')] }),
    );
    const totalScheduled = solution.days.reduce(
      (sum, day) => sum + day.experiences.length,
      0,
    );
    expect(totalScheduled).toBe(1);
  });

  it('does not claim approximate routing when no route estimate was needed', async () => {
    const solver = new GreedyDailyPlanningSolver(
      realishTravelEstimateProvider(),
      policy,
    );
    const solution = await solver.solve(
      baseInput({ requestedDays: 1, candidates: [candidate('a')] }),
    );
    expect(solution.metadata.approximateTravel).toBe(false);
    expect(solution.metadata.routing).toMatchObject({
      externalEstimateCount: 0,
      internalEstimateCount: 0,
      approximateEstimateCount: 0,
      fallbackCount: 0,
    });
  });

  it('routes all internal component legs with the request mobility modes before placement', async () => {
    const provider = realishTravelEstimateProvider();
    const solver = new GreedyDailyPlanningSolver(provider, policy);
    const composite: PlanningExperienceCandidate = {
      ...candidate('composite'),
      componentFootprints: [
        { type: 'POINT', centroid: { lat: 0, lng: 0 } },
        { type: 'POINT', centroid: { lat: 0, lng: 0.001 } },
        { type: 'POINT', centroid: { lat: 0, lng: 0.002 } },
      ],
    };

    const solution = await solver.solve(
      baseInput({ requestedDays: 1, candidates: [composite] }),
    );

    expect(provider.estimate).toHaveBeenCalledTimes(2);
    expect(provider.estimate).toHaveBeenCalledWith(
      composite.componentFootprints![0],
      composite.componentFootprints![1],
      [TransportationMode.WALKING],
    );
    expect(solution.metadata.approximateTravel).toBe(true);
    expect(solution.metadata.routing).toMatchObject({
      internalEstimateCount: 2,
      approximateEstimateCount: 2,
      providerCounts: { approximate: 2 },
    });
  });

  it('rejects a composite when one internal walking leg exceeds the continuous walking limit, with actual-vs-limit diagnostics', async () => {
    const provider = realishTravelEstimateProvider();
    const solver = new GreedyDailyPlanningSolver(provider, policy);
    const composite: PlanningExperienceCandidate = {
      ...candidate('too-much-internal-walking', 0.9),
      componentFootprints: [
        { type: 'POINT', centroid: { lat: 0, lng: 0 } },
        { type: 'POINT', centroid: { lat: 0, lng: 0.01 } },
        { type: 'POINT', centroid: { lat: 0, lng: 0.0105 } },
      ],
    };

    const solution = await solver.solve(
      baseInput({
        requestedDays: 1,
        candidates: [composite],
        mobility: {
          allowedTransportationModes: [TransportationMode.WALKING],
          maxWalkingDistancePerDayMeters: 10000,
          maxContinuousWalkingDistanceMeters: 600,
          travelPace: TravelPace.MODERATE,
          accessibilityNeeds: [],
        },
      }),
    );

    expect(solution.days[0].experiences).toHaveLength(0);
    expect(solution.unselected).toHaveLength(1);
    const unselected = solution.unselected[0];
    expect(unselected.experienceId).toBe(composite.experienceId);
    expect(unselected.reasons).toEqual(['MAX_CONTINUOUS_WALKING_EXCEEDED']);
    expect(unselected.walkingDiagnostics).toBeDefined();
    expect(unselected.walkingDiagnostics?.continuousWalkingLimitMeters).toBe(
      600,
    );
    expect(unselected.walkingDiagnostics?.dailyWalkingLimitMeters).toBe(10000);
    expect(
      unselected.walkingDiagnostics?.longestContinuousWalkingMeters,
    ).toBeCloseTo(1110);
    expect(
      unselected.walkingDiagnostics?.internalWalkingContributionMeters,
    ).toBeCloseTo(1165.5);
    expect(
      unselected.walkingDiagnostics?.incomingTravelWalkingContributionMeters,
    ).toBe(0);
    expect(unselected.walkingDiagnostics?.dailyWalkingMeters).toBeCloseTo(
      1165.5,
    );
  });

  // Deterministic, provider-free control for the RW2 multi-area walk: the same
  // composite candidate is rejected under the exact RW2 mobility constraints
  // and becomes feasible when those walking limits are intentionally
  // non-binding (still inside the valid request contract). No threshold tuning.
  it('RW2 walking control: same composite is rejected under RW2 limits and feasible under non-binding limits', async () => {
    const solver = new GreedyDailyPlanningSolver(
      realishTravelEstimateProvider(),
      policy,
    );
    // Deterministic proxy for "San Telmo to La Boca History Walk": seven stops
    // along an ~5.5 km corridor. The first leg (~5 km) exceeds the continuous
    // limit and the summed internal walking exceeds the daily limit.
    const stops: Array<[number, number]> = [
      [0, 0],
      [0, 0.045],
      [0, 0.047],
      [0, 0.048],
      [0, 0.049],
      [0, 0.0492],
      [0, 0.0494],
    ];
    const composite: PlanningExperienceCandidate = {
      ...candidate('rw2-walk', 0.9),
      componentFootprints: stops.map(([lat, lng]) => ({
        type: 'POINT' as const,
        centroid: { lat, lng },
      })),
    };

    // 1. Exact RW2 mobility constraints → walking hard-rejection.
    const rw2Limits = {
      allowedTransportationModes: [TransportationMode.WALKING],
      maxWalkingDistancePerDayMeters: 5000,
      maxContinuousWalkingDistanceMeters: 3000,
      travelPace: TravelPace.MODERATE,
      accessibilityNeeds: [] as string[],
    };
    const rejected = await solver.solve(
      baseInput({
        requestedDays: 1,
        candidates: [composite],
        mobility: rw2Limits,
      }),
    );
    expect(rejected.days[0].experiences).toHaveLength(0);
    expect(rejected.unselected).toHaveLength(1);
    expect(rejected.unselected[0].reasons).toEqual(
      expect.arrayContaining([
        'MAX_WALKING_PER_DAY_EXCEEDED',
        'MAX_CONTINUOUS_WALKING_EXCEEDED',
      ]),
    );
    const diagnostics = rejected.unselected[0].walkingDiagnostics;
    expect(diagnostics).toBeDefined();
    expect(diagnostics?.dailyWalkingLimitMeters).toBe(5000);
    expect(diagnostics?.continuousWalkingLimitMeters).toBe(3000);
    expect(diagnostics?.dailyWalkingMeters).toBeGreaterThan(5000);
    expect(diagnostics?.longestContinuousWalkingMeters).toBeGreaterThan(3000);
    expect(diagnostics?.incomingTravelWalkingContributionMeters).toBe(0);
    expect(diagnostics?.internalWalkingContributionMeters).toBeGreaterThan(
      5000,
    );

    // 2. Non-binding walking limits (DTO upper bound, not a recommendation) →
    // the same candidate becomes feasible; no other constraint rejects it.
    const nonBindingLimits = {
      allowedTransportationModes: [TransportationMode.WALKING],
      maxWalkingDistancePerDayMeters: 50000,
      maxContinuousWalkingDistanceMeters: 20000,
      travelPace: TravelPace.MODERATE,
      accessibilityNeeds: [] as string[],
    };
    const feasible = await solver.solve(
      baseInput({
        requestedDays: 1,
        candidates: [composite],
        mobility: nonBindingLimits,
      }),
    );
    expect(feasible.days[0].experiences).toHaveLength(1);
    expect(feasible.days[0].experiences[0].experienceId).toBe(
      composite.experienceId,
    );
    expect(
      feasible.unselected.filter((item) =>
        item.reasons.some((reason) => reason.includes('WALKING')),
      ),
    ).toHaveLength(0);
  });

  it('is deterministic: repeated solves on identical input produce a deep-equal solution', async () => {
    const solver = new GreedyDailyPlanningSolver(
      realishTravelEstimateProvider(),
      policy,
    );
    const input = baseInput({
      requestedDays: 2,
      candidates: [
        candidate('a', 0.9),
        candidate('b', 0.5),
        candidate('c', 0.7),
      ],
    });
    const first = await solver.solve(input);
    const second = await solver.solve(input);
    expect(first).toEqual(second);
  });

  it('never expands a duplicate experienceId in the input into two planned instances', async () => {
    const solver = new GreedyDailyPlanningSolver(
      realishTravelEstimateProvider(),
      policy,
    );
    const dup = candidate('dup');
    const solution = await solver.solve(
      baseInput({ requestedDays: 1, candidates: [dup, { ...dup }] }),
    );
    const totalScheduled = solution.days.reduce(
      (sum, day) => sum + day.experiences.length,
      0,
    );
    expect(totalScheduled).toBe(1);
    expect(
      solution.unselected.some((item) => item.experienceId === 'dup'),
    ).toBe(true);
  });
});
