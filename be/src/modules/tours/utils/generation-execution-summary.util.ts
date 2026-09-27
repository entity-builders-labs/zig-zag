import {
  GenerationExecutionStageSummary,
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
  const orderedStages: GenerationExecutionStageSummary[] = input.steps.map(
    (step, index) => ({
      ordinal: index + 1,
      stage: step.stage,
      status: step.status ?? step.decision?.status ?? 'INFO',
      component: step.component,
      outcome: step.decision?.outcome,
      summary: step.summary,
      counts: numericCounts(step.outputs),
    }),
  );

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

  // Roll up the canonical multi-source acquisition loop from its steps
  // (component === 'ExperienceAcquisitionService', emitted once per pass).
  const acquisitionSteps = input.steps.filter(
    (step) => step.component === 'ExperienceAcquisitionService',
  );
  let acquisition: GenerationTraceExecutionSummary['acquisition'];
  if (acquisitionSteps.length > 0) {
    const providersAttempted = new Set<string>();
    const providersFailed = new Set<string>();
    let observationCount = 0;
    let structuredCandidateCount = 0;
    let webCandidateCount = 0;
    for (const step of acquisitionSteps) {
      const out = (step.outputs ?? {}) as Record<string, any>;
      observationCount += Number(out.observationCount) || 0;
      structuredCandidateCount += Number(out.structuredCandidateCount) || 0;
      webCandidateCount += Number(out.webCandidateCount) || 0;
      for (const entry of out.structuredProviders ?? []) {
        providersAttempted.add(entry.provider);
        if (entry.status === 'failed') providersFailed.add(entry.provider);
      }
      for (const web of out.webResults ?? []) {
        // RW3-F2: name the grounded provider actually attempted/failed
        // (serper, serpapi, ...); fall back to the generic capability
        // label only when the result never recorded one.
        const webProvider = web.groundedProvider ?? 'web';
        providersAttempted.add(webProvider);
        if (web.status === 'failed') providersFailed.add(webProvider);
      }
    }
    const planningStep = input.steps.find(
      (step) => step.stage === 'daily_planning',
    );
    acquisition = {
      passes: acquisitionSteps.length,
      providersAttempted: [...providersAttempted].sort(),
      providersFailed: [...providersFailed].sort(),
      observationCount,
      structuredCandidateCount,
      webCandidateCount,
      approximateRouting: (planningStep as any)?.dailyPlanning
        ?.approximateTravel,
    };
  }

  return {
    status: input.status,
    orderedStages,
    acceptedExperiences: input.acceptedExperiences,
    rejectedProposals: input.rejectedProposals,
    selectedExperiences: materialized.length,
    acquisition,
    failure: input.failure,
  };
}
