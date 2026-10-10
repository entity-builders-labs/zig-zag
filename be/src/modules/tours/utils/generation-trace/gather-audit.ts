import { GenerationTraceRecorder } from '../generation-trace-recorder.util';
import { TraceStepV5 } from '../../interfaces/generation-trace-v5.interface';
import { FinalExperienceResolutionResponse } from '../../interfaces/experience-resolution.interface';
import { DailyPlanningSolution } from '../../interfaces/daily-planning.interface';
import { CandidateScoreBreakdown } from '../candidate-ranking.util';

/**
 * Trace producers for the GATHER → RECONCILE → FREEZE → PLAN boundary of one
 * generation. They make the sequence
 *
 *   INITIAL_CATALOG_SNAPSHOT → ACQUISITION_DEFICITS → GATHER_START →
 *   source-plan executions + RECONCILIATION outcomes → (PROVISIONAL plan →
 *   PLANNER_CAPACITY acquisition)* → GATHER_COMPLETE →
 *   FINAL_CATALOG_SNAPSHOT → FINAL_RANKING → FINAL_PLAN → FINAL_SELECTION
 *
 * observable, so "was a refill-persisted Experience considered?" is answered
 * by the trace. Audit projections only; never read by domain logic.
 */

export type CatalogSnapshotPhase = 'INITIAL' | 'GATHER' | 'FINAL';

/** One Experience of a catalog snapshot (the catalog boundary projection). */
export interface SnapshotExperienceItem {
  id: string;
  canonicalName?: string;
  name?: string;
  compositionCompleteness?: 'COMPLETE' | 'PARTIAL';
  sourceMembership?: {
    memberCount: number;
    resolvedMemberCount: number;
    navigableCount: number;
  };
}

export interface CatalogCandidateSnapshot<
  T extends SnapshotExperienceItem = SnapshotExperienceItem,
> {
  phase: CatalogSnapshotPhase;
  /** Acquisition executions completed in this generation when it was read. */
  acquisitionEpoch: number;
  /** Canonical order (by id): discovery order never leaks into planning. */
  experiences: T[];
}

export function recordCatalogSnapshotStep(
  recorder: GenerationTraceRecorder,
  snapshot: CatalogCandidateSnapshot,
): TraceStepV5 {
  const composites = snapshot.experiences.filter(
    (experience) => (experience.sourceMembership?.memberCount ?? 0) > 1,
  );
  return recorder.record({
    name: 'catalog.snapshot',
    description: `${snapshot.phase === 'FINAL' ? 'FINAL_CATALOG_SNAPSHOT' : snapshot.phase === 'INITIAL' ? 'INITIAL_CATALOG_SNAPSHOT' : 'GATHER_CATALOG_SNAPSHOT'}: ${snapshot.experiences.length} Experience(s) elegibles leídas del catálogo canónico tras ${snapshot.acquisitionEpoch} ejecución(es) de adquisición.`,
    component: 'ExperienceCatalogService',
    decision: {
      status: 'INFO',
      outcome: `${snapshot.phase}_CATALOG_SNAPSHOT`,
    },
    facts: {
      phase: snapshot.phase,
      acquisitionEpoch: snapshot.acquisitionEpoch,
      eligibleCount: snapshot.experiences.length,
      compositeCount: composites.length,
      eligibleExperienceIds: snapshot.experiences.map(
        (experience) => experience.id,
      ),
    },
    subjects: composites.map((experience) => ({
      subject: {
        kind: 'experience',
        id: experience.id,
        label: experience.canonicalName ?? experience.name,
      },
      facts: {
        completeness: experience.compositionCompleteness ?? null,
        sourceMemberCount: experience.sourceMembership?.memberCount ?? null,
        resolvedMemberCount:
          experience.sourceMembership?.resolvedMemberCount ?? null,
        navigableCount: experience.sourceMembership?.navigableCount ?? null,
      },
    })),
  });
}

/** What one acquisition execution did to the canonical catalog. */
export interface GatherExperienceOutcome {
  candidate: string;
  status: 'PERSISTED' | 'REJECTED';
  dedupeDecision: 'NEW' | 'SAME' | 'AMBIGUOUS' | null;
  experienceId: string | null;
  reconciliation: string | null;
  reasons: string[];
}

export interface GatherExecutionRecord {
  pass: number;
  workUnit: string;
  sourcePlanCount: number;
  candidateCount: number;
  outcomes: GatherExperienceOutcome[];
}

export function gatherOutcomesOf(
  resolution: FinalExperienceResolutionResponse | undefined,
): GatherExperienceOutcome[] {
  return (resolution?.resolved ?? []).map((entry) => {
    const persisted = entry.status === 'accepted' && !!entry.experienceId;
    return {
      candidate: entry.candidate?.name ?? 'unknown',
      status: persisted ? 'PERSISTED' : 'REJECTED',
      dedupeDecision:
        entry.dedupeDecision ??
        (entry.rejectionReasons.includes('AMBIGUOUS_DEDUPE')
          ? 'AMBIGUOUS'
          : null),
      experienceId: persisted ? (entry.experienceId as string) : null,
      reconciliation: entry.sourceKnowledgeReconciliation?.outcome ?? null,
      reasons: [...entry.rejectionReasons],
    };
  });
}

export function recordGatherBoundaryStep(
  recorder: GenerationTraceRecorder,
  input:
    | { boundary: 'GATHER_START'; deficitCount: number }
    | {
        boundary: 'GATHER_COMPLETE';
        executions: GatherExecutionRecord[];
        acquisitionEpoch: number;
        executedSourcePlanCount: number;
      },
): TraceStepV5 {
  if (input.boundary === 'GATHER_START') {
    return recorder.record({
      name: 'generation.gather',
      description: `GATHER_START: adquisición acotada para ${input.deficitCount} déficit(s); el catálogo puede crecer y enriquecerse hasta GATHER_COMPLETE.`,
      component: 'ExperienceGenerationService',
      decision: { status: 'INFO', outcome: 'GATHER_START' },
      facts: { boundary: 'GATHER_START', deficitCount: input.deficitCount },
    });
  }
  const outcomes = input.executions.flatMap((execution) => execution.outcomes);
  const count = (predicate: (outcome: GatherExperienceOutcome) => boolean) =>
    outcomes.filter(predicate).length;
  const affected = [
    ...new Set(
      outcomes.flatMap((outcome) =>
        outcome.experienceId ? [outcome.experienceId] : [],
      ),
    ),
  ];
  return recorder.record({
    name: 'generation.gather',
    description: `GATHER_COMPLETE (ACQUISITION_COMPLETE_FOR_GENERATION): ${input.executions.length} ejecución(es), ${outcomes.length} candidato(s) materializados; NEW ${count((o) => o.dedupeDecision === 'NEW' && o.status === 'PERSISTED')}, SAME ${count((o) => o.dedupeDecision === 'SAME' && o.status === 'PERSISTED')}, AMBIGUOUS ${count((o) => o.dedupeDecision === 'AMBIGUOUS')}, rechazados ${count((o) => o.status === 'REJECTED')}. No se espera más adquisición en esta generación.`,
    component: 'ExperienceGenerationService',
    decision: { status: 'INFO', outcome: 'GATHER_COMPLETE' },
    facts: {
      boundary: 'GATHER_COMPLETE',
      acquisitionEpoch: input.acquisitionEpoch,
      executedSourcePlanCount: input.executedSourcePlanCount,
      executionCount: input.executions.length,
      candidatesMaterialized: outcomes.length,
      newCount: count(
        (o) => o.dedupeDecision === 'NEW' && o.status === 'PERSISTED',
      ),
      sameCount: count(
        (o) => o.dedupeDecision === 'SAME' && o.status === 'PERSISTED',
      ),
      ambiguousCount: count((o) => o.dedupeDecision === 'AMBIGUOUS'),
      rejectedCount: count((o) => o.status === 'REJECTED'),
      enrichedCount: count((o) => o.reconciliation === 'ENRICHED'),
      affectedExperienceIds: affected,
    },
    subjects: input.executions.map((execution, index) => ({
      subject: {
        kind: 'acquisition_execution',
        id: `${index + 1}-${execution.workUnit.toLowerCase()}`,
        label: `pass ${execution.pass} ${execution.workUnit}`,
      },
      facts: {
        pass: execution.pass,
        workUnit: execution.workUnit,
        sourcePlanCount: execution.sourcePlanCount,
        candidateCount: execution.candidateCount,
        outcomes: execution.outcomes.map(
          (outcome) =>
            `${outcome.candidate}: ${outcome.status}${outcome.dedupeDecision ? ` ${outcome.dedupeDecision}` : ''}${outcome.experienceId ? ` ${outcome.experienceId}` : ''}${outcome.reconciliation ? ` reconciliation=${outcome.reconciliation}` : ''}${outcome.reasons.length ? ` [${outcome.reasons.join(', ')}]` : ''}`,
        ),
      },
    })),
  });
}

/**
 * A plan computed only to discover planner-capacity deficits. It is never
 * the Tour: acquisition followed it, so the final plan is recomputed from a
 * fresh catalog snapshot.
 */
export function recordProvisionalPlanStep(
  recorder: GenerationTraceRecorder,
  input: {
    acquisitionEpoch: number;
    plannedExperienceIds: string[];
    stopReason: string;
    residualMinutes: number | null;
    refillAuthorized: boolean;
  },
): TraceStepV5 {
  return recorder.record({
    name: 'planning.provisional',
    description: `PROVISIONAL / ACQUISITION PLANNING: ${input.plannedExperienceIds.length} Experience(s) planificadas solo para descubrir capacidad residual (${input.stopReason}); ${input.refillAuthorized ? 'se autoriza adquisición PLANNER_CAPACITY y el plan se descarta' : 'sin adquisición posterior'}.`,
    component: 'ExperienceGenerationService',
    decision: {
      status: 'INFO',
      outcome: input.refillAuthorized
        ? 'PROVISIONAL_PLAN_DISCARDED_FOR_REFILL'
        : 'PROVISIONAL_PLAN_NO_REFILL',
    },
    facts: {
      acquisitionEpoch: input.acquisitionEpoch,
      plannedExperienceIds: input.plannedExperienceIds,
      stopReason: input.stopReason,
      residualMinutes: input.residualMinutes,
      refillAuthorized: input.refillAuthorized,
    },
  });
}

export type FinalCandidateOutcome =
  | 'PLANNED'
  | 'PLANNER_UNSELECTED'
  | 'OVERLAP_EXCLUDED'
  | 'RESERVOIR_NOT_PROMOTED';

/**
 * POST_RECONCILIATION_SELECTION: every candidate of the final snapshot's
 * composition with its coverage, semantic score and final outcome.
 */
export function recordFinalSelectionStep(
  recorder: GenerationTraceRecorder,
  input: {
    acquisitionEpoch: number;
    selectedIds: string[];
    reservoirIds: string[];
    labelsById: Map<string, string | undefined>;
    scoreBreakdownById: Map<string, CandidateScoreBreakdown>;
    overlapExcluded: Array<{ id: string; overlapsWith: string }>;
    planningSolution: DailyPlanningSolution;
    convergence: {
      stopReason: string;
      promotionAttempts: number;
      acquisitionPasses: number;
    };
  },
): TraceStepV5 {
  const planned = new Map<string, string>();
  input.planningSolution.days.forEach((day) =>
    day.experiences.forEach((experience, index) =>
      planned.set(
        experience.experienceId,
        `day ${day.dayNumber} #${index + 1}`,
      ),
    ),
  );
  const unselected = new Map(
    input.planningSolution.unselected.map((item) => [
      item.experienceId,
      item.reasons,
    ]),
  );
  const excluded = new Map(
    input.overlapExcluded.map((item) => [item.id, item.overlapsWith]),
  );
  const selected = new Set(input.selectedIds);
  const outcomeOf = (id: string): [FinalCandidateOutcome, string] =>
    planned.has(id)
      ? ['PLANNED', planned.get(id)!]
      : excluded.has(id)
        ? ['OVERLAP_EXCLUDED', `REDUNDANT_WITH ${excluded.get(id)}`]
        : unselected.has(id)
          ? ['PLANNER_UNSELECTED', unselected.get(id)!.join(', ')]
          : [
              'RESERVOIR_NOT_PROMOTED',
              `promotion stop: ${input.convergence.stopReason}`,
            ];
  const ids = [...input.selectedIds, ...input.reservoirIds];
  return recorder.record({
    name: 'selection.final',
    description: `POST_RECONCILIATION_SELECTION: ${ids.length} candidato(s) del snapshot final; ${planned.size} planificado(s) (convergencia ${input.convergence.stopReason}).`,
    component: 'ExperienceGenerationService',
    decision: { status: 'INFO', outcome: 'POST_RECONCILIATION_SELECTION' },
    facts: {
      acquisitionEpoch: input.acquisitionEpoch,
      convergence: input.convergence,
      plannedExperienceIds: [...planned.keys()],
    },
    subjects: ids.map((id) => {
      const [outcome, reason] = outcomeOf(id);
      const breakdown = input.scoreBreakdownById.get(id);
      return {
        subject: { kind: 'experience', id, label: input.labelsById.get(id) },
        decision: {
          status: outcome === 'PLANNED' ? ('PASS' as const) : ('INFO' as const),
          outcome,
          reason,
        },
        facts: {
          composition: selected.has(id) ? 'SELECTED' : 'RESERVOIR',
          preferenceCoverage: breakdown?.preferenceScore ?? null,
          semanticSimilarity: breakdown?.semanticSimilarity ?? null,
        },
      };
    }),
  });
}
