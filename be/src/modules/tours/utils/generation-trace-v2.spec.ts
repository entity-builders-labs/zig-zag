import { buildDailyPlanningStep } from './generation-trace-builder.util';
import { DailyPlanningSolution } from '../interfaces/daily-planning.interface';

describe('GenerationTrace V2 audit contract', () => {
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

    const step = buildDailyPlanningStep(solution);

    expect(step.component).toBe('GreedyCapacitatedDailyPlanningSolver');
    expect(step.decision?.outcome).toBe('DAILY_PLAN_BUILT');
    expect(
      step.rules?.find((rule) => rule.ruleId === 'PLAN-TRAVEL-001')?.result,
    ).toBe('WARN');
    expect(step.candidateDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'experience-selected',
          status: 'SELECTED',
          dayNumber: 1,
          order: 1,
        }),
        expect.objectContaining({
          id: 'experience-rejected',
          status: 'UNSELECTED',
          reasonCodes: ['DAILY_TIME_CAPACITY_EXCEEDED'],
        }),
      ]),
    );
  });
});
