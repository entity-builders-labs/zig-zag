import {
  placeCandidates,
  checkHardConstraints,
  scoreCandidateForDay,
  DayAccumulator,
  PlacementContext,
} from './daily-planning-placement.util';
import {
  PlanningExperienceCandidate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';

function candidate(
  overrides: Partial<PlanningExperienceCandidate> = {},
): PlanningExperienceCandidate {
  return {
    activityId: overrides.activityId ?? 'a1',
    kind: 'POI',
    title: 'Test',
    durationMinutes: 60,
    spatialFootprint: { type: 'POINT', centroid: { lat: 0, lng: 0 } },
    semanticScore: 0.5,
    ...overrides,
  };
}

function fakeTravelEstimateProvider(
  overrides: Partial<
    Awaited<ReturnType<TravelEstimateProvider['estimate']>>
  > = {},
): TravelEstimateProvider {
  return {
    estimate: jest.fn().mockResolvedValue({
      mode: TransportationMode.WALKING,
      durationMinutes: 10,
      distanceMeters: 800,
      walkingMinutes: 10,
      walkingDistanceMeters: 800,
      approximate: true,
      ...overrides,
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
  localImprovement: { maxIterations: 50 },
  window: { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1200 }, // 9:00-20:00, 660 min/day
};

function baseContext(
  overrides: Partial<PlacementContext> = {},
): PlacementContext {
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
    travelEstimateProvider: fakeTravelEstimateProvider(),
    startDates: [],
    ...overrides,
  };
}

function emptyDay(dayNumber: number): DayAccumulator {
  return {
    dayNumber,
    assigned: [],
    totalActivityMinutes: 0,
    totalWalkingMeters: 0,
  };
}

describe('checkHardConstraints', () => {
  it('accepts a candidate that fits comfortably in an empty day', async () => {
    const result = await checkHardConstraints(
      candidate(),
      emptyDay(1),
      baseContext(),
    );
    expect(result.feasible).toBe(true);
  });

  it('rejects a candidate that exceeds the daily time capacity', async () => {
    const acc: DayAccumulator = {
      dayNumber: 1,
      assigned: [],
      totalActivityMinutes: 650,
      totalWalkingMeters: 0,
    };
    const result = await checkHardConstraints(
      candidate({ durationMinutes: 60 }),
      acc,
      baseContext(),
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('DAILY_TIME_CAPACITY_EXCEEDED');
  });

  it('rejects when the day already has an assigned activity and the leg exceeds max continuous walking', async () => {
    const context = baseContext({
      mobility: {
        allowedTransportationModes: [TransportationMode.WALKING],
        maxWalkingDistancePerDayMeters: 10000,
        maxContinuousWalkingDistanceMeters: 500,
        travelPace: 'moderate' as any,
        accessibilityNeeds: [],
      },
      travelEstimateProvider: fakeTravelEstimateProvider({
        walkingDistanceMeters: 800,
      }),
    });
    const acc: DayAccumulator = {
      dayNumber: 1,
      assigned: [candidate({ activityId: 'prev' })],
      totalActivityMinutes: 60,
      totalWalkingMeters: 0,
    };
    const result = await checkHardConstraints(
      candidate({ activityId: 'next' }),
      acc,
      context,
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('MAX_CONTINUOUS_WALKING_EXCEEDED');
  });

  it('rejects when total daily walking would exceed the limit', async () => {
    const context = baseContext({
      mobility: {
        allowedTransportationModes: [TransportationMode.WALKING],
        maxWalkingDistancePerDayMeters: 500,
        maxContinuousWalkingDistanceMeters: 3000,
        travelPace: 'moderate' as any,
        accessibilityNeeds: [],
      },
      travelEstimateProvider: fakeTravelEstimateProvider({
        walkingDistanceMeters: 800,
      }),
    });
    const acc: DayAccumulator = {
      dayNumber: 1,
      assigned: [candidate({ activityId: 'prev' })],
      totalActivityMinutes: 60,
      totalWalkingMeters: 0,
    };
    const result = await checkHardConstraints(
      candidate({ activityId: 'next' }),
      acc,
      context,
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('MAX_WALKING_PER_DAY_EXCEEDED');
  });

  it('rejects a candidate outside its known opening hours when a base date exists', async () => {
    const context = baseContext({ startDates: ['2026-09-07'] }); // a real Monday
    const result = await checkHardConstraints(
      candidate({
        openingHours: {
          status: 'known',
          rangesByWeekday: {
            1: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 660 }],
          }, // 10:00-11:00 Monday only
        },
      }),
      emptyDay(1), // day starts at window start, 9:00 — before the 10:00 opening
      context,
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('OPENING_HOURS_INCOMPATIBLE');
  });

  it('rejects a candidate with a NaN centroid as INVALID_SPATIAL_FOOTPRINT instead of crashing', async () => {
    const result = await checkHardConstraints(
      candidate({
        spatialFootprint: {
          type: 'POINT',
          centroid: { lat: NaN, lng: 0 },
        },
      }),
      emptyDay(1),
      baseContext(),
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toEqual(['INVALID_SPATIAL_FOOTPRINT']);
  });

  it('rejects a candidate with a null centroid coordinate as INVALID_SPATIAL_FOOTPRINT', async () => {
    // `Activity.latitude`/`longitude` are Prisma `Float?`, so a missing value
    // really arrives as `null` at runtime even though the TS type says
    // `number`. Cast accordingly — a `null` that slipped through would be
    // coerced to 0 by the Haversine math and planned at Null Island.
    const result = await checkHardConstraints(
      candidate({
        spatialFootprint: {
          type: 'POINT',
          centroid: { lat: null as unknown as number, lng: 0 },
        },
      }),
      emptyDay(1),
      baseContext(),
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toEqual(['INVALID_SPATIAL_FOOTPRINT']);
  });

  it('rejects a candidate with a null centroid longitude as INVALID_SPATIAL_FOOTPRINT', async () => {
    const result = await checkHardConstraints(
      candidate({
        spatialFootprint: {
          type: 'POINT',
          centroid: { lat: 0, lng: null as unknown as number },
        },
      }),
      emptyDay(1),
      baseContext(),
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toEqual(['INVALID_SPATIAL_FOOTPRINT']);
  });

  it('rejects a candidate with an undefined centroid coordinate as INVALID_SPATIAL_FOOTPRINT instead of crashing', async () => {
    const result = await checkHardConstraints(
      candidate({
        spatialFootprint: {
          type: 'POINT',
          centroid: { lat: 0, lng: undefined as unknown as number },
        },
      }),
      emptyDay(1),
      baseContext(),
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toEqual(['INVALID_SPATIAL_FOOTPRINT']);
  });

  it('does not hard-reject on opening hours when no base date exists (unknown weekday policy)', async () => {
    const result = await checkHardConstraints(
      candidate({
        openingHours: {
          status: 'known',
          rangesByWeekday: {
            1: [{ startMinutesFromMidnight: 600, endMinutesFromMidnight: 660 }],
          },
        },
      }),
      emptyDay(1),
      baseContext({ startDates: [] }),
    );
    expect(result.reasons).not.toContain('OPENING_HOURS_INCOMPATIBLE');
  });
});

describe('scoreCandidateForDay', () => {
  it('never penalizes an undefined qualityScore relative to an explicit 0', () => {
    const scoreUnknown = scoreCandidateForDay(
      candidate({ qualityScore: undefined }),
      emptyDay(1),
      baseContext(),
    );
    const scoreZero = scoreCandidateForDay(
      candidate({ qualityScore: 0 }),
      emptyDay(1),
      baseContext(),
    );
    expect(scoreUnknown).toBe(scoreZero);
  });

  it('penalizes a same-family candidate already assigned that day', () => {
    const acc: DayAccumulator = {
      dayNumber: 1,
      assigned: [candidate({ activityId: 'existing', familyId: 'fam-1' })],
      totalActivityMinutes: 60,
      totalWalkingMeters: 0,
    };
    const sameFamily = scoreCandidateForDay(
      candidate({ familyId: 'fam-1' }),
      acc,
      baseContext(),
    );
    const differentFamily = scoreCandidateForDay(
      candidate({ familyId: 'fam-2' }),
      acc,
      baseContext(),
    );
    expect(sameFamily).toBe(differentFamily);
  });
});

describe('placeCandidates', () => {
  it('places every hard-feasible candidate somewhere across the requested days', async () => {
    const { days, unselected } = await placeCandidates(
      [candidate({ activityId: 'a' }), candidate({ activityId: 'b' })],
      2,
      baseContext(),
    );
    const totalAssigned = Array.from(days.values()).reduce(
      (sum, d) => sum + d.assigned.length,
      0,
    );
    expect(totalAssigned).toBe(2);
    expect(unselected).toHaveLength(0);
  });

  it('marks a duplicate activityId as unselected with DUPLICATE_ACTIVITY', async () => {
    const { unselected } = await placeCandidates(
      [candidate({ activityId: 'dup' }), candidate({ activityId: 'dup' })],
      1,
      baseContext(),
    );
    expect(unselected).toEqual([
      { activityId: 'dup', reasons: ['DUPLICATE_ACTIVITY'] },
    ]);
  });

  it('rejects with NO_FEASIBLE_DAY when requestedDays is 0', async () => {
    const { unselected } = await placeCandidates(
      [candidate()],
      0,
      baseContext(),
    );
    expect(unselected[0].reasons).toContain('NO_FEASIBLE_DAY');
  });
});
