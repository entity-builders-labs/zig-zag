import {
  GenerationExecutionStageSummary,
  GenerationTraceExecutionSummary,
  GenerationTraceStep,
  MaterializedTourExperienceTrace,
} from '../interfaces/generation-trace.interface';
import { redactTracePayload } from './trace-redaction.util';

export const GENERATION_TRACE_VERSION = 3 as const;

function numericCounts(step: GenerationTraceStep): Record<string, number> | undefined {
  const values = Object.entries(step.outputs ?? {}).filter(
    ([, value]) => typeof value === 'number' && Number.isFinite(value),
  ) as Array<[string, number]>;
  return values.length ? Object.fromEntries(values) : undefined;
}

export function buildOrderedExecutionStages(
  steps: GenerationTraceStep[],
  materialized?: MaterializedTourExperienceTrace[],
): GenerationExecutionStageSummary[] {
  const ordered = steps.map((step, index) => ({
    ordinal: index + 1,
    stage: step.stage,
    status: step.status ?? step.decision?.status ?? 'INFO',
    component: step.component,
    outcome: step.decision?.outcome,
    summary: step.summary,
    counts: numericCounts(step),
  }));
  if (materialized) {
    ordered.push({
      ordinal: ordered.length + 1,
      stage: 'tour_experience_materialization',
      status: materialized.length ? 'PASS' : 'WARN',
      component: 'TourExperienceRepository',
      outcome: materialized.length
        ? 'TOUR_EXPERIENCES_PERSISTED'
        : 'NO_TOUR_EXPERIENCES_PERSISTED',
      summary: `${materialized.length} TourExperience snapshot(s) persisted from verified Experience identities.`,
      counts: { materializedTourExperienceCount: materialized.length },
    });
  }
  return ordered;
}

export function buildExecutionSummary(params: {
  status: 'completed' | 'failed';
  steps: GenerationTraceStep[];
  materialized?: MaterializedTourExperienceTrace[];
  acceptedExperiences?: number;
  rejectedProposals?: number;
  selectedExperiences?: number;
  failure?: string;
}): GenerationTraceExecutionSummary {
  const orderedStages = buildOrderedExecutionStages(
    params.steps,
    params.materialized,
  );
  return {
    status: params.status,
    orderedStages,
    steps: orderedStages.map((stage) => stage.summary),
    narrative: orderedStages
      .map((stage) => `${stage.ordinal}. ${stage.summary}`)
      .join('\n'),
    acceptedExperiences: params.acceptedExperiences,
    rejectedProposals: params.rejectedProposals,
    selectedExperiences: params.selectedExperiences,
    failure: params.failure,
  };
}

export function buildGenerationTraceV3(params: {
  canonicalRequest: unknown;
  steps: GenerationTraceStep[];
  tourCompleteness?: unknown;
  materializedTourExperiences?: MaterializedTourExperienceTrace[];
  executionSummary?: GenerationTraceExecutionSummary;
}) {
  return redactTracePayload({
    version: GENERATION_TRACE_VERSION,
    canonicalRequest: params.canonicalRequest,
    steps: params.steps,
    tourCompleteness: params.tourCompleteness,
    hallucinatedCount: 0,
    duplicateCount: 0,
    materializedTourExperiences: params.materializedTourExperiences,
    executionSummary: params.executionSummary,
  });
}
