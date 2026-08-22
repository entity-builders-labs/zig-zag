import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActivityKind, Prisma, VariantTheme } from '@prisma/client';
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
import { shortlistNeighborhoods } from '../utils/neighborhood-shortlist.util';
import { GenerateTourOptions } from '../interfaces/tour-generation.interface';
import { transformAiActivitiesToDto } from '../utils/activity-transformer.util';
import { updateTravelTimesForActivities } from '../utils/travel-time-calculator.util';
import { optimizeActivityOrder } from '../utils/route-optimizer.util';
import { verifyAndDedupeActivities } from '../utils/activity-verification.util';
import {
  ActivityForPrompt,
  formatActivityForPrompt,
  formatOsmFeatureForPrompt,
} from '../utils/activity-prompt-formatter.util';
import { verifySelectedWaypointSubset } from '../utils/composite-activity-verification.util';
import {
  rankCandidatesByRelevance,
  RankableCandidate,
} from '../utils/candidate-ranking.util';
import { auditGeneration } from '../utils/generation-audit.util';
import {
  buildDbSearchStep,
  buildDestinationResolutionStep,
  buildEmbeddingsStep,
  buildPlacesCrawlStep,
  buildLlmGenerationStep,
  buildNeighborhoodShortlistStep,
  buildOsmBoundaryStep,
  buildOsmStreetsStep,
  buildVerificationStep,
  buildWikidataEnrichmentStep,
} from '../utils/generation-trace-builder.util';
import {
  GenerationTraceStep,
  TraceCandidate,
} from '../interfaces/generation-trace.interface';
import {
  PlacesCrawlError,
  placesProviderLabel,
} from '@integrations/google-places/interfaces/places-api.interface';

@Injectable()
export class TourActivityGenerationService {
  private readonly logger = new Logger(TourActivityGenerationService.name);
  // A pool below this size is treated the same as empty — worth a crawl
  // refresh — because it can't fill the ~15-item candidate window the LLM
  // sees. Matches the existing nearbyActivitiesSample.slice(0, 15) below.
  private readonly MIN_SUFFICIENT_ACTIVITIES = 15;

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
  ) {}

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
    await this.prisma.tour.update({
      where: { id: tourId },
      data: {
        metadata: {
          ...metadata,
          generationStatus: status,
          generationMessage: message,
          ...(status === 'generating' && !metadata?.generationStartedAt
            ? { generationStartedAt: new Date().toISOString() }
            : {}),
        },
      },
    });
  }

  /**
   * Re-ranks a DB-proximity result set by interest relevance before slicing
   * to the LLM's candidate window — see candidate-ranking.util.ts and
   * docs/superpowers/specs/2026-08-21-activity-engine-design.md. No
   * interests, or embeddings unavailable/failing: falls back to the DB's own
   * weightedScore + distance order (today's exact behavior), sliced the
   * same way.
   */
  private async rankAndSliceActivities(
    activities: any[],
    interests: string[] | undefined,
  ): Promise<any[]> {
    if (!interests || interests.length === 0) {
      return activities.slice(0, 15);
    }

    let similarityById: Map<string, number> | null = null;
    try {
      similarityById = await this.vectorStoreService.getSimilarityScores(
        activities.map((a) => a.id),
        interests.join(', '),
      );
    } catch (error: any) {
      this.logger.warn(
        `Interest-similarity lookup failed, falling back to rating-only ranking: ${error.message}`,
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
        weightedScore: a.weightedScore,
        isCurated: a.isCurated,
        original: a,
      }),
    );
    return rankCandidatesByRelevance(rankable, similarityById)
      .slice(0, 15)
      .map((r) => r.original);
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
      // Get options from metadata
      const options = metadata?.options as GenerateTourOptions;
      if (!options) {
        throw new BadRequestException(
          'Tour does not have generation options stored',
        );
      }

      // Rebuild the prompt and generate activities
      const prompt = metadata?.originalPrompt || metadata?.enhancedPrompt;
      if (!prompt) {
        throw new BadRequestException('Tour does not have a prompt stored');
      }

      // Call the internal generation logic but only for activities
      // We'll reuse the logic from generateTour but only create activities
      const enhancedPrompt = metadata?.enhancedPrompt || prompt;
      let availableActivitiesText = '';
      // Real activity ids we actually offered the model — anything it
      // returns outside this set gets dropped as a hallucination, since
      // every stop must be a real, verified place.
      const candidateActivityIds = new Set<string>();
      // Real OSM street/boundary candidates for composite activities
      // (neighborhood walks, routes, experiences) — populated below,
      // defensively: a failed/unconfigured Overpass or Wikidata call never
      // breaks plain POI generation, it just means no composites this run.
      let candidateOsmFeaturesById = new Map<string, OsmCandidate>();
      let areaCandidate: OsmCandidate | null = null;
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

      const destinationResolution =
        await this.destinationResolutionService.resolveDestination(
          options.destination,
        );
      traceSteps.push(
        buildDestinationResolutionStep(
          options.destination,
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
            latitude: options.latitude,
            longitude: options.longitude,
            radiusMeters: options.radius || 25000,
          };

      // Search for existing activities if location provided
      if (options?.latitude && options?.longitude) {
        const radius = searchArea.radiusMeters;
        const activityLimit = 20;

        // Update status: searching for activities
        await this.updateGenerationStatus(
          tourId,
          'generating',
          `Buscando actividades en la zona (radio ${Math.round(radius / 1000)}km)...`,
        );

        try {
          const nearbyActivities = await Promise.race([
            this.activitiesService.findAll(
              searchArea.latitude.toString(),
              searchArea.longitude.toString(),
              radius,
              activityLimit,
            ),
            new Promise<any[]>((_, reject) =>
              setTimeout(
                () => reject(new Error('Activity search timeout')),
                10000,
              ),
            ),
          ]);

          if (nearbyActivities.length >= this.MIN_SUFFICIENT_ACTIVITIES) {
            // Update status: activities found, processing
            await this.updateGenerationStatus(
              tourId,
              'generating',
              `${nearbyActivities.length} actividades encontradas. Ordenando según tus preferencias...`,
            );

            const nearbyActivitiesSample = await this.rankAndSliceActivities(
              nearbyActivities,
              options.interests,
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

            const placesStatus = this.googlePlacesService.getProviderStatus();
            const placesLabel = placesProviderLabel(placesStatus.provider);

            // Update status: pool is too thin, triggering catalog refill.
            const poolStatus =
              nearbyActivities.length > 0
                ? `Se encontraron ${nearbyActivities.length} actividades pero insuficientes. Buscando más con ${placesLabel}...`
                : `No se encontraron actividades locales. Buscando con ${placesLabel}...`;
            await this.updateGenerationStatus(tourId, 'generating', poolStatus);

            try {
              const crawlResult =
                await this.googlePlacesService.crawlAndSaveActivities({
                  latitude: searchArea.latitude,
                  longitude: searchArea.longitude,
                  radius: Math.min(radius, 5000),
                });

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

                const refreshedActivitiesSample =
                  await this.rankAndSliceActivities(
                    refreshedActivities,
                    options.interests,
                  );
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
                  const nearbyActivitiesSample = nearbyActivities.slice(0, 15);
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
              // Crawl failed, but if we already had a thin local pool, use it
              // rather than leaving generation with empty candidates.
              if (nearbyActivities.length > 0) {
                await this.updateGenerationStatus(
                  tourId,
                  'generating',
                  `${placesLabel} indisponible. Usando ${nearbyActivities.length} actividades locales encontradas.`,
                );
                const nearbyActivitiesSample = nearbyActivities.slice(0, 15);
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

        // Composite activity candidates: real OSM streets (for a ROUTE like
        // "Pasear por Caminito") and the boundary containing this point (so
        // a NEIGHBORHOOD_WALK/EXPERIENCE has a real ActivityFamily to
        // belong to, never one the LLM has to invent). Entirely optional —
        // provider failures degrade without aborting the tour and are kept
        // distinct from successful empty results in the generation trace.
        let streetCandidates: OsmCandidate[] = [];
        let osmStreetsFailure: string | undefined;
        let osmBoundaryFailure: string | undefined;
        let osmStreetsResponded: boolean | undefined;
        let osmBoundaryResponded: boolean | undefined;

        if (isAreaScale) {
          areaCandidate = destinationResolution.boundary;
          const rawNeighborhoods =
            await this.osmPlacesService.findNeighborhoodsWithin(
              destinationResolution.boundary,
            );
          // findPoisWithin is called once per raw neighborhood here — its
          // result doubles as the shortlisting signal (poiCount) AND, for
          // whichever neighborhoods end up shortlisted below, the actual POI
          // candidates offered to the LLM (no second fetch) — validated live
          // in the spike, where a neighborhood's real POI nodes (monuments,
          // museums) were legitimately chosen as composite waypoints
          // alongside its streets, not merely a scoring input.
          const poisByNeighborhoodId = new Map<string, OsmCandidate[]>();
          const scoringInputs = await Promise.all(
            rawNeighborhoods.map(async (neighborhood) => {
              const neighborhoodActivity = await this.prisma.activity.findFirst(
                {
                  where: {
                    externalId: `${neighborhood.osmType}/${neighborhood.osmId}`,
                    kind: ActivityKind.AREA,
                  },
                  select: { id: true },
                },
              );
              const existingFamilyCount = neighborhoodActivity
                ? await this.prisma.activityFamily.count({
                    where: { areaActivityId: neighborhoodActivity.id },
                  })
                : 0;
              const pois =
                await this.osmPlacesService.findPoisWithin(neighborhood);
              poisByNeighborhoodId.set(neighborhood.id, pois);
              return {
                candidate: neighborhood,
                hasExistingFamily: existingFamilyCount > 0,
                poiCount: pois.length,
              };
            }),
          );
          const shortlisted = shortlistNeighborhoods(scoringInputs);

          // Per-neighborhood cap, not one global cap applied after
          // flattening — a single dense neighborhood (the spike measured
          // San Telmo at 178 streets + 50 POIs) would otherwise exhaust a
          // flat slice(0, 20) on its own, starving every other shortlisted
          // neighborhood of candidates despite paying for their Overpass
          // queries. Each neighborhood gets an even share of the same
          // total budget (Overpass/Groq payload limits), so the LLM
          // actually sees content from every neighborhood the shortlist
          // surfaced, not just the first.
          const perNeighborhoodCap = Math.ceil(20 / shortlisted.length);
          const perNeighborhood = await Promise.all(
            shortlisted.map(async (neighborhood) => ({
              streets:
                await this.osmPlacesService.findStreetsWithin(neighborhood),
              pois: poisByNeighborhoodId.get(neighborhood.id) ?? [],
            })),
          );
          // Streets and POI nodes from every shortlisted neighborhood, merged
          // into the same candidate set the LLM sees as "Available OSM
          // features" — a POI node can be picked as a waypoint exactly like
          // a street (see composite-activity.service.ts's Point-geometry
          // handling, this same task).
          streetCandidates = perNeighborhood.flatMap((n) =>
            [...n.streets, ...n.pois].slice(0, perNeighborhoodCap),
          );

          traceSteps.push(
            buildNeighborhoodShortlistStep(rawNeighborhoods, shortlisted),
          );
        } else {
          const [streetsLookup, boundaryLookup] = await Promise.all([
            this.osmPlacesService.lookupStreetsNear(
              searchArea.latitude,
              searchArea.longitude,
              radius,
            ),
            this.osmPlacesService.lookupContainingBoundary(
              searchArea.latitude,
              searchArea.longitude,
            ),
          ]);
          // A dense neighborhood can have hundreds of named ways within the
          // search radius — same cap pattern as the flat activities list
          // above (activityLimit=20/slice(0,15)). Without one, a real
          // Overpass response reliably blows past Groq's per-request payload
          // limit (413) once every candidate's formatted line is in the
          // prompt.
          streetCandidates = streetsLookup.value.slice(0, 20);
          areaCandidate = boundaryLookup.value;
          osmStreetsFailure = streetsLookup.failureReason;
          osmBoundaryFailure = boundaryLookup.failureReason;
          osmStreetsResponded = streetsLookup.status === 'success';
          osmBoundaryResponded = boundaryLookup.status === 'success';
        }

        candidateOsmFeaturesById = new Map(
          streetCandidates.map((c) => [c.id, c]),
        );
        const streetsStep = buildOsmStreetsStep(
          streetCandidates,
          osmStreetsFailure,
          osmStreetsResponded,
        );
        traceSteps.push(streetsStep);
        traceCandidateLists.push(streetsStep.candidates ?? []);
        traceSteps.push(
          buildOsmBoundaryStep(
            areaCandidate,
            osmBoundaryFailure,
            osmBoundaryResponded,
          ),
        );

        // Wikidata narrative context: one batch call for every QID found
        // across streets + area, not one call per candidate (see
        // wikidata-api.service.ts) — and a content-safety pass before any
        // of it is trusted, since tags.wikidata on OSM is crowd-sourced,
        // editable data, not curated content.
        const allOsmCandidates = areaCandidate
          ? [...streetCandidates, areaCandidate]
          : streetCandidates;
        const narrativeContextUsed =
          await this.compositeGenerationService.enrichCandidatesWithWikidata(
            allOsmCandidates,
          );
        if (narrativeContextUsed > 0) {
          this.logger.debug(
            `Wikidata narrative context available for ${narrativeContextUsed} OSM candidate(s) for tour ${tourId}.`,
          );
        }
        traceSteps.push(buildWikidataEnrichmentStep(allOsmCandidates));

        // Real (not simulated) check of how many of the candidates offered
        // this generation have a pgvector embedding indexed. This measures
        // index availability only: it cannot by itself prove that the query
        // embedding provider responded or that semantic scores were applied.
        const offeredIds = Array.from(candidateActivityIds);
        let indexedCount = 0;
        if (offeredIds.length > 0) {
          const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(
            Prisma.sql`SELECT count(*) AS count FROM "activity" WHERE id IN (${Prisma.join(offeredIds)}) AND embedding IS NOT NULL`,
          );
          indexedCount = Number(rows[0]?.count ?? 0);
        }
        traceSteps.push(
          buildEmbeddingsStep(
            offeredIds.length,
            indexedCount,
            !!options.interests?.length,
          ),
        );
      }

      // Never let the AI invent activities out of thin air — every stop must
      // come from real places found in our database, crawled from
      // Google/Geoapify, or real OSM streets/POIs offered as composite
      // candidates. An area-scale destination may have no flat DB/Google
      // activities yet (a cold-DB city) but still have real OSM streets/
      // POIs from its shortlisted neighborhoods — that's exactly what
      // area-scale exploration is for, so it's allowed to proceed to the
      // LLM call on OSM candidates alone. Point-scale keeps its original,
      // stricter requirement (flat activities only). Either way, if
      // NOTHING real was found — no flat activities and (for area-scale)
      // no OSM candidates either — fail loudly instead of hallucinating a
      // tour.
      if (
        !availableActivitiesText &&
        (!isAreaScale || candidateOsmFeaturesById.size === 0)
      ) {
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

      const osmFeaturesText = Array.from(candidateOsmFeaturesById.values())
        .map((c) =>
          formatOsmFeatureForPrompt({
            id: c.id,
            name: c.name,
            osmType: c.osmType,
            narrativeContext: c.narrativeContext,
          }),
        )
        .join('\n');
      const areaText = areaCandidate
        ? formatOsmFeatureForPrompt({
            id: areaCandidate.id,
            name: areaCandidate.name,
            osmType: areaCandidate.osmType,
            narrativeContext: areaCandidate.narrativeContext,
          })
        : '';
      const themesText = Object.values(VariantTheme).join(', ');

      const tourChain = this.compositeGenerationService.createTourChain();
      const fullPrompt = enhancedPrompt + availableActivitiesText;
      const generationTimeout = this.langChainService.getGenerationTimeout();

      const aiResponse = (await Promise.race([
        tourChain.invoke({
          input: fullPrompt,
          activities: availableActivitiesText,
          osmFeatures: osmFeaturesText,
          area: areaText,
          themes: themesText,
        }),
        new Promise<any>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`AI generation timeout after ${generationTimeout}ms`),
              ),
            generationTimeout,
          ),
        ),
      ])) as any;

      // Update status: AI response received, processing activities
      await this.updateGenerationStatus(
        tourId,
        'generating',
        'Itinerario generado. Guardando actividades...',
      );

      traceSteps.push(buildLlmGenerationStep(aiResponse.reasoning));

      // Hard safety net: drop any activity the model returned that doesn't
      // match one of the real candidates we offered it (prompt instructions
      // alone aren't reliable enough to stop hallucination), and any repeat
      // visit to the same place.
      const rawActivities: any[] = aiResponse.activities || [];
      const {
        verified: uniqueActivities,
        hallucinatedCount,
        duplicateCount,
      } = verifyAndDedupeActivities(rawActivities, candidateActivityIds);
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

      // Deterministic evidence for the bitácora — checks the AI's own picks
      // against the real data it was given (opening hours, price level),
      // rather than trusting its self-reported reasoning. Runs on the AI's
      // raw startTime string (transformAiActivitiesToDto discards HH:MM-only
      // times below, since it needs a real date to combine with).
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
          budgetLevel: options?.budgetLevel,
          dietaryRestrictions: options?.dietaryRestrictions,
        },
      );
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

      // Instance-level waypoint customization ("adapt this variant for a
      // family with kids") lives on the flat activity pick, not on
      // compositeActivities — captured here (pre-transform, keyed by the
      // real activityId) since transformAiActivitiesToDto doesn't carry it.
      const selectedWaypointIdsByActivityId = new Map<string, string[]>();
      for (const act of rawActivities) {
        if (act.activityId && Array.isArray(act.selectedWaypointIds)) {
          selectedWaypointIdsByActivityId.set(
            act.activityId,
            act.selectedWaypointIds,
          );
        }
      }

      // Same hard-enforcement principle, one level deeper: every waypointId
      // inside a compositeActivities proposal has to trace back to a real
      // candidate too, not just the composite as a whole. Persist each
      // survivor into a real, reusable Activity (Area -> Family -> Variant)
      // — shared with the generate-templates CLI (Fase 5), see
      // composite-generation.service.ts.
      const rawComposites: any[] = aiResponse.compositeActivities || [];
      const { persisted: persistedComposites } =
        await this.compositeGenerationService.verifyAndPersistComposites({
          rawComposites,
          candidateActivityIds,
          candidateOsmFeaturesById,
          areaCandidate,
          logContext: `tour ${tourId}`,
        });

      // Fold persisted composites into the same activities list as a flat
      // pick — from here on a composite is indistinguishable from a POI to
      // the rest of the pipeline (ordering, travel times, TourActivity
      // creation).
      const compositeGeneratedActivities = persistedComposites.map((p) => ({
        activityId: p.variant.id,
        activityName: p.variant.name,
        type: p.variant.kind,
        latitude: p.variant.latitude,
        longitude: p.variant.longitude,
        notes: p.themeReasoning,
        dayNumber: p.dayNumber,
        startTime: p.startTime,
      }));

      if (
        uniqueActivities.length === 0 &&
        compositeGeneratedActivities.length === 0
      ) {
        throw new Error(
          'No se encontraron lugares reales para esta ubicación. Probá con otro destino o un radio de búsqueda más amplio.',
        );
      }

      // The AI has no real geographic reasoning — it just lists activities
      // in whatever order seemed plausible. Reorder them with a free
      // nearest-neighbor + 2-opt heuristic (straight-line distance, no
      // external API) so the itinerary doesn't zigzag across the search area.
      // Composites are merged in first — from here on they're just points
      // (their own centroid) like any other pick to this heuristic.
      const allPicks = [...uniqueActivities, ...compositeGeneratedActivities];
      let orderedActivities = allPicks;
      if (options?.latitude && options?.longitude) {
        orderedActivities = optimizeActivityOrder(
          { latitude: options.latitude, longitude: options.longitude },
          allPicks,
        );
      }

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

        // Update tour metadata to mark as completed
        await tx.tour.update({
          where: { id: tourId },
          data: {
            metadata: {
              ...metadata,
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
              },
            },
          },
        });
      });

      this.logger.log(
        `Activities generated successfully for tour ${tourId} (${activities.length} activities)`,
      );

      // Generate cover image (optional, don't block on this)
      try {
        await this.updateGenerationStatus(
          tourId,
          'generating',
          'Generando imagen de portada...',
        );
        await this.tourImageService.generateTourCoverImage(tourId);
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
