import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PrismaService } from '@core/database/prisma.service';
import { OutboxService } from '../../outbox/services/outbox.service';
import { ToursService } from './tours.service';
import { TourImageService } from './tour-image.service';
import { DestinationResolutionService } from './destination-resolution.service';
import {
  boundingBoxToCenterRadius,
  pointRadiusToGeometry,
} from '../utils/geometry-search-area.util';
import {
  BudgetLevel,
  GroupType,
  TourGenerationRequest,
} from '../interfaces/tour-generation.interface';
import { CandidateScoreBreakdown } from '../utils/candidate-ranking.util';
import { filterOverlappingExperienceCandidates } from '../utils/candidate-overlap-filter.util';
import {
  buildExperienceCandidatePoolStep,
  buildPreferenceCoverageStep,
  buildDailyPlanningStep,
  buildAcquisitionStep,
  buildDbSearchStep,
  buildDestinationResolutionStep,
  buildEmbeddingsStep,
  buildEntityResolutionStep,
  buildGeographicValidationStep,
  buildCatalogMaterializationStep,
  buildTourIntentStep,
  buildTourCompletenessStep,
} from '../utils/generation-trace-builder.util';
import { TourCompletenessValidator } from './tour-completeness-validator.service';
import {
  TourCompletenessInput,
  UnmetRequestedFormatIssue,
} from '../interfaces/tour-completeness.interface';
import { GenerationTraceStep } from '../interfaces/generation-trace.interface';
import { PlanningCandidateNormalizerService } from './planning-candidate-normalizer.service';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import {
  DAILY_PLANNING_SOLVER,
  DailyPlanningInput,
  DailyPlanningSolver,
  TOUR_PLANNING_FEASIBILITY_VALIDATOR,
  TourPlanningFeasibilityValidator,
} from '../interfaces/daily-planning.interface';
import {
  ExperienceCatalogService,
  VerifiedExperienceRow,
} from './experience-catalog.service';
import { ExperienceAcquisitionService } from './experience-acquisition.service';
import { ExperienceAcquisitionPlannerService } from './experience-acquisition-planner.service';
import { AreaRouteWalkAcquisitionService } from './area-route-walk-acquisition.service';
import { partitionDeficitsByStrategy } from '../utils/acquisition-strategy-selector.util';
import { redactTracePayload } from '../utils/trace-redaction.util';
import { buildGenerationExecutionSummary } from '../utils/generation-execution-summary.util';
import { PreferenceInterpreterService } from './preference-interpreter.service';
import { EmbeddingIndexIdentity } from '@shared/ai/interfaces/embedding-index.interface';
import { findHardExclusionMatches } from '../utils/experience-preference-evaluator.util';
import { ExperienceCompositionService } from './experience-composition.service';
import {
  getFacetKeysByDimension,
  NormalizedPreferenceIntent,
} from '../interfaces/preference-interpretation.interface';
import { PreferenceFacet } from '../preferences/preference-facet.interface';
import {
  mergePreferenceFacets,
  normalizeWizardFacet,
} from '../utils/preference-facet-merge.util';
import { buildTourExperienceCreateData } from '../utils/tour-experience-snapshot.util';
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
} from '../interfaces/preference-spec.interface';
import { AcquisitionDeficit } from '../interfaces/experience-acquisition-plan.interface';

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
  experiences: any[];
  semanticRanking: SemanticRankingOutcome;
  scoreBreakdownById: Map<string, CandidateScoreBreakdown>;
  preferenceEvaluationById: Map<string, unknown>;
  hardExclusionRelaxed: boolean;
}

function formatExperienceForPrompt(experience: any): string {
  const themes = Array.isArray(experience.themes)
    ? experience.themes.join(', ')
    : '';
  const traits = Array.isArray(experience.traits)
    ? experience.traits.join(', ')
    : '';
  const intents = Array.isArray(experience.intents)
    ? experience.intents.join(', ')
    : '';
  const components = Array.isArray(experience.components)
    ? experience.components
        .map((component: any) => component.geoEntity?.name ?? component.name)
        .filter(Boolean)
        .join(', ')
    : '';
  return [
    `${experience.id}: ${experience.canonicalName ?? experience.name ?? 'Experience'}`,
    experience.description,
    themes ? `themes=${themes}` : undefined,
    traits ? `traits=${traits}` : undefined,
    intents ? `intents=${intents}` : undefined,
    components ? `components=${components}` : undefined,
  ]
    .filter(Boolean)
    .join(' | ');
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
    private readonly tourImageService: TourImageService,
    private readonly destinationResolutionService: DestinationResolutionService,
    private readonly facetRetrieval: FacetRetrievalService,
    private readonly experienceAcquisitionPlanner: ExperienceAcquisitionPlannerService,
    private readonly areaRouteWalkAcquisition: AreaRouteWalkAcquisitionService,
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
    @Optional()
    private readonly outboxService?: OutboxService,
    @Optional()
    private readonly preferenceInterpreter?: PreferenceInterpreterService,
  ) {}

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

  private mergeStructuredPreferences(
    interpreted: NormalizedPreferenceIntent,
    request: TourGenerationRequest,
  ): NormalizedPreferenceIntent {
    const unique = (values: string[]) =>
      Array.from(
        new Set(
          values.map((value) => value.trim().toLowerCase()).filter(Boolean),
        ),
      );
    const dietary = unique([
      ...interpreted.dietaryPreferences,
      ...(request.dietaryRestrictions ?? []),
    ]);
    const accessibility = unique([
      ...interpreted.accessibilityPreferences,
      ...(request.mobility.accessibilityNeeds ?? []),
    ]);
    const hardExclusions = [...interpreted.hardExclusions];
    if (dietary.some((value) => /vegan|vegano|vegana/.test(value))) {
      hardExclusions.push('non-vegan food');
    }
    const budgetPreferences = [...interpreted.budgetPreferences];
    if (request.budgetLevel === BudgetLevel.LOW) {
      budgetPreferences.push('low budget');
    }
    const groupPreferences = [...interpreted.groupPreferences];
    if (request.groupType === GroupType.FAMILY) {
      groupPreferences.push('family friendly');
    }

    const wizardFacets: PreferenceFacet[] = [
      ...(request.intent.interests ?? []).map((interest) =>
        normalizeWizardFacet('theme', interest),
      ),
      ...(request.intent.intents ?? []).map((intent) =>
        normalizeWizardFacet('intent', intent),
      ),
      // The wizard's always-present explorationStyle field: ICONIC /
      // LOCAL_DEEP_DIVE become an exploration_style facet that influences
      // ranking only; BALANCED normalizes to undefined (neutral, no facet).
      // This is the single merge point where the structured field reaches
      // NormalizedPreferenceIntent — it never touches acquisition or search
      // queries.
      normalizeWizardFacet(
        'exploration_style',
        request.intent.explorationStyle,
      ),
    ].filter((facet): facet is PreferenceFacet => facet !== undefined);

    const preferredFacets = mergePreferenceFacets(
      wizardFacets,
      interpreted.preferredFacets ?? [],
    );

    return {
      ...interpreted,
      preferredFacets,
      excludedThemes: unique(interpreted.excludedThemes),
      excludedTraits: unique(interpreted.excludedTraits),
      hardExclusions: unique(hardExclusions),
      softConstraints: unique(interpreted.softConstraints),
      ambiguities: unique(interpreted.ambiguities),
      dietaryPreferences: dietary,
      accessibilityPreferences: accessibility,
      budgetPreferences: unique(budgetPreferences),
      groupPreferences: unique(groupPreferences),
    };
  }

  private hydratePersistedExperience(experience: any): any {
    const metadata =
      experience?.metadata &&
      typeof experience.metadata === 'object' &&
      !Array.isArray(experience.metadata)
        ? experience.metadata
        : {};
    const firstPoint = experience.components?.find(
      (component: any) =>
        Number.isFinite(component.geoEntity?.latitude) &&
        Number.isFinite(component.geoEntity?.longitude),
    )?.geoEntity;
    const traitDefinitions = (experience.traits ?? []).map(
      (trait: any) => trait.traitDefinition,
    );
    const metadataDimensioned = Array.isArray(metadata.dimensionedTraits)
      ? (metadata.dimensionedTraits as Array<{
          dimension: string;
          key: string;
          label?: string;
        }>)
      : [];
    const dimensionedTraits = [
      ...metadataDimensioned,
      ...traitDefinitions.filter(Boolean).map((definition: any) => ({
        dimension: definition.dimension,
        key: definition.key,
        label: definition.label ?? undefined,
      })),
    ];
    return {
      id: experience.id,
      name: experience.canonicalName,
      canonicalName: experience.canonicalName,
      description: experience.description,
      latitude: experience.latitude ?? firstPoint?.latitude,
      longitude: experience.longitude ?? firstPoint?.longitude,
      duration: (experience.durationMinutes ?? 120) / 60,
      durationMinutes: experience.durationMinutes,
      price: experience.price,
      qualityScore: experience.qualityScore,
      themes: Array.isArray(metadata.themes) ? metadata.themes : [],
      intents: Array.isArray(metadata.intents)
        ? metadata.intents
        : Array.isArray(metadata.archetypes)
          ? metadata.archetypes
          : [],
      traits: Array.from(
        new Set([
          ...(Array.isArray(metadata.traits) ? metadata.traits : []),
          ...traitDefinitions.flatMap((definition: any) =>
            [definition?.label, definition?.key].filter(Boolean),
          ),
        ]),
      ),
      dimensionedTraits,
      metadata: {
        ...metadata,
        dimensionedTraits,
        source: 'experience_catalog',
        experienceId: experience.id,
      },
      components: experience.components ?? [],
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
    // M2 does not yet wire anchor/composition reservations into the
    // portfolio target (M3's acquisition-strategy anchors, M5's
    // composition) -- 0 distinct reservations, 0 distinct must-anchors.
    // `portfolioTarget` degrades to `baseTarget` alone until then.
    const target = portfolioTarget(baseTarget, 0, 0);

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

  private buildCandidatePoolTraceStep(
    selection: CandidateSelection,
    discoveryResolvedExperienceIds: Set<string>,
    newlyAcquiredExperienceIds: Set<string>,
    crawlProvider: 'google' | 'geoapify' | undefined,
    request: TourGenerationRequest,
    initialCatalogCount: number,
    postAcquisitionCatalogCount: number,
    eligibleCount: number,
  ): GenerationTraceStep {
    const offeredCandidates = selection.experiences.map((experience: any) => ({
      id: experience.id,
      name: experience.name,
      metadata: {
        ...(experience.metadata ?? {}),
        preferenceEvaluation: selection.preferenceEvaluationById.get(
          experience.id,
        ),
        hardExclusionRelaxed: selection.hardExclusionRelaxed,
      },
      traceSource: discoveryResolvedExperienceIds.has(experience.id)
        ? ('discovery' as const)
        : newlyAcquiredExperienceIds.has(experience.id)
          ? crawlProvider === 'google'
            ? ('google_places' as const)
            : ('geoapify' as const)
          : ('db' as const),
      scoreBreakdown: selection.scoreBreakdownById.get(experience.id)!,
    }));
    return buildExperienceCandidatePoolStep({
      initialCatalogCount,
      postAcquisitionCatalogCount,
      eligibleCount,
      offeredCandidates,
      requestedThemes: request.intent.interests,
    });
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

  private readonly CATALOG_RETRIEVAL_POOL_LIMIT = 250;
  private async composeExperiences(
    experiences: any[],
    preferenceSpec: PreferenceSpec,
  ): Promise<CandidateSelection> {
    const composition = await this.experienceComposition.compose({
      experiences,
      preferenceSpec,
    });
    const orderedIds = [
      ...composition.result.selected,
      ...composition.result.reservoir,
    ];
    const selected = composition.result.selected
      .map((id) => composition.candidatesById.get(id))
      .filter(Boolean);
    const scoreBreakdownById = new Map<string, CandidateScoreBreakdown>();
    for (const [index, id] of orderedIds.entries()) {
      const candidate = composition.candidatesById.get(id);
      scoreBreakdownById.set(id, {
        semanticSimilarity: null,
        qualityBonus:
          typeof candidate?.qualityScore === 'number'
            ? candidate.qualityScore
            : 0,
        proximityBonus: 0,
        diversityBonus: 0,
        totalScore: orderedIds.length - index,
      });
    }
    return {
      experiences: selected,
      scoreBreakdownById,
      preferenceEvaluationById: new Map(),
      hardExclusionRelaxed: false,
      semanticRanking: {
        status: preferenceSpec.semanticQuery.trim()
          ? 'applied'
          : 'not_requested',
        eligibleCandidateCount: experiences.length,
        indexedCandidateCount: 0,
      },
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

    const traceSteps: GenerationTraceStep[] = [];

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

      let availableExperiencesText = '';
      const candidateExperienceIds = new Set<string>();
      const candidateExperiencesById = new Map<string, any>();
      const offeredScoreBreakdownById = new Map<
        string,
        CandidateScoreBreakdown
      >();
      const allEligibleExperiencesById = new Map<string, any>();
      const discoveryResolvedExperienceIds = new Set<string>();
      // Canonical multi-source acquisition bookkeeping (was: placesRefillError).
      // Per-pass detail lands in the trace via buildAcquisitionStep; only the
      // degraded-all-providers signal needs to survive to the failure branch.
      const acquisitionProvidersAttempted = new Set<string>();
      const acquisitionProvidersFailed = new Set<string>();
      let degradedAcquisitionReason: string | null = null;

      const recordOfferedCandidates = (selection: CandidateSelection) => {
        selection.experiences.forEach((experience: any) => {
          candidateExperienceIds.add(experience.id);
          candidateExperiencesById.set(experience.id, experience);
          const breakdown = selection.scoreBreakdownById.get(experience.id);
          if (breakdown) {
            offeredScoreBreakdownById.set(experience.id, breakdown);
          }
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

      const normalizedPreferences = this.mergeStructuredPreferences(
        preferenceInterpretation.intent,
        request,
      );
      request.intent.normalizedPreferences = normalizedPreferences;
      request.intent.interests = Array.from(
        new Set([
          ...request.intent.interests,
          ...getFacetKeysByDimension(
            normalizedPreferences.preferredFacets,
            'theme',
          ),
        ]),
      );
      if (normalizedPreferences.positiveSemanticQuery) {
        request.intent.additionalPreferences =
          normalizedPreferences.positiveSemanticQuery;
      }

      // M1 (preference-first live cutover) -- the canonical PreferenceSpec
      // (spec §3, plan Task A3), built once here from the RAW interpreter
      // output (buildPreferenceSpec does its own wizard-facet merging
      // internally; passing the already `mergeStructuredPreferences`-merged
      // `normalizedPreferences` would double-merge wizard facets). This is
      // the single normalized-requirement model every later milestone reads
      // (retrieval, sufficiency, acquisition-strategy selection,
      // composition) instead of `NormalizedPreferenceIntent`/ad-hoc
      // `request.intent.*` field reads.
      const preferenceSpec = buildPreferenceSpec(
        request,
        preferenceInterpretation.intent,
      );

      traceSteps.push({
        stage: 'preference_interpretation',
        label: 'Interpretación de preferencias',
        summary:
          preferenceInterpretation.trace.status === 'applied'
            ? 'Preferencias libres normalizadas y combinadas con filtros.'
            : preferenceInterpretation.trace.status === 'fallback'
              ? 'Preferencias estructuradas aplicadas con respaldo determinístico.'
              : 'Filtros estructurados aplicados.',
        component: 'PreferenceInterpreterService',
        status:
          preferenceInterpretation.trace.status === 'applied'
            ? 'PASS'
            : preferenceInterpretation.trace.status === 'fallback'
              ? 'WARN'
              : 'INFO',
        inputs: {
          hasAdditionalPreferences: Boolean(
            request.intent.additionalPreferences?.trim(),
          ),
          intents: request.intent.intents ?? [],
          dietaryRestrictions: request.dietaryRestrictions,
          accessibilityNeeds: request.mobility.accessibilityNeeds,
          budgetLevel: request.budgetLevel,
          groupType: request.groupType,
        },
        outputs: { intent: normalizedPreferences, preferenceSpec },
        preferenceInterpretation: {
          ...preferenceInterpretation.trace,
          parsedResponse: normalizedPreferences,
        },
        timing: { durationMs: preferenceInterpretation.trace.durationMs },
      });
      traceSteps.push(buildTourIntentStep(request));

      const destinationResolution =
        await this.destinationResolutionService.resolveDestination(
          request.destination.label,
          {
            latitude: request.destination.latitude,
            longitude: request.destination.longitude,
          },
          request.destination.scaleHint,
        );
      traceSteps.push(
        buildDestinationResolutionStep(
          request.destination.label,
          destinationResolution,
        ),
      );

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
      const destinationScope = isAreaScale
        ? destinationResolution.boundary
        : {
            id: 'point-radius-scope',
            name: request.destination.label ?? 'selected destination',
            osmType: 'relation' as const,
            osmId: 0,
            geometry: pointRadiusToGeometry(
              request.destination.latitude,
              request.destination.longitude,
              request.destination.radiusMeters || 25000,
            ),
            tags: {},
          };

      const searchArea = isAreaScale
        ? boundingBoxToCenterRadius(destinationResolution.boundary.geometry)
        : {
            latitude: request.destination.latitude,
            longitude: request.destination.longitude,
            radiusMeters: request.destination.radiusMeters || 25000,
          };
      if (
        Number.isFinite(request.destination.latitude) &&
        Number.isFinite(request.destination.longitude)
      ) {
        const radius = searchArea.radiusMeters;
        const experienceLimit = this.CATALOG_RETRIEVAL_POOL_LIMIT;

        await this.updateGenerationStatus(
          tourId,
          'generating',
          `Buscando Experiences verificadas en la zona (radio ${Math.round(radius / 1000)}km)...`,
        );

        try {
          const nearbyExperiences = await this.withTimeout(
            this.experienceCatalog.findVerifiedWithin(
              searchArea.latitude,
              searchArea.longitude,
              radius,
              experienceLimit,
            ),
            10000,
            'Experience catalog search timeout',
          );
          nearbyExperiences.forEach((experience: any) =>
            allEligibleExperiencesById.set(experience.id, experience),
          );
          const selection = await this.composeExperiences(
            nearbyExperiences,
            preferenceSpec,
          );
          const nearbyExperiencesSample = selection.experiences;
          semanticRankingOutcome = selection.semanticRanking;
          const initialPreferenceCoverage =
            await this.computePreferenceCoverage(preferenceSpec, searchArea);
          traceSteps.push(
            buildPreferenceCoverageStep(initialPreferenceCoverage, {
              offeredCandidateCount: nearbyExperiencesSample.length,
              semanticRanking: semanticRankingOutcome,
              providerHealth: { status: 'healthy' },
            }),
          );

          if (initialPreferenceCoverage.sufficient) {
            await this.updateGenerationStatus(
              tourId,
              'generating',
              `${nearbyExperiences.length} Experiences relevantes encontradas. Ordenando según tus preferencias...`,
            );
            recordOfferedCandidates(selection);
            availableExperiencesText = `\n\nAvailable verified Experiences in the area (within ${radius / 1000}km):\n${nearbyExperiencesSample
              .map((experience: any) => formatExperienceForPrompt(experience))
              .join('\n')}`;
            traceSteps.push(
              buildDbSearchStep(nearbyExperiencesSample, radius / 1000),
              this.buildCandidatePoolTraceStep(
                selection,
                discoveryResolvedExperienceIds,
                new Set(),
                undefined,
                request,
                nearbyExperiences.length,
                nearbyExperiences.length,
                initialPreferenceCoverage.totalDistinctEligibleExperiences,
              ),
            );
          } else {
            traceSteps.push(
              buildDbSearchStep(nearbyExperiences, radius / 1000),
            );

            // ── Canonical bounded multi-source acquisition loop ──
            // Replaces the former hand-rolled discovery + Places-only refill
            // cascade with the single canonical path:
            //   coverage deficits → ExperienceAcquisitionPlannerService
            //   .buildAcquisitionPlan → ExperienceAcquisitionService.executePlan
            //   (structured providers + web discovery) → materializeExecution
            //   (ExperienceProposalResolver) → catalog re-query →
            //   FacetRetrievalService/preference-sufficiency, bounded by
            //   MAX_ACQUISITION_PASSES.
            const acquisitionScope = {
              destinationName: request.destination.label,
              latitude: searchArea.latitude,
              longitude: searchArea.longitude,
              radiusMeters: searchArea.radiusMeters,
            };

            let currentPool = nearbyExperiences;
            let currentSelection = selection;
            let currentPreferenceCoverage = initialPreferenceCoverage;
            let currentProviderHealth: {
              status: 'healthy' | 'degraded' | 'unknown';
              reason?: string;
            } = { status: 'healthy' };

            for (let pass = 1; pass <= MAX_ACQUISITION_PASSES; pass++) {
              if (currentPreferenceCoverage.sufficient) break;

              // M3 (preference-first live cutover): the ONE place deficits
              // are routed to an acquisition strategy. An area/route anchor
              // + walk/route_like deficit goes to
              // AreaRouteWalkAcquisitionService; every other deficit
              // (including every global_capacity deficit, deliberately
              // dimensionless and never anchor-routable) continues through
              // generic acquisition exactly as before. The canonical
              // deficit objects from FacetRetrievalService/
              // preference-sufficiency.util.ts are passed straight through
              // to whichever strategy handles them -- never recomputed,
              // never reconstructed.
              const { areaRouteWalk, generic } = partitionDeficitsByStrategy(
                currentPreferenceCoverage.acquisitionDeficits,
                preferenceSpec.anchors,
              );

              // M2 (preference-first live cutover): deficits are now the
              // real FacetRetrievalService-derived unsatisfied facets
              // (`origin: 'preference_facet'`), never the legacy
              // CoverageAnalyzer/theme-matching projection -- this is the
              // one canonical deficit source feeding acquisition routing.
              const acquisitionPlan =
                this.experienceAcquisitionPlanner.buildAcquisitionPlan({
                  destination: acquisitionScope,
                  deficits: generic,
                  semanticQuery: normalizedPreferences.positiveSemanticQuery,
                  breadth: 'focused',
                });
              const genericRoutable = acquisitionPlan.sourcePlans.length > 0;

              if (!genericRoutable && areaRouteWalk.length === 0) {
                // Nothing routable — a soft-only deficit. Stop acquiring; the
                // gap stays visible in the coverage trace, never fatal.
                break;
              }

              for (const routed of areaRouteWalk) {
                await this.updateGenerationStatus(
                  tourId,
                  'generating',
                  `Buscando una experiencia de tipo "${routed.intentKey}" en "${routed.anchor.rawName}"...`,
                );

                const areaRouteWalkResult =
                  await this.areaRouteWalkAcquisition.acquireOrReuse({
                    anchor: routed.anchor,
                    intentKey: routed.intentKey,
                    destination: acquisitionScope,
                    destinationCountryCode: destinationResolution.countryCode,
                    destinationPoint: {
                      latitude: searchArea.latitude,
                      longitude: searchArea.longitude,
                    },
                    destinationBoundary: destinationScope,
                    destinationPointRadius: isAreaScale
                      ? undefined
                      : {
                          latitude: request.destination.latitude,
                          longitude: request.destination.longitude,
                          radiusMeters: searchArea.radiusMeters,
                        },
                    deficit: routed.deficit,
                    semanticQuery: normalizedPreferences.positiveSemanticQuery,
                  });

                if (areaRouteWalkResult.outcome !== 'no_result') {
                  const persisted = await this.prisma.experience.findMany({
                    where: {
                      id: areaRouteWalkResult.experienceId,
                      status: 'VERIFIED',
                    },
                    include: {
                      components: { include: { geoEntity: true } },
                      traits: { include: { traitDefinition: true } },
                    },
                  });
                  persisted.forEach((experience: any) => {
                    allEligibleExperiencesById.set(
                      experience.id,
                      this.hydratePersistedExperience(experience),
                    );
                    discoveryResolvedExperienceIds.add(experience.id);
                  });
                }
              }

              if (genericRoutable) {
                await this.updateGenerationStatus(
                  tourId,
                  'generating',
                  `Buscando más Experiences (fuentes: ${acquisitionPlan.sourcePlans
                    .map((sourcePlan) => sourcePlan.provider)
                    .join(', ')})...`,
                );

                const execution =
                  await this.experienceAcquisition.executePlan(acquisitionPlan);

                for (const [provider, res] of Object.entries(
                  execution.providerResults,
                )) {
                  acquisitionProvidersAttempted.add(provider);
                  if ((res as any)?.status === 'failed') {
                    acquisitionProvidersFailed.add(provider);
                  }
                }
                for (const web of execution.webResults ?? []) {
                  acquisitionProvidersAttempted.add('web');
                  if (web.status === 'failed') {
                    acquisitionProvidersFailed.add('web');
                  }
                }

                traceSteps.push(
                  buildAcquisitionStep({
                    passNumber: pass,
                    plan: acquisitionPlan,
                    execution,
                  }),
                );

                if (execution.candidates.length > 0) {
                  const resolution =
                    await this.experienceAcquisition.materializeExecution(
                      execution,
                      {
                        destinationName: request.destination.label,
                        destinationCountryCode:
                          destinationResolution.countryCode,
                        destinationBoundary: destinationScope,
                        destinationPointRadius: isAreaScale
                          ? undefined
                          : {
                              latitude: request.destination.latitude,
                              longitude: request.destination.longitude,
                              radiusMeters: searchArea.radiusMeters,
                            },
                      },
                    );
                  traceSteps.push(
                    buildEntityResolutionStep(resolution),
                    buildGeographicValidationStep(resolution),
                    buildCatalogMaterializationStep(resolution),
                  );

                  const acceptedIds = resolution.resolved
                    .filter(
                      (result) =>
                        result.status === 'accepted' && result.experienceId,
                    )
                    .map((result) => result.experienceId as string);
                  if (acceptedIds.length > 0) {
                    const persisted = await this.prisma.experience.findMany({
                      where: { id: { in: acceptedIds }, status: 'VERIFIED' },
                      include: {
                        components: { include: { geoEntity: true } },
                        traits: { include: { traitDefinition: true } },
                      },
                    });
                    persisted.forEach((experience: any) => {
                      allEligibleExperiencesById.set(
                        experience.id,
                        this.hydratePersistedExperience(experience),
                      );
                      discoveryResolvedExperienceIds.add(experience.id);
                    });
                  }
                }
              }

              // Re-query the real catalog — the resolver may have created NEW,
              // resolved SAME, enriched an existing row, or rejected; the
              // accepted-id list alone is not the pool.
              const refreshed = await this.experienceCatalog.findVerifiedWithin(
                searchArea.latitude,
                searchArea.longitude,
                radius,
                experienceLimit,
              );
              refreshed.forEach((experience: any) =>
                allEligibleExperiencesById.set(experience.id, experience),
              );
              currentPool = Array.from(allEligibleExperiencesById.values());
              currentSelection = await this.composeExperiences(
                currentPool,
                preferenceSpec,
              );
              semanticRankingOutcome = currentSelection.semanticRanking;

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

              currentPreferenceCoverage = await this.computePreferenceCoverage(
                preferenceSpec,
                searchArea,
              );
              traceSteps.push(
                buildPreferenceCoverageStep(currentPreferenceCoverage, {
                  offeredCandidateCount: currentSelection.experiences.length,
                  semanticRanking: semanticRankingOutcome,
                  providerHealth: currentProviderHealth,
                }),
              );
            }

            // A requested soft theme/trait/intent still missing after catalog +
            // bounded acquisition is a real, trace-visible deficit — but per
            // invariant it must never fail the Tour on its own. Only a
            // genuinely infeasible pool (currentPool is empty) aborts here.
            if (currentPool.length === 0) {
              const coverageError = new Error(
                `Coverage insuficiente después de catálogo y adquisición multi-fuente acotada: ${currentPreferenceCoverage.acquisitionDeficits
                  .map((deficit) => deficit.reason)
                  .join(', ')}`,
              );
              (coverageError as any).retryable =
                currentProviderHealth.status === 'degraded';
              throw coverageError;
            }

            recordOfferedCandidates(currentSelection);
            availableExperiencesText = `\n\nAvailable verified Experiences in the area (within ${radius / 1000}km):\n${currentSelection.experiences
              .map((experience: any) => formatExperienceForPrompt(experience))
              .join('\n')}`;
            traceSteps.push(
              this.buildCandidatePoolTraceStep(
                currentSelection,
                discoveryResolvedExperienceIds,
                new Set(),
                undefined,
                request,
                nearbyExperiences.length,
                currentPool.length,
                currentPreferenceCoverage.totalDistinctEligibleExperiences,
              ),
            );
          }
        } catch (error: any) {
          this.logger.warn(
            `Experience catalog/acquisition pipeline failed: ${error.message}`,
          );
          if (!availableExperiencesText) {
            throw error;
          }
        }

        traceSteps.push(
          buildEmbeddingsStep(
            semanticRankingOutcome,
            candidateExperienceIds.size,
          ),
        );
      }

      if (!availableExperiencesText) {
        if (degradedAcquisitionReason) {
          // Every acquisition source consulted this run failed and the catalog
          // has no relevant coverage yet — worth retrying once the providers
          // recover. (A bare destination with providers responding normally
          // but empty is NOT retryable — that path lands on the generic
          // message below.)
          const degradedError = new Error(
            'No se encontraron Experiences verificadas y relevantes, y todas las fuentes de adquisición consultadas fallaron. Volvé a intentar cuando los proveedores se recuperen.',
          );
          (degradedError as any).retryable = true;
          throw degradedError;
        }
        throw new Error(
          'No se encontraron Experiences verificadas y relevantes para esta solicitud.',
        );
      }

      await this.updateGenerationStatus(
        tourId,
        'generating',
        'Planificando el itinerario día a día...',
      );

      // Verified live: a standalone POI Experience and a composite Experience
      // that separately resolved the *same real place* as one of its own
      // components can both reach this pool as unrelated records (their
      // GeoEntity rows may predate ExperienceCatalogService.upsertGeoEntity's
      // cross-provider reconciliation, or some other gap could still produce
      // the same split) — the solver has no way to know they're the same
      // place, so it can book a traveler into it twice on two different days.
      // Filter that overlap out of the pool itself, before normalization.
      const overlapFilter = filterOverlappingExperienceCandidates(
        Array.from(candidateExperiencesById.values()).map((experience) => ({
          ...experience,
          rankingScore: offeredScoreBreakdownById.get(experience.id)
            ?.totalScore,
        })),
      );
      if (overlapFilter.excluded.length > 0) {
        this.logger.log(
          `Excluded ${overlapFilter.excluded.length} candidate(s) redundant with another selected candidate covering the same real place: ${overlapFilter.excluded
            .map((item) => `${item.id} (kept ${item.overlapsWith})`)
            .join(', ')}`,
        );
      }

      const planningCandidates =
        await this.planningCandidateNormalizer.normalizeExperiences(
          overlapFilter.kept,
          offeredScoreBreakdownById,
        );

      const planningInput: DailyPlanningInput = {
        destination: destinationResolution,
        requestedDays: request.days,
        candidates: planningCandidates,
        mobility: request.mobility,
        travelPace: request.mobility.travelPace,
        planningWindow: this.dailyPlanningPolicy.window,
        startDates: request.startDates,
      };

      const planningSolution =
        await this.dailyPlanningSolver.solve(planningInput);
      const feasibilityResult = this.tourPlanningFeasibilityValidator.validate(
        planningSolution,
        planningInput,
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

      traceSteps.push(buildDailyPlanningStep(planningSolution));

      await this.updateGenerationStatus(
        tourId,
        'generating',
        'Itinerario planificado. Guardando TourExperience...',
      );

      const isFoodFocusedIntent =
        request.intent.interests.length === 1 &&
        request.intent.interests[0] === 'food';
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
        new Set([
          ...(request.intent.intents ?? []),
          ...getFacetKeysByDimension(
            normalizedPreferences.preferredFacets,
            'intent',
          ),
        ]),
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
      traceSteps.push(
        buildTourCompletenessStep(completeness, correctiveRetryAttempted),
      );
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
            componentCount: experience.components.length,
          };
        });

      const generationTrace = redactTracePayload({
        version: 3,
        canonicalRequest: request,
        steps: traceSteps,
        materializedTourExperiences,
        tourCompleteness: {
          ...completeness,
          retryAttempted: correctiveRetryAttempted,
        },
      });

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

        if (this.outboxService) {
          for (const experience of experienceEntities) {
            if (experience.mediaStatus === 'PENDING') {
              await this.outboxService.createInTx(tx, {
                eventType: 'ExperienceMediaEnrichmentRequested',
                payload: {
                  experienceId: experience.id,
                  name: experience.canonicalName,
                  destinationLabel: request.destination?.label,
                  latitude:
                    experience.latitude ??
                    experience.components[0]?.geoEntity?.latitude ??
                    0,
                  longitude:
                    experience.longitude ??
                    experience.components[0]?.geoEntity?.longitude ??
                    0,
                  category: experience.components[0]?.role,
                },
              });
            }
          }
        }
      });

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
      const traceStepList = (generationTrace as any).steps ?? [];
      const acceptedExperiences = Math.max(
        selectedExperiences.length,
        traceStepList
          .filter((step: any) => step.stage === 'entity_resolution')
          .reduce(
            (sum: number, step: any) =>
              sum + Number((step.resolution as any)?.acceptedCount ?? 0),
            0,
          ),
      );
      const rejectedProposals = traceStepList
        .filter((step: any) => step.stage === 'entity_resolution')
        .reduce(
          (sum: number, step: any) =>
            sum + Number((step.resolution as any)?.rejectedCount ?? 0),
          0,
        );
      const executionSummary = buildGenerationExecutionSummary({
        status: 'completed',
        steps: traceSteps,
        materializedTourExperiences,
        acceptedExperiences,
        rejectedProposals,
      });
      const completedTour = await this.toursService.findOne(tourId);
      const effectiveMetadata =
        (completedTour?.metadata as any) || (metadata as any) || {};
      await this.prisma.$transaction(async (tx) => {
        await tx.tour.update({
          where: { id: tourId },
          data: {
            metadata: {
              ...withoutGenerationFailure(effectiveMetadata),
              executionSummary,
              generationTrace: {
                ...(generationTrace as any),
                executionSummary,
              },
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
                generationTrace: redactTracePayload({
                  ...((latestTour?.metadata as any)?.generationTrace ?? {}),
                  steps: traceSteps,
                  version: 3,
                  canonicalRequest: redactTracePayload(
                    (latestTour?.metadata as any)?.generationRequest ??
                      metadata?.generationRequest ??
                      {},
                  ),
                  executionSummary: buildGenerationExecutionSummary({
                    status: 'failed',
                    steps: traceSteps,
                    failure: error?.message || String(error),
                  }),
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
