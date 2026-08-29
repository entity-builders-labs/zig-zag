import { TourPlanningFeasibilityValidatorService } from './tour-planning-feasibility-validator.service';
import {
  DailyPlanningInput,
  DailyPlanningSolution,
} from '../interfaces/daily-planning.interface';
import {
  TransportationMode,
  TravelPace,
} from '../interfaces/tour-generation.interface';

function baseInput(
  overrides: Partial<DailyPlanningInput> = {},
): DailyPlanningInput {
  return {
    destination: {} as any,
    requestedDays: 1,
    candidates: [
      {
        activityId: 'a',
        kind: 'POI',
        title: 'a',
        durationMinutes: 60,
        spatialFootprint: { type: 'POINT', centroid: { lat: 0, lng: 0 } },
        semanticScore: 0.5,
      },
    ],
    mobility: {
      allowedTransportationModes: [TransportationMode.WALKING],
      maxWalkingDistancePerDayMeters: 10000,
      maxContinuousWalkingDistanceMeters: 3000,
      travelPace: TravelPace.MODERATE,
      accessibilityNeeds: [],
    },
    travelPace: TravelPace.MODERATE,
    planningWindow: {
      startMinutesFromMidnight: 540,
      endMinutesFromMidnight: 1200,
    },
    startDates: [],
    ...overrides,
  };
}

function validSolution(): DailyPlanningSolution {
  return {
    days: [
      {
        dayNumber: 1,
        activities: [
          {
            activityId: 'a',
            startMinutesFromMidnight: 540,
            endMinutesFromMidnight: 600,
          },
        ],
        totalActivityMinutes: 60,
        totalTravelMinutes: 0,
        totalWalkingMinutes: 0,
        utilizationMinutes: 60,
      },
    ],
    unselected: [],
    score: 1,
    metadata: { solver: 'test', approximateTravel: true },
  };
}

describe('TourPlanningFeasibilityValidatorService', () => {
  const validator = new TourPlanningFeasibilityValidatorService();

  it('accepts a valid solution', () => {
    const result = validator.validate(validSolution(), baseInput());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects a day-count mismatch', () => {
    const result = validator.validate(
      validSolution(),
      baseInput({ requestedDays: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'DAY_COUNT_MISMATCH')).toBe(
      true,
    );
  });

  it('rejects a duplicate activity across days', () => {
    const solution = validSolution();
    solution.days.push({
      dayNumber: 2,
      activities: [
        {
          activityId: 'a',
          startMinutesFromMidnight: 540,
          endMinutesFromMidnight: 600,
        },
      ],
      totalActivityMinutes: 60,
      totalTravelMinutes: 0,
      totalWalkingMinutes: 0,
      utilizationMinutes: 60,
    });
    const result = validator.validate(
      solution,
      baseInput({ requestedDays: 2 }),
    );
    expect(result.issues.some((i) => i.code === 'DUPLICATE_ACTIVITY')).toBe(
      true,
    );
  });

  it('rejects an activity scheduled out of chronological order', () => {
    const solution = validSolution();
    solution.days[0].activities.push({
      activityId: 'a2',
      startMinutesFromMidnight: 500, // before the previous activity's end (600)
      endMinutesFromMidnight: 560,
    });
    const input = baseInput({
      candidates: [
        ...baseInput().candidates,
        {
          activityId: 'a2',
          kind: 'POI',
          title: 'a2',
          durationMinutes: 60,
          spatialFootprint: { type: 'POINT', centroid: { lat: 0, lng: 0 } },
          semanticScore: 0.5,
        },
      ],
    });
    const result = validator.validate(solution, input);
    expect(
      result.issues.some((i) => i.code === 'CHRONOLOGICAL_ORDER_VIOLATION'),
    ).toBe(true);
  });

  it('rejects an activity that runs past the planning window', () => {
    const solution = validSolution();
    solution.days[0].activities[0].endMinutesFromMidnight = 1300; // past 1200
    const result = validator.validate(solution, baseInput());
    expect(
      result.issues.some((i) => i.code === 'DAILY_TIME_CAPACITY_EXCEEDED'),
    ).toBe(true);
  });

  it('rejects a day number outside the requested range', () => {
    const solution = validSolution();
    solution.days[0].dayNumber = 5;
    const result = validator.validate(solution, baseInput());
    expect(result.issues.some((i) => i.code === 'INVALID_DAY_NUMBER')).toBe(
      true,
    );
  });

  // Supplementary cases beyond the brief's minimum set, covering the
  // remaining independently-checked codes so each branch of the validator
  // is actually exercised rather than merely present in the source.

  it('rejects an activity that is not part of the offered candidate pool', () => {
    const solution = validSolution();
    solution.days[0].activities[0].activityId = 'ghost';
    const result = validator.validate(solution, baseInput());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'UNKNOWN_ACTIVITY')).toBe(true);
  });

  it('rejects a travel leg using a disallowed transportation mode', () => {
    const solution = validSolution();
    solution.days[0].activities.push({
      activityId: 'a2',
      startMinutesFromMidnight: 610,
      endMinutesFromMidnight: 670,
      travelFromPrevious: {
        mode: TransportationMode.DRIVING,
        durationMinutes: 10,
        distanceMeters: 2000,
        walkingMinutes: 0,
        walkingDistanceMeters: 0,
        approximate: true,
      },
    });
    const input = baseInput({
      candidates: [
        ...baseInput().candidates,
        {
          activityId: 'a2',
          kind: 'POI',
          title: 'a2',
          durationMinutes: 60,
          spatialFootprint: { type: 'POINT', centroid: { lat: 0, lng: 0 } },
          semanticScore: 0.5,
        },
      ],
    });
    const result = validator.validate(solution, input);
    expect(result.issues.some((i) => i.code === 'DISALLOWED_TRAVEL_MODE')).toBe(
      true,
    );
  });

  it('rejects a single leg that exceeds the max continuous walking distance', () => {
    const solution = validSolution();
    solution.days[0].activities.push({
      activityId: 'a2',
      startMinutesFromMidnight: 610,
      endMinutesFromMidnight: 670,
      travelFromPrevious: {
        mode: TransportationMode.WALKING,
        durationMinutes: 40,
        distanceMeters: 5000,
        walkingMinutes: 40,
        walkingDistanceMeters: 5000, // exceeds maxContinuousWalkingDistanceMeters (3000)
        approximate: true,
      },
    });
    const input = baseInput({
      candidates: [
        ...baseInput().candidates,
        {
          activityId: 'a2',
          kind: 'POI',
          title: 'a2',
          durationMinutes: 60,
          spatialFootprint: { type: 'POINT', centroid: { lat: 0, lng: 0 } },
          semanticScore: 0.5,
        },
      ],
    });
    const result = validator.validate(solution, input);
    expect(
      result.issues.some((i) => i.code === 'MAX_CONTINUOUS_WALKING_EXCEEDED'),
    ).toBe(true);
  });

  it('rejects a day whose cumulative walking distance exceeds the daily maximum', () => {
    const solution = validSolution();
    const input = baseInput({
      candidates: [
        {
          activityId: 'a',
          kind: 'POI',
          title: 'a',
          durationMinutes: 60,
          spatialFootprint: { type: 'POINT', centroid: { lat: 0, lng: 0 } },
          semanticScore: 0.5,
          mobility: { internalWalkingDistanceMeters: 15000 }, // exceeds maxWalkingDistancePerDayMeters (10000)
        },
      ],
    });
    const result = validator.validate(solution, input);
    expect(
      result.issues.some((i) => i.code === 'MAX_WALKING_PER_DAY_EXCEEDED'),
    ).toBe(true);
  });
});
