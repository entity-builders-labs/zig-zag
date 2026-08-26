import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActivityKind } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import { ActivitiesService } from '@activities/services/activities.service';
import { LangChainService } from '@shared/ai/langchain.service';
import { VectorStoreService } from '@shared/ai/services/vector-store.service';
import { GooglePlacesService } from '@integrations/google-places/google-places.service';
import {
  OsmCandidate,
  OsmPlacesService,
} from '@integrations/osm/services/osm-places.service';
import { ToursService } from './tours.service';
import { TourImageService } from './tour-image.service';
import { CompositeGenerationService } from './composite-generation.service';
import { DestinationResolutionService } from './destination-resolution.service';
import { boundingBoxToCenterRadius } from '../utils/geometry-search-area.util';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';
import { transformAiActivitiesToDto } from '../utils/activity-transformer.util';
import { updateTravelTimesForActivities } from '../utils/travel-time-calculator.util';
import { optimizeActivityOrder } from '../utils/route-optimizer.util';
import { verifyAndDedupeActivities } from '../utils/activity-verification.util';
import {
  ActivityForPrompt,
  formatActivityForPrompt,
} from '../utils/activity-prompt-formatter.util';
import { verifySelectedWaypointSubset } from '../utils/composite-activity-verification.util';
import {
  rankCandidatesByRelevance,
  RankableCandidate,
} from '../utils/candidate-ranking.util';
import { auditGeneration } from '../utils/generation-audit.util';
import {
  buildCoverageAnalysisStep,
  buildDiscoveryStep,
  buildDbSearchStep,
  buildDestinationResolutionStep,
  buildEmbeddingsStep,
  buildEntityResolutionStep,
  buildTourIntentStep,
  buildPlacesCrawlStep,
  buildLlmGenerationStep,
  buildTourCompletenessStep,
  buildTourFormatCoverageStep,
  buildVerificationStep,
} from '../utils/generation-trace-builder.util';
import {
  IProposalResolver,
  PROPOSAL_RESOLVER,
} from '../interfaces/proposal-resolution.interface';
import { TourCompletenessValidator } from './tour-completeness-validator.service';
import {
  TourCompletenessInput,
  TourCompletenessIssue,
} from '../interfaces/tour-completeness.interface';
import { TourFormatCoverageValidator } from './tour-format-coverage-validator.service';
import {
  TourFormatCoverageActivityRef,
  TourFormatCoverageInput,
  TourFormatCoverageIssue,
} from '../interfaces/tour-format-coverage.interface';
import {
  GenerationTraceStep,
  TraceCandidate,
} from '../interfaces/generation-trace.interface';
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
}

@Injectable()
export class TourActivityGenerationService {
  private readonly logger = new Logger(TourActivityGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toursService: ToursService,
    private readonly activitiesService: ActivitiesService,
    private readonly langChainService: LangChainService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly googlePlacesService: GooglePlacesService,
    private readonly tourImageService: TourImageService,
    private readonly osmPlacesService: OsmPlacesService,
    private readonly compositeGenerationService: CompositeGenerationService,
    private readonly destinationResolutionService: DestinationResolutionService,
    private readonly catalogRefillAnchorPlanner: CatalogRefillAnchorPlanner,
    private readonly coverageAnalyzer: CoverageAnalyzer,
    private readonly activityDiscoveryService: ActivityDiscoveryService,
    private readonly tourCompletenessValidator: TourCompletenessValidator,
    private readonly tourFormatCoverageValidator: TourFormatCoverageValidator,
    @Inject(PROPOSAL_RESOLVER)
    private readonly proposalResolver: IProposalResolver,
  ) {}

  /**
   * Deterministic, real-data-only feedback for the one bounded corrective
   * retry (PR 7.2 completeness + PR 7.4 format coverage) — never asserts
   * anything neither validator actually measured. Combined into a single
   * message so both concerns share one retry, never two independent loops.
   */
  private buildCorrectiveFeedback(
    completenessIssues: TourCompletenessIssue[],
    formatIssues: TourFormatCoverageIssue[],
    travelPace: TourGenerationRequest['mobility']['travelPace'],
  ): string {
    const lines: string[] = [];
    if (completenessIssues.length > 0) {
      lines.push(
        'The previous itinerary materially under-filled the following requested day(s):',
        ...completenessIssues.map(
          (issue) =>
            `- Day ${issue.dayNumber}: ${issue.selectedActivityCount} selected activity/activities, ` +
            `approximately ${issue.selectedActivityHours} hours of activity time, with ` +
            `${issue.viableUnusedCandidateCount} additional relevant viable candidate(s) still available.`,
        ),
      );
    }
    if (formatIssues.length > 0) {
      lines.push(
        'The previous itinerary ignored the following explicitly requested experience format(s), even though viable verified candidates existed:',
        ...formatIssues.map(
          (issue) =>
            `- "${issue.requestedFormat}": ${issue.availableCandidateCount} viable candidate(s) available, 0 selected.`,
        ),
      );
    }
    lines.push(
      '',
      `Regenerate the itinerary once: make each under-filled day reasonably complete for the requested "${travelPace}" travel pace, and include at least one strong candidate for each requested format that has viable candidates available.`,
      'Do not add irrelevant, repetitive, low-quality, or geographically inefficient activities merely to increase count, and do not fabricate an activity to satisfy a requested format that has no real candidate.',
    );
    return lines.join('\n');
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
    const metadata = tour.metadata as any;
    // A successful retry must not keep presenting the previous attempt's
    // failure as current state. Failed metadata is added atomically in the
    // catch path below; every non-failed transition explicitly removes it.
    const nextMetadata = withoutGenerationFailure(metadata);
    await this.prisma.tour.update({
      where: { id: tourId },
      data: {
        metadata: {
          ...nextMetadata,
          generationStatus: status,
          generationMessage: message,
          ...(status === 'generating' &&
          metadata?.generationStatus !== 'generating'
            ? { generationStartedAt: new Date().toISOString() }
            : {}),
        },
      },
    });
  }

  private readonly CATALOG_RETRIEVAL_POOL_LIMIT = 250;
  private readonly ITINERARY_CANDIDATE_LIMIT = 15;

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

    // A row from ActivitiesService.findAll can itself be an existing
    // composite variant (kind NEIGHBORHOOD_WALK/ROUTE/EXPERIENCE) — those
    // must score as 'composite' (isCurated bonus), never 'poi'
    // (weightedScore), or they'd keep inheriting the exact flat-prior
    // unfairness this design set out to remove (spec root cause #3).
    const rankable: (RankableCandidate & { original: any })[] = activities.map(
      (a) => ({
        id: a.id,
        source: a.kind && a.kind !== 'POI' ? 'composite' : 'poi',
        kind: a.kind,
        subtype: a.knownActivityTypeName ?? a.type,
        distanceKm: a.distance,
        weightedScore: a.weightedScore,
        isCurated: a.isCurated,
        original: a,
      }),
    );
    const ranked = rankCandidatesByRelevance(
      rankable,
      semanticResult?.status === 'applied' ? semanticResult.scores : null,
    )
      .slice(0, this.ITINERARY_CANDIDATE_LIMIT)
      .map((candidate) => candidate.original);

    if (!semanticQuery) {
      return {
        activities: ranked,
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
      semanticRanking: {
        status: semanticResult!.status,
        eligibleCandidateCount: semanticResult!.requestedCandidateCount,
        indexedCandidateCount: semanticResult!.indexedCandidateCount,
        identity: semanticResult!.identity,
        reason: semanticResult!.reason,
      },
    };
  }

  /**
   * Generate activities for an existing tour
   * This method generates activities in the background for a tour that was created with skipActivities=true
   */
  async generateTourActivities(tourId: string) {
    const tour = await this.toursService.findOne(tourId);
    if (!tour) {
      throw new NotFoundException(`Tour with ID ${tourId} not found`);
    }

    // Check if activities are already being generated or completed
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

    // Update status to generating
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

      const selectorInput = tour.prompt;
      if (!selectorInput) {
        throw new BadRequestException(
          'Tour does not have canonical selector input stored',
        );
      }

      let availableActivitiesText = '';
      // Real activity ids we actually offered the model — anything it
      // returns outside this set gets dropped as a hallucination, since
      // every stop must be a real, verified place.
      const candidateActivityIds = new Set<string>();
      // Same db/Google candidates, keyed by id, keeping their real
      // rating/priceLevel/openingHours — needed both for the trace's
      // candidate `detail` and to audit the AI's picks against the actual
      // data it saw.
      const candidateActivitiesById = new Map<string, ActivityForPrompt>();
      // The generation bitácora (docs/superpowers/specs/2026-08-20-generation-
      // bitacora-design.md) — one step per pipeline stage, in order.
      const traceSteps: GenerationTraceStep[] = [];
      const traceCandidateLists: TraceCandidate[][] = [];
      let placesRefillError: PlacesCrawlError | null = null;
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

      // Area-scale: the search area is the resolved boundary's own extent,
      // never the FE-derived viewport radius. Point-scale: today's exact
      // behavior, unchanged.
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

      // Search for existing activities if location provided
      if (
        Number.isFinite(request.destination.latitude) &&
        Number.isFinite(request.destination.longitude)
      ) {
        const radius = searchArea.radiusMeters;
        const activityLimit = this.CATALOG_RETRIEVAL_POOL_LIMIT;

        // Update status: searching for activities
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
          // PR 6: replace the global MIN_SUFFICIENT_ACTIVITIES gate with the
          // deterministic CoverageAnalyzer. Sufficiency now depends on the real
          // eligible pool (requested themes, quantity by days/pace, kind spread),
          // and the coverage report is traced truthfully before any decision.
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
            // Update status: activities found, processing
            await this.updateGenerationStatus(
              tourId,
              'generating',
              `${nearbyActivities.length} actividades encontradas. Ordenando según tus preferencias...`,
            );
            nearbyActivitiesSample.forEach((act: any) => {
              candidateActivityIds.add(act.id);
              candidateActivitiesById.set(act.id, act);
            });
            availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${nearbyActivitiesSample
              .map((act: any) => formatActivityForPrompt(act))
              .join('\n')}`;
            const dbSearchStep = buildDbSearchStep(
              nearbyActivitiesSample,
              radius / 1000,
            );
            traceSteps.push(dbSearchStep);
            traceCandidateLists.push(dbSearchStep.candidates ?? []);
          } else {
            const dbSearchStep = buildDbSearchStep(
              nearbyActivities,
              radius / 1000,
            );
            traceSteps.push(dbSearchStep);
            traceCandidateLists.push(dbSearchStep.candidates ?? []);

            // PR 7: run grounded discovery for the detected deficits.
            // Proposals are traced but not persisted (PR 7 contract).
            // The tour still proceeds with Places refill (PR 8 will resolve
            // discovery proposals into real Activities). Gated only on
            // whether CoverageAnalyzer actually found a blocking deficit —
            // not on interests being non-empty, since a user can request a
            // composite experience format with zero themes selected and
            // still deserve discovery for that (PR 7.4).
            {
              const deficits = initialCoverageReport.deficits
                .filter((d) => d.severity === 'blocking')
                .map((d) => ({
                  reason: d.reason as any,
                  severity: d.severity as any,
                  message: d.message,
                  theme: d.theme,
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
                    );
                  if (discoveryResult.proposals.length > 0) {
                    traceSteps.push(buildDiscoveryStep(discoveryResult));
                    // PR 8: turn accepted proposals into real, persisted
                    // Activities (AREA/composite via CompositeActivityService,
                    // POI direct). This does NOT add them to this request's
                    // own candidateActivityIds/candidateActivitiesById — a
                    // newly persisted Activity only becomes selectable by a
                    // future generation's ordinary geographic catalog query.
                    // Combining freshly resolved discovery Activities into
                    // *this* request's offered pool is PR 9's job.
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
                      );
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

            // Update status: pool is too thin, triggering catalog refill.
            const poolStatus =
              nearbyActivities.length > 0
                ? `Se encontraron ${nearbyActivities.length} actividades pero insuficientes. Buscando más con ${placesLabel}...`
                : `No se encontraron actividades locales. Buscando con ${placesLabel}...`;
            await this.updateGenerationStatus(tourId, 'generating', poolStatus);

            try {
              if (isAreaScale) {
                // Child-area centers are transient geographic coverage points
                // for the point-based Nearby operation. They are not ranked as
                // tourism areas and never enter composite generation.
                coverageAreas = await this.lookupCoverageAreas(
                  destinationResolution.boundary,
                );
              }
              const anchors = await this.catalogRefillAnchorPlanner.plan({
                destinationResolution,
                destinationPoint,
                pointRadiusMeters: Math.min(radius, 5_000),
                coverageAreas,
              });
              const crawlResult =
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

              // Try searching again after crawling
              const refreshedActivities = await this.activitiesService.findAll(
                searchArea.latitude.toString(),
                searchArea.longitude.toString(),
                radius,
                activityLimit,
              );
              if (refreshedActivities.length > 0) {
                await this.updateGenerationStatus(
                  tourId,
                  'generating',
                  `¡Catálogo actualizado con ${placesLabel}! Analizando ${refreshedActivities.length} actividades...`,
                );

                const selection = await this.rankAndSliceActivities(
                  refreshedActivities,
                  request.intent,
                );
                const refreshedActivitiesSample = selection.activities;
                semanticRankingOutcome = selection.semanticRanking;
                const refreshedCoverageReport = this.buildCoverageReport(
                  refreshedActivities,
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
                refreshedActivitiesSample.forEach((act: any) => {
                  candidateActivityIds.add(act.id);
                  candidateActivitiesById.set(act.id, act);
                });
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
                traceCandidateLists.push(crawlStep.candidates ?? []);
              } else {
                traceSteps.push(
                  buildPlacesCrawlStep([], crawlResult.provenance),
                );
                // Crawl found nothing — but if we already had a thin local pool,
                // fall back to using it rather than leaving candidateActivityIds empty.
                // Same "degrade gracefully" pattern as OSM/Wikidata failures.
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
                  const selection = await this.rankAndSliceActivities(
                    nearbyActivities,
                    request.intent,
                  );
                  const nearbyActivitiesSample = selection.activities;
                  semanticRankingOutcome = selection.semanticRanking;
                  nearbyActivitiesSample.forEach((act: any) => {
                    candidateActivityIds.add(act.id);
                    candidateActivitiesById.set(act.id, act);
                  });
                  availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${nearbyActivitiesSample
                    .map((act: any) => formatActivityForPrompt(act))
                    .join('\n')}`;
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
              // PR 6: report the provider degradation truthfully instead of
              // treating it as proof of geographic scarcity, then reuse the
              // thin local pool exactly as before when it exists.
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
              // Crawl failed, but if we already had a thin local pool, use it
              // rather than leaving generation with empty candidates.
              if (nearbyActivities.length > 0) {
                await this.updateGenerationStatus(
                  tourId,
                  'generating',
                  `${placesLabel} indisponible. Usando ${nearbyActivities.length} actividades locales encontradas.`,
                );
                const selection = await this.rankAndSliceActivities(
                  nearbyActivities,
                  request.intent,
                );
                const nearbyActivitiesSample = selection.activities;
                semanticRankingOutcome = selection.semanticRanking;
                nearbyActivitiesSample.forEach((act: any) => {
                  candidateActivityIds.add(act.id);
                  candidateActivitiesById.set(act.id, act);
                });
                availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${nearbyActivitiesSample
                  .map((act: any) => formatActivityForPrompt(act))
                  .join('\n')}`;
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

      // The itinerary model selects only reusable catalog Activity IDs.
      // New composites are created by the separate grounded proposal resolver,
      // never improvised from raw OSM streets during live generation.
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

      // Generate activities using AI
      await this.updateGenerationStatus(
        tourId,
        'generating',
        'Creando itinerario optimizado con inteligencia artificial...',
      );

      // Reformat from canonical catalog data immediately before selection.
      if (candidateActivitiesById.size > 0) {
        availableActivitiesText = `\n\nAvailable activities in the area:\n${Array.from(
          candidateActivitiesById.values(),
        )
          .map((activity) => formatActivityForPrompt(activity))
          .join('\n')}`;
      }

      const tourChain = this.compositeGenerationService.createTourChain();
      const generationTimeout = this.langChainService.getGenerationTimeout();

      // Runs one full invoke + anti-hallucination verify/dedupe + audit
      // pass. Factored out so the completeness retry below (PR 7.2) can run
      // the exact same pipeline a second time with feedback appended to the
      // prompt, instead of duplicating this logic.
      const runItinerarySelection = async (promptInput: string) => {
        const response = (await this.withTimeout(
          tourChain.invoke({
            // activities is injected into its own prompt section by the
            // chain; including it in input as well duplicates the complete
            // candidate list and wastes the provider's token budget.
            input: promptInput,
            activities: availableActivitiesText,
          }),
          generationTimeout,
          `AI generation timeout after ${generationTimeout}ms`,
        )) as any;

        // Hard safety net: drop any activity the model returned that
        // doesn't match one of the real candidates we offered it (prompt
        // instructions alone aren't reliable enough to stop hallucination),
        // and any repeat visit to the same place.
        const rawActivities: any[] = response.activities || [];
        const {
          verified: verifiedSelections,
          hallucinatedCount,
          duplicateCount,
        } = verifyAndDedupeActivities(rawActivities, candidateActivityIds);

        // The model selects and schedules by id only. Identity, labels and
        // coordinates always come back from the exact catalog candidates we
        // offered, never from generated text. Besides shrinking the Groq
        // response, this prevents a valid id from being paired with an
        // altered name, type or location before spatial optimization.
        const uniqueActivities = verifiedSelections.map((selection: any) => {
          const candidate = candidateActivitiesById.get(selection.activityId);
          return {
            ...selection,
            activityName: candidate?.name ?? 'Activity',
            type: candidate?.type ?? 'Activity',
            latitude: candidate?.latitude,
            longitude: candidate?.longitude,
          };
        });

        // Deterministic evidence for the bitácora — checks the AI's own
        // picks against the real data it was given (opening hours, price
        // level), rather than trusting its self-reported reasoning. Runs on
        // the AI's raw startTime string (transformAiActivitiesToDto
        // discards HH:MM-only times below, since it needs a real date to
        // combine with).
        const auditResult = auditGeneration(
          uniqueActivities.map((act: any) => {
            const candidate = act.activityId
              ? candidateActivitiesById.get(act.activityId)
              : undefined;
            return {
              activityId: act.activityId,
              activityName: act.activityName || act.type || 'Activity',
              startTime: act.startTime,
              type: act.type,
              notes: act.notes,
              openingHoursWeekdayText: candidate?.openingHours?.weekdayText,
              priceLevel: candidate?.priceLevel,
            };
          }),
          {
            budgetLevel: request.budgetLevel,
            dietaryRestrictions: request.dietaryRestrictions,
          },
        );

        return {
          aiResponse: response,
          rawActivities,
          uniqueActivities,
          hallucinatedCount,
          duplicateCount,
          auditResult,
        };
      };

      // Real data the LLM's own free-text intent already carries as prose
      // (buildWizardSelectionInput) — 'food' is a strict single-theme
      // request, not merely one interest among several. See PR10's deferred
      // "role-aware food and drink scheduling" note: a mixed interest list
      // that happens to include food is not evidence of a food-centric
      // trip, so this stays deliberately narrow.
      const isFoodFocusedIntent =
        request.intent.interests.length === 1 &&
        request.intent.interests[0] === 'food';

      const buildCompletenessInput = (
        sel: Awaited<ReturnType<typeof runItinerarySelection>>,
      ): TourCompletenessInput => {
        const selectedIds = new Set<string>();
        const selectedActivities = sel.uniqueActivities.map((act: any) => {
          if (act.activityId) selectedIds.add(act.activityId);
          const candidate = act.activityId
            ? candidateActivitiesById.get(act.activityId)
            : undefined;
          return {
            activityId: act.activityId,
            dayNumber: act.dayNumber,
            // Canonical duration always comes from the offered candidate,
            // never from the model's own echoed value — same identity rule
            // as name/type/coordinates above.
            durationHours: candidate?.duration ?? 0,
            isMeal: candidate?.type === 'food',
          };
        });
        return {
          requestedDays: request.days,
          travelPace: request.mobility.travelPace,
          isFoodFocusedIntent,
          selectedActivities,
          viableUnusedCandidateCount:
            candidateActivitiesById.size - selectedIds.size,
        };
      };

      const buildFormatCoverageInput = (
        sel: Awaited<ReturnType<typeof runItinerarySelection>>,
      ): TourFormatCoverageInput => ({
        requestedExperienceFormats: request.intent.experienceFormats,
        selectedActivities: sel.uniqueActivities
          .map((act: any): TourFormatCoverageActivityRef | null => {
            const candidate = act.activityId
              ? candidateActivitiesById.get(act.activityId)
              : undefined;
            return candidate?.kind
              ? { activityId: act.activityId, kind: candidate.kind }
              : null;
          })
          .filter((ref): ref is TourFormatCoverageActivityRef => ref !== null),
        availableCandidateActivities: Array.from(
          candidateActivitiesById.entries(),
        )
          .filter(([, candidate]) => candidate.kind)
          .map(([activityId, candidate]) => ({
            activityId,
            kind: candidate.kind as ActivityKind,
          })),
      });

      let selection = await runItinerarySelection(selectorInput);

      // Update status: AI response received, processing activities
      await this.updateGenerationStatus(
        tourId,
        'generating',
        'Itinerario generado. Guardando actividades...',
      );

      let completeness = this.tourCompletenessValidator.validate(
        buildCompletenessInput(selection),
      );
      let formatCoverage = this.tourFormatCoverageValidator.validate(
        buildFormatCoverageInput(selection),
      );
      let correctiveRetryAttempted = false;

      // Bounded, single corrective regeneration (PR 7.2 completeness + PR 7.4
      // format coverage) — never looped, and never two independent retries.
      // Coverage/refill/discovery already ran once for this request; this
      // only re-invokes the itinerary LLM with real, measured feedback about
      // what it left unused or ignored.
      if (!completeness.complete || !formatCoverage.valid) {
        correctiveRetryAttempted = true;
        this.logger.warn(
          `Tour ${tourId} needs correction (completeness=${completeness.complete}, formatCoverage=${formatCoverage.valid}); retrying itinerary selection once with combined feedback.`,
        );
        await this.updateGenerationStatus(
          tourId,
          'generating',
          'Ajustando el itinerario para aprovechar mejor el día...',
        );
        const feedback = this.buildCorrectiveFeedback(
          completeness.issues,
          formatCoverage.issues,
          request.mobility.travelPace,
        );
        selection = await runItinerarySelection(
          `${selectorInput}\n\n${feedback}`,
        );
        completeness = this.tourCompletenessValidator.validate(
          buildCompletenessInput(selection),
        );
        formatCoverage = this.tourFormatCoverageValidator.validate(
          buildFormatCoverageInput(selection),
        );
        await this.updateGenerationStatus(
          tourId,
          'generating',
          'Itinerario generado. Guardando actividades...',
        );
      }

      const {
        aiResponse,
        rawActivities,
        uniqueActivities,
        hallucinatedCount,
        duplicateCount,
        auditResult,
      } = selection;

      traceSteps.push(buildLlmGenerationStep(aiResponse.reasoning));

      if (hallucinatedCount > 0) {
        this.logger.warn(
          `Dropped ${hallucinatedCount} activity/activities for tour ${tourId} that did not match a real candidate (model ignored the provided list).`,
        );
      }
      if (duplicateCount > 0) {
        this.logger.warn(
          `Dropped ${duplicateCount} duplicate activity/activities for tour ${tourId} (model repeated the same place).`,
        );
      }

      traceSteps.push(
        buildVerificationStep({
          hallucinatedCount,
          duplicateCount,
          pickedActivityIds: uniqueActivities
            .map((act: any) => act.activityId)
            .filter((id: string | undefined): id is string => !!id),
          candidatesByStage: traceCandidateLists,
        }),
      );
      traceSteps.push(
        buildTourCompletenessStep(completeness, correctiveRetryAttempted),
      );
      traceSteps.push(
        buildTourFormatCoverageStep(formatCoverage, correctiveRetryAttempted),
      );

      // Instance-level waypoint customization ("adapt this variant for a
      // family with kids") lives on the selected catalog activity. Capture it
      // here, keyed by the real activityId, because the DTO transform does not
      // carry it.
      const selectedWaypointIdsByActivityId = new Map<string, string[]>();
      for (const act of rawActivities) {
        if (act.activityId && Array.isArray(act.selectedWaypointIds)) {
          selectedWaypointIdsByActivityId.set(
            act.activityId,
            act.selectedWaypointIds,
          );
        }
      }

      if (uniqueActivities.length === 0) {
        throw new Error(
          'No se encontraron lugares reales para esta ubicación. Probá con otro destino o un radio de búsqueda más amplio.',
        );
      }

      // The AI has no real geographic reasoning — it just lists activities
      // in whatever order seemed plausible. Reorder them with a free
      // nearest-neighbor + 2-opt heuristic (straight-line distance, no
      // external API) so the itinerary doesn't zigzag across the search area.
      // Existing catalog composites are already represented by an Activity ID
      // and are ordered exactly like any other selected Activity.
      let orderedActivities = uniqueActivities;
      orderedActivities = optimizeActivityOrder(
        {
          latitude: request.destination.latitude,
          longitude: request.destination.longitude,
        },
        uniqueActivities,
      );

      // Transform AI response activities to CreateTourDto format
      let activities = transformAiActivitiesToDto(orderedActivities);

      // Calculate travel times using real coordinates
      // First, get all activity entities from database if they have activityId
      const activityIds = activities
        .map((a) => a.activityId)
        .filter((id): id is string => !!id);

      let activitiesMap: Map<string, any> | undefined;
      // kind of each real Activity picked — used below to decide which
      // TourActivity rows need a TourActivityWaypoint snapshot (any pick
      // with kind !== POI, whether a composite just created above or an
      // existing variant the model picked directly from the flat list).
      let kindByActivityId = new Map<string, ActivityKind>();
      // Current waypoints of each non-POI activity picked, in order —
      // fetched once here so the snapshot written per TourActivity below
      // doesn't need a query per row.
      const waypointIdsByActivityId = new Map<string, string[]>();

      if (activityIds.length > 0) {
        const activityEntities = await this.prisma.activity.findMany({
          where: { id: { in: activityIds } },
          select: {
            id: true,
            latitude: true,
            longitude: true,
            kind: true,
          },
        });

        activitiesMap = new Map(activityEntities.map((act) => [act.id, act]));
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

      // Update travel times and distances using real coordinates
      activities = updateTravelTimesForActivities(activities, activitiesMap);

      // Update tour with activities
      await this.prisma.$transaction(async (tx) => {
        // Delete any existing activities (should be none, but just in case)
        await tx.tourActivity.deleteMany({
          where: { tourId },
        });

        // Create new activities one at a time (not createMany) — we need
        // each row's real id back to write its TourActivityWaypoint
        // snapshot below, which createMany's bulk result doesn't give us.
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

          // Snapshot the waypoints of any pick with kind !== POI — always,
          // not only when the model asked to exclude a stop, and for ANY
          // such pick (a composite just created above, or an existing
          // variant the model picked directly by id from the flat list),
          // so a generated tour stays stable in time even if the shared
          // variant's own content changes later.
          const kind = activity.activityId
            ? kindByActivityId.get(activity.activityId)
            : undefined;
          if (kind && kind !== ActivityKind.POI) {
            const actualWaypointIds =
              waypointIdsByActivityId.get(activity.activityId as string) ?? [];
            const requested = selectedWaypointIdsByActivityId.get(
              activity.activityId as string,
            );
            const finalWaypointIds =
              verifySelectedWaypointSubset(
                requested,
                new Set(actualWaypointIds),
              ) ?? actualWaypointIds;

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

        // 'completed' means the generation *process* finished end to end —
        // it does not mean every quality gate passed. A completeness
        // shortfall (PR 7.2) or an ignored requested experience format
        // (PR 7.4) that survives the one bounded retry is a real, known
        // outcome, not an error: the tour still gets a valid, fully
        // verified (non-hallucinated, non-duplicated) itinerary, and exactly
        // how thin/off-format it is stays visible in
        // generationTrace.tourCompleteness/tourFormatCoverage rather than
        // being silently absorbed into a generic "completed".
        await tx.tour.update({
          where: { id: tourId },
          data: {
            metadata: {
              ...withoutGenerationFailure(metadata),
              generationStatus: 'completed',
              generationMessage: `¡Listo! ${activities.length} actividades generadas exitosamente.`,
              generationCompletedAt: new Date().toISOString(),
              // The bitácora — see docs/superpowers/specs/2026-08-20-
              // generation-bitacora-design.md — a chronological, per-step
              // trace of how this tour's activities got picked.
              generationTrace: {
                steps: traceSteps,
                aiReasoning: aiResponse.reasoning,
                hallucinatedCount,
                duplicateCount,
                auditFindings: auditResult,
                tourCompleteness: {
                  ...completeness,
                  retryAttempted: correctiveRetryAttempted,
                },
                tourFormatCoverage: {
                  ...formatCoverage,
                  retryAttempted: correctiveRetryAttempted,
                },
              },
            },
          },
        });
      });

      this.logger.log(
        `Activities generated successfully for tour ${tourId} (${activities.length} activities)`,
      );

      try {
        if (!request.skipImageGeneration) {
          await this.updateGenerationStatus(
            tourId,
            'generating',
            'Generando imagen de portada...',
          );
          await this.tourImageService.generateTourCoverImage(tourId);
        }
      } catch (imgError) {
        this.logger.warn(`Failed to generate cover image: ${imgError.message}`);
      } finally {
        // Always update status to completed after image generation (even if bypassed or failed)
        // This ensures the frontend knows generation is complete
        await this.updateGenerationStatus(
          tourId,
          'completed',
          `¡Listo! ${activities.length} actividades generadas exitosamente.`,
        );
      }

      // Return updated tour
      return this.toursService.findOne(tourId);
    } catch (error) {
      // Update status to failed, and record the error alongside it in the
      // same write — a separate update spreading the pre-generation metadata
      // would clobber the 'failed' status back to whatever it was before.
      const latestTour = await this.toursService.findOne(tourId);
      await this.prisma.tour.update({
        where: { id: tourId },
        data: {
          metadata: {
            ...(latestTour.metadata as any),
            generationStatus: 'failed',
            generationMessage: `Error: ${error?.message || 'No se pudo generar el itinerario'}`,
            generationError: error?.message || String(error),
            generationFailedAt: new Date().toISOString(),
          },
        },
      });

      this.logger.error(
        `Failed to generate activities for tour ${tourId}: ${error.message}`,
        error.stack,
      );

      throw new BadRequestException(
        `Failed to generate activities: ${error.message}`,
      );
    }
  }

  /**
   * Rewrites the TourActivityWaypoint snapshot of one TourActivity — the
   * pre-confirmation wizard review screen's "exclude a stop" affordance.
   * Reuses the exact same validation as selectedWaypointIds in the prompt:
   * the subset must belong to the variant's own current ActivityWaypoint
   * set and meet the minimum of 2, or the requested change is ignored
   * rather than persisted. Never touches the shared variant's own content,
   * nor any other tour's snapshot — this is strictly per-TourActivity.
   */
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
