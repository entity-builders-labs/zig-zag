import { GenerationTraceRecorder } from '../generation-trace-recorder.util';
import {
  TraceJsonValue,
  TraceStepV5,
} from '../../interfaces/generation-trace-v5.interface';
import { TourGenerationRequest } from '../../interfaces/tour-generation.interface';
import { CompositionSelectionResult } from '../../interfaces/preference-spec.interface';
import { CandidateScoreBreakdown } from '../candidate-ranking.util';
import { DailyPlanningSolution } from '../../interfaces/daily-planning.interface';
import { TourCompletenessResult } from '../../interfaces/tour-completeness.interface';

export interface CandidatePoolExperienceItem {
  id: string;
  canonicalName?: string;
  name?: string;
  qualityScore?: number | null;
}

export interface CandidatePoolSelectionStepInput {
  selection: {
    initialExperiences: CandidatePoolExperienceItem[];
    reservoirExperiences: CandidatePoolExperienceItem[];
    compositionResult: CompositionSelectionResult;
    scoreBreakdownById: Map<string, CandidateScoreBreakdown>;
  };
  request: TourGenerationRequest;
  initialCatalogCount: number;
  postAcquisitionCatalogCount: number;
  eligibleCount: number;
  discoveryResolvedExperienceIds: Set<string>;
  newlyAcquiredExperienceIds: Set<string>;
  crawlProvider?: 'google' | 'geoapify';
}

export function recordCandidatePoolSelectionStep(
  recorder: GenerationTraceRecorder,
  input: CandidatePoolSelectionStepInput,
): TraceStepV5 {
  const {
    selection,
    request,
    initialCatalogCount,
    postAcquisitionCatalogCount,
    eligibleCount,
    discoveryResolvedExperienceIds,
    newlyAcquiredExperienceIds,
    crawlProvider,
  } = input;

  const allOffered = [
    ...selection.initialExperiences,
    ...selection.reservoirExperiences,
  ];
  const bySource = { catalog: 0, refill: 0, discovery: 0 };
  for (const exp of allOffered) {
    if (discoveryResolvedExperienceIds.has(exp.id)) {
      bySource.discovery++;
    } else if (newlyAcquiredExperienceIds.has(exp.id)) {
      bySource.refill++;
    } else {
      bySource.catalog++;
    }
  }

  const selectedSet = new Set(selection.initialExperiences.map((e) => e.id));
  const reservoirSet = new Set(selection.reservoirExperiences.map((e) => e.id));

  return recorder.record({
    name: 'candidate_pool.selection',
    description: `Ranking y selección de experiencias (${allOffered.length} ofrecidas: ${bySource.catalog} catálogo, ${bySource.refill} adquisición, ${bySource.discovery} discovery).`,
    component: 'CandidateSelectionService',
    decision: {
      status: 'PASS',
      outcome: 'EXPERIENCE_POOL_RANKED',
    },
    input: {
      initialCatalogCount,
      postAcquisitionCatalogCount,
      eligibleCount,
      requestedThemes: request.intent.interests,
      portfolioTarget: selection.compositionResult?.portfolioTarget,
    },
    output: {
      offeredCount: allOffered.length,
      selectedCount: selection.initialExperiences.length,
      reservoirCount: selection.reservoirExperiences.length,
    },
    facts: {
      initialCatalogCount,
      postAcquisitionCatalogCount,
      eligibleCount,
      bySource,
      portfolioTarget: selection.compositionResult?.portfolioTarget,
    },
    rules: [
      {
        id: 'EXPERIENCE-RANK-001',
        name: 'Ordenar Experiences por relevancia semántica y calidad',
        status: 'PASS',
        reason:
          'El ranking determinístico consume únicamente Experiences verificadas.',
        facts: { candidateCount: allOffered.length },
      },
    ],
    subjects: allOffered.map((exp: CandidatePoolExperienceItem) => {
      const isSelected = selectedSet.has(exp.id);
      const isReservoir = reservoirSet.has(exp.id);
      const scoreBreakdown = selection.scoreBreakdownById.get(exp.id);
      const traceSource = discoveryResolvedExperienceIds.has(exp.id)
        ? 'discovery'
        : newlyAcquiredExperienceIds.has(exp.id)
          ? crawlProvider === 'google'
            ? 'google_places'
            : 'geoapify'
          : 'db';
      return {
        subject: {
          kind: 'experience',
          id: exp.id,
          label: exp.canonicalName ?? exp.name,
        },
        decision: {
          status: isSelected ? ('PASS' as const) : ('INFO' as const),
          outcome: isSelected
            ? 'SELECTED'
            : isReservoir
              ? 'RESERVOIR'
              : 'OFFERED',
          reason: scoreBreakdown
            ? `Score total ${scoreBreakdown.totalScore.toFixed(3)}`
            : undefined,
        },
        facts: {
          source: traceSource,
          scoreBreakdown,
        },
      };
    }),
  });
}

export interface SemanticRankingOutcome {
  status:
    | 'EMBEDDINGS_MATCHED'
    | 'NO_INDEX'
    | 'FALLBACK_KEYWORD'
    | 'NO_QUERY'
    | 'applied'
    | 'unavailable'
    | 'not_requested';
  indexedCandidateCount?: number;
  eligibleCandidateCount?: number;
  identity?: unknown;
  model?: string;
  reason?: string;
}

export function recordSemanticRankingStep(
  recorder: GenerationTraceRecorder,
  input: {
    semanticRankingOutcome: SemanticRankingOutcome;
    candidateCount: number;
  },
): TraceStepV5 {
  const { semanticRankingOutcome, candidateCount } = input;
  const status = semanticRankingOutcome?.status ?? 'not_requested';
  return recorder.record({
    name: 'ranking.semantic',
    description:
      status === 'applied'
        ? `Ranking semántico aplicado sobre ${semanticRankingOutcome.eligibleCandidateCount ?? candidateCount} candidato(s) elegible(s).`
        : status === 'unavailable'
          ? `Ranking semántico no disponible: ${semanticRankingOutcome.reason || 'proveedor no disponible'}.`
          : 'Ranking semántico no solicitado para esta intención.',
    component: 'VectorStoreService + pgvector',
    decision: {
      status: status === 'unavailable' ? 'WARN' : 'PASS',
      outcome: status.toUpperCase(),
      reason: semanticRankingOutcome?.reason,
    },
    facts: {
      status,
      candidateCount,
      model: semanticRankingOutcome?.model,
      identity: semanticRankingOutcome?.identity,
      eligibleCandidateCount: semanticRankingOutcome?.eligibleCandidateCount,
      indexedCandidateCount: semanticRankingOutcome?.indexedCandidateCount,
    },
    rules: [
      {
        id: 'RANK-SEMANTIC-001',
        name: 'Usar similitud semántica solo cuando fue solicitada y está disponible',
        status:
          status === 'unavailable'
            ? 'WARN'
            : status === 'not_requested'
              ? 'SKIPPED'
              : 'PASS',
        reason:
          status === 'applied'
            ? 'Similitud semántica calculada y agregada al score.'
            : status === 'unavailable'
              ? 'El vector store o embedding provider no estuvo disponible.'
              : 'No se requirió similitud semántica.',
      },
    ],
  });
}

export function recordDailyPlanningStep(
  recorder: GenerationTraceRecorder,
  input: {
    planningSolution: DailyPlanningSolution;
  },
): TraceStepV5 {
  const { planningSolution } = input;
  const selectedCount = planningSolution.days.reduce(
    (sum, day) => sum + day.experiences.length,
    0,
  );
  return recorder.record({
    name: 'planning.daily',
    description: `Solver ${planningSolution.metadata.solver} planificó ${planningSolution.days.length} día(s): ${selectedCount} Experience(s) seleccionada(s), ${planningSolution.unselected.length} sin seleccionar.`,
    component: planningSolution.metadata.solver,
    decision: {
      status: selectedCount ? 'PASS' : 'FAIL',
      outcome: selectedCount ? 'DAILY_PLAN_BUILT' : 'PLANNING_FAILED',
      reason: selectedCount
        ? 'Itinerario factible construido con las restricciones de tiempo y ritmo.'
        : 'No se pudo construir un itinerario factible.',
    },
    input: {
      solver: planningSolution.metadata.solver,
      approximateTravel: planningSolution.metadata.approximateTravel,
      iterations: planningSolution.metadata.iterations ?? null,
    },
    output: {
      dayCount: planningSolution.days.length,
      selectedCount,
      unselectedCount: planningSolution.unselected.length,
      score: planningSolution.score,
    },
    facts: {
      solver: planningSolution.metadata.solver,
      approximateTravel: planningSolution.metadata.approximateTravel,
      iterations: planningSolution.metadata.iterations,
      score: planningSolution.score,
      routing: planningSolution.metadata.routing,
      days: planningSolution.days.map((d) => ({
        dayNumber: d.dayNumber,
        experienceCount: d.experiences.length,
        totalExperienceMinutes: d.totalExperienceMinutes,
        totalTravelMinutes: d.totalTravelMinutes,
        totalWalkingMinutes: d.totalWalkingMinutes,
        utilizationMinutes: d.utilizationMinutes,
      })),
      unselectedCount: planningSolution.unselected.length,
    },
    rules: [
      {
        id: 'PLAN-DAYS-001',
        name: 'Mantener exactamente los buckets de días solicitados por el planner',
        status: 'PASS',
        reason: `El solver devolvió ${planningSolution.days.length} bucket(s) de día.`,
        facts: { dayCount: planningSolution.days.length },
      },
      {
        id: 'PLAN-FEASIBILITY-001',
        name: 'No seleccionar candidatos que el solver haya marcado como no factibles',
        status: 'PASS',
        reason: `${planningSolution.unselected.length} candidato(s) quedaron fuera con reason codes explícitos.`,
        facts: { unselectedCount: planningSolution.unselected.length },
      },
      {
        id: 'PLAN-TRAVEL-001',
        name: 'Declarar si las estimaciones de traslado son aproximadas',
        status: planningSolution.metadata.approximateTravel ? 'WARN' : 'PASS',
        reason: planningSolution.metadata.approximateTravel
          ? 'Los tiempos/distancias usados por el solver son aproximados.'
          : 'El solver informa estimaciones de traslado no aproximadas.',
        facts: {
          approximateTravel: planningSolution.metadata.approximateTravel,
        },
      },
    ],
    subjects: [
      ...planningSolution.days.flatMap((day) =>
        day.experiences.map((experience, order) => ({
          subject: { kind: 'experience', id: experience.experienceId },
          decision: {
            status: 'PASS' as const,
            outcome: 'SELECTED',
            reason: `Asignada al día ${day.dayNumber} en posición ${order + 1}; pasó la factibilidad del solver.`,
            reasonCodes: ['FEASIBLE_AND_SELECTED'],
          },
          facts: {
            dayNumber: day.dayNumber,
            order: order + 1,
            startMinutes: experience.startMinutesFromMidnight,
            endMinutes: experience.endMinutesFromMidnight,
          },
        })),
      ),
      ...planningSolution.unselected.map((candidate) => ({
        subject: { kind: 'experience', id: candidate.experienceId },
        decision: {
          status: 'FAIL' as const,
          outcome: 'UNSELECTED',
          reason: candidate.reasons.join(', '),
          reasonCodes: candidate.reasons,
        },
        facts: {
          reasons: candidate.reasons,
          ...(candidate.walkingDiagnostics
            ? { walkingDiagnostics: candidate.walkingDiagnostics }
            : {}),
        },
      })),
    ],
  });
}

export function recordTourCompletenessStep(
  recorder: GenerationTraceRecorder,
  input: {
    completeness: TourCompletenessResult;
    retryAttempted: boolean;
  },
): TraceStepV5 {
  const { completeness, retryAttempted } = input;
  const reasonCodes = Array.from(
    new Set(completeness.issues.map((i) => i.code)),
  );
  return recorder.record({
    name: 'tour.completeness',
    description: completeness.complete
      ? 'El itinerario generado hace un uso razonable de los días solicitados.'
      : `Observaciones de completitud: ${completeness.issues.map((i) => i.code).join(', ')}.`,
    component: 'TourCompletenessValidator',
    decision: {
      status: completeness.complete ? 'PASS' : 'WARN',
      outcome: completeness.complete ? 'TOUR_COMPLETE' : 'TOUR_UNDERFILLED',
      reason: completeness.complete
        ? 'La política de completitud no detectó déficit accionable.'
        : 'Existen días que podrían estar mejor utilizados, o formatos pedidos sin cubrir.',
      reasonCodes,
    },
    input: { retryAttempted },
    output: {
      complete: completeness.complete,
      issueCount: completeness.issues.length,
      issues: completeness.issues,
    },
    facts: {
      ...completeness,
      retryAttempted,
    },
    rules: [
      {
        id: 'COMP-DAY-USAGE-001',
        name: 'Cada día debe tener un uso razonable cuando existen candidatos viables',
        status: completeness.complete ? 'PASS' : 'WARN',
        reason: completeness.complete
          ? 'No se detectaron días subutilizados con alternativas viables.'
          : completeness.issues.map((i) => i.message).join(' '),
      },
      ...completeness.issues.map((issue) => ({
        id: issue.code,
        name: issue.code,
        status: 'WARN' as const,
        reason: issue.message,
        facts: issue as unknown as TraceJsonValue,
      })),
    ],
  });
}

export interface MaterializedTourExperienceFact {
  experienceId: string;
  dayNumber: number;
  order: number;
  startTime?: string;
  durationHours: number;
  componentCount: number;
}

export function recordTourMaterializationStep(
  recorder: GenerationTraceRecorder,
  input: {
    tourId: string;
    materializedTourExperiences: MaterializedTourExperienceFact[];
  },
): TraceStepV5 {
  const { tourId, materializedTourExperiences } = input;
  return recorder.record({
    name: 'tour.materialization',
    description: `${materializedTourExperiences.length} TourExperience snapshot(s) persistidos desde Experiences verificadas.`,
    component: 'Prisma.TourExperience',
    decision: {
      status: 'PASS',
      outcome: 'TOUR_EXPERIENCES_PERSISTED',
    },
    facts: {
      tourId,
      materializedCount: materializedTourExperiences.length,
      experiences: materializedTourExperiences,
    },
    subjects: materializedTourExperiences.map((item) => ({
      subject: { kind: 'experience', id: item.experienceId },
      decision: { status: 'PASS', outcome: 'PERSISTED' },
      facts: item,
    })),
  });
}
