import { GreedyDailyPlanningSolver } from './greedy-daily-planning.solver';
import {
  DailyPlanningInput,
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
      };
    }),
  };
}

const policy: DailyPlanningPolicy = {
  paceTargets: {
    relaxed: { preferredActivitiesMin: 2, preferredActivitiesMax: 4 },
    moderate: { preferredActivitiesMin: 3, preferredActivitiesMax: 5 },
    fast: { preferredActivitiesMin: 4, preferredActivitiesMax: 7 },
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
    formatWeight: 0.75,
    familyVariantPenaltyWeight: 0.5,
    dayBalanceWeight: 0.25,
  },
  localImprovement: { maxIterations: 20 },
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

function candidate(id: string, semanticScore = 0.5) {
  return {
    activityId: id,
    kind: 'POI' as const,
    title: id,
    durationMinutes: 60,
    spatialFootprint: {
      type: 'POINT' as const,
      centroid: { lat: 0, lng: Math.random() * 0.01 },
    },
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
      (sum, d) => sum + d.activities.length,
      0,
    );
    expect(totalScheduled).toBe(1);
  });

  it('always reports approximateTravel: true for the V1 provider', async () => {
    const solver = new GreedyDailyPlanningSolver(
      realishTravelEstimateProvider(),
      policy,
    );
    const solution = await solver.solve(
      baseInput({ candidates: [candidate('a')] }),
    );
    expect(solution.metadata.approximateTravel).toBe(true);
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

  it('never expands a duplicate activityId in the input into two planned instances', async () => {
    const solver = new GreedyDailyPlanningSolver(
      realishTravelEstimateProvider(),
      policy,
    );
    const dup = candidate('dup');
    const solution = await solver.solve(
      baseInput({ requestedDays: 1, candidates: [dup, { ...dup }] }),
    );
    const totalScheduled = solution.days.reduce(
      (sum, d) => sum + d.activities.length,
      0,
    );
    expect(totalScheduled).toBe(1);
    expect(solution.unselected.some((u) => u.activityId === 'dup')).toBe(true);
  });
});
