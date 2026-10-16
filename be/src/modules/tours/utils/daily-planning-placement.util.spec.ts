import {
  placeCandidates,
  checkHardConstraints,
  scoreDayForCandidate,
  DayAccumulator,
  PlacementContext,
} from './daily-planning-placement.util';
import {
  PlanningExperienceCandidate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';
import {
  alignUnknownHours,
  legacyHoursByDay,
  mobilityFixture,
  planningDaysFixture,
  planningPreferenceFixture,
  singleVisitCandidate,
  withVisitFacts,
} from '../fixtures/planning-input.fixture';

function candidate(
  overrides: Partial<PlanningExperienceCandidate> & {
    durationMinutes?: number;
  } = {},
): PlanningExperienceCandidate {
  const { durationMinutes, ...rest } = overrides;
  return {
    ...singleVisitCandidate({
      experienceId: overrides.experienceId ?? 'a1',
      title: 'Test',
      durationMinutes: durationMinutes ?? 60,
      preferenceRank: 1,
    }),
    ...rest,
  };
}

/** A real Monday, so day 1 resolves to weekday 1. */
const MONDAY = '2026-09-07';

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
  scoring: {
    dayBalanceWeight: 0.25,
  },
  localImprovement: { maxIterations: 50 },
  backfill: {
    minimumUsefulResidualMinutes: 60,
    maxReservoirPromotionAttempts: 50,
    maxAcquisitionPasses: 1,
  },
  window: { startMinutesFromMidnight: 540, endMinutesFromMidnight: 1200 }, // 9:00-20:00, 660 min/day
};

function baseContext(
  overrides: Partial<PlacementContext> = {},
): PlacementContext {
  return {
    policy,
    mobility: mobilityFixture(),
    days: planningDaysFixture(1, { window: policy.window }),
    travelEstimateProvider: fakeTravelEstimateProvider(),
    ...overrides,
  };
}

function emptyDay(dayNumber: number): DayAccumulator {
  return {
    dayNumber,
    assigned: [],
    totalExperienceMinutes: 0,
    totalWalkingMeters: 0,
    totalCyclingMinutes: 0,
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
      totalExperienceMinutes: 650,
      totalWalkingMeters: 0,
      totalCyclingMinutes: 0,
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
      mobility: mobilityFixture({ maxContinuousWalkingDistanceMeters: 500 }),
      travelEstimateProvider: fakeTravelEstimateProvider({
        walkingDistanceMeters: 800,
      }),
    });
    const acc: DayAccumulator = {
      dayNumber: 1,
      assigned: [candidate({ experienceId: 'prev' })],
      totalExperienceMinutes: 60,
      totalWalkingMeters: 0,
      totalCyclingMinutes: 0,
    };
    const result = await checkHardConstraints(
      candidate({ experienceId: 'next' }),
      acc,
      context,
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('MAX_CONTINUOUS_WALKING_EXCEEDED');
  });

  it('estimates inter-candidate travel end→start, not centroid-to-centroid', async () => {
    // Regression guard for CP8-1: a route-shaped candidate's real endpoints
    // are far from its centroid — routing by spatialFootprint would silently
    // mis-price (and mis-order) the leg.
    const estimate = jest.fn().mockResolvedValue({
      mode: TransportationMode.WALKING,
      durationMinutes: 5,
      distanceMeters: 100,
      walkingMinutes: 5,
      walkingDistanceMeters: 100,
      approximate: true,
    });
    const previous = candidate({
      experienceId: 'prev',
      spatialFootprint: { type: 'AREA', centroid: { lat: 0, lng: 0 } },
      endFootprint: { type: 'POINT', centroid: { lat: 1, lng: 1 } },
    });
    const next = candidate({
      experienceId: 'next',
      spatialFootprint: { type: 'AREA', centroid: { lat: 10, lng: 10 } },
      startFootprint: { type: 'POINT', centroid: { lat: 2, lng: 2 } },
    });
    const acc: DayAccumulator = {
      dayNumber: 1,
      assigned: [previous],
      totalExperienceMinutes: 60,
      totalWalkingMeters: 0,
      totalCyclingMinutes: 0,
    };

    await checkHardConstraints(
      next,
      acc,
      baseContext({ travelEstimateProvider: { estimate } }),
    );

    expect(estimate).toHaveBeenCalledWith(
      previous.endFootprint,
      next.startFootprint,
      expect.anything(),
    );
  });

  it('rejects a candidate whose duration fits alone but pushes past closing once internal travel is included', async () => {
    // Regression guard for CP8-2: the hard-constraint check must use the
    // same duration formula the scheduler actually books
    // (visit duration + internalTravelMinutes), not the visit duration alone.
    const days = planningDaysFixture(1, {
      startDate: MONDAY,
      window: policy.window,
    });
    const result = await checkHardConstraints(
      withVisitFacts(
        candidate({
          durationMinutes: 50,
          mobility: { internalTravelMinutes: 20 },
        }),
        {
          openingHoursByDay: legacyHoursByDay(
            {
              status: 'known',
              rangesByWeekday: {
                1: [
                  {
                    startMinutesFromMidnight: 540,
                    endMinutesFromMidnight: 600,
                  },
                ],
              }, // 9:00-10:00 Monday only — 60 min window
            },
            days,
          ),
        },
      ),
      emptyDay(1), // day starts at window start, 9:00
      baseContext({ days }),
    );
    // durationMinutes alone (50) fits inside the 60-minute window; +20 min
    // internal travel (70 total) does not.
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('OPENING_HOURS_INCOMPATIBLE');
  });

  it('rejects when total daily walking would exceed the limit', async () => {
    const context = baseContext({
      mobility: mobilityFixture({ maxWalkingDistancePerDayMeters: 500 }),
      travelEstimateProvider: fakeTravelEstimateProvider({
        walkingDistanceMeters: 800,
      }),
    });
    const acc: DayAccumulator = {
      dayNumber: 1,
      assigned: [candidate({ experienceId: 'prev' })],
      totalExperienceMinutes: 60,
      totalWalkingMeters: 0,
      totalCyclingMinutes: 0,
    };
    const result = await checkHardConstraints(
      candidate({ experienceId: 'next' }),
      acc,
      context,
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('MAX_WALKING_PER_DAY_EXCEEDED');
  });

  it('rejects a candidate outside its known opening hours when a base date exists', async () => {
    const days = planningDaysFixture(1, {
      startDate: MONDAY,
      window: policy.window,
    });
    const result = await checkHardConstraints(
      withVisitFacts(candidate(), {
        openingHoursByDay: legacyHoursByDay(
          {
            status: 'known',
            rangesByWeekday: {
              1: [
                { startMinutesFromMidnight: 600, endMinutesFromMidnight: 660 },
              ],
            }, // 10:00-11:00 Monday only
          },
          days,
        ),
      }),
      emptyDay(1), // day starts at window start, 9:00 — before the 10:00 opening
      baseContext({ days }),
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('OPENING_HOURS_INCOMPATIBLE');
  });

  it('does not hard-reject on opening hours when no base date exists (unknown weekday policy)', async () => {
    // Without a date the legacy weekly hours resolve to UNKNOWN for the day.
    const days = planningDaysFixture(1, { window: policy.window });
    const result = await checkHardConstraints(
      withVisitFacts(candidate(), {
        openingHoursByDay: legacyHoursByDay(
          {
            status: 'known',
            rangesByWeekday: {
              1: [
                { startMinutesFromMidnight: 600, endMinutesFromMidnight: 660 },
              ],
            },
          },
          days,
        ),
      }),
      emptyDay(1),
      baseContext({ days }),
    );
    expect(result.reasons).not.toContain('OPENING_HOURS_INCOMPATIBLE');
  });
});

describe('scoreDayForCandidate', () => {
  it('prefers the day with fewer assigned Experiences (day balance only)', () => {
    const busy: DayAccumulator = {
      dayNumber: 1,
      assigned: [candidate({ experienceId: 'existing' })],
      totalExperienceMinutes: 60,
      totalWalkingMeters: 0,
      totalCyclingMinutes: 0,
    };
    expect(scoreDayForCandidate(emptyDay(2), baseContext())).toBeGreaterThan(
      scoreDayForCandidate(busy, baseContext()),
    );
  });

  it('takes no candidate input: preference never becomes a placement score', () => {
    // The candidate's preference is identical on every day, so it cannot
    // change which feasible day wins (task 25.2).
    expect(scoreDayForCandidate.length).toBe(2);
  });
});

describe('placeCandidates', () => {
  it('places every hard-feasible candidate somewhere across the requested days', async () => {
    const { days, unselected } = await placeCandidates(
      [candidate({ experienceId: 'a' }), candidate({ experienceId: 'b' })].map(
        (item) => alignUnknownHours(item, 2),
      ),
      baseContext({ days: planningDaysFixture(2, { window: policy.window }) }),
    );
    const totalAssigned = Array.from(days.values()).reduce(
      (sum, d) => sum + d.assigned.length,
      0,
    );
    expect(totalAssigned).toBe(2);
    expect(unselected).toHaveLength(0);
  });

  it('rejects with NO_FEASIBLE_DAY when there is no planning day', async () => {
    const { unselected } = await placeCandidates(
      [candidate()],
      baseContext({ days: [] }),
    );
    expect(unselected[0].reasons).toContain('NO_FEASIBLE_DAY');
  });
});

describe('checkHardConstraints cycling limit (owner D3)', () => {
  const cyclingContext = (
    limits: {
      maxContinuousCyclingMinutes: number;
      maxDailyCyclingMinutes: number | null;
    },
    legMinutes: number,
  ) =>
    baseContext({
      mobility: mobilityFixture({
        allowedTransportationModes: [TransportationMode.CYCLING],
        cycling: { ...limits, source: { kind: 'USER_STATED' } },
      }),
      travelEstimateProvider: fakeTravelEstimateProvider({
        mode: TransportationMode.CYCLING,
        durationMinutes: legMinutes,
        walkingDistanceMeters: 0,
        walkingMinutes: 0,
      }),
    });
  const dayWithPrevious = (totalCyclingMinutes = 0): DayAccumulator => ({
    dayNumber: 1,
    assigned: [candidate({ experienceId: 'prev' })],
    totalExperienceMinutes: 60,
    totalWalkingMeters: 0,
    totalCyclingMinutes,
  });

  it('rejects a bicycle leg longer than the continuous cycling limit', async () => {
    const result = await checkHardConstraints(
      // The best preference rank never buys hard feasibility.
      candidate({ experienceId: 'next', preference: planningPreferenceFixture(1) }),
      dayWithPrevious(),
      cyclingContext(
        { maxContinuousCyclingMinutes: 30, maxDailyCyclingMinutes: null },
        59,
      ),
    );
    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('CYCLING_LIMIT');
  });

  it('accepts a bicycle leg within the continuous limit', async () => {
    const result = await checkHardConstraints(
      candidate({ experienceId: 'next' }),
      dayWithPrevious(),
      cyclingContext(
        { maxContinuousCyclingMinutes: 30, maxDailyCyclingMinutes: null },
        20,
      ),
    );
    expect(result.reasons).not.toContain('CYCLING_LIMIT');
  });

  it('rejects when the day total would exceed the daily cycling limit', async () => {
    const result = await checkHardConstraints(
      candidate({ experienceId: 'next' }),
      dayWithPrevious(50),
      cyclingContext(
        { maxContinuousCyclingMinutes: 30, maxDailyCyclingMinutes: 60 },
        20,
      ),
    );
    expect(result.reasons).toContain('CYCLING_LIMIT');
  });
});
