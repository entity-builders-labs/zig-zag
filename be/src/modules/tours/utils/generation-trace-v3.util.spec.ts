import {
  buildExecutionSummary,
  buildGenerationTraceV3,
  buildOrderedExecutionStages,
} from './generation-trace-v3.util';
import { GenerationTraceStep } from '../interfaces/generation-trace.interface';

const steps: GenerationTraceStep[] = [
  {
    stage: 'db_search',
    label: 'catalog',
    summary: 'catalog → 300 candidates',
    component: 'ExperienceCatalog',
    status: 'PASS',
    outputs: { candidateCount: 300 },
    decision: {
      status: 'PASS',
      outcome: 'CATALOG_POOL_AVAILABLE',
      reason: 'catalog reuse',
    },
  },
  {
    stage: 'daily_planning',
    label: 'planner',
    summary: 'planner selected 8',
    component: 'DeterministicSolver',
    status: 'PASS',
    outputs: { selectedCount: 8 },
  },
];

describe('GenerationTrace V3', () => {
  it('persists a deterministic ordered execution summary plus materialization', () => {
    const materialized = [
      {
        experienceId: 'exp-1',
        dayNumber: 1,
        order: 1,
        durationHours: 1,
        componentCount: 2,
      },
    ];
    const ordered = buildOrderedExecutionStages(steps, materialized);
    expect(ordered.map((stage) => stage.stage)).toEqual([
      'db_search',
      'daily_planning',
      'tour_experience_materialization',
    ]);
    expect(ordered[0].counts).toEqual({ candidateCount: 300 });

    const summary = buildExecutionSummary({
      status: 'completed',
      steps,
      materialized,
      selectedExperiences: 1,
    });
    expect(summary.orderedStages).toHaveLength(3);
    expect(summary.narrative).toContain('3. 1 TourExperience snapshot');
  });

  it('redacts secrets while retaining exact non-secret canonical request evidence', () => {
    const trace = buildGenerationTraceV3({
      canonicalRequest: {
        destination: { label: 'Mendoza' },
        intent: { additionalPreferences: 'vegan wine experience' },
        apiKey: 'super-secret',
      },
      steps: [
        {
          ...steps[0],
          inputs: {
            query: 'Mendoza vegan wine experience',
            authorization: 'Bearer secret-token',
          },
        },
      ],
    }) as any;

    expect(trace.version).toBe(3);
    expect(trace.canonicalRequest.destination.label).toBe('Mendoza');
    expect(trace.canonicalRequest.apiKey).toBe('[REDACTED]');
    expect(trace.steps[0].inputs.query).toBe('Mendoza vegan wine experience');
    expect(trace.steps[0].inputs.authorization).toBe('[REDACTED]');
  });

  it('records failure in the same ordered schema instead of a separate ad-hoc shape', () => {
    const summary = buildExecutionSummary({
      status: 'failed',
      steps,
      failure: 'provider timeout',
    });
    expect(summary.status).toBe('failed');
    expect(summary.failure).toBe('provider timeout');
    expect(summary.orderedStages[0].ordinal).toBe(1);
  });
});
