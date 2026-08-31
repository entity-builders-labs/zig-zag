import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ActivityKind } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import { ActivitiesService } from '@activities/services/activities.service';
import { OutboxService } from '../../outbox/services/outbox.service';
import { VectorStoreService } from '@shared/ai/services/vector-store.service';
import {
  GooglePlacesService,
  PlacesCrawlResult,
} from '@integrations/google-places/google-places.service';
import {
  OsmCandidate,
  OsmPlacesService,
} from '@integrations/osm/services/osm-places.service';
import { ToursService } from './tours.service';
import { TourImageService } from './tour-image.service';
import { DestinationResolutionService } from './destination-resolution.service';
import { boundingBoxToCenterRadius } from '../utils/geometry-search-area.util';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';
import {
  ActivityForPrompt,
  formatActivityForPrompt,
} from '../utils/activity-prompt-formatter.util';
import { verifySelectedWaypointSubset } from '../utils/composite-activity-verification.util';
import {
  rankCandidatesByRelevance,
  RankableCandidate,
  CandidateScoreBreakdown,
} from '../utils/candidate-ranking.util';
import {
  selectBoundedWindow,
  FormatAvailability,
} from '../utils/candidate-window-selection.util';
import {
  buildCandidatePoolStep,
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
  buildTourFormatCoverageStep,
} from '../utils/generation-trace-builder.util';
import {
  IProposalResolver,
  PROPOSAL_RESOLVER,
} from '../interfaces/proposal-resolution.interface';
import { TourCompletenessValidator } from './tour-completeness-validator.service';
import { TourCompletenessInput } from '../interfaces/tour-completeness.interface';
import { TourFormatCoverageValidator } from './tour-format-coverage-validator.service';
import {
  TourFormatCoverageActivityRef,
  TourFormatCoverageInput,
} from '../interfaces/tour-format-coverage.interface';
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
import { CatalogRefillAnchorPlanner } from './catalog-refill-anchor-planner.service';
import { TourIntent } from '../interfaces/tour-generation.interface';
import { ActivityDiscoveryService } from './activity-discovery.service';
import { CoverageAnalyzer } from './coverage-analyzer.service';
import { buildSemanticTourQuery } from '../utils/semantic-tour-query-builder.util';
import {
  EmbeddingIndexIdentity,
  SemanticSimilarityResult,
} from '@shared/ai/interfaces/embedding-index.interface';

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
  activities: any[];
  semanticRanking: SemanticRankingOutcome;
  scoreBreakdownById: Map<string, CandidateScoreBreakdown>;
  formatAvailability: FormatAvailability[];
  droppedForFamilyCapCount: number;
}

@Injectable()
export class TourActivityGenerationService {
  private readonly logger = new Logger(TourActivityGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toursService: ToursService,
    private readonly activitiesService: ActivitiesService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly googlePlacesService: GooglePlacesService,
    private readonly tourImageService: TourImageService,
    private readonly osmPlacesService: OsmPlacesService,
    private readonly destinationResolutionService: DestinationResolutionService,
    private readonly catalogRefillAnchorPlanner: CatalogRefillAnchorPlanner,
    private readonly coverageAnalyzer: CoverageAnalyzer,
    private readonly activityDiscoveryService: ActivityDiscoveryService,
    private readonly tourCompletenessValidator: TourCompletenessValidator,
    private readonly tourFormatCoverageValidator: TourFormatCoverageValidator,
    @Inject(PROPOSAL_RESOLVER)
    private readonly proposalResolver: IProposalResolver,
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
  ) {}

  /** PR10: no new Prisma columns. If a real base date exists, combine it
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
        kind: activity.kind,
        source: activity.source || activity.sourceId || 'db',
        type: activity.type,
        knownActivityTypeName: activity.knownActivityTypeName,
        weightedScore: activity.weightedScore,
        distanceKm: activity.distance,
        metadata: activity.metadata,
      })),
      requestedThemes: request.intent.interests,
      requestedExperienceFormats: request.intent.experienceFormats,
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
   * PR 9: builds the candidate_pool trace step for whichever branch just
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
    const offeredCandidates = selection.activities.map((act: any) => ({
      id: act.id,
      name: act.name,
      kind: act.kind,
      type: act.type,
      knownActivityTypeName: act.knownActivityTypeName,
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
    return buildCandidatePoolStep({
      initialCatalogCount,
      postAcquisitionCatalogCount,
      eligibleCount,
      offeredCandidates,
      requestedThemes: request.intent.interests,
      formatAvailability: selection.formatAvailability,
      droppedForFamilyCapCount: selection.droppedForFamilyCapCount,
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

    if (this.outboxService && (status === 'generating' || status === 'pending')) {
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

  private async rankAndSliceActivities(
    activities: any[],
    intent: TourIntent,
  ): Promise<CandidateSelection> {
    const semanticQuery = buildSemanticTourQuery(intent);
    let semanticResult: SemanticSimilarityResult | null = null;

    if (semanticQuery) {
      semanticResult = await this.vectorStoreService.getSimilarityScores(
        activities.map((activity) => activity.id),
        semanticQuery,
      );
    }

    const rankable: (RankableCandidate & { original: any })[] = activities.map(
      (a) => ({
        id: a.id,
        source: a.kind && a.kind !== 'POI' ? 'composite' : 'poi',
        kind: a.kind,
        subtype: a.knownActivityTypeName ?? a.type,
        distanceKm: a.distance,
        weightedScore: a.weightedScore,
        isCurated: a.isCurated,
        familyId: a.familyId,
        original: a,
      }),
    );
    const rankedFull = rankCandidatesByRelevance(
      rankable,
      semanticResult?.status === 'applied' ? semanticResult.scores : null,
    );
    const { window, formatAvailability, droppedForFamilyCapCount } =
      selectBoundedWindow(
        rankedFull,
        intent.experienceFormats,
        this.ITINERARY_CANDIDATE_LIMIT,
      );
    const ranked = window.map((r) => r.candidate.original);
    const scoreBreakdownById = new Map(
      window.map((r) => [r.candidate.id, r.scoreBreakdown]),
    );

    if (!semanticQuery) {
      return {
        activities: ranked,
        scoreBreakdownById,
        formatAvailability,
        droppedForFamilyCapCount,
        semanticRanking: {
          status: 'not_requested',
          eligibleCandidateCount: activities.length,
          indexedCandidateCount:
            await this.vectorStoreService.getCompatibleIndexCount(
              activities.map((activity) => activity.id),
            ),
        },
      };
    }

    return {
      activities: ranked,
      scoreBreakdownById,
      formatAvailability,
      droppedForFamilyCapCount,
      semanticRanking: {
        status: semanticResult!.status,
        eligibleCandidateCount: semanticResult!.requestedCandidateCount,
        indexedCandidateCount: semanticResult!.indexedCandidateCount,
        identity: semanticResult!.identity,
        reason: semanticResult!.reason,
      },
    };
  }

  async generateTourActivities(tourId: string) {
    const tour = await this.toursService.findOne(tourId);
    if (!tour) {
      throw new NotFoundException(`Tour with ID ${tourId} not found`);
    }

    const metadata = tour.metadata as any;
    if (metadata?.generationStatus === 'generating') {
      throw new BadRequestException(
        'Activities are already being generated for this tour',
      );
    }
    if (
      metadata?.generationStatus === 'completed' &&
      tour.activities.length > 0
    ) {
      throw new BadRequestException('Activities have already been generated');
    }

    const traceSteps: GenerationTraceStep[] = [];

    await this.updateGenerationStatus(
      tourId,
      'generating',
      'Iniciando generación de actividades...',
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
      const candidateActivitiesById = new Map<string, ActivityForPrompt>();
      const offeredScoreBreakdownById = new Map<
        string,
        CandidateScoreBreakdown
      >();
      const allEligibleActivitiesById = new Map<string, any>();
      const discoveryResolvedActivityIds = new Set<string>();
      let placesRefillError: PlacesCrawlError | null = null;

      const recordOfferedCandidates = (selection: CandidateSelection) => {
        selection.activities.forEach((act: any) => {
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
          `Buscando actividades en la zona (radio ${Math.round(radius / 1000)}km)...`,
        );

        try {
          const nearbyActivities = await this.withTimeout(
            this.activitiesService.findAll(
              searchArea.latitude.toString(),
              searchArea.longitude.toString(),
              radius,
              activityLimit,
            ),
            10000,
            'Activity search timeout',
          );
          nearbyActivities.forEach((act: any) =>
            allEligibleActivitiesById.set(act.id, act),
          );
          const selection = await this.rankAndSliceActivities(
            nearbyActivities,
            request.intent,
          );
          const nearbyActivitiesSample = selection.activities;
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
              `${nearbyActivities.length} actividades encontradas. Ordenando según tus preferencias...`,
            );
            recordOfferedCandidates(selection);
            availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${nearbyActivitiesSample
              .map((act: any) => formatActivityForPrompt(act))
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
                    await this.activityDiscoveryService.discoverGaps(
                      request.destination.label,
                      undefined,
                      request.intent.interests,
                      deficits,
                      request.intent.experienceFormats,
                      request.intent.explorationStyle,
                      request.intent.additionalPreferences,
                    );
                  traceSteps.push(buildDiscoveryStep(discoveryResult));
                  if (discoveryResult.proposals.length > 0) {
                    try {
                      const resolutionResult =
                        await this.proposalResolver.resolve({
                          proposals: discoveryResult.proposals,
                          destinationName: request.destination.label,
                          destinationBoundary:
                            destinationResolution.scale === 'area'
                              ? destinationResolution.boundary
                              : undefined,
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
                              r.status === 'accepted' && r.persistedActivityId,
                          )
                          .map((r) => r.persistedActivityId as string);
                      if (persistedDiscoveryActivityIds.length > 0) {
                        const newlyResolvedActivities =
                          await this.activitiesService.findManyByIds(
                            persistedDiscoveryActivityIds,
                            searchArea.latitude,
                            searchArea.longitude,
                          );
                        newlyResolvedActivities.forEach((act: any) => {
                          allEligibleActivitiesById.set(act.id, act);
                          discoveryResolvedActivityIds.add(act.id);
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

            const placesStatus = this.googlePlacesService.getProviderStatus();
            const placesLabel = placesProviderLabel(placesStatus.provider);

            const poolStatus =
              nearbyActivities.length > 0
                ? `Se encontraron ${nearbyActivities.length} actividades pero insuficientes. Buscando más con ${placesLabel}...`
                : `No se encontraron actividades locales. Buscando con ${placesLabel}...`;
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
                  activitiesIds: [],
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
                const anchors = await this.catalogRefillAnchorPlanner.plan({
                  destinationResolution,
                  destinationPoint,
                  pointRadiusMeters: Math.min(radius, 5_000),
                  coverageAreas,
                });
                crawlResult =
                  await this.googlePlacesService.crawlAndSaveActivities(
                    {
                      latitude: searchArea.latitude,
                      longitude: searchArea.longitude,
                      radius: Math.min(radius, 5000),
                    },
                    {
                      anchors,
                      destinationLabel: request.destination.label,
                      requestedInterests: request.intent.interests,
                      destinationBoundary: isAreaScale
                        ? destinationResolution.boundary.geometry
                        : undefined,
                    },
                  );
              }

              const refreshedActivities = await this.activitiesService.findAll(
                searchArea.latitude.toString(),
                searchArea.longitude.toString(),
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
                  `¡Catálogo actualizado con ${placesLabel}! Analizando ${refreshedActivities.length} actividades...`,
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

                const selection = await this.rankAndSliceActivities(
                  mergedPool,
                  request.intent,
                );
                const refreshedActivitiesSample = selection.activities;
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
                    'No se encontró un pool de actividades utilizable para armar un itinerario real con el catálogo actual.',
                  );
                }
                recordOfferedCandidates(selection);
                availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${refreshedActivitiesSample
                  .map((act: any) => formatActivityForPrompt(act))
                  .join('\n')}`;
                const newActivityIds = new Set(crawlResult.activitiesIds);
                const crawlStep = buildPlacesCrawlStep(
                  refreshedActivitiesSample.filter((activity: any) =>
                    newActivityIds.has(activity.id),
                  ),
                  crawlResult.provenance,
                );
                traceSteps.push(crawlStep);

                const candidatePoolStep = this.buildCandidatePoolTraceStep(
                  selection,
                  discoveryResolvedActivityIds,
                  newActivityIds,
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
                      : `${nearbyActivities.length} actividades locales disponibles.`;
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
                  const selection = await this.rankAndSliceActivities(
                    mergedPool,
                    request.intent,
                  );
                  const nearbyActivitiesSample = selection.activities;
                  semanticRankingOutcome = selection.semanticRanking;
                  recordOfferedCandidates(selection);
                  availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${nearbyActivitiesSample
                    .map((act: any) => formatActivityForPrompt(act))
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
                  `${placesLabel} indisponible. Usando ${nearbyActivities.length} actividades locales encontradas.`,
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
                const selection = await this.rankAndSliceActivities(
                  mergedPool,
                  request.intent,
                );
                const nearbyActivitiesSample = selection.activities;
                semanticRankingOutcome = selection.semanticRanking;
                recordOfferedCandidates(selection);
                availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${nearbyActivitiesSample
                  .map((act: any) => formatActivityForPrompt(act))
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
            'Búsqueda de actividades completada. Generando itinerario con IA...',
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
          .filter(
            (d) =>
              d.severity === 'blocking' &&
              d.reason === 'missing_requested_experience_format',
          )
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
              await this.activityDiscoveryService.discoverGaps(
                request.destination.label,
                undefined,
                request.intent.interests,
                remainingStructuralDeficits,
                request.intent.experienceFormats,
                request.intent.explorationStyle,
                request.intent.additionalPreferences,
              );
            traceSteps.push(buildDiscoveryStep(discoveryResult));

            if (discoveryResult.proposals.length > 0) {
              const resolutionResult = await this.proposalResolver.resolve({
                proposals: discoveryResult.proposals,
                destinationName: request.destination.label,
                destinationBoundary:
                  destinationResolution.scale === 'area'
                    ? destinationResolution.boundary
                    : undefined,
              });
              traceSteps.push(
                buildEntityResolutionStep(resolutionResult),
                buildGeographicValidationStep(resolutionResult),
                buildCatalogMaterializationStep(resolutionResult),
              );

              const persistedDiscoveryActivityIds = resolutionResult.resolved
                .filter(
                  (r) => r.status === 'accepted' && r.persistedActivityId,
                )
                .map((r) => r.persistedActivityId as string);
              if (persistedDiscoveryActivityIds.length > 0) {
                const newlyResolvedActivities =
                  await this.activitiesService.findManyByIds(
                    persistedDiscoveryActivityIds,
                    searchArea.latitude,
                    searchArea.longitude,
                  );
                newlyResolvedActivities.forEach((act: any) => {
                  allEligibleActivitiesById.set(act.id, act);
                  discoveryResolvedActivityIds.add(act.id);
                });

                const reconciledSelection = await this.rankAndSliceActivities(
                  Array.from(allEligibleActivitiesById.values()),
                  request.intent,
                );
                semanticRankingOutcome = reconciledSelection.semanticRanking;
                recordOfferedCandidates(reconciledSelection);
                availableActivitiesText = `\n\nAvailable activities in the area:\n${reconciledSelection.activities
                  .map((act: any) => formatActivityForPrompt(act))
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

        const unresolvedRequestedFormats = finalCoverageReport.deficits.filter(
          (d) =>
            d.severity === 'blocking' &&
            d.reason === 'missing_requested_experience_format',
        );
        if (unresolvedRequestedFormats.length > 0) {
          throw new Error(
            `Requested experience formats could not be acquired after catalog refill and grounded discovery: ${unresolvedRequestedFormats
              .map(
                (d) =>
                  `${d.experienceFormat ?? 'unknown'} (${d.actualCount ?? 0}/${d.expectedCount ?? 1})`,
              )
              .join(', ')}.`,
          );
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
      }

      await this.updateGenerationStatus(
        tourId,
        'generating',
        'Planificando el itinerario día a día...',
      );

      const planningCandidates =
        await this.planningCandidateNormalizer.normalize(
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
        requestedFormats: request.intent.experienceFormats,
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
        (total, day) => total + day.activities.length,
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
        'Itinerario planificado. Guardando actividades...',
      );

      const isFoodFocusedIntent =
        request.intent.interests.length === 1 &&
        request.intent.interests[0] === 'food';

      const selectedIds = new Set(
        planningSolution.days.flatMap((day) =>
          day.activities.map((a) => a.activityId),
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
        infeasiblyUnselected.map((u) => u.activityId),
      );
      const viableUnusedCandidateCount =
        planningSolution.unselected.length - infeasiblyUnselected.length;

      const completenessInput: TourCompletenessInput = {
        requestedDays: request.days,
        travelPace: request.mobility.travelPace,
        isFoodFocusedIntent,
        selectedActivities: planningSolution.days.flatMap((day) =>
          day.activities.map((activity) => {
            const candidate = candidateActivitiesById.get(activity.activityId);
            return {
              activityId: activity.activityId,
              dayNumber: day.dayNumber,
              durationHours:
                (activity.endMinutesFromMidnight -
                  activity.startMinutesFromMidnight) /
                60,
              isMeal: candidate?.type === 'food',
            };
          }),
        ),
        viableUnusedCandidateCount,
      };
      const completeness =
        this.tourCompletenessValidator.validate(completenessInput);

      const formatCoverageInput: TourFormatCoverageInput = {
        requestedExperienceFormats: request.intent.experienceFormats,
        selectedActivities: Array.from(selectedIds)
          .map((activityId): TourFormatCoverageActivityRef | null => {
            const candidate = candidateActivitiesById.get(activityId);
            return candidate?.kind
              ? { activityId, kind: candidate.kind }
              : null;
          })
          .filter((ref): ref is TourFormatCoverageActivityRef => ref !== null),
        availableCandidateActivities: Array.from(
          candidateActivitiesById.entries(),
        )
          .filter(
            ([id, candidate]) =>
              candidate.kind && !infeasibleActivityIds.has(id),
          )
          .map(([activityId, candidate]) => ({
            activityId,
            kind: candidate.kind as ActivityKind,
          })),
      };
      const formatCoverage =
        this.tourFormatCoverageValidator.validate(formatCoverageInput);

      const correctiveRetryAttempted = false;

      traceSteps.push(
        buildTourCompletenessStep(completeness, correctiveRetryAttempted),
      );
      traceSteps.push(
        buildTourFormatCoverageStep(formatCoverage, correctiveRetryAttempted),
      );

      const activities = planningSolution.days.flatMap((day) =>
        day.activities.map((planned, index) => {
          const candidate = candidateActivitiesById.get(planned.activityId);
          const nextInDay = day.activities[index + 1];
          return {
            activityId: planned.activityId,
            activityName: candidate?.name ?? 'Activity',
            activityType: candidate?.type ?? 'Activity',
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

      const activityIds = activities
        .map((a) => a.activityId)
        .filter((id): id is string => !!id);

      let kindByActivityId = new Map<string, ActivityKind>();
      const waypointIdsByActivityId = new Map<string, string[]>();

      let activityEntities: Array<{
        id: string;
        name: string;
        latitude: number;
        longitude: number;
        kind: ActivityKind;
        type: string | null;
        formattedAddress: string | null;
        photos: any;
        metadata: any;
      }> = [];

      if (activityIds.length > 0) {
        activityEntities = await this.prisma.activity.findMany({
          where: { id: { in: activityIds } },
          select: {
            id: true,
            name: true,
            latitude: true,
            longitude: true,
            kind: true,
            type: true,
            formattedAddress: true,
            photos: true,
            metadata: true,
          },
        });

        kindByActivityId = new Map(
          activityEntities.map((act) => [act.id, act.kind]),
        );

        const nonPoiActivityIds = activityEntities
          .filter((act) => act.kind !== ActivityKind.POI)
          .map((act) => act.id);
        if (nonPoiActivityIds.length > 0) {
          const waypointRows = await this.prisma.activityWaypoint.findMany({
            where: { compositeActivityId: { in: nonPoiActivityIds } },
            orderBy: { order: 'asc' },
          });
          for (const row of waypointRows) {
            const list =
              waypointIdsByActivityId.get(row.compositeActivityId) ?? [];
            list.push(row.waypointActivityId);
            waypointIdsByActivityId.set(row.compositeActivityId, list);
          }
        }
      }

      const generationTrace = {
        steps: traceSteps,
        tourCompleteness: {
          ...completeness,
          retryAttempted: correctiveRetryAttempted,
        },
        tourFormatCoverage: {
          ...formatCoverage,
          retryAttempted: correctiveRetryAttempted,
        },
      };

      await this.prisma.$transaction(async (tx) => {
        await tx.tourActivity.deleteMany({
          where: { tourId },
        });

        for (const activity of activities as any[]) {
          const createdTourActivity = await tx.tourActivity.create({
            data: {
              tourId,
              activityId: activity.activityId,
              activityName: activity.activityName,
              activityType: activity.activityType,
              activityLatitude: activity.activityLatitude,
              activityLongitude: activity.activityLongitude,
              activityData: activity.activityData,
              duration: activity.duration,
              startTime: activity.startTime,
              notes: activity.notes,
              dayNumber: activity.dayNumber,
              travelTimeToNext: activity.travelTimeToNext,
              distanceToNext: activity.distanceToNext,
              order: activity.order,
            },
          });

          const kind = activity.activityId
            ? kindByActivityId.get(activity.activityId)
            : undefined;
          if (kind && kind !== ActivityKind.POI) {
            const actualWaypointIds =
              waypointIdsByActivityId.get(activity.activityId as string) ?? [];
            const finalWaypointIds = actualWaypointIds;

            if (finalWaypointIds.length > 0) {
              await tx.tourActivityWaypoint.createMany({
                data: finalWaypointIds.map((waypointActivityId, index) => ({
                  tourActivityId: createdTourActivity.id,
                  waypointActivityId,
                  order: index + 1,
                })),
              });
            }
          }
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
          for (const act of activityEntities) {
            if (
              !act.photos ||
              (Array.isArray(act.photos) && act.photos.length === 0)
            ) {
              await this.outboxService.createInTx(tx, {
                eventType: 'ActivityMediaEnrichmentRequested',
                payload: {
                  activityId: act.id,
                  name: act.name,
                  destinationLabel:
                    request.destination?.label || act.formattedAddress,
                  wikidataId: (act.metadata as any)?.wikidataId,
                  latitude: act.latitude,
                  longitude: act.longitude,
                  category: act.type || act.kind,
                },
              });
            }
          }
        }
      });

      this.logger.log(
        `Activities generated successfully for tour ${tourId} (${activities.length} activities)`,
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

      const completedMessage = `¡Listo! ${activities.length} actividades generadas exitosamente.`;
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
                generationTrace: {
                  ...((latestTour?.metadata as any)?.generationTrace ?? {}),
                  steps: traceSteps,
                },
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

  async updateTourActivityWaypoints(
    tourId: string,
    tourActivityId: string,
    selectedWaypointActivityIds: string[],
  ) {
    const tourActivity = await this.prisma.tourActivity.findUnique({
      where: { id: tourActivityId },
    });
    if (!tourActivity || tourActivity.tourId !== tourId) {
      throw new NotFoundException(
        `TourActivity ${tourActivityId} not found on tour ${tourId}`,
      );
    }
    if (!tourActivity.activityId) {
      throw new BadRequestException(
        'This tour stop has no linked variant to select waypoints from.',
      );
    }

    const actualWaypoints = await this.prisma.activityWaypoint.findMany({
      where: { compositeActivityId: tourActivity.activityId },
    });
    const actualWaypointIds = new Set(
      actualWaypoints.map((w) => w.waypointActivityId),
    );

    const validSubset = verifySelectedWaypointSubset(
      selectedWaypointActivityIds,
      actualWaypointIds,
    );
    if (!validSubset) {
      this.logger.warn(
        `Ignored an invalid/too-small waypoint subset for TourActivity ${tourActivityId} (tour ${tourId}) — left as-is.`,
      );
      return tourActivity;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.tourActivityWaypoint.deleteMany({
        where: { tourActivityId },
      });
      await tx.tourActivityWaypoint.createMany({
        data: validSubset.map((waypointActivityId, index) => ({
          tourActivityId,
          waypointActivityId,
          order: index + 1,
        })),
      });
    });

    return this.prisma.tourActivity.findUnique({
      where: { id: tourActivityId },
    });
  }
}
