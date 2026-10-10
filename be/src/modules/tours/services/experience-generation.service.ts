import { isTourEligibleForDestinationRequest } from '../utils/tour-destination-eligibility.policy';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import destinationScopePolicyConfig from '../config/destination-scope-policy.config';
import { PrismaService } from '@core/database/prisma.service';
import { OutboxService } from '../../outbox/services/outbox.service';
import { ToursService } from './tours.service';
import { TourImageService } from './tour-image.service';
import { DestinationResolutionService } from './destination-resolution.service';
import { boundingBoxToCenterRadius } from '../utils/geometry-search-area.util';
import { GeographicScope } from '../interfaces/experience-resolution.interface';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';
import { CandidateScoreBreakdown } from '../utils/candidate-ranking.util';
import { filterOverlappingExperienceCandidates } from '../utils/candidate-overlap-filter.util';
import {
  recordPreferenceInterpretationStep,
  recordRequestIntentStep,
  recordDestinationResolutionStep,
  recordAnchorResolutionStep,
  recordCatalogSearchStep,
  recordPreferenceCoverageStep,
  recordDeficitRoutingStep,
  recordAreaRouteWalkStep,
  recordAcquisitionLifecycle,
  recordCandidatePoolSelectionStep,
  recordSemanticRankingStep,
  recordDailyPlanningStep,
  recordTourCompletenessStep,
  recordTourMaterializationStep,
  recordCatalogSnapshotStep,
  recordGatherBoundaryStep,
  recordProvisionalPlanStep,
  recordFinalSelectionStep,
  gatherOutcomesOf,
  CatalogCandidateSnapshot,
  CatalogSnapshotPhase,
  GatherExecutionRecord,
} from '../utils/experience-generation-trace.util';
import { TourCompletenessValidator } from './tour-completeness-validator.service';
import {
  TourCompletenessInput,
  UnmetRequestedFormatIssue,
} from '../interfaces/tour-completeness.interface';
import { FinalExperienceResolutionResponse } from '../interfaces/experience-resolution.interface';
import { PlanningCandidateNormalizerService } from './planning-candidate-normalizer.service';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import {
  DAILY_PLANNING_SOLVER,
  DailyPlanningInput,
  DailyPlanningSolution,
  DailyPlanningSolver,
  PlanningExperienceCandidate,
  TOUR_PLANNING_FEASIBILITY_VALIDATOR,
  TourPlanningFeasibilityValidator,
} from '../interfaces/daily-planning.interface';
import {
  ExperienceCatalogService,
  VerifiedExperienceRow,
} from './experience-catalog.service';
import { ExperienceAcquisitionService } from './experience-acquisition.service';
import { ExecuteAcquisitionPlanResult } from './experience-acquisition.service';
import { ExperienceAcquisitionPlannerService } from './experience-acquisition-planner.service';
import { ExperienceDiscoveryScope } from '../interfaces/experience-discovery.interface';
import { AreaRouteWalkAcquisitionService } from './area-route-walk-acquisition.service';
import { AreaRouteAnchorResolverService } from './area-route-anchor-resolver.service';
import {
  AreaRouteWalkWorkUnit,
  DedicatedIntentWorkUnit,
  GenericWorkUnit,
  partitionDeficitsIntoWorkUnits,
  PlannerCapacityWorkUnit,
  workUnitDeficits,
  workUnitGeographicGrant,
} from '../utils/acquisition-strategy-selector.util';
import { GenerationTraceRecorder } from '../utils/generation-trace-recorder.util';
import { GenerationTraceV5 } from '../interfaces/generation-trace-v5.interface';
import { PreferenceInterpreterService } from './preference-interpreter.service';
import { EmbeddingIndexIdentity } from '@shared/ai/interfaces/embedding-index.interface';
import { findHardExclusionMatches } from '../utils/experience-preference-evaluator.util';
import { ExperienceCompositionService } from './experience-composition.service';
import { VenueAnchorResolutionService } from './venue-anchor-resolution.service';
import { NormalizedPreferenceIntent } from '../interfaces/preference-interpretation.interface';
import { buildTourExperienceCreateData } from '../utils/tour-experience-snapshot.util';
import { plannerRelevanceScore } from '../utils/daily-planning-candidate-sort.util';
import { plannerResidualCapacity } from '../utils/daily-planning-convergence.util';
import { buildPreferenceSpec } from '../utils/preference-spec-builder.util';
import {
  FacetRetrievalScope,
  FacetRetrievalService,
} from './facet-retrieval.service';
import {
  basePortfolioTarget,
  portfolioTarget,
} from '../utils/preference-sufficiency.util';
import {
  PreferenceCoverageResult,
  PreferenceSpec,
  CompositionSelectionResult,
} from '../interfaces/preference-spec.interface';
import {
  AcquisitionDeficit,
  GlobalCapacityDeficit,
} from '../interfaces/experience-acquisition-plan.interface';
import { AcquisitionExecutionLedger } from '../utils/acquisition-source-plan-fingerprint.util';
import { distinctResolvedSourceMembers } from '../utils/experience-source-membership.policy';

/**
 * Hard bound on the canonical acquisition loop: initial catalog coverage,
 * then at most this many `plan → executePlan → materialize → re-query →
 * coverage` passes before the pool is taken as final. Never `while (deficit)`.
 */
const MAX_ACQUISITION_PASSES = 2;

function withoutGenerationFailure(metadata: any): any {
  const cleanMetadata = { ...(metadata ?? {}) };
  delete cleanMetadata.generationError;
  delete cleanMetadata.generationFailedAt;
  return cleanMetadata;
}

interface SemanticRankingOutcome {
  status: 'not_requested' | 'applied' | 'unavailable';
  eligibleCandidateCount: number;
  indexedCandidateCount: number;
  identity?: EmbeddingIndexIdentity;
  reason?: string;
}

interface CandidateSelection {
  initialExperiences: any[];
  reservoirExperiences: any[];
  /** Canonical Stage-9 selection result, traced without re-running policy. */
  compositionResult: CompositionSelectionResult;
  semanticRanking: SemanticRankingOutcome;
  scoreBreakdownById: Map<string, CandidateScoreBreakdown>;
  preferenceEvaluationById: Map<string, unknown>;
  hardExclusionRelaxed: boolean;
  preferenceWeightById: Map<string, number>;
  mustIncludeExperienceIds: Set<string>;
  compositionOrderScoreById: Map<string, number>;
}

type PromotionStopReason =
  | 'CAPACITY_SATURATED_OR_TINY_GAPS'
  | 'RESERVOIR_EXHAUSTED'
  | 'PROMOTION_BUDGET_EXHAUSTED'
  | 'NO_PROGRESS';

/** The plan of ONE selection; every field derives from that selection. */
interface SelectionPlan {
  selection: CandidateSelection;
  /** The offered (initial + reservoir) candidates of `selection`. */
  candidatesById: Map<string, any>;
  overlapExcluded: Array<{ id: string; overlapsWith: string }>;
  planningInput: DailyPlanningInput;
  planningSolution: DailyPlanningSolution;
  admittedPlanningCandidates: PlanningExperienceCandidate[];
  promotionAttempts: number;
  promotionStopReason: PromotionStopReason;
  meaningfulResidual?: { dayNumber: number; availableMinutes: number };
}

@Injectable()
export class ExperienceGenerationService {
  private readonly logger = new Logger(ExperienceGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toursService: ToursService,
    private readonly experienceCatalog: ExperienceCatalogService,
    private readonly experienceAcquisition: ExperienceAcquisitionService,
    private readonly experienceComposition: ExperienceCompositionService,
    private readonly venueAnchorResolution: VenueAnchorResolutionService,
    private readonly tourImageService: TourImageService,
    private readonly destinationResolutionService: DestinationResolutionService,
    private readonly facetRetrieval: FacetRetrievalService,
    private readonly experienceAcquisitionPlanner: ExperienceAcquisitionPlannerService,
    private readonly areaRouteWalkAcquisition: AreaRouteWalkAcquisitionService,
    private readonly areaRouteAnchorResolver: AreaRouteAnchorResolverService,
    private readonly tourCompletenessValidator: TourCompletenessValidator,
    private readonly planningCandidateNormalizer: PlanningCandidateNormalizerService,
    @Inject(DAILY_PLANNING_SOLVER)
    private readonly dailyPlanningSolver: DailyPlanningSolver,
    @Inject(TOUR_PLANNING_FEASIBILITY_VALIDATOR)
    private readonly tourPlanningFeasibilityValidator: TourPlanningFeasibilityValidator,
    @Inject(dailyPlanningPolicyConfig.KEY)
    private readonly dailyPlanningPolicy: ConfigType<
      typeof dailyPlanningPolicyConfig
    >,
    @Inject(destinationScopePolicyConfig.KEY)
    private readonly destinationScopePolicy: ConfigType<
      typeof destinationScopePolicyConfig
    >,
    @Optional()
    private readonly outboxService?: OutboxService,
    @Optional()
    private readonly preferenceInterpreter?: PreferenceInterpreterService,
  ) {}

  /**
   * The ONE construction of an acquisition plan's destination scope, shared
   * by every plan-creation path (preference-deficit acquisition and the
   * planner's residual-capacity acquisition) so none of them drops a
   * destination fact. The country code is carried unchanged from
   * DestinationResolutionService, its single source of truth.
   */
  private acquisitionDiscoveryScope(
    destinationName: string,
    destinationCountryCode: string | undefined,
    area: { latitude: number; longitude: number; radiusMeters: number },
  ): ExperienceDiscoveryScope {
    return {
      destinationName,
      ...(destinationCountryCode ? { destinationCountryCode } : {}),
      latitude: area.latitude,
      longitude: area.longitude,
      radiusMeters: area.radiusMeters,
    };
  }

  private emptyNormalizedPreferences(): NormalizedPreferenceIntent {
    return {
      preferredFacets: [],
      anchoredPlaces: [],
      excludedThemes: [],
      excludedTraits: [],
      hardExclusions: [],
      softConstraints: [],
      ambiguities: [],
      dietaryPreferences: [],
      accessibilityPreferences: [],
      budgetPreferences: [],
      groupPreferences: [],
      positiveSemanticQuery: '',
      notes: [],
    };
  }

  private resolvePlannedStartTime(
    startDates: string[],
    dayNumber: number,
    startMinutesFromMidnight: number,
  ): Date | undefined {
    if (!startDates || startDates.length === 0) return undefined;
    const base = new Date(startDates[0]);
    if (Number.isNaN(base.getTime())) return undefined;
    const result = new Date(base);
    result.setUTCDate(base.getUTCDate() + (dayNumber - 1));
    result.setUTCHours(0, startMinutesFromMidnight, 0, 0);
    return result;
  }

  /**
   * M2 (preference-first live cutover) -- the canonical, ONLY sufficiency/
   * deficit authority for new generations. Reads `PreferenceSpec.facets`
   * (the canonical requirement model) directly via `FacetRetrievalService`
   * (real PostGIS-scoped catalog retrieval, no in-memory truncation) +
   * `preference-sufficiency.util.ts`'s global days*pace portfolio target.
   *
   * Returns the canonical `PreferenceCoverageResult`. Trace presentation
   * (offered-candidate count, semantic ranking, provider health) is a
   * separate, caller-owned concern (`buildPreferenceCoverageStep`),
   * deliberately kept out of this pure decision result so policy and
   * presentation stay separate.
   */
  private async computePreferenceCoverage(
    preferenceSpec: PreferenceSpec,
    scope: FacetRetrievalScope,
    resolvedMustVenueExperienceIds: readonly string[] = [],
  ): Promise<PreferenceCoverageResult> {
    const facetResults = await Promise.all(
      preferenceSpec.facets.map((facet) =>
        this.facetRetrieval.retrieveFacetCandidates(facet, scope),
      ),
    );

    // Spec SS6.2's `totalDistinctEligibleExperiences` is a GLOBAL quantity,
    // independent of which facets were requested -- never the union of
    // per-facet strong/weak matches (that undercounts whenever a real,
    // eligible Experience matches no requested facet, and collapses to 0
    // whenever zero facets are requested regardless of real catalog size).
    const totalDistinctEligibleExperiences =
      await this.computeTotalDistinctEligibleExperiences(scope, preferenceSpec);

    const baseTarget = basePortfolioTarget(
      preferenceSpec.trip.days,
      preferenceSpec.trip.pace,
    );
    const mustIds = new Set(resolvedMustVenueExperienceIds);
    const reservedStrongExperienceIds: string[] = [];
    for (const result of facetResults) {
      if (result.strongMatches.some((id) => mustIds.has(id))) continue;
      const reservation = result.strongMatches.find(
        (id) => !reservedStrongExperienceIds.includes(id),
      );
      if (reservation) reservedStrongExperienceIds.push(reservation);
    }
    const target = portfolioTarget({
      baseTarget,
      reservedStrongExperienceIds,
      resolvedMustVenueExperienceIds,
    });

    const unsatisfiedFacets = facetResults.filter(
      (facetCandidates) => !facetCandidates.satisfied,
    );
    const allFacetsSatisfied = unsatisfiedFacets.length === 0;
    const sufficient =
      allFacetsSatisfied && totalDistinctEligibleExperiences >= target;

    // Spec SS7: targeted facet acquisition comes first. A global-capacity
    // deficit is raised ONLY once every requested facet is already
    // satisfied but the total eligible portfolio is still too thin --
    // never alongside facet deficits. `GlobalCapacityDeficit` has no
    // `dimension`/`key` field at all (invalid states unrepresentable): it
    // is structurally impossible for it to masquerade as a facet deficit.
    const acquisitionDeficits: AcquisitionDeficit[] = allFacetsSatisfied
      ? totalDistinctEligibleExperiences < target
        ? [
            {
              origin: 'global_capacity' as const,
              reason: `Global portfolio capacity shortage: ${totalDistinctEligibleExperiences} distinct eligible Experience(s) found, need >= ${target} for ${preferenceSpec.trip.days} day(s) at ${preferenceSpec.trip.pace} pace.`,
              currentEligibleCount: totalDistinctEligibleExperiences,
              requiredEligibleCount: target,
            },
          ]
        : []
      : unsatisfiedFacets.map((facetCandidates) => ({
          origin: 'preference_facet' as const,
          dimension: facetCandidates.facet.dimension,
          key: facetCandidates.facet.key,
          reason: `Preference facet [${facetCandidates.facet.dimension}:${facetCandidates.facet.key}] has no strong catalog match yet.`,
        }));

    return {
      facetResults,
      allFacetsSatisfied,
      totalDistinctEligibleExperiences,
      portfolioTarget: target,
      sufficient,
      acquisitionDeficits,
    };
  }

  /**
   * Spec SS6.2's GLOBAL `totalDistinctEligibleExperiences` -- independent of
   * which facets were requested. Reuses the exact same canonical geography
   * boundary `FacetRetrievalService` already queries
   * (`ExperienceCatalogService.findVerifiedWithinForMatching`: real PostGIS
   * radius, no correctness-visible LIMIT; its own JOIN already structurally
   * excludes bare/no-component rows), then applies the two SS12.1
   * eligibility rules that already have real, reusable primitives today:
   * hard exclusion (`findHardExclusionMatches` -- the SAME hard-exclusion
   * policy the legacy preference evaluator uses, fed from
   * `PreferenceSpec.exclusions.hard` here instead of
   * `NormalizedPreferenceIntent.hardExclusions`) and "not a bare AREA/ROUTE
   * representation" (at least one real PLACE-kind resolved component).
   *
   * Full SS12.1 eligibility (destination-scope exclusion beyond the
   * geography query, etc.) is Checkpoint C/M5 composition's job, which does
   * not exist yet -- this is the narrowest faithful subset backed by real
   * primitives, never a substitute count invented to make sufficiency
   * reachable.
   */
  private async computeTotalDistinctEligibleExperiences(
    scope: FacetRetrievalScope,
    preferenceSpec: PreferenceSpec,
  ): Promise<number> {
    const pool: VerifiedExperienceRow[] =
      await this.experienceCatalog.findVerifiedWithinForMatching(
        scope.latitude,
        scope.longitude,
        scope.radiusMeters,
      );
    const hardExclusions = preferenceSpec.exclusions.hard;

    let count = 0;
    for (const row of pool) {
      if (!isTourEligibleForDestinationRequest(row, scope.destination)) {
        continue;
      }
      if (
        hardExclusions.length > 0 &&
        findHardExclusionMatches(row, hardExclusions).length > 0
      ) {
        continue;
      }
      const hasRealPlaceComponent = row.components.some(
        (component) => component.geoEntity?.kind === 'PLACE',
      );
      if (!hasRealPlaceComponent) continue;
      count += 1;
    }
    return count;
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private async updateGenerationStatus(
    tourId: string,
    status: string,
    message?: string,
  ) {
    const tour = await this.toursService.findOne(tourId);
    const metadata = tour?.metadata as any;
    const nextMetadata = withoutGenerationFailure(metadata);
    const data = {
      metadata: {
        ...nextMetadata,
        generationStatus: status,
        generationMessage: message,
        ...(status === 'generating' &&
        metadata?.generationStatus !== 'generating'
          ? { generationStartedAt: new Date().toISOString() }
          : {}),
      },
    };

    if (
      this.outboxService &&
      (status === 'generating' || status === 'pending')
    ) {
      await this.prisma.$transaction(async (tx) => {
        await tx.tour.update({ where: { id: tourId }, data });
        await this.outboxService.createInTx(tx, {
          eventType: 'TourProgressUpdated',
          payload: {
            tourId,
            userId: tour?.ownerId || undefined,
            status,
            message,
          },
        });
      });
      return;
    }

    await this.prisma.tour.update({ where: { id: tourId }, data });
  }

  private async composeExperiences(
    experiences: any[],
    preferenceSpec: PreferenceSpec,
    resolvedVenueMustIds: string[] = [],
    resolvedVenueSoftIds: string[] = [],
    resolvedVenueMustAnchorNames: string[] = [],
  ): Promise<CandidateSelection> {
    const composition = await this.experienceComposition.compose({
      experiences,
      preferenceSpec,
      resolvedVenueMustIds,
      resolvedVenueSoftIds,
      resolvedVenueMustAnchorNames,
    });
    const orderedIds = [
      ...composition.result.selected,
      ...composition.result.reservoir,
    ];
    const compositionOrderScoreById = new Map(
      orderedIds.map((id, index) => [id, orderedIds.length - index]),
    );
    const initialExperiences = composition.result.selected
      .map((id) => composition.candidatesById.get(id))
      .filter(Boolean);
    const reservoirExperiences = composition.result.reservoir
      .map((id) => composition.candidatesById.get(id))
      .filter(Boolean);
    const scoreBreakdownById = new Map<string, CandidateScoreBreakdown>();
    for (const id of orderedIds) {
      const candidate = composition.candidatesById.get(id);
      const preferenceWeight = composition.preferenceWeightById.get(id) ?? 0;
      scoreBreakdownById.set(id, {
        semanticSimilarity: composition.semanticSimilarityById.has(id)
          ? composition.semanticSimilarityById.get(id)!
          : null,
        qualityBonus:
          typeof candidate?.qualityScore === 'number'
            ? candidate.qualityScore
            : 0,
        preferenceScore: preferenceWeight,
        preferenceBonus: preferenceWeight,
        proximityBonus: 0,
        diversityBonus: 0,
        // Composition is set-based and has no scalar ranking score. Keep a
        // transparent trace value for the existing contract; this value is
        // never transported as planner rankingScore.
        totalScore: preferenceWeight,
      });
    }
    return {
      initialExperiences,
      reservoirExperiences,
      compositionResult: composition.result,
      scoreBreakdownById,
      preferenceEvaluationById: new Map(),
      hardExclusionRelaxed: false,
      semanticRanking: {
        status: composition.semanticRanking.status,
        eligibleCandidateCount:
          composition.semanticRanking.requestedCandidateCount,
        indexedCandidateCount:
          composition.semanticRanking.indexedCandidateCount,
        identity: composition.semanticRanking.identity,
        reason: composition.semanticRanking.reason,
      },
      preferenceWeightById: composition.preferenceWeightById,
      mustIncludeExperienceIds: new Set(resolvedVenueMustIds),
      compositionOrderScoreById,
    };
  }

  /**
   * Shared acquisition mechanics for the generic, dedicated-intent and
   * planner-capacity work units. Work-unit assignment remains with the
   * partition; this seam only executes the unit's already-built plan,
   * materializes its candidates under THAT unit's geographic grant, and
   * records the canonical stage trace.
   */
  private async executeAndMaterializeAcquisitionPlan(
    plan: Parameters<ExperienceAcquisitionService['executePlan']>[0],
    passNumber: number,
    context: {
      destinationName?: string;
      destinationCountryCode?: string;
      geographicScope: GeographicScope;
    },
    traceRecorder: GenerationTraceRecorder,
    providerState: {
      attempted: Set<string>;
      failed: Set<string>;
    },
    executionLedger: AcquisitionExecutionLedger,
    workUnit:
      | GenericWorkUnit
      | DedicatedIntentWorkUnit
      | PlannerCapacityWorkUnit,
    /** GATHER ledger of this generation (trace only). */
    gatherExecutions?: GatherExecutionRecord[],
  ): Promise<ExecuteAcquisitionPlanResult> {
    const execution = await this.experienceAcquisition.executePlan(
      plan,
      executionLedger,
    );
    for (const [provider, result] of Object.entries(
      execution.providerResults,
    )) {
      providerState.attempted.add(provider);
      if (result?.status === 'failed') providerState.failed.add(provider);
    }
    for (const web of execution.webResults ?? []) {
      // RW3-F2: name the grounded provider actually attempted/failed
      // (serper, serpapi, ...); fall back to the generic capability label
      // only when the result never recorded one.
      const webProvider = web.groundedProvider ?? 'web';
      providerState.attempted.add(webProvider);
      if (web.status === 'failed') providerState.failed.add(webProvider);
    }

    // Geographic authority comes ONLY from the unit that produced this
    // execution: a DEDICATED_INTENT unit grants its own walk/route_like
    // deficit; GENERIC and PLANNER_CAPACITY grant nothing, whatever else
    // the tour requested or is still open elsewhere.
    const geographicGrant = workUnitGeographicGrant(workUnit);
    let resolution: FinalExperienceResolutionResponse | undefined;
    if (execution.candidates.length > 0) {
      resolution = await this.experienceAcquisition.materializeExecution(
        execution,
        { ...context, geographicGrant },
      );
    }
    recordAcquisitionLifecycle(traceRecorder, {
      passNumber,
      workUnit,
      geographicGrant,
      plan,
      execution,
      resolution,
    });
    gatherExecutions?.push({
      pass: passNumber,
      workUnit: workUnit.kind,
      sourcePlanCount: plan.sourcePlans.length,
      candidateCount: execution.candidates.length,
      outcomes: gatherOutcomesOf(resolution),
    });
    return execution;
  }

  /**
   * THE catalog snapshot of one generation, read fresh through the
   * canonical catalog boundary: the destination window (PD1: only
   * Experiences WITHIN the destination are tour-eligible from it) plus the
   * exact rows a request scope established (venue anchors, AREA_ROUTE_WALK
   * acquisitions). Nothing from an earlier read survives into it, and its
   * order is canonical (by id) so discovery order never decides eligibility.
   *
   * The window is the PostGIS geospatial boundary that coverage also reads
   * (`findVerifiedWithinForMatching`): the database resolves geographic
   * scope, with no global scan cap and no distance slice before
   * composition. Its distance order is discarded here; the snapshot order
   * is by id.
   */
  private async readCatalogSnapshot(input: {
    phase: CatalogSnapshotPhase;
    acquisitionEpoch: number;
    window: { latitude: number; longitude: number; radiusMeters: number };
    destination: GeographicScope;
    explicitIds: string[];
  }): Promise<CatalogCandidateSnapshot<VerifiedExperienceRow>> {
    const windowRows = (
      await this.experienceCatalog.findVerifiedWithinForMatching(
        input.window.latitude,
        input.window.longitude,
        input.window.radiusMeters,
      )
    ).filter((experience) =>
      isTourEligibleForDestinationRequest(experience, input.destination),
    );
    const explicitRows = await this.experienceCatalog.findVerifiedByIds([
      ...new Set(input.explicitIds),
    ]);
    const byId = new Map<string, VerifiedExperienceRow>();
    [...windowRows, ...explicitRows].forEach((experience) =>
      byId.set(experience.id, experience),
    );
    return {
      phase: input.phase,
      acquisitionEpoch: input.acquisitionEpoch,
      experiences: [...byId.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    };
  }

  /**
   * Plans ONE selection, deriving every planner input from that selection
   * only (no candidate, weight or score survives from an earlier
   * selection): overlap filter → initial solve → bounded reservoir
   * promotion → residual capacity.
   */
  private async planFromSelection(
    selection: CandidateSelection,
    planningBase: Omit<DailyPlanningInput, 'candidates'>,
    preferenceSpec: PreferenceSpec,
  ): Promise<SelectionPlan> {
    const offered = [
      ...selection.initialExperiences,
      ...selection.reservoirExperiences,
    ];
    const candidatesById = new Map<string, any>(
      offered.map((experience: any) => [experience.id, experience]),
    );
    // Verified live: a standalone POI Experience and a composite Experience
    // that separately resolved the *same real place* as one of its own
    // components can both reach this pool as unrelated records (their
    // GeoEntity rows may predate ExperienceCatalogService.upsertGeoEntity's
    // cross-provider reconciliation, or some other gap could still produce
    // the same split) — the solver has no way to know they're the same
    // place, so it can book a traveler into it twice on two different days.
    // Filter that overlap out of the pool itself, before normalization. The
    // input is in composition order (a function of the snapshot alone).
    const overlapFilter = filterOverlappingExperienceCandidates(
      offered.map((experience: any) => ({
        ...experience,
        compositionOrderScore: selection.compositionOrderScoreById.get(
          experience.id,
        ),
        weightedPreferenceCoverage: selection.preferenceWeightById.get(
          experience.id,
        ),
        mustInclude: selection.mustIncludeExperienceIds.has(experience.id),
      })),
    );
    if (overlapFilter.excluded.length > 0) {
      this.logger.log(
        `Excluded ${overlapFilter.excluded.length} candidate(s) redundant with another selected candidate covering the same real place: ${overlapFilter.excluded
          .map((item) => `${item.id} (kept ${item.overlapsWith})`)
          .join(', ')}`,
      );
    }

    const initialIds = new Set(
      selection.initialExperiences.map((experience: any) => experience.id),
    );
    const candidatePool = overlapFilter.kept;
    const initialPool = candidatePool.filter((experience) =>
      initialIds.has(experience.id),
    );
    const reservoirPool = selection.reservoirExperiences
      .map((reserved: any) =>
        candidatePool.find((experience) => experience.id === reserved.id),
      )
      .filter((experience): experience is any => Boolean(experience));
    const mustIncludeIds = selection.mustIncludeExperienceIds;
    const normalizePlanningPool = (experiences: any[]) =>
      this.planningCandidateNormalizer.normalizeExperiences(
        experiences,
        selection.scoreBreakdownById,
        {
          preferenceWeightById: selection.preferenceWeightById,
          mustIncludeExperienceIds: mustIncludeIds,
        },
      );
    const planningCandidates = await normalizePlanningPool(initialPool);
    const planningInput: DailyPlanningInput = {
      ...planningBase,
      candidates: planningCandidates,
    };

    const scheduledCount = (solution: DailyPlanningSolution) =>
      solution.days.reduce((total, day) => total + day.experiences.length, 0);
    const utilization = (solution: DailyPlanningSolution) =>
      solution.days.reduce((sum, day) => sum + day.utilizationMinutes, 0);
    const solutionRelevance = (
      solution: DailyPlanningSolution,
      candidates: PlanningExperienceCandidate[],
    ) => {
      const byId = new Map(
        candidates.map((candidate) => [candidate.experienceId, candidate]),
      );
      return solution.days.reduce(
        (total, day) =>
          total +
          day.experiences.reduce(
            (dayTotal, planned) =>
              dayTotal +
              plannerRelevanceScore(
                byId.get(planned.experienceId)!,
                this.dailyPlanningPolicy.scoring,
              ),
            0,
          ),
        0,
      );
    };
    const mustCount = (solution: DailyPlanningSolution) =>
      solution.days
        .flatMap((day) => day.experiences)
        .filter((planned) => mustIncludeIds.has(planned.experienceId)).length;
    const meaningfulResidualCapacity = (solution: DailyPlanningSolution) =>
      plannerResidualCapacity(
        solution,
        this.dailyPlanningPolicy.window,
        this.dailyPlanningPolicy.backfill.minimumUsefulResidualMinutes,
      ).some((residual) => residual.meaningful);

    let planningSolution = await this.dailyPlanningSolver.solve(planningInput);
    let admittedPlanningCandidates = [...planningCandidates];
    let promotionAttempts = 0;
    let promotionStopReason: PromotionStopReason =
      reservoirPool.length === 0 ? 'RESERVOIR_EXHAUSTED' : 'NO_PROGRESS';
    for (const experience of reservoirPool) {
      if (!meaningfulResidualCapacity(planningSolution)) {
        promotionStopReason = 'CAPACITY_SATURATED_OR_TINY_GAPS';
        break;
      }
      if (
        promotionAttempts >=
        this.dailyPlanningPolicy.backfill.maxReservoirPromotionAttempts
      ) {
        promotionStopReason = 'PROMOTION_BUDGET_EXHAUSTED';
        break;
      }
      promotionAttempts++;
      const promotedCandidates = await normalizePlanningPool([
        ...initialPool,
        ...admittedPlanningCandidates
          .filter((candidate) => !initialIds.has(candidate.experienceId))
          .map((candidate) =>
            candidatePool.find((item) => item.id === candidate.experienceId),
          )
          .filter(Boolean),
        experience,
      ]);
      const trialSolution = await this.dailyPlanningSolver.solve({
        ...planningInput,
        candidates: promotedCandidates,
      });
      const promoted = trialSolution.days
        .flatMap((day) => day.experiences)
        .some((planned) => planned.experienceId === experience.id);
      const noDegradation =
        mustCount(trialSolution) >= mustCount(planningSolution) &&
        solutionRelevance(trialSolution, promotedCandidates) >=
          solutionRelevance(planningSolution, admittedPlanningCandidates) -
            1e-9;
      const strictProgress =
        scheduledCount(trialSolution) > scheduledCount(planningSolution) ||
        utilization(trialSolution) > utilization(planningSolution);
      if (promoted && noDegradation && strictProgress) {
        planningSolution = trialSolution;
        admittedPlanningCandidates = promotedCandidates;
        promotionStopReason = 'NO_PROGRESS';
      }
    }

    if (
      reservoirPool.length > 0 &&
      promotionAttempts >=
        this.dailyPlanningPolicy.backfill.maxReservoirPromotionAttempts
    ) {
      promotionStopReason = 'PROMOTION_BUDGET_EXHAUSTED';
    } else if (
      reservoirPool.length > 0 &&
      promotionStopReason === 'NO_PROGRESS' &&
      promotionAttempts >= reservoirPool.length
    ) {
      promotionStopReason = 'RESERVOIR_EXHAUSTED';
    }
    planningSolution.metadata.residualCapacity = plannerResidualCapacity(
      planningSolution,
      this.dailyPlanningPolicy.window,
      this.dailyPlanningPolicy.backfill.minimumUsefulResidualMinutes,
    );
    const residuals = planningSolution.metadata.residualCapacity;
    const meaningfulResidual = residuals?.find(
      (residual) => residual.meaningful,
    );
    if (residuals && promotionAttempts >= reservoirPool.length) {
      planningSolution.metadata.capacityDeficits = meaningfulResidual
        ? [
            {
              origin: 'planner_capacity',
              dayNumber: meaningfulResidual.dayNumber,
              availableMinutes: meaningfulResidual.availableMinutes,
              preferredFacets: preferenceSpec.facets.map((facet) => ({
                dimension: facet.dimension,
                key: facet.key,
                weight: facet.weight,
              })),
            },
          ]
        : [];
    }

    return {
      selection,
      candidatesById,
      overlapExcluded: overlapFilter.excluded,
      planningInput,
      planningSolution,
      admittedPlanningCandidates,
      promotionAttempts,
      promotionStopReason,
      meaningfulResidual,
    };
  }

  async generateTourExperiences(tourId: string) {
    const tour = await this.toursService.findOne(tourId);
    if (!tour) {
      throw new NotFoundException(`Tour with ID ${tourId} not found`);
    }

    const metadata = tour.metadata as any;
    if (metadata?.generationStatus === 'generating') {
      throw new BadRequestException(
        'Experiences are already being generated for this tour',
      );
    }
    if (
      metadata?.generationStatus === 'completed' &&
      (tour.experiences?.length ?? 0) > 0
    ) {
      throw new BadRequestException('Experiences have already been generated');
    }

    const traceRecorder = new GenerationTraceRecorder();
    const acquisitionProvidersAttempted = new Set<string>();
    const acquisitionProvidersFailed = new Set<string>();
    let degradedAcquisitionReason: string | null = null;

    await this.updateGenerationStatus(
      tourId,
      'generating',
      'Iniciando generación de Experiences...',
    );

    try {
      const request = metadata?.generationRequest as TourGenerationRequest;
      if (!request || request.contractVersion !== 1) {
        throw new BadRequestException(
          'Tour does not have a supported canonical generation request stored',
        );
      }

      if (!tour.prompt) {
        throw new BadRequestException(
          'Tour does not have canonical selector input stored',
        );
      }

      const discoveryResolvedExperienceIds = new Set<string>();
      const acquisitionExecutionLedger: AcquisitionExecutionLedger = {
        executedSourcePlanFingerprints: new Set(),
      };
      // GATHER bookkeeping. `acquisitionEpoch` counts the acquisition
      // executions (catalog writes) of this generation; every catalog
      // snapshot records the epoch it was read at, and the final plan may
      // only be built from a snapshot read at the final epoch.
      let acquisitionEpoch = 0;
      const gatherExecutions: GatherExecutionRecord[] = [];
      let gatherStarted = false;
      const startGather = (deficitCount: number) => {
        if (gatherStarted) return;
        gatherStarted = true;
        recordGatherBoundaryStep(traceRecorder, {
          boundary: 'GATHER_START',
          deficitCount,
        });
      };

      let semanticRankingOutcome: SemanticRankingOutcome = {
        status: 'not_requested',
        eligibleCandidateCount: 0,
        indexedCandidateCount: 0,
      };

      const preferenceInterpretation = this.preferenceInterpreter
        ? await this.preferenceInterpreter.interpret(
            request.intent.additionalPreferences,
          )
        : {
            intent: this.emptyNormalizedPreferences(),
            trace: {
              stage: 'preference_interpretation' as const,
              systemPrompt: '',
              userPrompt: '',
              responseSchema: {},
              parsedResponse: this.emptyNormalizedPreferences(),
              validationErrors: [],
              status: 'skipped' as const,
              durationMs: 0,
            },
          };

      // M1 (preference-first live cutover) -- the canonical PreferenceSpec
      // (spec §3, plan Task A3), built once here from the RAW interpreter
      // output (buildPreferenceSpec does its own wizard-facet merging
      // internally). This is
      // the single normalized-requirement model every later milestone reads
      // (retrieval, sufficiency, acquisition-strategy selection,
      // composition) instead of `NormalizedPreferenceIntent`/ad-hoc
      // `request.intent.*` field reads.
      const preferenceSpec = buildPreferenceSpec(
        request,
        preferenceInterpretation.intent,
      );

      recordPreferenceInterpretationStep(traceRecorder, {
        preferenceInterpretation,
        preferenceSpec,
        request,
      });
      recordRequestIntentStep(traceRecorder, {
        request,
        preferenceSpec,
      });

      const destinationResolution =
        await this.destinationResolutionService.resolveDestination(
          request.destination.label,
          {
            latitude: request.destination.latitude,
            longitude: request.destination.longitude,
          },
          request.destination.scaleHint,
        );
      const canonicalDestinationName =
        destinationResolution.scale === 'area'
          ? destinationResolution.boundary.name
          : (destinationResolution.selectedResult?.displayName ??
            request.destination.label);
      recordDestinationResolutionStep(traceRecorder, {
        destinationText: request.destination.label,
        resolution: destinationResolution,
        canonicalDestinationName,
      });

      // Asynchronously resolve authentic destination cover photo in background
      void this.tourImageService
        .resolveDestinationCoverImage(tourId, {
          label: request.destination.label,
          latitude: request.destination.latitude,
          longitude: request.destination.longitude,
        })
        .catch((err) =>
          this.logger.warn(
            `Failed to resolve destination cover image for tour ${tourId}: ${err?.message}`,
          ),
        );

      const isAreaScale = destinationResolution.scale === 'area';
      const pointRadius =
        request.destination.radiusMeters ??
        this.destinationScopePolicy.pointRadiusMeters;
      const geographicScope: GeographicScope = isAreaScale
        ? { kind: 'AREA_BOUNDARY', boundary: destinationResolution.boundary }
        : {
            kind: 'POINT_RADIUS',
            latitude: request.destination.latitude,
            longitude: request.destination.longitude,
            radiusMeters: pointRadius,
          };

      const searchArea = isAreaScale
        ? boundingBoxToCenterRadius(destinationResolution.boundary.geometry)
        : {
            latitude: request.destination.latitude,
            longitude: request.destination.longitude,
            radiusMeters: pointRadius,
          };

      const resolvedAnchors =
        await this.areaRouteAnchorResolver.resolveNamedAnchors(
          preferenceInterpretation.intent.anchoredPlaces,
          {
            destinationCountryCode: destinationResolution.countryCode,
            destinationPoint: {
              latitude: searchArea.latitude,
              longitude: searchArea.longitude,
            },
            geographicScope,
          },
        );
      preferenceSpec.resolvedAnchors = resolvedAnchors;
      // Keep interpreted linguistic facts and canonical geographic facts in
      // separate PreferenceSpec fields. Downstream geographic consumers must
      // read resolvedAnchors; trace keeps both projections explicit.
      recordAnchorResolutionStep(traceRecorder, {
        requestedAnchors: preferenceInterpretation.intent.anchoredPlaces,
        resolvedAnchors,
      });
      const venueAnchorResolution = await this.venueAnchorResolution.resolve({
        anchors: resolvedAnchors,
        destinationName: canonicalDestinationName,
        destinationCountryCode: destinationResolution.countryCode,
        geographicScope,
      });
      if (
        !Number.isFinite(request.destination.latitude) ||
        !Number.isFinite(request.destination.longitude)
      ) {
        throw new Error(
          'No se encontraron Experiences verificadas y relevantes para esta solicitud.',
        );
      }

      const radius = searchArea.radiusMeters;
      // One canonical catalog window and one canonical composition input
      // for every snapshot of this generation: initial, gather and final
      // reads differ only in WHEN they are taken.
      const readSnapshot = (phase: CatalogSnapshotPhase) =>
        this.readCatalogSnapshot({
          phase,
          acquisitionEpoch,
          window: {
            latitude: searchArea.latitude,
            longitude: searchArea.longitude,
            radiusMeters: radius,
          },
          destination: geographicScope,
          // Venue resolution and AREA_ROUTE_WALK acquisition establish
          // canonical ids independently of the window scan; hydrate those
          // exact rows so they stay eligible whatever the distance order.
          explicitIds: [
            ...venueAnchorResolution.resolvedMustIds,
            ...venueAnchorResolution.resolvedSoftIds,
            ...discoveryResolvedExperienceIds,
          ],
        });
      const composeSnapshot = (
        snapshot: CatalogCandidateSnapshot<VerifiedExperienceRow>,
      ) =>
        this.composeExperiences(
          snapshot.experiences,
          preferenceSpec,
          venueAnchorResolution.resolvedMustIds,
          venueAnchorResolution.resolvedSoftIds,
          venueAnchorResolution.resolvedNames,
        );
      const coverageScope = { ...searchArea, destination: geographicScope };

      await this.updateGenerationStatus(
        tourId,
        'generating',
        `Buscando Experiences verificadas en la zona (radio ${Math.round(radius / 1000)}km)...`,
      );

      // ── INITIAL_CATALOG_SNAPSHOT ──
      let snapshot = await this.withTimeout(
        readSnapshot('INITIAL'),
        10000,
        'Experience catalog search timeout',
      );
      const initialCatalogCount = snapshot.experiences.length;
      recordCatalogSnapshotStep(traceRecorder, snapshot);
      let selection = await composeSnapshot(snapshot);
      semanticRankingOutcome = selection.semanticRanking;
      let preferenceCoverage = await this.computePreferenceCoverage(
        preferenceSpec,
        coverageScope,
        venueAnchorResolution.resolvedMustIds,
      );
      recordPreferenceCoverageStep(traceRecorder, {
        coverage: preferenceCoverage,
        context: {
          offeredCandidateCount: selection.initialExperiences.length,
          semanticRanking: semanticRankingOutcome,
          providerHealth: { status: 'healthy' },
        },
      });
      recordCatalogSearchStep(traceRecorder, {
        candidates: preferenceCoverage.sufficient
          ? selection.initialExperiences
          : snapshot.experiences,
        radiusKm: radius / 1000,
      });

      // ── GATHER: coverage deficits ──
      // The canonical bounded multi-source acquisition loop:
      //   coverage deficits → ExperienceAcquisitionPlannerService
      //   .buildAcquisitionPlan → ExperienceAcquisitionService.executePlan
      //   (structured providers + web discovery) → materializeExecution
      //   (resolver: NEW, SAME + member reconciliation, or rejected) →
      //   fresh catalog snapshot → preference sufficiency, bounded by
      //   MAX_ACQUISITION_PASSES. Selections computed here are provisional.
      if (!preferenceCoverage.sufficient) {
        try {
          const acquisitionScope = this.acquisitionDiscoveryScope(
            canonicalDestinationName,
            destinationResolution.countryCode,
            searchArea,
          );
          startGather(preferenceCoverage.acquisitionDeficits.length);

          // Resolution is request-scoped: repeated acquisition passes reuse
          // the same canonical anchor result, including a transient
          // provider failure, instead of silently changing scope semantics.
          let currentProviderHealth: {
            status: 'healthy' | 'degraded' | 'unknown';
            reason?: string;
          } = { status: 'healthy' };
          for (let pass = 1; pass <= MAX_ACQUISITION_PASSES; pass++) {
            if (preferenceCoverage.sufficient) break;

            // The ONE place open deficits are assigned to acquisition work
            // units (acquisition-strategy-selector.util.ts): each
            // walk/route_like deficit gets its own AREA_ROUTE_WALK or
            // DEDICATED_INTENT unit (one owner, one geographic grant);
            // every other deficit -- including every dimensionless
            // global_capacity deficit -- joins the single GENERIC unit.
            // The canonical deficit objects from FacetRetrievalService/
            // preference-sufficiency.util.ts pass straight through --
            // never recomputed, never reconstructed.
            const workUnits = partitionDeficitsIntoWorkUnits(
              preferenceCoverage.acquisitionDeficits,
              resolvedAnchors,
            );
            recordDeficitRoutingStep(traceRecorder, {
              workUnits,
              resolvedAnchors,
              acquisitionDeficits: preferenceCoverage.acquisitionDeficits,
            });

            // GENERIC and DEDICATED_INTENT units share the generic
            // acquisition pipeline, each with a plan built from ONLY its
            // own deficits, so a dedicated unit's query, requested
            // intents and evidence requirement keep its one deficit's
            // provenance.
            const plannedUnits = workUnits
              .flatMap((unit) =>
                unit.kind === 'GENERIC' || unit.kind === 'DEDICATED_INTENT'
                  ? [
                      {
                        unit,
                        plan: this.experienceAcquisitionPlanner.buildAcquisitionPlan(
                          {
                            destination: acquisitionScope,
                            deficits: workUnitDeficits(unit),
                            semanticQuery: preferenceSpec.semanticQuery,
                            breadth: 'focused',
                            anchors: resolvedAnchors,
                          },
                        ),
                      },
                    ]
                  : [],
              )
              .filter(({ plan }) => plan.sourcePlans.length > 0);
            const areaRouteWalkUnits = workUnits.filter(
              (unit): unit is AreaRouteWalkWorkUnit =>
                unit.kind === 'AREA_ROUTE_WALK',
            );

            if (plannedUnits.length === 0 && areaRouteWalkUnits.length === 0) {
              // Nothing routable — a soft-only deficit. Stop acquiring; the
              // gap stays visible in the coverage trace, never fatal.
              break;
            }

            for (const routed of areaRouteWalkUnits) {
              await this.updateGenerationStatus(
                tourId,
                'generating',
                `Buscando una experiencia de tipo "${routed.deficit.key}" en "${routed.anchor.rawName}"...`,
              );

              const areaRouteWalkResult =
                await this.areaRouteWalkAcquisition.acquireOrReuse({
                  anchor: routed.anchor,
                  destination: acquisitionScope,
                  destinationCountryCode: destinationResolution.countryCode,
                  destinationPoint: {
                    latitude: searchArea.latitude,
                    longitude: searchArea.longitude,
                  },
                  geographicScope,
                  deficit: routed.deficit,
                  semanticQuery: preferenceSpec.semanticQuery,
                  executionLedger: acquisitionExecutionLedger,
                });
              acquisitionEpoch++;
              recordAreaRouteWalkStep(traceRecorder, {
                anchor: routed.anchor,
                deficit: routed.deficit,
                result: areaRouteWalkResult,
              });

              const lifecycle =
                'lifecycle' in areaRouteWalkResult
                  ? areaRouteWalkResult.lifecycle
                  : undefined;
              if (lifecycle) {
                recordAcquisitionLifecycle(traceRecorder, {
                  passNumber: pass,
                  workUnit: routed,
                  geographicGrant: workUnitGeographicGrant(routed),
                  plan: lifecycle.plan,
                  execution: lifecycle.execution,
                  resolution: lifecycle.materialization,
                });
              }
              gatherExecutions.push({
                pass,
                workUnit: routed.kind,
                sourcePlanCount: lifecycle?.plan.sourcePlans.length ?? 0,
                candidateCount: lifecycle?.execution.candidates.length ?? 0,
                outcomes: gatherOutcomesOf(lifecycle?.materialization),
              });

              if (areaRouteWalkResult.outcome !== 'no_result') {
                discoveryResolvedExperienceIds.add(
                  areaRouteWalkResult.experienceId,
                );
              }
            }

            for (const { unit, plan } of plannedUnits) {
              await this.updateGenerationStatus(
                tourId,
                'generating',
                unit.kind === 'DEDICATED_INTENT'
                  ? `Buscando una experiencia de tipo "${unit.deficit.key}"...`
                  : `Buscando más Experiences (fuentes: ${plan.sourcePlans
                      .map((sourcePlan) => sourcePlan.provider)
                      .join(', ')})...`,
              );

              await this.executeAndMaterializeAcquisitionPlan(
                plan,
                pass,
                {
                  destinationName: canonicalDestinationName,
                  destinationCountryCode: destinationResolution.countryCode,
                  geographicScope,
                },
                traceRecorder,
                {
                  attempted: acquisitionProvidersAttempted,
                  failed: acquisitionProvidersFailed,
                },
                acquisitionExecutionLedger,
                unit,
                gatherExecutions,
              );
              acquisitionEpoch++;
            }

            // Re-read the real catalog — the resolver may have created NEW,
            // reconciled SAME knowledge into an existing row, or rejected;
            // the accepted-id list alone is not the pool.
            snapshot = await readSnapshot('GATHER');
            selection = await composeSnapshot(snapshot);
            semanticRankingOutcome = selection.semanticRanking;

            currentProviderHealth =
              acquisitionProvidersAttempted.size > 0 &&
              acquisitionProvidersFailed.size ===
                acquisitionProvidersAttempted.size
                ? {
                    status: 'degraded',
                    reason: `all_acquisition_providers_failed:${[
                      ...acquisitionProvidersFailed,
                    ]
                      .sort()
                      .join(',')}`,
                  }
                : { status: 'healthy' };
            if (currentProviderHealth.status === 'degraded') {
              degradedAcquisitionReason =
                currentProviderHealth.reason ?? 'degraded';
            }

            preferenceCoverage = await this.computePreferenceCoverage(
              preferenceSpec,
              coverageScope,
              venueAnchorResolution.resolvedMustIds,
            );
            recordPreferenceCoverageStep(traceRecorder, {
              coverage: preferenceCoverage,
              context: {
                offeredCandidateCount: selection.initialExperiences.length,
                semanticRanking: semanticRankingOutcome,
                providerHealth: currentProviderHealth,
              },
            });
          }

          // A requested soft theme/trait/intent still missing after catalog +
          // bounded acquisition is a real, trace-visible deficit — but per
          // invariant it must never fail the Tour on its own. Only a
          // genuinely infeasible pool (the snapshot is empty) aborts here.
          if (snapshot.experiences.length === 0) {
            const coverageError = new Error(
              `Coverage insuficiente después de catálogo y adquisición multi-fuente acotada: ${preferenceCoverage.acquisitionDeficits
                .map((deficit) => deficit.reason)
                .join(', ')}`,
            );
            (coverageError as any).retryable =
              currentProviderHealth.status === 'degraded';
            throw coverageError;
          }
        } catch (error: any) {
          this.logger.warn(
            `Experience catalog/acquisition pipeline failed: ${error.message}`,
          );
          throw error;
        }
      }

      await this.updateGenerationStatus(
        tourId,
        'generating',
        'Planificando el itinerario día a día...',
      );

      const planningBase: Omit<DailyPlanningInput, 'candidates'> = {
        destination: destinationResolution,
        requestedDays: request.days,
        mobility: request.mobility,
        travelPace: request.mobility.travelPace,
        planningWindow: this.dailyPlanningPolicy.window,
        startDates: request.startDates,
      };

      // ── GATHER: planner capacity ──
      // A plan over the current snapshot is needed to discover a global
      // capacity deficit. While a PLANNER_CAPACITY acquisition is still
      // authorized, that plan is PROVISIONAL (acquisition planning only):
      // the acquisition runs, the catalog is re-read and the plan is
      // recomputed from the fresh snapshot. It never leaks into the Tour.
      let plan = await this.planFromSelection(
        selection,
        planningBase,
        preferenceSpec,
      );
      let acquisitionPasses = 0;
      while (
        plan.meaningfulResidual &&
        plan.promotionStopReason === 'RESERVOIR_EXHAUSTED' &&
        acquisitionPasses <
          this.dailyPlanningPolicy.backfill.maxAcquisitionPasses
      ) {
        const residual = plan.meaningfulResidual;
        acquisitionPasses++;
        const plannerDeficit: GlobalCapacityDeficit = {
          origin: 'global_capacity',
          reason: `Planner has ${residual.availableMinutes} minutes of residual capacity on day ${residual.dayNumber}`,
          currentEligibleCount: snapshot.experiences.length,
          requiredEligibleCount: snapshot.experiences.length + 1,
        };
        const plannerAcquisitionPlan =
          this.experienceAcquisitionPlanner.buildAcquisitionPlan({
            destination: this.acquisitionDiscoveryScope(
              canonicalDestinationName,
              destinationResolution.countryCode,
              {
                latitude: request.destination.latitude,
                longitude: request.destination.longitude,
                radiusMeters:
                  request.destination.radiusMeters ??
                  this.destinationScopePolicy.pointRadiusMeters,
              },
            ),
            deficits: [plannerDeficit],
            preferredFacets: preferenceSpec.facets.map((facet) => ({
              dimension: facet.dimension,
              key: facet.key,
              importance: facet.weight,
              confidence: 1,
              source: facet.source === 'free_text' ? 'free_text' : 'wizard',
            })),
            semanticQuery: preferenceSpec.semanticQuery,
            breadth: 'focused',
            anchors: resolvedAnchors,
          });
        const refillAuthorized = plannerAcquisitionPlan.sourcePlans.length > 0;
        recordProvisionalPlanStep(traceRecorder, {
          acquisitionEpoch,
          plannedExperienceIds: plan.planningSolution.days.flatMap((day) =>
            day.experiences.map((experience) => experience.experienceId),
          ),
          stopReason: plan.promotionStopReason,
          residualMinutes: residual.availableMinutes,
          refillAuthorized,
        });
        if (!refillAuthorized) {
          plan.promotionStopReason = 'NO_PROGRESS';
          break;
        }

        startGather(1);
        await this.executeAndMaterializeAcquisitionPlan(
          plannerAcquisitionPlan,
          acquisitionPasses,
          {
            destinationName: canonicalDestinationName,
            destinationCountryCode: destinationResolution.countryCode,
            geographicScope,
          },
          traceRecorder,
          {
            attempted: acquisitionProvidersAttempted,
            failed: acquisitionProvidersFailed,
          },
          acquisitionExecutionLedger,
          // Residual capacity owns no policy-bearing deficit: grant NONE,
          // whatever intents the tour requested elsewhere.
          { kind: 'PLANNER_CAPACITY', deficit: plannerDeficit },
          gatherExecutions,
        );
        acquisitionEpoch++;

        // Reconciled knowledge and refill-persisted Experiences get the same
        // ranking/composition opportunity as everything found earlier.
        snapshot = await readSnapshot('GATHER');
        selection = await composeSnapshot(snapshot);
        semanticRankingOutcome = selection.semanticRanking;
        plan = await this.planFromSelection(
          selection,
          planningBase,
          preferenceSpec,
        );
      }

      // ── ACQUISITION_COMPLETE_FOR_GENERATION ──
      // No further canonical acquisition is expected for this generation.
      // The plan below is the POST_RECONCILIATION_SELECTION: it was built
      // from a catalog snapshot read after the last acquisition execution.
      if (snapshot.acquisitionEpoch !== acquisitionEpoch) {
        throw new Error(
          `Final planning snapshot is stale (read at acquisition epoch ${snapshot.acquisitionEpoch}, gather ended at ${acquisitionEpoch})`,
        );
      }
      recordGatherBoundaryStep(traceRecorder, {
        boundary: 'GATHER_COMPLETE',
        executions: gatherExecutions,
        acquisitionEpoch,
        executedSourcePlanCount:
          acquisitionExecutionLedger.executedSourcePlanFingerprints.size,
      });
      recordCatalogSnapshotStep(traceRecorder, { ...snapshot, phase: 'FINAL' });
      recordCandidatePoolSelectionStep(traceRecorder, {
        selection,
        request,
        initialCatalogCount,
        postAcquisitionCatalogCount: snapshot.experiences.length,
        eligibleCount: preferenceCoverage.totalDistinctEligibleExperiences,
        discoveryResolvedExperienceIds,
        newlyAcquiredExperienceIds: new Set(),
        crawlProvider: undefined,
      });
      recordSemanticRankingStep(traceRecorder, {
        semanticRankingOutcome,
        candidateCount: plan.candidatesById.size,
      });

      const {
        planningSolution,
        planningInput,
        admittedPlanningCandidates,
        candidatesById: candidateExperiencesById,
        promotionAttempts,
      } = plan;
      planningSolution.metadata.convergence = {
        stopReason: plan.promotionStopReason,
        promotionAttempts,
        acquisitionPasses,
      };

      const planningInputForValidation: DailyPlanningInput = {
        ...planningInput,
        candidates: admittedPlanningCandidates,
      };
      const feasibilityResult = this.tourPlanningFeasibilityValidator.validate(
        planningSolution,
        planningInputForValidation,
      );
      if (!feasibilityResult.valid) {
        throw new Error(
          `Deterministic daily planning produced an infeasible solution: ${feasibilityResult.issues
            .map((issue) => `${issue.code}: ${issue.message}`)
            .join('; ')}`,
        );
      }

      const plannedExperienceCount = planningSolution.days.reduce(
        (total, day) => total + day.experiences.length,
        0,
      );
      if (plannedExperienceCount === 0) {
        throw new Error(
          'No se pudo construir un itinerario factible con las Experiences verificadas.',
        );
      }

      recordDailyPlanningStep(traceRecorder, { planningSolution });
      recordFinalSelectionStep(traceRecorder, {
        acquisitionEpoch,
        selectedIds: plan.selection.initialExperiences.map(
          (experience: any) => experience.id,
        ),
        reservoirIds: plan.selection.reservoirExperiences.map(
          (experience: any) => experience.id,
        ),
        labelsById: new Map(
          [...candidateExperiencesById.values()].map((experience: any) => [
            experience.id,
            experience.canonicalName ?? experience.name,
          ]),
        ),
        scoreBreakdownById: plan.selection.scoreBreakdownById,
        overlapExcluded: plan.overlapExcluded,
        planningSolution,
        convergence: planningSolution.metadata.convergence!,
      });

      await this.updateGenerationStatus(
        tourId,
        'generating',
        'Itinerario planificado. Guardando TourExperience...',
      );

      const isFoodFocusedIntent =
        preferenceSpec.facets.length === 1 &&
        preferenceSpec.facets[0].dimension === 'theme' &&
        preferenceSpec.facets[0].key === 'food';
      const physicallyInfeasibleReasons = new Set<string>([
        'DAILY_TIME_CAPACITY_EXCEEDED',
        'MAX_WALKING_PER_DAY_EXCEEDED',
        'MAX_CONTINUOUS_WALKING_EXCEEDED',
        'NO_ALLOWED_TRAVEL_MODE',
        'OPENING_HOURS_INCOMPATIBLE',
        'NO_FEASIBLE_DAY',
        'INVALID_SPATIAL_FOOTPRINT',
        'INVALID_COMPOSITE',
      ]);
      const infeasiblyUnselected = planningSolution.unselected.filter(
        (unselected) =>
          unselected.reasons.some((reason) =>
            physicallyInfeasibleReasons.has(reason),
          ),
      );
      const viableUnusedCandidateCount =
        planningSolution.unselected.length - infeasiblyUnselected.length;

      const requestedFormatIntents = Array.from(
        new Set(
          preferenceSpec.facets
            .filter((facet) => facet.dimension === 'intent')
            .map((facet) => facet.key),
        ),
      );
      const completenessInput: TourCompletenessInput = {
        requestedDays: request.days,
        travelPace: request.mobility.travelPace,
        isFoodFocusedIntent,
        selectedExperiences: planningSolution.days.flatMap((day) =>
          day.experiences.map((experience) => {
            const candidate = candidateExperiencesById.get(
              experience.experienceId,
            );
            return {
              experienceId: experience.experienceId,
              dayNumber: day.dayNumber,
              durationHours:
                (experience.endMinutesFromMidnight -
                  experience.startMinutesFromMidnight) /
                60,
              isMeal:
                Array.isArray(candidate?.traits) &&
                candidate.traits.some(
                  (trait: string) => trait.toLowerCase() === 'food',
                ),
              intents: candidate?.intents ?? [],
            };
          }),
        ),
        viableUnusedCandidateCount,
        requestedIntents: requestedFormatIntents,
      };
      const completeness =
        this.tourCompletenessValidator.validate(completenessInput);
      const correctiveRetryAttempted = false;
      recordTourCompletenessStep(traceRecorder, {
        completeness,
        retryAttempted: correctiveRetryAttempted,
      });
      // Plain, user-facing summary — never nested under generationTrace,
      // which is __DEV__-only. This is the one signal a real user gets when
      // a format they explicitly asked for didn't make it into their tour.
      const unmetFormatMessages = completeness.issues
        .filter(
          (issue): issue is UnmetRequestedFormatIssue =>
            issue.code === 'UNMET_REQUESTED_FORMAT',
        )
        .map(
          (issue) =>
            `No pudimos encontrar experiencias verificadas de tipo "${issue.requestedIntent}" para incluir en tu itinerario.`,
        );

      const selectedExperiences = planningSolution.days.flatMap((day) =>
        day.experiences.map((planned, index) => {
          const candidate = candidateExperiencesById.get(planned.experienceId);
          const nextInDay = day.experiences[index + 1];
          return {
            experienceId: planned.experienceId,
            experienceName: candidate?.name ?? 'Experience',
            duration:
              (planned.endMinutesFromMidnight -
                planned.startMinutesFromMidnight) /
              60,
            startTime: this.resolvePlannedStartTime(
              request.startDates,
              day.dayNumber,
              planned.startMinutesFromMidnight,
            ),
            notes: undefined as string | undefined,
            dayNumber: day.dayNumber,
            order: index + 1,
            travelTimeToNext: nextInDay?.travelFromPrevious?.durationMinutes,
            distanceToNext: nextInDay?.travelFromPrevious
              ? nextInDay.travelFromPrevious.distanceMeters / 1000
              : undefined,
            travelFromPrevious: planned.travelFromPrevious ?? null,
          };
        }),
      );

      const experienceIds = selectedExperiences.map(
        (selected) => selected.experienceId,
      );
      const experienceEntities = await this.prisma.experience.findMany({
        where: { id: { in: experienceIds }, status: 'VERIFIED' },
        include: { components: { include: { geoEntity: true } } },
      });

      const materializedTourExperiences = selectedExperiences
        .filter((selected) =>
          experienceEntities.some(
            (experience) => experience.id === selected.experienceId,
          ),
        )
        .map((selected) => {
          const experience = experienceEntities.find(
            (candidate) => candidate.id === selected.experienceId,
          )!;
          return {
            experienceId: selected.experienceId,
            dayNumber: selected.dayNumber,
            order: selected.order,
            startTime: selected.startTime?.toISOString(),
            durationHours: selected.duration,
            componentCount: distinctResolvedSourceMembers(experience).length,
          };
        });

      let generationTrace!: GenerationTraceV5;
      const materializationCheckpoint = traceRecorder.checkpoint();

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.tourExperience.deleteMany({ where: { tourId } });

          for (const selected of selectedExperiences) {
            const experience = experienceEntities.find(
              (candidate) => candidate.id === selected.experienceId,
            );
            if (!experience) {
              this.logger.warn(
                `Skipping unmaterialized planner item ${selected.experienceId}: V2 only persists verified Experiences.`,
              );
              continue;
            }
            await tx.tourExperience.create({
              data: buildTourExperienceCreateData(tourId, selected, experience),
            });
          }

          if (this.outboxService) {
            for (const experience of experienceEntities) {
              if (experience.mediaStatus === 'PENDING') {
                const [firstResolved] =
                  distinctResolvedSourceMembers(experience);
                await this.outboxService.createInTx(tx, {
                  eventType: 'ExperienceMediaEnrichmentRequested',
                  payload: {
                    experienceId: experience.id,
                    name: experience.canonicalName,
                    destinationLabel: request.destination?.label,
                    latitude:
                      experience.latitude ??
                      firstResolved?.geoEntity?.latitude ??
                      0,
                    longitude:
                      experience.longitude ??
                      firstResolved?.geoEntity?.longitude ??
                      0,
                    category: firstResolved?.role,
                  },
                });
              }
            }
          }

          recordTourMaterializationStep(traceRecorder, {
            tourId,
            materializedTourExperiences,
          });

          generationTrace = traceRecorder.build({
            runtime: {
              buildCommit: process.env.BUILD_COMMIT ?? 'unknown',
              buildTimestamp: process.env.BUILD_TIMESTAMP ?? 'unknown',
            },
            canonicalRequest: request,
            result: {
              status: 'COMPLETED',
              outcome: 'TOUR_EXPERIENCES_MATERIALIZED',
              facts: {
                materializedTourExperiences,
                tourCompleteness: {
                  ...completeness,
                  retryAttempted: correctiveRetryAttempted,
                },
                degradedAcquisitionReason,
                acquisitionProvidersAttempted: Array.from(
                  acquisitionProvidersAttempted,
                ),
                acquisitionProvidersFailed: Array.from(
                  acquisitionProvidersFailed,
                ),
              },
            },
          });

          await tx.tour.update({
            where: { id: tourId },
            data: {
              metadata: {
                ...withoutGenerationFailure(metadata),
                generationStatus: request.skipImageGeneration
                  ? 'finalizing'
                  : 'generating',
                generationMessage: request.skipImageGeneration
                  ? 'Finalizando itinerario...'
                  : 'Generando imagen de portada...',
                generationTrace,
              },
            },
          });
        });
      } catch (error) {
        traceRecorder.rollback(materializationCheckpoint);
        throw error;
      }

      if (!request.skipImageGeneration) {
        try {
          await this.updateGenerationStatus(
            tourId,
            'generating',
            'Generando imagen de portada...',
          );
          await this.tourImageService.generateTourCoverImage(tourId);
        } catch (imgError: any) {
          this.logger.warn(
            `Failed to generate cover image: ${imgError.message}`,
          );
        }
      }

      const completedMessage = `¡Listo! ${selectedExperiences.length} experiencias generadas exitosamente.`;
      const completedTour = await this.toursService.findOne(tourId);
      const effectiveMetadata =
        (completedTour?.metadata as any) || (metadata as any) || {};
      await this.prisma.$transaction(async (tx) => {
        await tx.tour.update({
          where: { id: tourId },
          data: {
            metadata: {
              ...withoutGenerationFailure(effectiveMetadata),
              generationTrace,
              generationStatus: 'completed',
              generationMessage: completedMessage,
              generationCompletedAt: new Date().toISOString(),
              completenessNotice:
                unmetFormatMessages.length > 0 ? unmetFormatMessages : null,
            },
          },
        });
        if (this.outboxService) {
          await this.outboxService.createInTx(tx, {
            eventType: 'TourCompleted',
            payload: {
              tourId,
              userId: tour.ownerId || undefined,
              status: 'COMPLETED',
              totalActivities: selectedExperiences.length,
              message: completedMessage,
            },
          });
        }
      });

      return this.toursService.findOne(tourId);
    } catch (error: any) {
      let latestTour: any = null;
      try {
        latestTour = await this.toursService.findOne(tourId);
      } catch {}

      const userId = latestTour?.ownerId || undefined;
      const failureMessage = `Error: ${
        error?.message || 'No se pudo generar el itinerario'
      }`;

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.tour.update({
            where: { id: tourId },
            data: {
              metadata: {
                ...(latestTour?.metadata as any),
                generationStatus: 'failed',
                generationMessage: failureMessage,
                generationError: error?.message || String(error),
                generationFailedAt: new Date().toISOString(),
                generationTrace: traceRecorder.build({
                  runtime: {
                    buildCommit: process.env.BUILD_COMMIT ?? 'unknown',
                    buildTimestamp: process.env.BUILD_TIMESTAMP ?? 'unknown',
                  },
                  canonicalRequest: ((latestTour?.metadata as any)
                    ?.generationRequest ??
                    metadata?.generationRequest ??
                    {}) as TourGenerationRequest,
                  result: {
                    status: 'FAILED',
                    outcome: 'GENERATION_FAILED',
                    reason: error?.message || String(error),
                    facts: {
                      error: error?.message || String(error),
                      degradedAcquisitionReason,
                      acquisitionProvidersAttempted: Array.from(
                        acquisitionProvidersAttempted,
                      ),
                      acquisitionProvidersFailed: Array.from(
                        acquisitionProvidersFailed,
                      ),
                    },
                  },
                }),
              },
            },
          });

          if (this.outboxService) {
            await this.outboxService.createInTx(tx, {
              eventType: 'TourFailed',
              payload: {
                tourId,
                userId,
                status: 'FAILED',
                message: failureMessage,
              },
            });
          }
        });
      } catch (statusError: any) {
        this.logger.error(
          `Failed to persist terminal failure state for tour ${tourId}: ${
            statusError?.message || statusError
          }`,
        );
      }

      this.logger.error(
        `Failed to generate experiences for tour ${tourId}: ${error.message}`,
        error.stack,
      );

      const wrapped = new BadRequestException(
        `Failed to generate experiences: ${error.message}`,
      );
      // Preserve an explicit retryable signal (e.g. from the genuinely
      // empty-pool coverage throw above) across this wrap — without this,
      // classifyGenerationFailure never sees it and falls back to its
      // whole-trace heuristic scan.
      if (typeof error.retryable === 'boolean') {
        (wrapped as any).retryable = error.retryable;
      }
      throw wrapped;
    }
  }
}
