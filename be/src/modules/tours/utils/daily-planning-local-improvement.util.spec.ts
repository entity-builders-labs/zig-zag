import { runBoundedLocalImprovement } from './daily-planning-local-improvement.util';
import {
  DayAccumulator,
  PlacementContext,
} from './daily-planning-placement.util';
import {
  NormalizedOpeningHours,
  PlanningExperienceCandidate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';

function candidate(
  id: string,
  lat: number,
  lng: number,
): PlanningExperienceCandidate {
  const footprint = { type: 'POINT' as const, centroid: { lat, lng } };
  return {
    experienceId: id,
    title: id,
    durationMinutes: 60,
    spatialFootprint: footprint,
    startFootprint: footprint,
    endFootprint: footprint,
    semanticScore: 0.5,
  };
}

function candidateWithOptions(
  id: string,
  lat: number,
  lng: number,
  opts: { durationMinutes?: number; openingHours?: NormalizedOpeningHours },
): PlanningExperienceCandidate {
  const footprint = { type: 'POINT' as const, centroid: { lat, lng } };
  return {
    experienceId: id,
    title: id,
    durationMinutes: opts.durationMinutes ?? 60,
    spatialFootprint: footprint,
    startFootprint: footprint,
    endFootprint: footprint,
    semanticScore: 0.5,
    openingHours: opts.openingHours,
  };
}

function candidateWithMobility(
  id: string,
  lat: number,
  lng: number,
  opts: {
    durationMinutes: number;
    internalTravelMinutes?: number;
    internalWalkingDistanceMeters?: number;
  },
): PlanningExperienceCandidate {
  const footprint = { type: 'POINT' as const, centroid: { lat, lng } };
  return {
    experienceId: id,
    title: id,
    durationMinutes: opts.durationMinutes,
    spatialFootprint: footprint,
    startFootprint: footprint,
    endFootprint: footprint,
    semanticScore: 0.5,
    mobility: {
      internalTravelMinutes: opts.internalTravelMinutes,
      internalWalkingDistanceMeters: opts.internalWalkingDistanceMeters,
    },
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
          totalExperienceMinutes: 180,
          totalWalkingMeters: 0,
        },
      ],
      [
        2,
        {
          dayNumber: 2,
          assigned: [],
          totalExperienceMinutes: 0,
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
          totalExperienceMinutes: 120,
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
          totalExperienceMinutes: 120,
          totalWalkingMeters: 0,
        },
      ],
    ]);

    const { days: improved } = await runBoundedLocalImprovement(
      days,
      context(),
    );
    const day1Ids = improved.get(1)!.assigned.map((a) => a.experienceId);
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
          totalExperienceMinutes: 60,
          totalWalkingMeters: 0,
        },
      ],
      [
        2,
        {
          dayNumber: 2,
          assigned: [candidate('b', 1, 1)],
          totalExperienceMinutes: 60,
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
          totalExperienceMinutes: 180,
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
          totalExperienceMinutes: 60,
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

  it('re-prices both day totals exactly when a move relocates a candidate of a different duration', async () => {
    // Fixtures deliberately differ in duration (and carry internal travel /
    // internal walking) — with every candidate at a uniform 60 minutes and no
    // mobility fields, a total that only ever moved `durationMinutes` looked
    // correct by coincidence.
    const a = candidateWithMobility('a', 0, 0, {
      durationMinutes: 60,
      internalTravelMinutes: 30,
      internalWalkingDistanceMeters: 500,
    });
    const days = new Map<number, DayAccumulator>([
      [
        1,
        {
          dayNumber: 1,
          // a = 60 + 30 internal travel, b = 180, c = 60 → 330 minutes.
          assigned: [
            a,
            candidateWithMobility('b', 0, 0.001, {
              durationMinutes: 180,
            }),
            candidateWithMobility('c', 0, 0.002, { durationMinutes: 60 }),
          ],
          totalExperienceMinutes: 330,
          totalWalkingMeters: 500,
        },
      ],
      [
        2,
        {
          dayNumber: 2,
          assigned: [],
          totalExperienceMinutes: 0,
          totalWalkingMeters: 0,
        },
      ],
    ]);

    const { days: improved } = await runBoundedLocalImprovement(
      days,
      context(),
    );

    expect(improved.get(2)!.assigned.map((x) => x.experienceId)).toEqual(['a']);
    expect(improved.get(1)!.assigned.map((x) => x.experienceId)).toEqual([
      'b',
      'c',
    ]);
    // 330 - (60 duration + 30 internal travel) = 240, not 270: the omitted
    // internal travel is exactly the drift this asserts against.
    expect(improved.get(1)!.totalExperienceMinutes).toBe(240);
    expect(improved.get(2)!.totalExperienceMinutes).toBe(90);
    expect(improved.get(1)!.totalWalkingMeters).toBe(0);
    expect(improved.get(2)!.totalWalkingMeters).toBe(500);
  });

  it('re-prices both day totals exactly when a swap exchanges candidates of different durations', async () => {
    const a = candidateWithMobility('a', 0, 0, { durationMinutes: 60 });
    const far = candidateWithMobility('far', 0, 0.03, {
      durationMinutes: 180,
    });
    const b = candidateWithMobility('b', 0, 0.031, { durationMinutes: 60 });
    const near = candidateWithMobility('near', 0, 0.002, {
      durationMinutes: 120,
      internalTravelMinutes: 30,
      internalWalkingDistanceMeters: 400,
    });

    const days = new Map<number, DayAccumulator>([
      [
        1,
        {
          dayNumber: 1,
          assigned: [a, far], // 60 + 180
          totalExperienceMinutes: 240,
          totalWalkingMeters: 0,
        },
      ],
      [
        2,
        {
          dayNumber: 2,
          assigned: [b, near], // 60 + (120 + 30 internal travel)
          totalExperienceMinutes: 210,
          totalWalkingMeters: 400,
        },
      ],
    ]);

    const { days: improved } = await runBoundedLocalImprovement(
      days,
      context(),
    );

    // Geographic compactness swaps 'far' (180 min) with 'near' (150 min).
    expect(improved.get(1)!.assigned.map((x) => x.experienceId)).toEqual([
      'a',
      'near',
    ]);
    expect(improved.get(2)!.assigned.map((x) => x.experienceId)).toEqual([
      'b',
      'far',
    ]);
    // Day 1 now holds a(60) + near(120+30) = 210; day 2 holds b(60) + far(180)
    // = 240. Before the fix both days kept their pre-swap totals (240/210).
    expect(improved.get(1)!.totalExperienceMinutes).toBe(210);
    expect(improved.get(2)!.totalExperienceMinutes).toBe(240);
    expect(improved.get(1)!.totalWalkingMeters).toBe(400);
    expect(improved.get(2)!.totalWalkingMeters).toBe(0);
  });

  it('does not false-accept a swap that would place a candidate before its opening hours (stale-total regression)', async () => {
    // Same geographically-favorable pair as the compactness swap test above
    // ('far-from-a' at (10,10) really belongs with (10,10.001); the incoming
    // candidate at (0,0.001) really belongs with (0,0)) — the swap probe
    // must remove 'far-from-a' (180 min) from day 1's totalExperienceMinutes
    // (180) before computing the incoming candidate's proposed start. Done
    // correctly, the true post-removal total is 0, so the proposed start is
    // 540 (9:00) — before the 11:00 opening, correctly infeasible. Before
    // the withoutCandidate fix, the stale (un-subtracted) total of 180 would
    // have placed the proposed start at 720 (12:00) — falsely inside the
    // 11:00-18:00 window, a false ACCEPT of a swap that shouldn't happen.
    const farFromA = candidateWithOptions('far-from-a', 10, 10, {
      durationMinutes: 180,
    });
    const nearButClosedUntilEleven = candidateWithOptions(
      'near-a-actually',
      0,
      0.001,
      {
        durationMinutes: 60,
        openingHours: {
          status: 'known',
          rangesByWeekday: {
            // Monday: opens 11:00 (660), closes 18:00 (1080).
            1: [
              { startMinutesFromMidnight: 660, endMinutesFromMidnight: 1080 },
            ],
          },
        },
      },
    );

    const days = new Map<number, DayAccumulator>([
      [
        1,
        {
          dayNumber: 1,
          assigned: [candidate('a1', 0, 0), farFromA],
          totalExperienceMinutes: 180,
          totalWalkingMeters: 0,
        },
      ],
      [
        2,
        {
          dayNumber: 2,
          assigned: [candidate('b1', 10, 10.001), nearButClosedUntilEleven],
          totalExperienceMinutes: 120,
          totalWalkingMeters: 0,
        },
      ],
    ]);

    const regressionContext: PlacementContext = {
      ...context(),
      startDates: ['2026-06-01'], // a Monday, so day 1 resolves to weekday 1
    };

    const { days: improved } = await runBoundedLocalImprovement(
      days,
      regressionContext,
    );
    const day1Ids = improved.get(1)!.assigned.map((a) => a.experienceId);
    expect(day1Ids).not.toContain('near-a-actually');
    expect(day1Ids).toContain('far-from-a');
  });
});
