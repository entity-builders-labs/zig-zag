import {
  buildCoverageAnalysisStep,
  buildDailyPlanningStep,
} from './generation-trace-builder.util';
import { CoverageReport } from '../interfaces/coverage-analysis.interface';
import { DailyPlanningSolution } from '../interfaces/daily-planning.interface';

describe('GenerationTrace V2 audit contract', () => {
  it('explains why coverage is insufficient with stable rule ids and next action', () => {
    const report: CoverageReport = {
      status: 'insufficient',
      analyzedCandidateCount: 11,
      eligibleCandidateCount: 11,
      offeredCandidateCount: 11,
      usableCandidateCount: 11,
      requiredCandidateCount: 9,
      requestedThemeCoverage: [
        { theme: 'nature', matchedCandidateCount: 0, strongMatchCount: 0 },
      ],
      kindCoverage: [{ kind: 'POI' as any, count: 11 }],
      sourceCoverage: [{ source: 'geoapify', count: 11 }],
      geographicCoverage: { distinctClusterCount: 2, thresholdKilometers: 1.5 },
      semanticCoverage: {
        status: 'applied',
        eligibleCandidateCount: 11,
        indexedCandidateCount: 11,
      },
      destinationKnowledge: {
        status: 'unprofiled',
        deployableBoundary: 'catalog_quality_only_until_pr7',
        reason: 'not profiled',
      },
      providerHealth: { status: 'healthy' },
      deficits: [
        {
          reason: 'missing_requested_theme',
          severity: 'blocking',
          theme: 'nature',
          expectedCount: 1,
          actualCount: 0,
          message: 'No candidate covers requested nature theme.',
        },
      ],
      decision: {
        action: 'defer_to_pr7_grounded_gap',
        reason: 'qualitative_gap_requires_activity_discovery',
        deployableInPr6: false,
        deficits: [
          {
            reason: 'missing_requested_theme',
            severity: 'blocking',
            theme: 'nature',
            expectedCount: 1,
            actualCount: 0,
            message: 'No candidate covers requested nature theme.',
          },
        ],
      },
    };

    const step = buildCoverageAnalysisStep(report);

    expect(step.component).toBe('CoverageAnalyzer');
    expect(step.status).toBe('FAIL');
    expect(step.decision?.outcome).toBe('defer_to_pr7_grounded_gap');
    expect(step.decision?.triggeredActions).toContain('RUN_GROUNDED_DISCOVERY');
    expect(
      step.rules?.find((rule) => rule.ruleId === 'COV-QUANTITY-001')?.result,
    ).toBe('PASS');
    expect(
      step.rules?.find((rule) => rule.ruleId === 'COV-THEME-NATURE')?.result,
    ).toBe('FAIL');
    expect(step.decision?.reasonCodes).toContain('missing_requested_theme');
  });

  it('records selected and unselected planner candidates with real rejection reason codes', () => {
    const solution: DailyPlanningSolution = {
      days: [
        {
          dayNumber: 1,
          activities: [
            {
              activityId: 'activity-selected',
              startMinutesFromMidnight: 540,
              endMinutesFromMidnight: 660,
            },
          ],
          totalActivityMinutes: 120,
          totalTravelMinutes: 0,
          totalWalkingMinutes: 0,
          utilizationMinutes: 120,
        },
      ],
      unselected: [
        {
          activityId: 'activity-rejected',
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
          id: 'activity-selected',
          status: 'SELECTED',
          dayNumber: 1,
          order: 1,
        }),
        expect.objectContaining({
          id: 'activity-rejected',
          status: 'UNSELECTED',
          reasonCodes: ['DAILY_TIME_CAPACITY_EXCEEDED'],
        }),
      ]),
    );
  });
});
