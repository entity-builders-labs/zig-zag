import { TourPlanningFeasibilityValidatorService } from './tour-planning-feasibility-validator.service';
import {
  DailyPlanningInput,
  DailyPlanningSolution,
  PlannedDay,
  PlannedExperience,
  TravelEstimate,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { GREEDY_PLANNING_POLICY_VERSIONS } from '../constants/planning-policy-versions';
import {
  LEGACY_DURATION_PROVENANCE,
  LEGACY_HOURS_PROVENANCE,
  mobilityFixture,
  planningInputFixture,
  singleVisitCandidate,
} from '../fixtures/planning-input.fixture';

function baseInput(
  overrides: Partial<DailyPlanningInput> & { requestedDays?: number } = {},
): DailyPlanningInput {
  const { requestedDays, ...rest } = overrides;
  return planningInputFixture({
    dayCount: requestedDays ?? 1,
    candidates: [
      singleVisitCandidate({ experienceId: 'a', semanticScore: 0.5 }),
    ],
    ...rest,
  });
}

function planned(
  experienceId: string,
  start: number,
  end: number,
  travelFromPrevious: TravelEstimate | null = null,
): PlannedExperience {
  return {
    experienceId,
    startMinutesFromMidnight: start,
    endMinutesFromMidnight: end,
    travelFromPrevious,
    duration: { minutes: end - start, provenance: LEGACY_DURATION_PROVENANCE },
    openingHours: { status: 'UNKNOWN', provenance: LEGACY_HOURS_PROVENANCE },
    bindingConstraints: [],
  };
}

function plannedDay(
  dayNumber: number,
  experiences: PlannedExperience[],
): PlannedDay {
  return {
    dayNumber,
    date: null,
    experiences,
    totalExperienceMinutes: 60,
    totalTravelMinutes: 0,
    totalWalkingMinutes: 0,
    utilizationMinutes: 60,
    residual: { dayNumber, availableMinutes: 600, meaningful: true },
    firstLastMileTravel: 'EXCLUDED_NO_ANCHOR',
  };
}

function validSolution(): DailyPlanningSolution {
  const input = baseInput();
  return {
    days: [plannedDay(1, [planned('a', 540, 600)])],
    unselected: [],
    inputErrors: [],
    score: 1,
    metadata: {
      solver: 'test',
      policies: GREEDY_PLANNING_POLICY_VERSIONS,
      approximateTravel: true,
      routing: {
        externalEstimateCount: 0,
        internalEstimateCount: 0,
        approximateEstimateCount: 0,
        fallbackCount: 0,
        providerCounts: {},
      },
      legs: { byMode: {}, providerBacked: 0, approximate: 0 },
      constraints: {
        days: input.days,
        allowedTransportationModes: input.mobility.allowedTransportationModes,
        maxWalkingDistancePerDayMeters:
          input.mobility.maxWalkingDistancePerDayMeters,
        maxContinuousWalkingDistanceMeters:
          input.mobility.maxContinuousWalkingDistanceMeters,
        cycling: null,
        travelPace: input.travelPace,
      },
    },
  };
}

const leg = (
  mode: TransportationMode,
  durationMinutes: number,
  walkingDistanceMeters: number,
): TravelEstimate => ({
  mode,
  durationMinutes,
  distanceMeters: walkingDistanceMeters || 2000,
  walkingMinutes: walkingDistanceMeters ? durationMinutes : 0,
  walkingDistanceMeters,
  approximate: true,
});

const withSecondCandidate = (
  overrides: Partial<DailyPlanningInput> = {},
): DailyPlanningInput =>
  baseInput({
    candidates: [
      singleVisitCandidate({ experienceId: 'a', semanticScore: 0.5 }),
      singleVisitCandidate({ experienceId: 'a2', semanticScore: 0.5 }),
    ],
    ...overrides,
  });

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
    expect(
      result.issues.some((issue) => issue.code === 'DAY_COUNT_MISMATCH'),
    ).toBe(true);
  });

  it('rejects a duplicate activity across days', () => {
    const solution = validSolution();
    solution.days.push(plannedDay(2, [planned('a', 540, 600)]));
    const result = validator.validate(
      solution,
      baseInput({ requestedDays: 2 }),
    );
    expect(
      result.issues.some((issue) => issue.code === 'DUPLICATE_EXPERIENCE'),
    ).toBe(true);
  });

  it('rejects an activity scheduled out of chronological order', () => {
    const solution = validSolution();
    solution.days[0].experiences.push(planned('a2', 500, 560));
    const result = validator.validate(solution, withSecondCandidate());
    expect(
      result.issues.some(
        (issue) => issue.code === 'CHRONOLOGICAL_ORDER_VIOLATION',
      ),
    ).toBe(true);
  });

  it('rejects an activity that runs past the planning window', () => {
    const solution = validSolution();
    solution.days[0].experiences[0].endMinutesFromMidnight = 1300;
    const result = validator.validate(solution, baseInput());
    expect(
      result.issues.some(
        (issue) => issue.code === 'DAILY_TIME_CAPACITY_EXCEEDED',
      ),
    ).toBe(true);
  });

  it('rejects a day number outside the requested range', () => {
    const solution = validSolution();
    solution.days[0].dayNumber = 5;
    const result = validator.validate(solution, baseInput());
    expect(
      result.issues.some((issue) => issue.code === 'INVALID_DAY_NUMBER'),
    ).toBe(true);
  });

  it('rejects an activity that is not part of the offered candidate pool', () => {
    const solution = validSolution();
    solution.days[0].experiences[0].experienceId = 'ghost';
    const result = validator.validate(solution, baseInput());
    expect(
      result.issues.some((issue) => issue.code === 'UNKNOWN_EXPERIENCE'),
    ).toBe(true);
  });

  it('rejects a travel leg using a disallowed transportation mode', () => {
    const solution = validSolution();
    solution.days[0].experiences.push(
      planned('a2', 610, 670, leg(TransportationMode.DRIVING, 10, 0)),
    );
    const result = validator.validate(solution, withSecondCandidate());
    expect(
      result.issues.some((issue) => issue.code === 'DISALLOWED_TRAVEL_MODE'),
    ).toBe(true);
  });

  it('rejects a single leg that exceeds the max continuous walking distance', () => {
    const solution = validSolution();
    solution.days[0].experiences.push(
      planned('a2', 610, 670, leg(TransportationMode.WALKING, 40, 5000)),
    );
    const result = validator.validate(solution, withSecondCandidate());
    expect(
      result.issues.some(
        (issue) => issue.code === 'MAX_CONTINUOUS_WALKING_EXCEEDED',
      ),
    ).toBe(true);
  });

  it('rejects a day whose cumulative walking distance exceeds the daily maximum', () => {
    const input = baseInput({
      candidates: [
        singleVisitCandidate({
          experienceId: 'a',
          semanticScore: 0.5,
          mobility: { internalWalkingDistanceMeters: 15000 },
        }),
      ],
    });
    const result = validator.validate(validSolution(), input);
    expect(
      result.issues.some(
        (issue) => issue.code === 'MAX_WALKING_PER_DAY_EXCEEDED',
      ),
    ).toBe(true);
  });

  it('rejects a bicycle leg longer than the resolved continuous cycling limit', () => {
    const solution = validSolution();
    solution.days[0].experiences.push(
      planned('a2', 660, 720, leg(TransportationMode.CYCLING, 59, 0)),
    );
    const input = withSecondCandidate({
      mobility: mobilityFixture({
        allowedTransportationModes: [TransportationMode.CYCLING],
        cycling: {
          maxContinuousCyclingMinutes: 45,
          maxDailyCyclingMinutes: null,
          source: { kind: 'USER_STATED' },
        },
      }),
    });
    const result = validator.validate(solution, input);
    expect(result.issues.map((issue) => issue.code)).toEqual(['CYCLING_LIMIT']);
  });

  it('accepts a bicycle leg within the resolved cycling limits', () => {
    const solution = validSolution();
    solution.days[0].experiences.push(
      planned('a2', 640, 700, leg(TransportationMode.CYCLING, 40, 0)),
    );
    const input = withSecondCandidate({
      mobility: mobilityFixture({
        allowedTransportationModes: [TransportationMode.CYCLING],
        cycling: {
          maxContinuousCyclingMinutes: 45,
          maxDailyCyclingMinutes: 60,
          source: {
            kind: 'MOBILITY_PROFILE',
            profileName: 'test-profile',
            profileVersion: 'v1',
          },
        },
      }),
    });
    expect(validator.validate(solution, input)).toEqual({
      valid: true,
      issues: [],
    });
  });
});
