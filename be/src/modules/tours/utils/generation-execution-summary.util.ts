import {
  GenerationTraceExecutionSummary,
  GenerationTraceStep,
  MaterializedTourExperienceTrace,
} from '../interfaces/generation-trace.interface';

interface BuildExecutionSummaryInput {
  status: 'completed' | 'failed';
  steps: GenerationTraceStep[];
  materializedTourExperiences?: MaterializedTourExperienceTrace[];
  acceptedExperiences?: number;
  rejectedProposals?: number;
  failure?: string;
}

function numericCounts(outputs: Record<string, unknown> | undefined) {
  if (!outputs) return undefined;
  const counts = Object.fromEntries(
    Object.entries(outputs).filter(([, value]) => typeof value === 'number'),
  ) as Record<string, number>;
  return Object.keys(counts).length > 0 ? counts : undefined;
}

export function buildGenerationExecutionSummary(
  input: BuildExecutionSummaryInput,
): GenerationTraceExecutionSummary {
  const orderedStages = input.steps.map((step, index) => ({
    ordinal: index + 1,
    stage: step.stage,
    status: step.status ?? step.decision?.status ?? 'INFO',
    component: step.component,
    outcome: step.decision?.outcome,
    summary: step.summary,
    counts: numericCounts(step.outputs),
  }));

  const materialized = input.materializedTourExperiences ?? [];
  if (materialized.length > 0) {
    orderedStages.push({
      ordinal: orderedStages.length + 1,
      stage: 'tour_experience_materialization',
      status: 'PASS',
      component: 'Prisma.TourExperience',
      outcome: 'TOUR_EXPERIENCES_PERSISTED',
      summary: `${materialized.length} TourExperience snapshot(s) persistidos desde Experience verificadas.`,
      counts: {
        selectedExperiences: materialized.length,
        componentSnapshots: materialized.reduce(
          (sum, item) => sum + item.componentCount,
          0,
        ),
      },
    });
  }

  const summaries = orderedStages.map((stage) => stage.summary);
  return {
    status: input.status,
    orderedStages,
    steps: summaries,
    narrative: orderedStages
      .map((stage) => `${stage.ordinal}. ${stage.summary}`)
      .join('\n'),
    acceptedExperiences: input.acceptedExperiences,
    rejectedProposals: input.rejectedProposals,
    selectedExperiences: materialized.length,
    failure: input.failure,
  };
}
