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
    expect(result.orderedStages[3].summary).toContain(
      '2 TourExperience snapshot',
    );
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
    expect(result.orderedStages[1].summary).toBe('geography validated');
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

  it('rolls up the multi-source acquisition loop from its per-pass steps', () => {
    const acqStep = (pass: number, outputs: Record<string, unknown>) => ({
      ...step('discovery', `pase ${pass}`, outputs),
      component: 'ExperienceAcquisitionService',
    });
    const result = buildGenerationExecutionSummary({
      status: 'completed',
      steps: [
        acqStep(1, {
          observationCount: 3,
          structuredCandidateCount: 2,
          webCandidateCount: 1,
          structuredProviders: [
            { provider: 'wikivoyage', status: 'success' },
            { provider: 'osm', status: 'failed' },
          ],
          webResults: [{ status: 'success' }],
        }),
        acqStep(2, {
          observationCount: 1,
          structuredCandidateCount: 1,
          webCandidateCount: 0,
          structuredProviders: [
            { provider: 'google_places', status: 'success' },
          ],
          webResults: [],
        }),
        {
          ...step('daily_planning', 'planned'),
          dailyPlanning: { approximateTravel: true },
        } as any,
      ],
    });

    expect(result.acquisition).toEqual({
      passes: 2,
      providersAttempted: ['google_places', 'osm', 'web', 'wikivoyage'],
      providersFailed: ['osm'],
      observationCount: 4,
      structuredCandidateCount: 3,
      webCandidateCount: 1,
      approximateRouting: true,
    });
  });

  it('omits the acquisition roll-up when acquisition never ran (catalog-first)', () => {
    const result = buildGenerationExecutionSummary({
      status: 'completed',
      steps: [
        step('coverage_analysis', 'coverage none'),
        step('daily_planning', 'planned'),
      ],
    });
    expect(result.acquisition).toBeUndefined();
  });
});
