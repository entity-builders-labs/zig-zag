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
import { ExperienceVectorStoreService } from '@shared/ai/services/experience-vector-store.service';
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
  TourIntent,
} from '../interfaces/tour-generation.interface';
import {
  rankCandidatesByRelevance,
  RankableCandidate,
  CandidateScoreBreakdown,
} from '../utils/candidate-ranking.util';
import { selectBoundedWindow } from '../utils/candidate-window-selection.util';
import { filterOverlappingExperienceCandidates } from '../utils/candidate-overlap-filter.util';
import {
  buildExperienceCandidatePoolStep,
  buildCoverageAnalysisStep,
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
import { ExperienceCatalogService } from './experience-catalog.service';
import { ExperienceAcquisitionService } from './experience-acquisition.service';
import { ExperienceAcquisitionPlannerService } from './experience-acquisition-planner.service';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { CoverageAnalyzer } from './coverage-analyzer.service';
import { isCoverageFatal } from '../utils/coverage-decision.util';
import { redactTracePayload } from '../utils/trace-redaction.util';
import { buildGenerationExecutionSummary } from '../utils/generation-execution-summary.util';
import { PreferenceInterpreterService } from './preference-interpreter.service';
import { buildSemanticTourQuery } from '../utils/semantic-tour-query-builder.util';
import {
  EmbeddingIndexIdentity,
  SemanticSimilarityResult,
} from '@shared/ai/interfaces/embedding-index.interface';
import {
  evaluateExperiencePreferences,
  PreferenceEvaluation,
} from '../utils/experience-preference-evaluator.util';
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
  preferenceEvaluationById: Map<string, PreferenceEvaluation>;
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
    private readonly vectorStoreService: ExperienceVectorStoreService,
    private readonly tourImageService: TourImageService,
    private readonly destinationResolutionService: DestinationResolutionService,
    private readonly coverageAnalyzer: CoverageAnalyzer,
    private readonly experienceAcquisitionPlanner: ExperienceAcquisitionPlannerService,
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

  private buildCoverageReport(
    experiences: any[],
    request: TourGenerationRequest,
    offeredCandidateCount: number,
    semanticRanking: SemanticRankingOutcome,
    providerHealth?: {
      status: 'healthy' | 'degraded' | 'unknown';
      reason?: string;
    },
  ) {
    const normalized =
      request.intent.normalizedPreferences ?? this.emptyNormalizedPreferences();
    return this.coverageAnalyzer.analyze({
      candidates: experiences.map((experience) => ({
        id: experience.id,
        name: experience.canonicalName ?? experience.name,
        description: experience.description,
        source:
          experience.source ||
          experience.sourceId ||
          experience.metadata?.source ||
          'db',
        weightedScore:
          experience.weightedScore ?? experience.qualityScore ?? null,
        distanceKm: experience.distance,
        durationMinutes:
          experience.durationMinutes ??
          (Number.isFinite(experience.duration)
            ? experience.duration * 60
            : undefined),
        themes: experience.themes ?? experience.metadata?.themes ?? [],
        traits: experience.traits ?? experience.metadata?.traits ?? [],
        intents:
          experience.intents ??
          experience.metadata?.intents ??
          experience.metadata?.archetypes ??
          [],
        metadata: experience.metadata,
      })),
      requestedThemes: Array.from(
        new Set([
          ...request.intent.interests,
          ...getFacetKeysByDimension(normalized.preferredFacets, 'theme'),
        ]),
      ),
      requestedTraits: Array.from(
        new Set([
          ...getFacetKeysByDimension(normalized.preferredFacets, 'trait'),
          ...normalized.dietaryPreferences,
          ...normalized.accessibilityPreferences,
        ]),
      ),
      requestedIntents: Array.from(
        new Set([
          ...(request.intent.intents ?? []),
          ...getFacetKeysByDimension(normalized.preferredFacets, 'intent'),
        ]),
      ),
      days: request.days,
      explorationStyle: request.intent.explorationStyle,
      travelPace: request.mobility.travelPace,
      semanticCoverage: {
        status: semanticRanking.status,
        eligibleCandidateCount: semanticRanking.eligibleCandidateCount,
        indexedCandidateCount: semanticRanking.indexedCandidateCount,
        reason: semanticRanking.reason,
      },
      offeredCandidateCount,
      providerHealth,
    });
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
  private readonly ITINERARY_CANDIDATE_LIMIT = 15;

  private async rankAndSliceExperiences(
    experiences: any[],
    intent: TourIntent,
  ): Promise<CandidateSelection> {
    const preferenceEvaluationById = new Map<string, PreferenceEvaluation>();
    for (const experience of experiences) {
      preferenceEvaluationById.set(
        experience.id,
        evaluateExperiencePreferences(experience, intent.normalizedPreferences),
      );
    }

    const hasHardExclusions =
      (intent.normalizedPreferences?.hardExclusions.length ?? 0) > 0;
    const strictCandidates = hasHardExclusions
      ? experiences.filter(
          (experience) =>
            (preferenceEvaluationById.get(experience.id)?.exclusionMatches
              .length ?? 0) === 0,
        )
      : experiences;
    const hardExclusionRelaxed =
      hasHardExclusions &&
      strictCandidates.length === 0 &&
      experiences.length > 0;
    const candidateExperiences = hardExclusionRelaxed
      ? experiences
      : strictCandidates;

    const semanticQuery = buildSemanticTourQuery(intent);
    let semanticResult: SemanticSimilarityResult | null = null;

    if (semanticQuery) {
      semanticResult = await this.vectorStoreService.getSimilarityScores(
        candidateExperiences.map((experience) => experience.id),
        semanticQuery,
      );
    }

    const rankable: (RankableCandidate & { original: any })[] =
      candidateExperiences.map((experience) => ({
        id: experience.id,
        // A multi-component Experience (walk/route/day-trip) is a
        // 'composite', matching candidate-ranking.util's own quality-bonus
        // split — this used to be hardcoded 'poi' for everything, silently
        // disabling that split and the curated-composite bonus entirely.
        source: (experience.components?.length ?? 1) > 1 ? 'composite' : 'poi',
        subtype:
          experience.themes?.[0] ??
          experience.traits?.[0] ??
          experience.intents?.[0] ??
          experience.metadata?.traits?.[0],
        distanceKm: experience.distance,
        weightedScore: experience.qualityScore,
        isCurated: false,
        preferenceScore:
          preferenceEvaluationById.get(experience.id)?.score ?? 0,
        original: experience,
      }));

    const rankedFull = rankCandidatesByRelevance(
      rankable,
      semanticResult?.status === 'applied' ? semanticResult.scores : null,
    );
    // A plain top-N score slice can starve out a real candidate for a
    // format the user explicitly requested (walk/route_like/day_trip/...)
    // whenever plain single-place candidates numerically dominate the pool
    // — which they usually do. Reserve real matches for every requested
    // intent before filling the rest by score.
    const requestedIntents = Array.from(
      new Set([
        ...(intent.intents ?? []),
        ...getFacetKeysByDimension(
          intent.normalizedPreferences?.preferredFacets,
          'intent',
        ),
      ]),
    );
    const window = selectBoundedWindow(
      rankedFull,
      (candidate) =>
        candidate.original.intents ?? candidate.original.metadata?.intents,
      requestedIntents,
      this.ITINERARY_CANDIDATE_LIMIT,
    );
    const ranked = window.map((result) => result.candidate.original);
    const scoreBreakdownById = new Map(
      window.map((result) => [result.candidate.id, result.scoreBreakdown]),
    );

    if (!semanticQuery) {
      return {
        experiences: ranked,
        scoreBreakdownById,
        preferenceEvaluationById,
        hardExclusionRelaxed,
        semanticRanking: {
          status: 'not_requested',
          eligibleCandidateCount: candidateExperiences.length,
          indexedCandidateCount:
            await this.vectorStoreService.getCompatibleIndexCount(
              candidateExperiences.map((experience) => experience.id),
            ),
        },
      };
    }

    return {
      experiences: ranked,
      scoreBreakdownById,
      preferenceEvaluationById,
      hardExclusionRelaxed,
      semanticRanking: {
        status: semanticResult!.status,
        eligibleCandidateCount: semanticResult!.requestedCandidateCount,
        indexedCandidateCount: semanticResult!.indexedCandidateCount,
        identity: semanticResult!.identity,
        reason: semanticResult!.reason,
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
        outputs: { intent: normalizedPreferences },
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
          const selection = await this.rankAndSliceExperiences(
            nearbyExperiences,
            request.intent,
          );
          const nearbyExperiencesSample = selection.experiences;
          semanticRankingOutcome = selection.semanticRanking;
          const initialCoverageReport = this.buildCoverageReport(
            nearbyExperiences,
            request,
            nearbyExperiencesSample.length,
            semanticRankingOutcome,
            { status: 'healthy' },
          );
          traceSteps.push(buildCoverageAnalysisStep(initialCoverageReport));

          if (initialCoverageReport.decision.action === 'none') {
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
                initialCoverageReport.relevantCandidateCount,
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
            //   CoverageAnalyzer, bounded by MAX_ACQUISITION_PASSES.
            const acquisitionScope = {
              destinationName: request.destination.label,
              latitude: searchArea.latitude,
              longitude: searchArea.longitude,
              radiusMeters: searchArea.radiusMeters,
            };
            const coverageCandidateView = (pool: any[]) =>
              pool.map(
                (experience) =>
                  ({
                    name: experience.canonicalName ?? experience.name,
                    description: experience.description,
                    themes:
                      experience.themes ?? experience.metadata?.themes ?? [],
                    traits:
                      experience.traits ?? experience.metadata?.traits ?? [],
                    intents:
                      experience.intents ??
                      experience.metadata?.intents ??
                      experience.metadata?.archetypes ??
                      [],
                  }) as unknown as ExperienceCandidate,
              );

            let currentPool = nearbyExperiences;
            let currentSelection = selection;
            let currentCoverage = initialCoverageReport;

            for (let pass = 1; pass <= MAX_ACQUISITION_PASSES; pass++) {
              if (currentCoverage.decision.action === 'none') break;

              const blockingDeficits = currentCoverage.deficits.filter(
                (deficit) => deficit.severity === 'blocking',
              );

              const acquisitionPlan =
                this.experienceAcquisitionPlanner.buildAcquisitionPlan({
                  destination: acquisitionScope,
                  legacyDeficits: blockingDeficits,
                  preferredFacets: normalizedPreferences.preferredFacets,
                  candidates: coverageCandidateView(currentPool),
                  semanticQuery: normalizedPreferences.positiveSemanticQuery,
                  breadth: 'focused',
                });

              if (acquisitionPlan.sourcePlans.length === 0) {
                // Nothing routable — a soft-only deficit. Stop acquiring; the
                // gap stays visible in the coverage trace, never fatal.
                break;
              }

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
                      destinationCountryCode: destinationResolution.countryCode,
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
              currentSelection = await this.rankAndSliceExperiences(
                currentPool,
                request.intent,
              );
              semanticRankingOutcome = currentSelection.semanticRanking;

              const providerHealth: {
                status: 'healthy' | 'degraded' | 'unknown';
                reason?: string;
              } =
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
              if (providerHealth.status === 'degraded') {
                degradedAcquisitionReason = providerHealth.reason ?? 'degraded';
              }

              currentCoverage = this.buildCoverageReport(
                currentPool,
                request,
                currentSelection.experiences.length,
                semanticRankingOutcome,
                providerHealth,
              );
              traceSteps.push(buildCoverageAnalysisStep(currentCoverage));
            }

            const finalCoverage = currentCoverage;

            // A requested soft theme/trait/intent still missing after catalog +
            // bounded acquisition is a real, trace-visible deficit — but per
            // invariant it must never fail the Tour on its own. Only a
            // genuinely infeasible pool (`isCoverageFatal`) aborts here.
            if (isCoverageFatal(finalCoverage)) {
              const coverageError = new Error(
                `Coverage insuficiente después de catálogo y adquisición multi-fuente acotada: ${finalCoverage.deficits
                  .filter((deficit) => deficit.severity === 'blocking')
                  .map((deficit) => deficit.reason)
                  .join(', ')}`,
              );
              (coverageError as any).retryable =
                finalCoverage.providerHealth.status === 'degraded';
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
                finalCoverage.relevantCandidateCount,
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
      // Preserve an explicit retryable signal (e.g. from isCoverageFatal's
      // throw) across this wrap — without this, classifyGenerationFailure
      // never sees it and falls back to its whole-trace heuristic scan.
      if (typeof error.retryable === 'boolean') {
        (wrapped as any).retryable = error.retryable;
      }
      throw wrapped;
    }
  }
}
