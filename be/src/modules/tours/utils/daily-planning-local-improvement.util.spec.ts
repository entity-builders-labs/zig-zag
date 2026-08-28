import { runBoundedLocalImprovement } from './daily-planning-local-improvement.util';
import {
  DayAccumulator,
  PlacementContext,
} from './daily-planning-placement.util';
import {
  PlanningActivityCandidate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';

function candidate(
  id: string,
  lat: number,
  lng: number,
  familyId?: string,
): PlanningActivityCandidate {
  return {
    activityId: id,
    kind: 'POI',
    title: id,
    durationMinutes: 60,
    spatialFootprint: { type: 'POINT', centroid: { lat, lng } },
    semanticScore: 0.5,
    familyId,
  };
}

function stubTravelEstimateProvider(): TravelEstimateProvider {
  return {
    estimate: jest.fn().mockResolvedValue({
      mode: TransportationMode.WALKING,
      durationMinutes: 5,
      distanceMeters: 300,
      walkingMinutes: 5,
      walkingDistanceMeters: 300,
      approximate: true,
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

function context(): PlacementContext {
  return {
    policy,
    mobility: {
      allowedTransportationModes: [TransportationMode.WALKING],
      maxWalkingDistancePerDayMeters: 10000,
      maxContinuousWalkingDistanceMeters: 3000,
      travelPace: 'moderate' as any,
      accessibilityNeeds: [],
    },
    planningWindow: policy.window,
    requestedFormats: [],
    travelEstimateProvider: stubTravelEstimateProvider(),
    startDates: [],
  };
}

describe('runBoundedLocalImprovement', () => {
  it('moves an activity from an overloaded day to a lighter day', async () => {
    const days = new Map<number, DayAccumulator>([
      [
        1,
        {
          dayNumber: 1,
          assigned: [
            candidate('a', 0, 0),
            candidate('b', 0, 0.001),
            candidate('c', 0, 0.002),
          ],
          totalActivityMinutes: 180,
          totalWalkingMeters: 0,
        },
      ],
      [
        2,
        {
          dayNumber: 2,
          assigned: [],
          totalActivityMinutes: 0,
          totalWalkingMeters: 0,
        },
      ],
    ]);

    const { days: improved } = await runBoundedLocalImprovement(
      days,
      context(),
    );
    expect(improved.get(1)!.assigned.length).toBeLessThan(3);
    expect(improved.get(2)!.assigned.length).toBeGreaterThan(0);
  });

  it('swaps two candidates to improve geographic compactness', async () => {
    const days = new Map<number, DayAccumulator>([
      [
        1,
        {
          dayNumber: 1,
          assigned: [candidate('a1', 0, 0), candidate('far-from-a', 10, 10)],
          totalActivityMinutes: 120,
          totalWalkingMeters: 0,
        },
      ],
      [
        2,
        {
          dayNumber: 2,
          assigned: [
            candidate('b1', 10, 10.001),
            candidate('near-a-actually', 0, 0.001),
          ],
          totalActivityMinutes: 120,
          totalWalkingMeters: 0,
        },
      ],
    ]);

    const { days: improved } = await runBoundedLocalImprovement(
      days,
      context(),
    );
    const day1Ids = improved.get(1)!.assigned.map((a) => a.activityId);
    // 'near-a-actually' (0, 0.001) belongs with 'a1' (0,0), not 'far-from-a' (10,10).
    expect(day1Ids).toContain('near-a-actually');
  });

  it('never exceeds the configured max iterations', async () => {
    const days = new Map<number, DayAccumulator>([
      [
        1,
        {
          dayNumber: 1,
          assigned: [candidate('a', 0, 0)],
          totalActivityMinutes: 60,
          totalWalkingMeters: 0,
        },
      ],
      [
        2,
        {
          dayNumber: 2,
          assigned: [candidate('b', 1, 1)],
          totalActivityMinutes: 60,
          totalWalkingMeters: 0,
        },
      ],
    ]);
    const { iterations } = await runBoundedLocalImprovement(days, context());
    expect(iterations).toBeLessThanOrEqual(
      policy.localImprovement.maxIterations,
    );
  });

  it('does not move a candidate when it would violate a hard constraint at the destination', async () => {
    const tightContext: PlacementContext = {
      ...context(),
      mobility: { ...context().mobility, maxWalkingDistancePerDayMeters: 1 },
    };
    const days = new Map<number, DayAccumulator>([
      [
        1,
        {
          dayNumber: 1,
          assigned: [
            candidate('a', 0, 0),
            candidate('b', 0, 0.001),
            candidate('c', 0, 0.002),
          ],
          totalActivityMinutes: 180,
          totalWalkingMeters: 0,
        },
      ],
      [
        2,
        {
          dayNumber: 2,
          // Seeded (not empty): checkHardConstraints only prices leg-walking
          // distance from the destination day's *previous* stop, so an empty
          // day would have zero leg cost by construction and the tight limit
          // below could never trip. A far-away pre-existing candidate gives
          // day 2 a real "previous stop" for the walking-distance check.
          assigned: [candidate('seed-far', 10, 10)],
          totalActivityMinutes: 60,
          totalWalkingMeters: 0,
        },
      ],
    ]);
    const { days: improved } = await runBoundedLocalImprovement(
      days,
      tightContext,
    );
    expect(improved.get(1)!.assigned.length).toBe(3); // no move possible under the tight walking limit
  });
});
