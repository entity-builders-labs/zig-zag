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

  it('reports total activity minutes independent of travel time', async () => {
    const day = await orderAndScheduleDay(
      1,
      [candidate('a', 0, 0, 60), candidate('b', 0, 0.01, 90)],
      context(),
    );
    expect(day.totalActivityMinutes).toBe(150);
  });
});
