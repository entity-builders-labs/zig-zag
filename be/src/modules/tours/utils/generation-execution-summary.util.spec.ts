import { buildGenerationExecutionSummary } from './generation-execution-summary.util';
import { GenerationTraceStep } from '../interfaces/generation-trace.interface';

function step(
  stage: GenerationTraceStep['stage'],
  summary: string,
  outputs?: Record<string, unknown>,
): GenerationTraceStep {
  return {
    stage,
    label: stage,
    summary,
    component: `component:${stage}`,
    status: 'PASS',
    decision: {
      status: 'PASS',
      outcome: `OUTCOME_${stage}`,
      reason: 'test',
    },
    outputs,
  };
}

describe('buildGenerationExecutionSummary', () => {
  it('persists ordered machine-readable stages and materialization counts', () => {
    const result = buildGenerationExecutionSummary({
      status: 'completed',
      steps: [
        step('db_search', 'catalog', { candidateCount: 320 }),
        step('coverage_analysis', 'coverage', { relevantCandidateCount: 25 }),
        step('daily_planning', 'planner', { selectedCount: 10 }),
      ],
      materializedTourExperiences: [
        {
          experienceId: 'exp-1',
          dayNumber: 1,
          order: 1,
          durationHours: 1,
          componentCount: 2,
        },
        {
          experienceId: 'exp-2',
          dayNumber: 1,
          order: 2,
          durationHours: 1,
          componentCount: 1,
        },
      ],
      acceptedExperiences: 2,
      rejectedProposals: 3,
    });

    expect(result.orderedStages.map((item) => item.stage)).toEqual([
      'db_search',
      'coverage_analysis',
      'daily_planning',
      'tour_experience_materialization',
    ]);
    expect(result.orderedStages[0].counts).toEqual({ candidateCount: 320 });
    expect(result.orderedStages[3].counts).toEqual({
      selectedExperiences: 2,
      componentSnapshots: 3,
    });
    expect(result.selectedExperiences).toBe(2);
    expect(result.narrative).toContain('4. 2 TourExperience snapshot');
  });

  it('records geographic validation as its own ordered execution stage', () => {
    const result = buildGenerationExecutionSummary({
      status: 'completed',
      steps: [
        step('entity_resolution', 'components resolved', { resolvedCount: 2 }),
        step('geographic_validation', 'geography validated', {
          acceptedCount: 1,
          rejectedCount: 1,
        }),
        step('catalog_materialization', 'experience persisted', {
          persistedCount: 1,
        }),
      ],
    });

    expect(result.orderedStages.map((item) => item.stage)).toEqual([
      'entity_resolution',
      'geographic_validation',
      'catalog_materialization',
    ]);
    expect(result.orderedStages[1]).toEqual(
      expect.objectContaining({
        stage: 'geographic_validation',
        outcome: 'OUTCOME_geographic_validation',
        counts: {
          acceptedCount: 1,
          rejectedCount: 1,
        },
      }),
    );
    expect(result.narrative).toContain('2. geography validated');
  });

  it('keeps failed executions structured without inventing materialization', () => {
    const result = buildGenerationExecutionSummary({
      status: 'failed',
      steps: [step('coverage_analysis', 'coverage failed')],
      failure: 'missing_requested_theme',
    });

    expect(result.status).toBe('failed');
    expect(result.failure).toBe('missing_requested_theme');
    expect(result.orderedStages).toHaveLength(1);
    expect(result.selectedExperiences).toBe(0);
  });
});
