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
import { PlacesCrawlProvenance } from '@integrations/google-places/interfaces/places-api.interface';
import {
  OsmCandidate,
  OsmPlacesService,
} from '@integrations/osm/services/osm-places.service';
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
  buildDiscoveryStep,
  buildDbSearchStep,
  buildDestinationResolutionStep,
  buildEmbeddingsStep,
  buildEntityResolutionStep,
  buildGeographicValidationStep,
  buildCatalogMaterializationStep,
  buildTourIntentStep,
  buildPlacesCrawlStep,
  buildTourCompletenessStep,
} from '../utils/generation-trace-builder.util';
import {
  ExperienceProposalResolver,
  EXPERIENCE_PROPOSAL_RESOLVER,
} from '../interfaces/experience-resolution.interface';
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
  PlacesCrawlError,
  placesProviderLabel,
} from '@integrations/google-places/interfaces/places-api.interface';
import {
  EXPERIENCE_GROUNDED_SEARCH_PROVIDER,
  ExperienceGroundedSearchProvider,
} from '../interfaces/experience-grounding.interface';
import { ExperienceDiscoveryPlannerService } from './experience-discovery-planner.service';
import { ExperienceCatalogService } from './experience-catalog.service';
import { ExperienceAcquisitionService } from './experience-acquisition.service';
import { ExperienceDiscoveryRequest } from '../interfaces/experience-discovery.interface';
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

interface NativeExperienceDiscoveryProvider {
  extractExperiences(
    request: ExperienceDiscoveryRequest,
    searchResult: import('../interfaces/experience-grounding.interface').ExperienceGroundedSearchResult,
  ): Promise<{
    candidates: any[];
    validationErrors?: string[];
    provider?: string;
    model?: string;
    rawOutput?: unknown;
    prompt?: unknown;
    responseSchema?: unknown;
    tokenUsage?: unknown;
  }>;
}

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

interface PlacesCrawlResult {
  experienceIds: string[];
  fromCache?: boolean;
  provenance: PlacesCrawlProvenance;
  experiences?: any[];
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
    @Inject('PlacesApiService') private readonly placesApi: any,
    private readonly tourImageService: TourImageService,
    private readonly osmPlacesService: OsmPlacesService,
    private readonly destinationResolutionService: DestinationResolutionService,
    private readonly coverageAnalyzer: CoverageAnalyzer,
    private readonly experienceDiscoveryPlanner: ExperienceDiscoveryPlannerService,
    @Inject(EXPERIENCE_GROUNDED_SEARCH_PROVIDER)
    private readonly groundedSearchProvider: ExperienceGroundedSearchProvider,
    @Inject('EXPERIENCE_DISCOVERY_PROVIDER')
    private readonly discoveryProvider: NativeExperienceDiscoveryProvider,
    private readonly tourCompletenessValidator: TourCompletenessValidator,
    @Inject(EXPERIENCE_PROPOSAL_RESOLVER)
    private readonly proposalResolver: ExperienceProposalResolver,
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

  private async discoverExperienceGaps(
    destinationName: string,
    interests: string[],
    requestedIntents: string[],
    deficits: any[],
    additionalPreferences?: string,
    preferredTraits?: string[],
    destinationCountry?: string,
  ): Promise<any> {
    const request: ExperienceDiscoveryRequest = {
      scope: { destinationName },
      requestedThemes: interests,
      requestedIntents,
      preferredTraits,
      semanticQuery: additionalPreferences,
      // Clean, single-word subjects only — never the deficit's rendered
      // `message` (a full Spanish sentence written for the Bitácora). That
      // text used to be fed straight into search queries and drowned them
      // in noise (see ExperienceDiscoveryPlannerService.plan()'s docstring).
      coverageGaps: deficits.map(
        (deficit) =>
          deficit.theme ?? deficit.trait ?? deficit.intent ?? deficit.reason,
      ),
      breadth: 'focused',
      maxCandidates: 8,
    };
    const plan = this.experienceDiscoveryPlanner.plan(request);
    const candidates: any[] = [];
    const evidence: any[] = [];
    const searchTrace: any[] = [];
    const extractionTrace: any[] = [];

    for (const [index, plannedQuery] of plan.queries.entries()) {
      const attempt = index + 1;
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      try {
        const grounded = await this.groundedSearchProvider.search({
          destinationName,
          destinationCountry,
          requestedThemes: interests,
          additionalPreferences,
          query: plannedQuery.query,
          requestedIntents,
        });
        searchTrace.push(
          redactTracePayload({
            query: plannedQuery.query,
            purpose: plannedQuery.purpose,
            provider: grounded.provider,
            model: grounded.model,
            groundingStatus: grounded.groundingStatus,
            evidenceCount: grounded.evidence.length,
            evidenceKeys: grounded.evidence.map((item: any) => item.key),
            // Per-evidence forensic detail — currently only populated by
            // GeminiGroundedSearchService (see its own doc comment): whether
            // each piece of evidence is the real source page (via Tavily
            // /extract) or a lower-confidence segment of Gemini's own
            // synthesized output when extraction wasn't possible.
            evidenceProvenance: grounded.evidenceProvenance,
            prompt: (grounded as any).prompt,
            rawResponse: (grounded as any).rawResponse,
            tokenUsage: (grounded as any).tokenUsage,
            attempt,
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startedMs,
            status: 'completed',
          }),
        );
        if (grounded.evidence.length === 0) continue;
        evidence.push(...grounded.evidence);

        const extractionStartedAt = new Date().toISOString();
        const extractionStartedMs = Date.now();
        try {
          const extracted = await this.discoveryProvider.extractExperiences(
            request,
            grounded,
          );
          extractionTrace.push(
            redactTracePayload({
              provider: extracted.provider,
              model: extracted.model,
              prompt: extracted.prompt,
              responseSchema: extracted.responseSchema,
              rawResponse: extracted.rawOutput,
              tokenUsage: extracted.tokenUsage,
              candidateCount: extracted.candidates.length,
              validationErrors: extracted.validationErrors,
              attempt,
              startedAt: extractionStartedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - extractionStartedMs,
              status:
                extracted.validationErrors?.length &&
                extracted.candidates.length === 0
                  ? 'invalid_response'
                  : 'completed',
            }),
          );
          candidates.push(...(extracted.candidates ?? []));
          if (candidates.length >= 8) break;
        } catch (error: any) {
          extractionTrace.push(
            redactTracePayload({
              attempt,
              startedAt: extractionStartedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - extractionStartedMs,
              status: 'provider_error',
              error: {
                name: error?.name,
                message: error?.message ?? String(error),
              },
            }),
          );
        }
      } catch (error: any) {
        searchTrace.push(
          redactTracePayload({
            query: plannedQuery.query,
            purpose: plannedQuery.purpose,
            attempt,
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startedMs,
            status: 'provider_error',
            error: {
              name: error?.name,
              message: error?.message ?? String(error),
            },
          }),
        );
      }
    }

    return {
      candidates: candidates.slice(0, 8),
      evidence,
      provider: 'experience-discovery',
      model: 'provider-neutral',
      groundingStatus: candidates.length
        ? 'applied'
        : searchTrace.some((item) => item.status === 'provider_error')
          ? 'provider_error'
          : 'no_usable_evidence',
      searchTrace,
      extractionTrace,
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

  private async lookupCoverageAreas(
    boundary: OsmCandidate,
  ): Promise<OsmCandidate[]> {
    const lookup =
      await this.osmPlacesService.lookupNeighborhoodsWithin(boundary);
    if (lookup.status === 'failed') {
      this.logger.warn(
        `OSM coverage-area lookup unavailable; Places refill will use the destination point only: ${lookup.failureReason ?? 'unknown failure'}`,
      );
    }
    return lookup.value;
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
  private readonly CATALOG_REFILL_RADIUS_THRESHOLD_DEG = 0.01;
  private readonly CATALOG_REFILL_CACHE_EXPIRY_HOURS = 24;

  private async wasCatalogRefillRecentlyAttempted(
    latitude: number,
    longitude: number,
  ): Promise<boolean> {
    const recentSearch = await this.prisma.crawlerSearch.findFirst({
      where: {
        AND: [
          {
            latitude: {
              gte: latitude - this.CATALOG_REFILL_RADIUS_THRESHOLD_DEG,
            },
          },
          {
            latitude: {
              lte: latitude + this.CATALOG_REFILL_RADIUS_THRESHOLD_DEG,
            },
          },
          {
            longitude: {
              gte: longitude - this.CATALOG_REFILL_RADIUS_THRESHOLD_DEG,
            },
          },
          {
            longitude: {
              lte: longitude + this.CATALOG_REFILL_RADIUS_THRESHOLD_DEG,
            },
          },
          {
            createdAt: {
              gte: new Date(
                Date.now() -
                  this.CATALOG_REFILL_CACHE_EXPIRY_HOURS * 60 * 60 * 1000,
              ),
            },
          },
        ],
      },
    });
    return !!recentSearch;
  }

  private async recordCatalogRefillAttempt(
    latitude: number,
    longitude: number,
  ): Promise<void> {
    const attemptedAt = new Date();
    await this.prisma.crawlerSearch.upsert({
      where: { latitude_longitude: { latitude, longitude } },
      create: { latitude, longitude, createdAt: attemptedAt },
      update: { createdAt: attemptedAt },
    });
  }

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
      let placesRefillError: PlacesCrawlError | null = null;

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
            const blockingDeficits = initialCoverageReport.deficits.filter(
              (deficit) => deficit.severity === 'blocking',
            );

            if (blockingDeficits.length > 0) {
              const discoveryResult = await this.discoverExperienceGaps(
                request.destination.label,
                // Union with the LLM's free-text theme interpretation, not
                // just the wizard's own explicit interests — same gap as
                // the intents union below, mirroring the pattern already
                // used in buildCoverageReport. Missing this meant a theme
                // the user only expressed in free text (never checked as a
                // wizard interest chip) silently never reached the search
                // query at all.
                Array.from(
                  new Set([
                    ...request.intent.interests,
                    ...getFacetKeysByDimension(
                      normalizedPreferences.preferredFacets,
                      'theme',
                    ),
                  ]),
                ),
                // Union with the wizard's own explicit intents, not just the
                // LLM's free-text interpretation — the same gap already
                // fixed for rankAndSliceExperiences and completenessInput.
                // Missing this meant a wizard-selected day_trip/route_like
                // intent silently never reached discovery's day-trip query
                // branch unless the free-text interpreter happened to
                // re-derive it independently.
                Array.from(
                  new Set([
                    ...(request.intent.intents ?? []),
                    ...getFacetKeysByDimension(
                      normalizedPreferences.preferredFacets,
                      'intent',
                    ),
                  ]),
                ),
                blockingDeficits,
                // The LLM-derived positive-only paraphrase, never the raw
                // additionalPreferences text. A search engine has no notion
                // of "no quiero X" as an exclusion — it just matches "X" as
                // another keyword, actively pulling in the exact content the
                // user asked to avoid (verified live: adding an excluded
                // term to the query, even with a "-" prefix, pulled in MORE
                // matching results, not fewer — Tavily's plain search has no
                // keyword-exclusion syntax at all). hardExclusions still
                // filters candidates correctly later in the pipeline; this
                // only stops the raw negation text from reaching the search
                // evidence-gathering step in the first place.
                normalizedPreferences.positiveSemanticQuery,
                // Union with dietary/accessibility preferences, matching
                // buildCoverageReport's requestedTraits exactly — a vegan
                // or accessibility need the user only expressed as such
                // (never phrased as a generic "trait") previously never
                // reached the search query either.
                Array.from(
                  new Set([
                    ...getFacetKeysByDimension(
                      normalizedPreferences.preferredFacets,
                      'trait',
                    ),
                    ...(normalizedPreferences.dietaryPreferences ?? []),
                    ...(normalizedPreferences.accessibilityPreferences ?? []),
                  ]),
                ),
                destinationResolution.country,
              );
              traceSteps.push(buildDiscoveryStep(discoveryResult));

              if (discoveryResult.candidates.length > 0) {
                const resolutionResult = await this.proposalResolver.resolve({
                  candidates: discoveryResult.candidates,
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
                  evidence: discoveryResult.evidence,
                });
                traceSteps.push(
                  buildEntityResolutionStep(resolutionResult),
                  buildGeographicValidationStep(resolutionResult),
                  buildCatalogMaterializationStep(resolutionResult),
                );

                const persistedExperienceIds = resolutionResult.resolved
                  .filter(
                    (result) =>
                      result.status === 'accepted' && result.experienceId,
                  )
                  .map((result) => result.experienceId as string);
                if (persistedExperienceIds.length > 0) {
                  const persistedExperiences =
                    await this.prisma.experience.findMany({
                      where: {
                        id: { in: persistedExperienceIds },
                        status: 'VERIFIED',
                      },
                      include: {
                        components: { include: { geoEntity: true } },
                        traits: { include: { traitDefinition: true } },
                      },
                    });
                  persistedExperiences.forEach((experience: any) => {
                    const hydrated =
                      this.hydratePersistedExperience(experience);
                    allEligibleExperiencesById.set(experience.id, hydrated);
                    discoveryResolvedExperienceIds.add(experience.id);
                  });
                }
              }
            }

            const postDiscoveryExperiences =
              await this.experienceCatalog.findVerifiedWithin(
                searchArea.latitude,
                searchArea.longitude,
                radius,
                experienceLimit,
              );
            postDiscoveryExperiences.forEach((experience: any) =>
              allEligibleExperiencesById.set(experience.id, experience),
            );
            const postDiscoveryPool = Array.from(
              allEligibleExperiencesById.values(),
            );
            let postDiscoverySelection = await this.rankAndSliceExperiences(
              postDiscoveryPool,
              request.intent,
            );
            semanticRankingOutcome = postDiscoverySelection.semanticRanking;
            let postDiscoveryCoverage = this.buildCoverageReport(
              postDiscoveryPool,
              request,
              postDiscoverySelection.experiences.length,
              semanticRankingOutcome,
              { status: 'healthy' },
            );
            traceSteps.push(buildCoverageAnalysisStep(postDiscoveryCoverage));

            if (postDiscoveryCoverage.decision.action === 'none') {
              recordOfferedCandidates(postDiscoverySelection);
              availableExperiencesText = `\n\nAvailable verified Experiences in the area (within ${radius / 1000}km):\n${postDiscoverySelection.experiences
                .map((experience: any) => formatExperienceForPrompt(experience))
                .join('\n')}`;
              traceSteps.push(
                this.buildCandidatePoolTraceStep(
                  postDiscoverySelection,
                  discoveryResolvedExperienceIds,
                  new Set(),
                  undefined,
                  request,
                  nearbyExperiences.length,
                  postDiscoveryPool.length,
                  postDiscoveryCoverage.relevantCandidateCount,
                ),
              );
            } else {
              const semanticCoverageDeficit =
                postDiscoveryCoverage.deficits.some(
                  (deficit) =>
                    deficit.reason === 'missing_requested_theme' ||
                    deficit.reason === 'missing_requested_trait' ||
                    deficit.reason === 'missing_requested_intent',
                );

              if (!semanticCoverageDeficit) {
                const placesStatus = this.placesApi.getStatus();
                const placesLabel = placesProviderLabel(placesStatus.provider);
                await this.updateGenerationStatus(
                  tourId,
                  'generating',
                  `Coverage temática resuelta pero faltan candidatos. Buscando más lugares con ${placesLabel}...`,
                );

                try {
                  const skipRefill =
                    await this.wasCatalogRefillRecentlyAttempted(
                      searchArea.latitude,
                      searchArea.longitude,
                    );
                  let crawlResult: PlacesCrawlResult;
                  if (skipRefill) {
                    crawlResult = {
                      experienceIds: [],
                      fromCache: true,
                      provenance: {
                        provider: placesStatus.provider,
                        cacheStatus: 'hit',
                        requestedCount: 0,
                        receivedCount: 0,
                        acceptedCount: 0,
                        rejectedCountByReason: {},
                      },
                    };
                  } else {
                    await this.recordCatalogRefillAttempt(
                      searchArea.latitude,
                      searchArea.longitude,
                    );
                    const acquired =
                      await this.experienceAcquisition.acquireNearby({
                        latitude: searchArea.latitude,
                        longitude: searchArea.longitude,
                        radius: Math.min(radius, 5000),
                        interests: request.intent.interests,
                        maxResultCount: experienceLimit,
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
                      });
                    crawlResult = {
                      experienceIds: acquired.experienceIds,
                      experiences: acquired.experiences,
                      provenance: acquired.provenance,
                    };
                  }

                  const refreshedExperiences =
                    await this.experienceCatalog.findVerifiedWithin(
                      searchArea.latitude,
                      searchArea.longitude,
                      radius,
                      experienceLimit,
                    );
                  refreshedExperiences.forEach((experience: any) =>
                    allEligibleExperiencesById.set(experience.id, experience),
                  );
                  const refreshedPool = Array.from(
                    allEligibleExperiencesById.values(),
                  );
                  postDiscoverySelection = await this.rankAndSliceExperiences(
                    refreshedPool,
                    request.intent,
                  );
                  semanticRankingOutcome =
                    postDiscoverySelection.semanticRanking;
                  postDiscoveryCoverage = this.buildCoverageReport(
                    refreshedPool,
                    request,
                    postDiscoverySelection.experiences.length,
                    semanticRankingOutcome,
                    { status: 'healthy' },
                  );
                  traceSteps.push(
                    buildPlacesCrawlStep(
                      refreshedExperiences.filter((experience: any) =>
                        new Set(crawlResult.experienceIds).has(experience.id),
                      ),
                      crawlResult.provenance,
                    ),
                    buildCoverageAnalysisStep(postDiscoveryCoverage),
                  );

                  if (postDiscoveryCoverage.decision.action === 'none') {
                    recordOfferedCandidates(postDiscoverySelection);
                    availableExperiencesText = `\n\nAvailable verified Experiences in the area (within ${radius / 1000}km):\n${postDiscoverySelection.experiences
                      .map((experience: any) =>
                        formatExperienceForPrompt(experience),
                      )
                      .join('\n')}`;
                    traceSteps.push(
                      this.buildCandidatePoolTraceStep(
                        postDiscoverySelection,
                        discoveryResolvedExperienceIds,
                        new Set(crawlResult.experienceIds),
                        crawlResult.provenance.provider === 'google'
                          ? 'google'
                          : 'geoapify',
                        request,
                        nearbyExperiences.length,
                        refreshedPool.length,
                        postDiscoveryCoverage.relevantCandidateCount,
                      ),
                    );
                  }
                } catch (crawlError: any) {
                  if (crawlError instanceof PlacesCrawlError) {
                    placesRefillError = crawlError;
                  }
                  this.logger.error(
                    `${placesLabel} catalog refill failed: ${crawlError.message}`,
                  );
                  const failedProvenance =
                    crawlError instanceof PlacesCrawlError
                      ? crawlError.provenance
                      : {
                          provider: placesStatus.provider,
                          cacheStatus:
                            placesStatus.cacheEnabled &&
                            placesStatus.cacheMode === 'strict'
                              ? ('strict-miss' as const)
                              : ('miss-live' as const),
                          requestedCount: 0,
                          receivedCount: 0,
                          acceptedCount: 0,
                          rejectedCountByReason: {},
                        };
                  traceSteps.push(
                    buildPlacesCrawlStep([], failedProvenance, true),
                  );
                }
              }

              const finalPool = Array.from(allEligibleExperiencesById.values());
              const finalSelection = await this.rankAndSliceExperiences(
                finalPool,
                request.intent,
              );
              semanticRankingOutcome = finalSelection.semanticRanking;
              const finalCoverage = this.buildCoverageReport(
                finalPool,
                request,
                finalSelection.experiences.length,
                semanticRankingOutcome,
                placesRefillError
                  ? { status: 'degraded', reason: placesRefillError.code }
                  : { status: 'healthy' },
              );
              traceSteps.push(buildCoverageAnalysisStep(finalCoverage));

              // A requested theme/trait/intent still missing after catalog +
              // discovery + acquisition (`requiresAdditionalDiscovery`) is a
              // real, trace-visible deficit — but per invariant #11 it must
              // never fail the Tour on its own. Only a genuinely infeasible
              // pool (`isCoverageFatal`) aborts generation here.
              if (isCoverageFatal(finalCoverage)) {
                const coverageError = new Error(
                  `Coverage insuficiente después de catálogo, discovery enfocado y adquisición acotada: ${finalCoverage.deficits
                    .filter((deficit) => deficit.severity === 'blocking')
                    .map((deficit) => deficit.reason)
                    .join(', ')}`,
                );
                // Authoritative retry signal from the code that actually
                // decided this is fatal — an empty/insufficient pool caused
                // by a genuinely degraded provider (e.g. Places down) is
                // worth retrying; the same pool being empty because the
                // destination just has no coverage yet never gets better on
                // retry. Set explicitly so classifyGenerationFailure's
                // whole-trace text scan (which can't distinguish "this
                // failure was provider-caused" from "an unrelated earlier
                // sub-step hit a transient 429 and recovered") never
                // overrides it.
                (coverageError as any).retryable =
                  finalCoverage.providerHealth.status === 'degraded';
                throw coverageError;
              }

              recordOfferedCandidates(finalSelection);
              availableExperiencesText = `\n\nAvailable verified Experiences in the area (within ${radius / 1000}km):\n${finalSelection.experiences
                .map((experience: any) => formatExperienceForPrompt(experience))
                .join('\n')}`;
              traceSteps.push(
                this.buildCandidatePoolTraceStep(
                  finalSelection,
                  discoveryResolvedExperienceIds,
                  new Set(),
                  undefined,
                  request,
                  nearbyExperiences.length,
                  finalPool.length,
                  finalCoverage.relevantCandidateCount,
                ),
              );
            }
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
        if (placesRefillError?.code === 'quota_exhausted') {
          throw new Error(
            'Google Places alcanzó su cuota diaria y no pudo buscar lugares reales para este destino. Volvé a intentar cuando se renueve la cuota del proveedor.',
          );
        }
        if (placesRefillError?.code === 'rate_limited') {
          throw new Error(
            'Google Places limitó temporalmente las búsquedas y no pudo devolver lugares reales para este destino. Esperá un momento y volvé a intentar.',
          );
        }
        if (placesRefillError?.code === 'strict_cache_miss') {
          throw new Error(
            'El modo estricto local no tiene datos cacheados de Google Places para este destino y no permite llamadas externas.',
          );
        }
        if (placesRefillError?.code === 'provider_unavailable') {
          throw new Error(
            'Google Places no está configurado o disponible para buscar lugares reales en este destino.',
          );
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
