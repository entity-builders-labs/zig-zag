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
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';
import {
  rankCandidatesByRelevance,
  RankableCandidate,
  CandidateScoreBreakdown,
} from '../utils/candidate-ranking.util';
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
import { TourCompletenessInput } from '../interfaces/tour-completeness.interface';
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
import { TourIntent } from '../interfaces/tour-generation.interface';
import { EXPERIENCE_GROUNDED_SEARCH_PROVIDER, ExperienceGroundedSearchProvider } from '../interfaces/experience-grounding.interface';
import { ExperienceDiscoveryPlannerService } from './experience-discovery-planner.service';
import { ExperienceCatalogService } from './experience-catalog.service';
import { ExperienceAcquisitionService } from './experience-acquisition.service';
import { ExperienceDiscoveryRequest } from '../interfaces/experience-discovery.interface';
import { CoverageAnalyzer } from './coverage-analyzer.service';
import { redactTracePayload } from '../utils/trace-redaction.util';
import { PreferenceInterpreterService } from './preference-interpreter.service';
import { buildSemanticTourQuery } from '../utils/semantic-tour-query-builder.util';
import {
  EmbeddingIndexIdentity,
  SemanticSimilarityResult,
} from '@shared/ai/interfaces/embedding-index.interface';

interface NativeExperienceDiscoveryProvider {
  extractExperiences(
    request: ExperienceDiscoveryRequest,
    searchResult: import('../interfaces/experience-grounding.interface').ExperienceGroundedSearchResult,
  ): Promise<{ candidates: any[]; validationErrors?: string[]; provider?: string; model?: string; rawOutput?: unknown }>;
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
  fromCache: boolean;
  provenance: PlacesCrawlProvenance;
}

interface CandidateSelection {
  experiences: any[];
  semanticRanking: SemanticRankingOutcome;
  scoreBreakdownById: Map<string, CandidateScoreBreakdown>;
}

function formatExperienceForPrompt(experience: any): string {
  const themes = Array.isArray(experience.themes) ? experience.themes.join(', ') : '';
  const traits = Array.isArray(experience.traits) ? experience.traits.join(', ') : '';
  const components = Array.isArray(experience.components)
    ? experience.components.map((component: any) => component.geoEntity?.name ?? component.name).filter(Boolean).join(', ')
    : '';
  return [
    `${experience.id}: ${experience.canonicalName ?? experience.name ?? 'Experience'}`,
    experience.description,
    themes ? `themes=${themes}` : undefined,
    traits ? `traits=${traits}` : undefined,
    components ? `components=${components}` : undefined,
  ].filter(Boolean).join(' | ');
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

  private async discoverExperienceGaps(
    destinationName: string,
    interests: string[],
    deficits: any[],
    additionalPreferences?: string,
  ): Promise<any> {
    const request: ExperienceDiscoveryRequest = {
      scope: { destinationName },
      requestedThemes: interests,
      semanticQuery: additionalPreferences,
      coverageGaps: deficits.map((deficit) => deficit.message || deficit.reason),
      breadth: 'focused',
      maxCandidates: 8,
    };
    const plan = this.experienceDiscoveryPlanner.plan(request);
    const proposals: any[] = [];
    const evidence: any[] = [];
    const searchTrace: any[] = [];
    for (const plannedQuery of plan.queries) {
      const grounded = await this.groundedSearchProvider.search({
        destinationName,
        requestedThemes: interests,
        additionalPreferences,
        query: plannedQuery.query,
      });
      searchTrace.push({ query: plannedQuery.query, provider: grounded.provider, model: grounded.model, groundingStatus: grounded.groundingStatus, evidenceCount: grounded.evidence.length });
      if (grounded.evidence.length === 0) continue;
      evidence.push(...grounded.evidence);
      const extracted = await this.discoveryProvider.extractExperiences(request, grounded);
      proposals.push(...(extracted.candidates ?? []));
      if (proposals.length >= 8) break;
    }
    return { proposals: proposals.slice(0, 8), evidence, provider: 'experience-discovery', model: 'provider-neutral', groundingStatus: proposals.length ? 'applied' : 'no_usable_evidence', searchTrace };
  }

  /** Daily planning solver: no new Prisma columns. If a real base date exists, combine it
   * with the planned day/minutes into a real Date; otherwise never invent
   * one — dayNumber/order/duration alone carry the schedule, and full
   * minutes-precise timing survives only in the planning trace/result.
   *
   * Day arithmetic is done in UTC on purpose: the wizard sends each start
   * date as a UTC-midnight ISO string, so UTC arithmetic keeps day 1 on the
   * exact calendar date the user picked, and produces the same value no
   * matter which timezone the server runs in (local `setDate`/`setHours`
   * would silently shift day 1 to the previous date for any negative UTC
   * offset, e.g. Buenos Aires). The planned minutes are destination-local
   * wall-clock time, which we cannot convert without the destination's own
   * timezone — a known approximation, not a claim of exact instants.
   */
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
    activities: any[],
    request: TourGenerationRequest,
    offeredCandidateCount: number,
    semanticRanking: SemanticRankingOutcome,
    providerHealth?: {
      status: 'healthy' | 'degraded' | 'unknown';
      reason?: string;
    },
  ) {
    return this.coverageAnalyzer.analyze({
      candidates: activities.map((activity) => ({
        id: activity.id,
        name: activity.name,
        source: activity.source || activity.sourceId || 'db',
        weightedScore: activity.weightedScore,
        distanceKm: activity.distance,
        metadata: activity.metadata,
      })),
      requestedThemes: request.intent.interests,
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

  /**
   * Builds the candidate_pool trace step for whichever branch just
   * produced a ranked/windowed selection — tags each offered candidate with
   * its real provenance (discovery-resolved this request, freshly
   * crawled/refilled, or pre-existing catalog) so the bitácora can show
   * source, score components, and coverage contribution truthfully.
   */
  private buildCandidatePoolTraceStep(
    selection: CandidateSelection,
    discoveryResolvedActivityIds: Set<string>,
    newlyCrawledActivityIds: Set<string>,
    crawlProvider: 'google' | 'geoapify' | undefined,
    request: TourGenerationRequest,
    initialCatalogCount: number,
    postAcquisitionCatalogCount: number,
    eligibleCount: number,
  ): GenerationTraceStep {
    const offeredCandidates = selection.experiences.map((act: any) => ({
      id: act.id,
      name: act.name,
      metadata: act.metadata,
      traceSource: discoveryResolvedActivityIds.has(act.id)
        ? ('discovery' as const)
        : newlyCrawledActivityIds.has(act.id)
          ? crawlProvider === 'google'
            ? ('google_places' as const)
            : ('geoapify' as const)
          : ('db' as const),
      scoreBreakdown: selection.scoreBreakdownById.get(act.id)!,
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

  /**
   * Helper method to update generation status and message
   */
  private async updateGenerationStatus(
    tourId: string,
    status: string,
    message?: string,
  ) {
    const tour = await this.toursService.findOne(tourId);
    const metadata = tour?.metadata as any;
    // A successful retry must not keep presenting the previous attempt's
    // failure as current state. Failed metadata is added atomically in the
    // catch path below; every non-failed transition explicitly removes it.
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

  /** Mirrors HybridSearchService's own crawl-dedup window — this refill
   * path calls Google Places directly and previously had no memory of a
   * recent crawl at all, unlike the map-search flow's CrawlerSearch gate. */
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
    const candidateExperiences = this.filterHardExcludedActivities(
      experiences,
      intent,
    );
    const semanticQuery = buildSemanticTourQuery(intent);
    let semanticResult: SemanticSimilarityResult | null = null;

    if (semanticQuery) {
      semanticResult = await this.vectorStoreService.getSimilarityScores(
        candidateExperiences.map((experience) => experience.id),
        semanticQuery,
      );
    }

    const rankable: (RankableCandidate & { original: any })[] =
      candidateExperiences.map((a) => ({
        id: a.id,
        source: 'poi' as const,
        subtype: a.themes?.[0] ?? a.traits?.[0] ?? a.metadata?.traits?.[0],
        distanceKm: a.distance,
        weightedScore: a.qualityScore,
        isCurated: false,
        original: a,
      }));
    const rankedFull = rankCandidatesByRelevance(
      rankable,
      semanticResult?.status === 'applied' ? semanticResult.scores : null,
    );
    const window = rankedFull.slice(0, this.ITINERARY_CANDIDATE_LIMIT);
    const ranked = window.map((r) => r.candidate.original);
    const scoreBreakdownById = new Map(
      window.map((r) => [r.candidate.id, r.scoreBreakdown]),
    );

    if (!semanticQuery) {
      return {
        experiences: ranked,
        scoreBreakdownById,
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
      semanticRanking: {
        status: semanticResult!.status,
        eligibleCandidateCount: semanticResult!.requestedCandidateCount,
        indexedCandidateCount: semanticResult!.indexedCandidateCount,
        identity: semanticResult!.identity,
        reason: semanticResult!.reason,
      },
    };
  }

  private filterHardExcludedActivities(activities: any[], intent: TourIntent) {
    const exclusions = intent.normalizedPreferences?.hardExclusions ?? [];
    if (exclusions.length === 0) return activities;
    const aliases: Record<string, string[]> = {
      religion: [
        'religion',
        'religious',
        'iglesia',
        'templo',
        'catedral',
        'mezquita',
      ],
      'non-vegan food': ['carne', 'asado', 'parrilla', 'meat'],
    };
    return activities.filter((activity) => {
      const haystack = JSON.stringify({
        name: activity.name,
        metadata: activity.metadata,
        themes: activity.themes,
        traits: activity.traits,
      }).toLowerCase();
      return !exclusions.some((exclusion) => {
        const terms = aliases[exclusion.toLowerCase()] ?? [
          exclusion.toLowerCase(),
        ];
        return terms.some((term) => haystack.includes(term));
      });
    });
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

      let availableActivitiesText = '';
      const candidateActivityIds = new Set<string>();
      const candidateActivitiesById = new Map<string, any>();
      const offeredScoreBreakdownById = new Map<
        string,
        CandidateScoreBreakdown
      >();
      const allEligibleActivitiesById = new Map<string, any>();
      const discoveryResolvedActivityIds = new Set<string>();
      let placesRefillError: PlacesCrawlError | null = null;

      const recordOfferedCandidates = (selection: CandidateSelection) => {
        selection.experiences.forEach((act: any) => {
          candidateActivityIds.add(act.id);
          candidateActivitiesById.set(act.id, act);
          const breakdown = selection.scoreBreakdownById.get(act.id);
          if (breakdown) offeredScoreBreakdownById.set(act.id, breakdown);
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
            intent: {
              preferredThemes: [],
              preferredTraits: [],
              excludedThemes: [],
              excludedTraits: [],
              hardExclusions: [],
              positiveSemanticQuery: '',
              notes: [],
            },
            trace: {
              stage: 'preference_interpretation' as const,
              systemPrompt: '',
              userPrompt: '',
              responseSchema: {},
              parsedResponse: {
                preferredThemes: [],
                preferredTraits: [],
                excludedThemes: [],
                excludedTraits: [],
                hardExclusions: [],
                positiveSemanticQuery: '',
                notes: [],
              },
              validationErrors: [],
              status: 'skipped' as const,
              durationMs: 0,
            },
          };
      traceSteps.push({
        stage: 'preference_interpretation',
        label: 'Interpretación de preferencias',
        summary:
          preferenceInterpretation.trace.status === 'applied'
            ? 'Preferencias libres normalizadas por el intérprete.'
            : preferenceInterpretation.trace.status === 'fallback'
              ? 'Se aplicó interpretación determinística de respaldo.'
              : 'No se proporcionaron preferencias libres.',
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
        },
        outputs: { intent: preferenceInterpretation.intent },
        preferenceInterpretation: preferenceInterpretation.trace,
        timing: { durationMs: preferenceInterpretation.trace.durationMs },
      });
      traceSteps.push(buildTourIntentStep(request));
      // The interpreter only normalizes language. The existing deterministic
      // acquisition/ranking pipeline consumes the merged themes/query below;
      // it remains the authority for geographic verification and selection.
      request.intent.interests = Array.from(
        new Set([
          ...request.intent.interests,
          ...preferenceInterpretation.intent.preferredThemes,
        ]),
      );
      request.intent.normalizedPreferences = preferenceInterpretation.intent;
      if (preferenceInterpretation.intent.positiveSemanticQuery) {
        request.intent.additionalPreferences =
          preferenceInterpretation.intent.positiveSemanticQuery;
      }

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
      const destinationPoint = {
        latitude: request.destination.latitude,
        longitude: request.destination.longitude,
      };
      let coverageAreas: OsmCandidate[] = [];

      if (
        Number.isFinite(request.destination.latitude) &&
        Number.isFinite(request.destination.longitude)
      ) {
        const radius = searchArea.radiusMeters;
        const activityLimit = this.CATALOG_RETRIEVAL_POOL_LIMIT;

        await this.updateGenerationStatus(
          tourId,
          'generating',
          `Buscando Experiences verificadas en la zona (radio ${Math.round(radius / 1000)}km)...`,
        );

        try {
          const nearbyActivities = await this.withTimeout(
            this.experienceCatalog.findVerifiedWithin(
              searchArea.latitude,
              searchArea.longitude,
              radius,
              activityLimit,
            ),
            10000,
            'Activity search timeout',
          );
          nearbyActivities.forEach((act: any) =>
            allEligibleActivitiesById.set(act.id, act),
          );
          const selection = await this.rankAndSliceExperiences(
            nearbyActivities,
            request.intent,
          );
          const nearbyActivitiesSample = selection.experiences;
          semanticRankingOutcome = selection.semanticRanking;
          const initialCoverageReport = this.buildCoverageReport(
            nearbyActivities,
            request,
            nearbyActivitiesSample.length,
            semanticRankingOutcome,
            { status: 'healthy' },
          );
          traceSteps.push(buildCoverageAnalysisStep(initialCoverageReport));

          if (initialCoverageReport.decision.action === 'none') {
            await this.updateGenerationStatus(
              tourId,
              'generating',
              `${nearbyActivities.length} Experiences encontradas. Ordenando según tus preferencias...`,
            );
            recordOfferedCandidates(selection);
            availableActivitiesText = `\n\nAvailable verified Experiences in the area (within ${radius / 1000}km):\n${nearbyActivitiesSample
              .map((act: any) => formatExperienceForPrompt(act))
              .join('\n')}`;
            const dbSearchStep = buildDbSearchStep(
              nearbyActivitiesSample,
              radius / 1000,
            );
            traceSteps.push(dbSearchStep);
            const candidatePoolStep = this.buildCandidatePoolTraceStep(
              selection,
              discoveryResolvedActivityIds,
              new Set(),
              undefined,
              request,
              nearbyActivities.length,
              nearbyActivities.length,
              nearbyActivities.length,
            );
            traceSteps.push(candidatePoolStep);
          } else {
            const dbSearchStep = buildDbSearchStep(
              nearbyActivities,
              radius / 1000,
            );
            traceSteps.push(dbSearchStep);

            {
              const deficits = initialCoverageReport.deficits
                .filter((d) => d.severity === 'blocking')
                .map((d) => ({
                  reason: d.reason as any,
                  severity: d.severity as any,
                  message: d.message,
                  theme: d.theme,
                  experienceFormat: d.experienceFormat,
                  expectedCount: d.expectedCount,
                  actualCount: d.actualCount,
                }));

              if (deficits.length > 0) {
                try {
                  const discoveryResult =
                    await this.discoverExperienceGaps(
                      request.destination.label,
                      request.intent.interests,
                      deficits,
                      request.intent.additionalPreferences,
                    );
                  traceSteps.push(buildDiscoveryStep(discoveryResult));
                  if (discoveryResult.proposals.length > 0) {
                    try {
                      const resolutionResult =
                        await this.proposalResolver.resolve({
                          proposals: discoveryResult.proposals,
                          destinationName: request.destination.label,
                          destinationBoundary: destinationScope,
                          evidence: discoveryResult.evidence,
                        });
                      traceSteps.push(
                        buildEntityResolutionStep(resolutionResult),
                        buildGeographicValidationStep(resolutionResult),
                        buildCatalogMaterializationStep(resolutionResult),
                      );

                      const persistedDiscoveryActivityIds =
                        resolutionResult.resolved
                          .filter(
                            (r) =>
                              r.status === 'accepted' && r.experienceId,
                          )
                          .map((r) => r.experienceId as string);
                      const persistedExperienceIds = resolutionResult.resolved
                        .filter((r: any) => r.status === 'accepted' && r.experienceId)
                        .map((r: any) => r.experienceId as string);
                      if (persistedExperienceIds.length > 0) {
                        const experiences = await this.prisma.experience.findMany({
                          where: { id: { in: persistedExperienceIds }, status: 'VERIFIED' },
                          include: { components: { include: { geoEntity: true } } },
                        });
                        experiences.forEach((experience: any) => {
                          allEligibleActivitiesById.set(experience.id, {
                            id: experience.id,
                            name: experience.canonicalName,
                            latitude: experience.latitude ?? experience.components[0]?.geoEntity.latitude,
                            longitude: experience.longitude ?? experience.components[0]?.geoEntity.longitude,
                            duration: (experience.durationMinutes ?? 120) / 60,
                            metadata: { source: 'experience_catalog', experienceId: experience.id },
                          });
                          candidateActivitiesById.set(experience.id, allEligibleActivitiesById.get(experience.id));
                          discoveryResolvedActivityIds.add(experience.id);
                        });
                      }
                    } catch (resolutionError) {
                      this.logger.warn(
                        `Entity resolution failed (non-fatal): ${resolutionError.message}`,
                      );
                    }
                  }
                } catch (discoveryError) {
                  this.logger.warn(
                    `Grounded discovery failed (non-fatal): ${discoveryError.message}`,
                  );
                }
              }
            }

            const placesStatus = this.placesApi.getStatus();
            const placesLabel = placesProviderLabel(placesStatus.provider);

            const poolStatus =
              nearbyActivities.length > 0
                ? `Se encontraron ${nearbyActivities.length} Experiences pero son insuficientes. Buscando más con ${placesLabel}...`
                : `No se encontraron Experiences locales. Buscando con ${placesLabel}...`;
            await this.updateGenerationStatus(tourId, 'generating', poolStatus);

            try {
              if (isAreaScale) {
                coverageAreas = await this.lookupCoverageAreas(
                  destinationResolution.boundary,
                );
              }

              const skipRefill = await this.wasCatalogRefillRecentlyAttempted(
                searchArea.latitude,
                searchArea.longitude,
              );

              let crawlResult: PlacesCrawlResult;
              if (skipRefill) {
                this.logger.log(
                  `Skipping catalog refill for ${searchArea.latitude}, ${searchArea.longitude}: already attempted within ${this.CATALOG_REFILL_CACHE_EXPIRY_HOURS}h.`,
                );
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
                const acquired = await this.experienceAcquisition.acquireNearby({
                  latitude: searchArea.latitude,
                  longitude: searchArea.longitude,
                  radius: Math.min(radius, 5000),
                  interests: request.intent.interests,
                  maxResultCount: activityLimit,
                });
                crawlResult = {
                  experienceIds: acquired.experienceIds,
                  experiences: acquired.experiences,
                  provenance: acquired.provenance,
                } as any;
              }

              const refreshedActivities = await this.experienceCatalog.findVerifiedWithin(
                searchArea.latitude,
                searchArea.longitude,
                radius,
                activityLimit,
              );
              refreshedActivities.forEach((act: any) =>
                allEligibleActivitiesById.set(act.id, act),
              );
              if (refreshedActivities.length > 0) {
                await this.updateGenerationStatus(
                  tourId,
                  'generating',
                  `¡Catálogo actualizado con ${placesLabel}! Analizando ${refreshedActivities.length} Experiences...`,
                );

                const discoveryResolvedActivities = Array.from(
                  allEligibleActivitiesById.values(),
                ).filter((a: any) => discoveryResolvedActivityIds.has(a.id));
                const mergedPool = [
                  ...refreshedActivities,
                  ...discoveryResolvedActivities.filter(
                    (a: any) =>
                      !refreshedActivities.some((r: any) => r.id === a.id),
                  ),
                ];

                const selection = await this.rankAndSliceExperiences(
                  mergedPool,
                  request.intent,
                );
        const refreshedActivitiesSample = selection.experiences;
                semanticRankingOutcome = selection.semanticRanking;
                const refreshedCoverageReport = this.buildCoverageReport(
                  mergedPool,
                  request,
                  refreshedActivitiesSample.length,
                  semanticRankingOutcome,
                  { status: 'healthy' },
                );
                traceSteps.push(
                  buildCoverageAnalysisStep(refreshedCoverageReport),
                );
                if (
                  refreshedCoverageReport.decision.reason ===
                  'no_usable_candidates'
                ) {
                  throw new Error(
                    'No se encontró un pool de Experiences utilizable para armar un itinerario real con el catálogo actual.',
                  );
                }
                recordOfferedCandidates(selection);
                availableActivitiesText = `\n\nAvailable verified Experiences in the area (within ${radius / 1000}km):\n${refreshedActivitiesSample
                  .map((act: any) => formatExperienceForPrompt(act))
                  .join('\n')}`;
                const newExperienceIds = new Set(crawlResult.experienceIds);
                const crawlStep = buildPlacesCrawlStep(
                  refreshedActivitiesSample.filter((experience: any) =>
                    newExperienceIds.has(experience.id),
                  ),
                  crawlResult.provenance,
                );
                traceSteps.push(crawlStep);

                const candidatePoolStep = this.buildCandidatePoolTraceStep(
                  selection,
                  discoveryResolvedActivityIds,
                  newExperienceIds,
                  crawlResult.provenance.provider === 'google'
                    ? 'google'
                    : 'geoapify',
                  request,
                  nearbyActivities.length,
                  mergedPool.length,
                  mergedPool.length,
                );
                traceSteps.push(candidatePoolStep);
              } else {
                traceSteps.push(
                  buildPlacesCrawlStep([], crawlResult.provenance),
                );
                if (nearbyActivities.length > 0) {
                  const thinPoolMessage =
                    nearbyActivities.length === 1
                      ? '1 actividad local disponible.'
                      : `${nearbyActivities.length} Experiences locales disponibles.`;
                  await this.updateGenerationStatus(
                    tourId,
                    'generating',
                    thinPoolMessage,
                  );
                  const discoveryResolvedActivities = Array.from(
                    allEligibleActivitiesById.values(),
                  ).filter((a: any) => discoveryResolvedActivityIds.has(a.id));
                  const mergedPool = [
                    ...nearbyActivities,
                    ...discoveryResolvedActivities.filter(
                      (a: any) =>
                        !nearbyActivities.some((r: any) => r.id === a.id),
                    ),
                  ];
                  const selection = await this.rankAndSliceExperiences(
                    mergedPool,
                    request.intent,
                  );
                  const nearbyActivitiesSample = selection.experiences;
                  semanticRankingOutcome = selection.semanticRanking;
                  recordOfferedCandidates(selection);
                  availableActivitiesText = `\n\nAvailable verified Experiences in the area (within ${radius / 1000}km):\n${nearbyActivitiesSample
                    .map((act: any) => formatExperienceForPrompt(act))
                    .join('\n')}`;
                  const candidatePoolStep = this.buildCandidatePoolTraceStep(
                    selection,
                    discoveryResolvedActivityIds,
                    new Set(),
                    undefined,
                    request,
                    nearbyActivities.length,
                    mergedPool.length,
                    mergedPool.length,
                  );
                  traceSteps.push(candidatePoolStep);
                } else {
                  await this.updateGenerationStatus(
                    tourId,
                    'generating',
                    'No se encontraron lugares reales cerca de esta ubicación.',
                  );
                }
              }
            } catch (crawlError) {
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
              traceSteps.push(buildPlacesCrawlStep([], failedProvenance, true));
              const degradedCoverageReport = this.buildCoverageReport(
                nearbyActivities,
                request,
                nearbyActivitiesSample.length,
                semanticRankingOutcome,
                {
                  status: 'degraded',
                  reason: placesStatus.degradedReason || 'provider_unavailable',
                },
              );
              traceSteps.push(
                buildCoverageAnalysisStep(degradedCoverageReport),
              );
              if (nearbyActivities.length > 0) {
                await this.updateGenerationStatus(
                  tourId,
                  'generating',
                  `${placesLabel} indisponible. Usando ${nearbyActivities.length} Experiences locales encontradas.`,
                );
                const discoveryResolvedActivities = Array.from(
                  allEligibleActivitiesById.values(),
                ).filter((a: any) => discoveryResolvedActivityIds.has(a.id));
                const mergedPool = [
                  ...nearbyActivities,
                  ...discoveryResolvedActivities.filter(
                    (a: any) =>
                      !nearbyActivities.some((r: any) => r.id === a.id),
                  ),
                ];
                const selection = await this.rankAndSliceExperiences(
                  mergedPool,
                  request.intent,
                );
                const nearbyActivitiesSample = selection.experiences;
                semanticRankingOutcome = selection.semanticRanking;
                recordOfferedCandidates(selection);
                availableActivitiesText = `\n\nAvailable verified Experiences in the area (within ${radius / 1000}km):\n${nearbyActivitiesSample
                  .map((act: any) => formatExperienceForPrompt(act))
                  .join('\n')}`;
                const candidatePoolStep = this.buildCandidatePoolTraceStep(
                  selection,
                  discoveryResolvedActivityIds,
                  new Set(),
                  undefined,
                  request,
                  nearbyActivities.length,
                  mergedPool.length,
                  mergedPool.length,
                );
                traceSteps.push(candidatePoolStep);
              } else {
                await this.updateGenerationStatus(
                  tourId,
                  'generating',
                  `La búsqueda con ${placesLabel} falló.`,
                );
              }
            }
          }
        } catch (error) {
          this.logger.warn(
            `Activity search failed or timed out: ${error.message}`,
          );
          await this.updateGenerationStatus(
            tourId,
            'generating',
            'Búsqueda de Experiences completada. Generando itinerario...',
          );
        }

        const offeredIds = Array.from(candidateActivityIds);
        traceSteps.push(
          buildEmbeddingsStep(semanticRankingOutcome, offeredIds.length),
        );
      }

      if (!availableActivitiesText) {
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
          'No se encontraron lugares reales para esta ubicación. Probá con otro destino o un radio de búsqueda más amplio.',
        );
      }

      if (allEligibleActivitiesById.size > 0) {
        let finalCoverageReport = this.buildCoverageReport(
          Array.from(allEligibleActivitiesById.values()),
          request,
          candidateActivityIds.size,
          semanticRankingOutcome,
          placesRefillError
            ? { status: 'degraded', reason: placesRefillError.code }
            : { status: 'healthy' },
        );
        const remainingStructuralDeficits = finalCoverageReport.deficits
          .filter((d) => d.severity === 'blocking')
          .map((d) => ({
            reason: d.reason as any,
            severity: d.severity as any,
            message: d.message,
            theme: d.theme,
            experienceFormat: d.experienceFormat,
            expectedCount: d.expectedCount,
            actualCount: d.actualCount,
          }));

        if (remainingStructuralDeficits.length > 0) {
          try {
            const discoveryResult =
              await this.discoverExperienceGaps(
                request.destination.label,
                request.intent.interests,
                remainingStructuralDeficits,
                request.intent.additionalPreferences,
              );
            traceSteps.push(buildDiscoveryStep(discoveryResult));

            if (discoveryResult.proposals.length > 0) {
              const resolutionResult = await this.proposalResolver.resolve({
                proposals: discoveryResult.proposals,
                destinationName: request.destination.label,
                destinationBoundary: destinationScope,
                evidence: discoveryResult.evidence,
              });
              traceSteps.push(
                buildEntityResolutionStep(resolutionResult),
                buildGeographicValidationStep(resolutionResult),
                buildCatalogMaterializationStep(resolutionResult),
              );

              const persistedDiscoveryActivityIds = resolutionResult.resolved
                .filter((r) => r.status === 'accepted' && r.experienceId)
                .map((r) => r.experienceId as string);
              const persistedExperienceIds = resolutionResult.resolved
                .filter((r: any) => r.status === 'accepted' && r.experienceId)
                .map((r: any) => r.experienceId as string);
              if (persistedExperienceIds.length > 0) {
                const experiences = await this.prisma.experience.findMany({
                  where: { id: { in: persistedExperienceIds }, status: 'VERIFIED' },
                  include: { components: { include: { geoEntity: true } } },
                });
                experiences.forEach((experience: any) => {
                  const candidate = {
                    id: experience.id,
                    name: experience.canonicalName,
                    latitude: experience.latitude ?? experience.components[0]?.geoEntity.latitude,
                    longitude: experience.longitude ?? experience.components[0]?.geoEntity.longitude,
                    duration: (experience.durationMinutes ?? 120) / 60,
                    metadata: { source: 'experience_catalog', experienceId: experience.id },
                  };
                  allEligibleActivitiesById.set(experience.id, candidate);
                  candidateActivitiesById.set(experience.id, candidate);
                  discoveryResolvedActivityIds.add(experience.id);
                });
              }
              if (persistedDiscoveryActivityIds.length > 0) {
                const reconciledSelection = await this.rankAndSliceExperiences(
                  Array.from(allEligibleActivitiesById.values()),
                  request.intent,
                );
                semanticRankingOutcome = reconciledSelection.semanticRanking;
                recordOfferedCandidates(reconciledSelection);
                  availableActivitiesText = `\n\nAvailable verified Experiences in the area:\n${reconciledSelection.experiences
                  .map((act: any) => formatExperienceForPrompt(act))
                  .join('\n')}`;
              }
            }
          } catch (discoveryError) {
            this.logger.warn(
              `Post-refill structural discovery failed (non-fatal until final acquisition gate): ${discoveryError.message}`,
            );
          }

          finalCoverageReport = this.buildCoverageReport(
            Array.from(allEligibleActivitiesById.values()),
            request,
            candidateActivityIds.size,
            semanticRankingOutcome,
            placesRefillError
              ? { status: 'degraded', reason: placesRefillError.code }
              : { status: 'healthy' },
          );
          traceSteps.push(buildCoverageAnalysisStep(finalCoverageReport));
        }

        if (
          finalCoverageReport.decision.action === 'fail' &&
          (finalCoverageReport.decision.reason === 'no_usable_candidates' ||
            finalCoverageReport.decision.reason ===
              'provider_degraded_without_usable_pool')
        ) {
          throw new Error(
            'El pool combinado de catálogo, refill y discovery sigue siendo insuficiente ' +
              'después de agotar todas las vías de adquisición disponibles para este destino; ' +
              'no se genera un itinerario con datos incompletos.',
          );
        }

        const unresolvedRequestedFormats: any[] = [];
        if (unresolvedRequestedFormats.length > 0) {
          // A missing preferred format is a satisfaction signal, not proof that
          // the destination has no usable experiences. Let the deterministic
          // planner build the best feasible tour from verified candidates and
          // preserve the deficit in the trace for the UI/audit surface.
          this.logger.warn(
            `Requested formats unavailable; continuing with feasible candidates: ${unresolvedRequestedFormats
              .map((d) => d.experienceFormat ?? 'unknown')
              .join(', ')}`,
          );
        }
      }

      await this.updateGenerationStatus(
        tourId,
        'generating',
        'Planificando el itinerario día a día...',
      );

      const planningCandidates =
        await this.planningCandidateNormalizer.normalizeExperiences(
          Array.from(candidateActivitiesById.values()),
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
            .map((i) => `${i.code}: ${i.message}`)
            .join('; ')}`,
        );
      }

      const plannedActivityCount = planningSolution.days.reduce(
        (total, day) => total + day.experiences.length,
        0,
      );
      if (plannedActivityCount === 0) {
        throw new Error(
          'No se encontraron lugares reales para esta ubicación. Probá con otro destino o un radio de búsqueda más amplio.',
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

      const selectedIds = new Set(
        planningSolution.days.flatMap((day) =>
          day.experiences.map((a) => a.experienceId),
        ),
      );

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
      const infeasiblyUnselected = planningSolution.unselected.filter((u) =>
        u.reasons.some((r) => physicallyInfeasibleReasons.has(r)),
      );
      const infeasibleActivityIds = new Set(
        infeasiblyUnselected.map((u) => u.experienceId),
      );
      const viableUnusedCandidateCount =
        planningSolution.unselected.length - infeasiblyUnselected.length;

      const completenessInput: TourCompletenessInput = {
        requestedDays: request.days,
        travelPace: request.mobility.travelPace,
        isFoodFocusedIntent,
        selectedExperiences: planningSolution.days.flatMap((day) =>
        day.experiences.map((activity) => {
          const experienceId = activity.experienceId;
            const candidate = candidateActivitiesById.get(experienceId);
            return {
              experienceId,
              dayNumber: day.dayNumber,
              durationHours:
                (activity.endMinutesFromMidnight -
                  activity.startMinutesFromMidnight) /
                60,
              isMeal: Array.isArray(candidate?.traits) && candidate.traits.some((trait: string) => trait.toLowerCase() === 'food'),
            };
          }),
        ),
        viableUnusedCandidateCount,
      };
      const completeness =
        this.tourCompletenessValidator.validate(completenessInput);

      const correctiveRetryAttempted = false;

      traceSteps.push(
        buildTourCompletenessStep(completeness, correctiveRetryAttempted),
      );

      const activities = planningSolution.days.flatMap((day) =>
        day.experiences.map((planned, index) => {
          const experienceId = planned.experienceId;
          const candidate = candidateActivitiesById.get(experienceId);
          const nextInDay = day.experiences[index + 1];
          return {
            experienceId,
            activityName: candidate?.name ?? 'Activity',
            activityType: 'experience',
            activityLatitude: candidate?.latitude,
            activityLongitude: candidate?.longitude,
            activityData: undefined as any,
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
          };
        }),
      );

      const experienceIds = activities
        .map((a) => a.experienceId)
        .filter((id): id is string => !!id);
      let experienceEntities: Array<any> = [];

      if (experienceIds.length > 0) {
        experienceEntities = await this.prisma.experience.findMany({
          where: { id: { in: experienceIds }, status: 'VERIFIED' },
          include: { components: { include: { geoEntity: true } } },
        });
      }

      const generationTrace = redactTracePayload({
        steps: traceSteps,
        tourCompleteness: {
          ...completeness,
          retryAttempted: correctiveRetryAttempted,
        },
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.tourExperience.deleteMany({ where: { tourId } });

        for (const activity of activities as any[]) {
          const experience = experienceEntities.find(
            (candidate) => candidate.id === activity.experienceId,
          );
          if (experience) {
            const snapshot = await tx.tourExperience.create({
              data: {
                tourId,
                experienceId: experience.id,
                dayNumber: activity.dayNumber,
                order: activity.order,
                startTime: activity.startTime,
                duration: activity.duration,
                notes: activity.notes,
                components: {
                  create: experience.components.map((component: any, index: number) => ({
                    geoEntityId: component.geoEntityId,
                    order: component.order ?? index + 1,
                    role: component.role,
                    required: component.required,
                    name: component.geoEntity.name,
                    latitude: component.geoEntity.latitude,
                    longitude: component.geoEntity.longitude,
                    geometry: component.geoEntity.geometry,
                  })),
                },
              },
            });
            continue;
          }
          this.logger.warn(
            `Skipping unmaterialized planner item ${activity.experienceId}: V2 only persists verified Experiences.`,
          );

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
                  latitude: experience.latitude ?? experience.components[0]?.geoEntity?.latitude ?? 0,
                  longitude: experience.longitude ?? experience.components[0]?.geoEntity?.longitude ?? 0,
                  category: experience.components[0]?.role,
                },
              });
            }
          }
        }
      });

      this.logger.log(
        `Experiences generated successfully for tour ${tourId} (${activities.length} experiences)`,
      );

      if (!request.skipImageGeneration) {
        try {
          await this.updateGenerationStatus(
            tourId,
            'generating',
            'Generando imagen de portada...',
          );
          await this.tourImageService.generateTourCoverImage(tourId);
        } catch (imgError) {
          this.logger.warn(
            `Failed to generate cover image: ${imgError.message}`,
          );
        }
      }

      const completedMessage = `¡Listo! ${activities.length} experiencias generadas exitosamente.`;
      const traceStepList = (generationTrace as any).steps ?? [];
      const executionSummary = {
        status: 'completed' as const,
        steps: traceStepList.map((step: any) => step.summary).filter(Boolean),
        narrative: traceStepList
          .map((step: any, index: number) => `${index + 1}. ${step.summary}`)
          .filter(Boolean)
          .join('\n'),
        acceptedExperiences: Math.max(activities.length, traceStepList
          .filter((step: any) => step.stage === 'entity_resolution')
          .reduce((sum: number, step: any) => sum + Number((step.resolution as any)?.acceptedCount ?? 0), 0)),
        rejectedProposals: traceStepList
          .filter((step: any) => step.stage === 'entity_resolution')
          .reduce((sum: number, step: any) => sum + Number((step.resolution as any)?.rejectedCount ?? 0), 0),
        selectedExperiences: activities.length,
      };
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
              generationTrace: { ...(generationTrace as any), executionSummary },
              generationStatus: 'completed',
              generationMessage: completedMessage,
              generationCompletedAt: new Date().toISOString(),
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
              totalActivities: activities.length,
              message: completedMessage,
            },
          });
        }
      });

      return this.toursService.findOne(tourId);
    } catch (error) {
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
                  executionSummary: {
                    status: 'failed',
                    steps: traceSteps.map((step) => step.summary).filter(Boolean),
                    narrative: traceSteps
                      .map((step, index) => `${index + 1}. ${step.summary}`)
                      .filter(Boolean)
                      .join('\n'),
                    failure: error?.message || String(error),
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
        `Failed to generate activities for tour ${tourId}: ${error.message}`,
        error.stack,
      );

      throw new BadRequestException(
        `Failed to generate activities: ${error.message}`,
      );
    }
  }

}
