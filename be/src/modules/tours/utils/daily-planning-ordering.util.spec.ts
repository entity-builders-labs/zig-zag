import {
  orderAndScheduleDay,
  orderAndScheduleDayWithRepair,
  OrderingContext,
} from './daily-planning-ordering.util';
import {
  PlanningExperienceCandidate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';

function candidate(
  id: string,
  lat: number,
  lng: number,
  durationMinutes = 60,
  semanticScore = 0.5,
): PlanningExperienceCandidate {
  const footprint = { type: 'POINT' as const, centroid: { lat, lng } };
  return {
    experienceId: id,
    title: id,
    durationMinutes,
    spatialFootprint: footprint,
    startFootprint: footprint,
    endFootprint: footprint,
    semanticScore,
  };
}

function realTravelEstimateProvider(): TravelEstimateProvider {
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

function context(): OrderingContext {
  return {
    travelEstimateProvider: realTravelEstimateProvider(),
    planningWindow: {
      startMinutesFromMidnight: 540,
      endMinutesFromMidnight: 1200,
    },
    allowedTransportationModes: [TransportationMode.WALKING],
    startDates: [],
  };
}

function mondayHours(
  startMinutesFromMidnight: number,
  endMinutesFromMidnight: number,
): PlanningExperienceCandidate['openingHours'] {
  return {
    status: 'known',
    rangesByWeekday: {
      1: [{ startMinutesFromMidnight, endMinutesFromMidnight }],
    },
  };
}

describe('orderAndScheduleDay', () => {
  it('returns an empty PlannedDay for no candidates', async () => {
    const day = await orderAndScheduleDay(1, [], context());
    expect(day.experiences).toEqual([]);
    expect(day.dayNumber).toBe(1);
  });

  it('schedules a single candidate starting at the planning window start', async () => {
    const day = await orderAndScheduleDay(1, [candidate('a', 0, 0)], context());
    expect(day.experiences[0].startMinutesFromMidnight).toBe(540);
    expect(day.experiences[0].endMinutesFromMidnight).toBe(600);
    expect(day.experiences[0].travelFromPrevious).toBeUndefined();
  });

  it('preserves merit for the first stop, then orders feasible stops by geography', async () => {
    const day = await orderAndScheduleDay(
      1,
      [
        candidate('near', 0, 0.001),
        candidate('far', 0, 0.01),
        candidate('start', 0, 0, 60, 0.9),
      ],
      context(),
    );
    expect(day.experiences.map((item) => item.experienceId)).toEqual([
      'start',
      'near',
      'far',
    ]);
  });

  it('accumulates travel time between consecutive experiences', async () => {
    const day = await orderAndScheduleDay(
      1,
      [candidate('a', 0, 0), candidate('b', 0, 0.01)],
      context(),
    );
    expect(day.totalTravelMinutes).toBeGreaterThan(0);
    expect(day.experiences[1].travelFromPrevious).toBeDefined();
    expect(day.experiences[1].startMinutesFromMidnight).toBeGreaterThan(
      day.experiences[0].endMinutesFromMidnight,
    );
  });

  it('uses routed arrival time, not the pre-travel cursor, when evaluating opening hours', async () => {
    const nearClosed = candidate('near-closed', 0, 0.001);
    nearClosed.openingHours = mondayHours(11 * 60, 18 * 60);

    const day = await orderAndScheduleDay(
      1,
      [
        nearClosed,
        candidate('far-open', 0, 0.05),
        candidate('start', 0, 0, 60, 0.9),
      ],
      { ...context(), startDates: ['2026-09-07'] },
    );

    expect(day.experiences.map((item) => item.experienceId)).toEqual([
      'start',
      'far-open',
      'near-closed',
    ]);
    const scheduledNearClosed = day.experiences[2];
    expect(scheduledNearClosed.startMinutesFromMidnight).toBeGreaterThanOrEqual(
      11 * 60,
    );
    expect(scheduledNearClosed.endMinutesFromMidnight).toBeLessThanOrEqual(
      18 * 60,
    );
  });

  it('still orders by geography when every known-hours candidate is feasible', async () => {
    const near = candidate('near', 0, 0.001);
    near.openingHours = mondayHours(9 * 60, 18 * 60);

    const day = await orderAndScheduleDay(
      1,
      [near, candidate('far', 0, 0.01), candidate('start', 0, 0, 60, 0.9)],
      { ...context(), startDates: ['2026-09-07'] },
    );

    expect(day.experiences.map((item) => item.experienceId)).toEqual([
      'start',
      'near',
      'far',
    ]);
  });

  it('does not enforce weekday-specific hours when no base date resolves a weekday', async () => {
    const nearClosed = candidate('near-closed', 0, 0.001);
    nearClosed.openingHours = mondayHours(11 * 60, 18 * 60);

    const day = await orderAndScheduleDay(
      1,
      [
        nearClosed,
        candidate('far-open', 0, 0.01),
        candidate('start', 0, 0, 60, 0.9),
      ],
      context(),
    );

    expect(day.experiences.map((item) => item.experienceId)).toEqual([
      'start',
      'near-closed',
      'far-open',
    ]);
  });

  it('repairs a post-routing opening-hours conflict without aborting the whole day', async () => {
    const closed = candidate('closed', 0, 0.001, 60, 0.2);
    closed.openingHours = mondayHours(7 * 60, 8 * 60);
    const start = candidate('start', 0, 0, 60, 0.9);

    const repaired = await orderAndScheduleDayWithRepair(1, [start, closed], {
      ...context(),
      startDates: ['2026-09-07'],
    });

    expect(repaired.day.experiences.map((item) => item.experienceId)).toEqual([
      'start',
    ]);
    expect(repaired.unselected).toEqual([
      {
        experienceId: 'closed',
        reasons: ['OPENING_HOURS_INCOMPATIBLE'],
      },
    ]);
  });

  it('removes ordinary candidates before a MUST during repair', async () => {
    const must = { ...candidate('must', 0, 0, 60, 0.1), mustInclude: true };
    const ordinary = candidate('ordinary', 0, 0.001, 60, 0.9);
    const repaired = await orderAndScheduleDayWithRepair(1, [must, ordinary], {
      ...context(),
      planningWindow: {
        startMinutesFromMidnight: 540,
        endMinutesFromMidnight: 630,
      },
    });

    expect(repaired.day.experiences.map((item) => item.experienceId)).toEqual([
      'must',
    ]);
    expect(repaired.unselected).toEqual([
      { experienceId: 'ordinary', reasons: ['DAILY_TIME_CAPACITY_EXCEEDED'] },
    ]);
  });

  it('reports total Experience minutes independent of travel time', async () => {
    const day = await orderAndScheduleDay(
      1,
      [candidate('a', 0, 0, 60), candidate('b', 0, 0.01, 90)],
      context(),
    );
    expect(day.totalExperienceMinutes).toBe(150);
  });

  it('includes internal travel in totalExperienceMinutes, keeping it consistent with its own end timestamps', async () => {
    // Regression guard for CP8-3: candidateExperienceMinutes/occupiedMinutes
    // (used for every `end` timestamp) already include internal travel —
    // the day-level total must not silently disagree with its own schedule.
    const withInternalTravel: PlanningExperienceCandidate = {
      ...candidate('a', 0, 0, 60),
      mobility: { internalTravelMinutes: 15 },
    };
    const day = await orderAndScheduleDay(
      1,
      [withInternalTravel, candidate('b', 0, 0.01, 90)],
      context(),
    );
    expect(day.totalExperienceMinutes).toBe(60 + 15 + 90);
    expect(day.totalExperienceMinutes + day.totalTravelMinutes).toBeCloseTo(
      day.utilizationMinutes,
    );
  });

  it('routes end→start, not centroid-to-centroid, when a candidate is route-shaped', async () => {
    // Regression guard for CP8-1: end/start footprints must drive the
    // estimate, not the generic (centroid) spatialFootprint — checked
    // order-independently, since which candidate the solver visits first
    // is its own decision, not this test's.
    const provider = realTravelEstimateProvider();
    const a: PlanningExperienceCandidate = {
      ...candidate('a', 5, 5, 60), // generic centroid — must never appear in an estimate() call
      startFootprint: { type: 'POINT', centroid: { lat: 0, lng: 0 } },
      endFootprint: { type: 'POINT', centroid: { lat: 0, lng: 0 } },
    };
    const b: PlanningExperienceCandidate = {
      ...candidate('b', 9, 9, 60), // generic centroid — must never appear in an estimate() call
      startFootprint: { type: 'POINT', centroid: { lat: 10, lng: 10 } },
      endFootprint: { type: 'POINT', centroid: { lat: 10, lng: 10 } },
    };

    await orderAndScheduleDay(1, [a, b], {
      ...context(),
      travelEstimateProvider: provider,
    });

    const calls = (provider.estimate as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [from, to] of calls) {
      expect(from.centroid).not.toEqual({ lat: 5, lng: 5 });
      expect(from.centroid).not.toEqual({ lat: 9, lng: 9 });
      expect(to.centroid).not.toEqual({ lat: 5, lng: 5 });
      expect(to.centroid).not.toEqual({ lat: 9, lng: 9 });
    }
  });
});
