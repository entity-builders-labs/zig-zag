import { GenerationTraceRecorder } from './generation-trace-recorder.util';
import { recordDailyPlanningStep } from './experience-generation-trace.util';
import { DailyPlanningSolution } from '../interfaces/daily-planning.interface';

describe('GenerationTrace daily planning audit contract', () => {
  it('records selected and unselected planner candidates with real rejection reason codes', () => {
    const solution: DailyPlanningSolution = {
      days: [
        {
          dayNumber: 1,
          experiences: [
            {
              experienceId: 'experience-selected',
              startMinutesFromMidnight: 540,
              endMinutesFromMidnight: 660,
            },
          ],
          totalExperienceMinutes: 120,
          totalTravelMinutes: 0,
          totalWalkingMinutes: 0,
          utilizationMinutes: 120,
        },
      ],
      unselected: [
        {
          experienceId: 'experience-rejected',
          reasons: ['DAILY_TIME_CAPACITY_EXCEEDED'],
        },
      ],
      score: 0.9,
      metadata: {
        solver: 'GreedyCapacitatedDailyPlanningSolver',
        approximateTravel: true,
      },
    };

    const recorder = new GenerationTraceRecorder();
    recordDailyPlanningStep(recorder, { planningSolution: solution });
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
