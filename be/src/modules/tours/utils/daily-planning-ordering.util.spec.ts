import {
  orderAndScheduleDay,
  OrderingContext,
} from './daily-planning-ordering.util';
import {
  PlanningActivityCandidate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';

function candidate(
  id: string,
  lat: number,
  lng: number,
  durationMinutes = 60,
  semanticScore = 0.5,
): PlanningActivityCandidate {
  return {
    activityId: id,
    kind: 'POI',
    title: id,
    durationMinutes,
    spatialFootprint: { type: 'POINT', centroid: { lat, lng } },
    semanticScore,
  };
}

function realTravelEstimateProvider(): TravelEstimateProvider {
  return {
    estimate: jest.fn(async (from, to) => {
      const dLat = to.centroid.lat - from.centroid.lat;
      const dLng = to.centroid.lng - from.centroid.lng;
      const distanceMeters = Math.sqrt(dLat * dLat + dLng * dLng) * 111000; // rough degrees-to-meters
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

/** Monday-only window, in minutes from midnight (weekday 1). */
function mondayHours(
  startMinutesFromMidnight: number,
  endMinutesFromMidnight: number,
): PlanningActivityCandidate['openingHours'] {
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
    expect(day.activities).toEqual([]);
    expect(day.dayNumber).toBe(1);
  });

  it('schedules a single candidate starting at the planning window start', async () => {
    const day = await orderAndScheduleDay(1, [candidate('a', 0, 0)], context());
    expect(day.activities[0].startMinutesFromMidnight).toBe(540);
    expect(day.activities[0].endMinutesFromMidnight).toBe(600);
    expect(day.activities[0].travelFromPrevious).toBeUndefined();
  });

  it('orders by nearest-neighbor from the previous stop', async () => {
    // 'start' has the highest semanticScore, so sortCandidatesDeterministically
    // picks it as the day's opening stop on real merit (realistic solver
    // behavior — the best-ranked candidate opens the day). 'near' and 'far'
    // are tied on score, so their relative order is decided purely by
    // geography from that opening stop: (0,0.001) is much closer to (0,0)
    // than (0,1) is.
    const day = await orderAndScheduleDay(
      1,
      [
        candidate('near', 0, 0.001),
        candidate('far', 0, 1),
        candidate('start', 0, 0, 60, 0.9),
      ],
      context(),
    );
    expect(day.activities.map((a) => a.activityId)).toEqual([
      'start',
      'near',
      'far',
    ]);
  });

  it('accumulates travel time between consecutive activities', async () => {
    const day = await orderAndScheduleDay(
      1,
      [candidate('a', 0, 0), candidate('b', 0, 0.01)],
      context(),
    );
    expect(day.totalTravelMinutes).toBeGreaterThan(0);
    expect(day.activities[1].travelFromPrevious).toBeDefined();
    expect(day.activities[1].startMinutesFromMidnight).toBeGreaterThan(
      day.activities[0].endMinutesFromMidnight,
    );
  });

  it('prefers a reachable open candidate over a nearer one that is still closed at the cursor', async () => {
    // 'start' (best score) opens the day at 9:00 and ends at 10:00. Pure
    // nearest-neighbor would then take 'near-closed' (0, 0.001) — but it only
    // opens at 11:00, so it would be scheduled an hour before opening. The
    // hours-aware preference takes the reachable open candidate instead and
    // comes back to 'near-closed' once the cursor is inside its window.
    const nearClosed = candidate('near-closed', 0, 0.001);
    nearClosed.openingHours = mondayHours(11 * 60, 18 * 60);

    const day = await orderAndScheduleDay(
      1,
      [
        nearClosed,
        candidate('far-open', 0, 0.05),
        candidate('start', 0, 0, 60, 0.9),
      ],
      { ...context(), startDates: ['2026-09-07'] }, // a real Monday
    );

    expect(day.activities.map((a) => a.activityId)).toEqual([
      'start',
      'far-open',
      'near-closed',
    ]);
    const scheduledNearClosed = day.activities[2];
    expect(scheduledNearClosed.startMinutesFromMidnight).toBeGreaterThanOrEqual(
      11 * 60,
    );
    expect(scheduledNearClosed.endMinutesFromMidnight).toBeLessThanOrEqual(
      18 * 60,
    );
  });

  it('still orders purely by geography when every candidate is open at the cursor', async () => {
    const near = candidate('near', 0, 0.001);
    near.openingHours = mondayHours(9 * 60, 18 * 60); // already open at 10:00

    const day = await orderAndScheduleDay(
      1,
      [near, candidate('far', 0, 1), candidate('start', 0, 0, 60, 0.9)],
      { ...context(), startDates: ['2026-09-07'] },
    );

    expect(day.activities.map((a) => a.activityId)).toEqual([
      'start',
      'near',
      'far',
    ]);
  });

  it('falls back to pure nearest-neighbor when no base date resolves a weekday', async () => {
    const nearClosed = candidate('near-closed', 0, 0.001);
    nearClosed.openingHours = mondayHours(11 * 60, 18 * 60);

    const day = await orderAndScheduleDay(
      1,
      [
        nearClosed,
        candidate('far-open', 0, 0.05),
        candidate('start', 0, 0, 60, 0.9),
      ],
      context(), // no startDates — weekday unknown, hours cannot be evaluated
    );

    expect(day.activities.map((a) => a.activityId)).toEqual([
      'start',
      'near-closed',
      'far-open',
    ]);
  });

  it('reports total activity minutes independent of travel time', async () => {
    const day = await orderAndScheduleDay(
      1,
      [candidate('a', 0, 0, 60), candidate('b', 0, 0.01, 90)],
      context(),
    );
    expect(day.totalActivityMinutes).toBe(150);
  });
});
