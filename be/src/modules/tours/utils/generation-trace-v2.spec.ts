import { GenerationTraceRecorder } from './generation-trace-recorder.util';
import { recordDailyPlanningStep } from './experience-generation-trace.util';
import { DailyPlanningSolution } from '../interfaces/daily-planning.interface';
import { TravelPace } from '../interfaces/tour-generation.interface';
import { GREEDY_PLANNING_POLICY_VERSIONS } from '../constants/planning-policy-versions';
import {
  LEGACY_DURATION_PROVENANCE,
  LEGACY_HOURS_PROVENANCE,
  planningDaysFixture,
} from '../fixtures/planning-input.fixture';

describe('GenerationTrace daily planning audit contract', () => {
  it('records selected and unselected planner candidates with real rejection reason codes', () => {
    const solution: DailyPlanningSolution = {
      days: [
        {
          dayNumber: 1,
          date: null,
          experiences: [
            {
              experienceId: 'experience-selected',
              startMinutesFromMidnight: 540,
              endMinutesFromMidnight: 660,
              travelFromPrevious: null,
              duration: {
                minutes: 120,
                provenance: LEGACY_DURATION_PROVENANCE,
              },
              openingHours: {
                status: 'UNKNOWN',
                provenance: LEGACY_HOURS_PROVENANCE,
              },
              bindingConstraints: ['DAY_WINDOW_START'],
            },
          ],
          totalExperienceMinutes: 120,
          totalTravelMinutes: 0,
          totalWalkingMinutes: 0,
          utilizationMinutes: 120,
          residual: { dayNumber: 1, availableMinutes: 540, meaningful: true },
          firstLastMileTravel: 'EXCLUDED_NO_ANCHOR',
        },
      ],
      unselected: [
        {
          experienceId: 'experience-rejected',
          reasons: ['DAILY_TIME_CAPACITY_EXCEEDED'],
        },
      ],
      inputErrors: [
        {
          scope: 'CANDIDATE',
          experienceId: 'experience-invalid',
          code: 'INVALID_SPATIAL_FOOTPRINT',
          detail: 'a footprint has no finite coordinates',
        },
      ],
      score: 0.9,
      metadata: {
        solver: 'GreedyCapacitatedDailyPlanningSolver',
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
          days: planningDaysFixture(1),
          allowedTransportationModes: [],
          maxWalkingDistancePerDayMeters: 10000,
          maxContinuousWalkingDistanceMeters: 3000,
          cycling: null,
          travelPace: TravelPace.MODERATE,
        },
      },
    };

    const recorder = new GenerationTraceRecorder();
    recordDailyPlanningStep(recorder, {
      planningSolution: solution,
      planningIneligible: [
        {
          experienceId: 'experience-without-duration',
          reason: 'MISSING_REQUIRED_DURATION',
        },
      ],
    });
    const trace = recorder.build({
      canonicalRequest: { destination: 'Test', durationDays: 1 },
      runtime: { buildCommit: 'v5-test' },
      result: { status: 'COMPLETED', outcome: 'SUCCESS' },
    });
    const step = trace.steps.find((s) => s.name === 'planning.daily')!;

    expect(step.component).toBe('GreedyCapacitatedDailyPlanningSolver');
    expect(step.decision.outcome).toBe('DAILY_PLAN_BUILT');
    expect(
      step.rules?.find((rule) => rule.id === 'PLAN-TRAVEL-001')?.status,
    ).toBe('WARN');
    expect(step.subjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: expect.objectContaining({
            id: 'experience-selected',
          }),
          decision: expect.objectContaining({
            outcome: 'SELECTED',
          }),
          facts: expect.objectContaining({
            dayNumber: 1,
            order: 1,
            duration: {
              minutes: 120,
              provenance: {
                source: 'LEGACY_EXPERIENCE_DURATION',
                evidenceBacked: false,
              },
            },
            openingHours: {
              status: 'UNKNOWN',
              provenance: {
                source: 'LEGACY_EXPERIENCE_OPENING_HOURS',
                evidenceBacked: false,
              },
            },
          }),
        }),
        expect.objectContaining({
          subject: expect.objectContaining({ id: 'experience-invalid' }),
          decision: expect.objectContaining({
            outcome: 'INPUT_ERROR',
            reasonCodes: ['INVALID_SPATIAL_FOOTPRINT'],
          }),
        }),
        expect.objectContaining({
          subject: expect.objectContaining({
            id: 'experience-without-duration',
          }),
          decision: expect.objectContaining({
            status: 'SKIPPED',
            outcome: 'NOT_PLANNING_READY',
            reasonCodes: ['MISSING_REQUIRED_DURATION'],
          }),
        }),
        expect.objectContaining({
          subject: expect.objectContaining({
            id: 'experience-rejected',
          }),
          decision: expect.objectContaining({
            outcome: 'UNSELECTED',
            reasonCodes: ['DAILY_TIME_CAPACITY_EXCEEDED'],
          }),
        }),
      ]),
    );
  });
});
