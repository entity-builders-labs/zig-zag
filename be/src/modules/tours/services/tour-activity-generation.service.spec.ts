import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@core/database/prisma.service';
import { ActivitiesService } from '@activities/services/activities.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';
import { LangChainService } from '@shared/ai/langchain.service';
import { VectorStoreService } from '@shared/ai/services/vector-store.service';
import { GooglePlacesService } from '@integrations/google-places/google-places.service';
import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { ActivityKind } from '@prisma/client';
import { TourActivityGenerationService } from './tour-activity-generation.service';
import { ToursService } from './tours.service';
import { TourImageService } from './tour-image.service';
import { CompositeGenerationService } from './composite-generation.service';
import { DestinationResolutionService } from './destination-resolution.service';
import { CatalogRefillAnchorPlanner } from './catalog-refill-anchor-planner.service';
import { CoverageAnalyzer } from './coverage-analyzer.service';
import { ActivityDiscoveryService } from './activity-discovery.service';
import { TourCompletenessValidator } from './tour-completeness-validator.service';
import { TourFormatCoverageValidator } from './tour-format-coverage-validator.service';
import { PROPOSAL_RESOLVER } from '../interfaces/proposal-resolution.interface';
import { PlacesCrawlError } from '@integrations/google-places/interfaces/places-api.interface';

// transformAiActivitiesToDto only keeps `activityId` when it passes
// isValidId() (a real UUID v4 or Mongo ObjectId) — real Activity rows
// always have one (Prisma @default(uuid())), but hand-written test
// fixtures like "poi-1" don't, and would silently get dropped exactly like
// an unmatched candidate would. This generates deterministic, valid-looking
// UUIDv4 strings so fixtures exercise the real code path.
let uuidCounter = 0;
function testUuid(): string {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${uuidCounter.toString(16).padStart(12, '0')}`;
}

describe('TourActivityGenerationService', () => {
  const TOUR_ID = 'tour-1';
  const embeddingIdentity = {
    provider: 'ollama' as const,
    model: 'nomic-embed-text',
    dimensions: 256,
    documentVersion: 1,
  };
  const similarityResult = (
    scores: Map<string, number>,
    requestedCandidateCount: number,
  ) => ({
    status: 'applied' as const,
    scores,
    requestedCandidateCount,
    indexedCandidateCount: scores.size,
    identity: embeddingIdentity,
  });

  const buildGenerationRequest = (overrides: any = {}) => ({
    contractVersion: 1,
    days: 1,
    budgetLevel: 'low',
    groupType: 'solo',
    dietaryRestrictions: [],
    startDates: [],
    includeExistingActivities: true,
    skipImageGeneration: true,
    excludeTours: [],
    categories: [],
    ...overrides,
    destination: {
      label: 'San Telmo, Buenos Aires, Argentina',
      latitude: -34.62,
      longitude: -58.37,
      radiusMeters: 3000,
      scaleHint: 'specific_point',
      ...overrides.destination,
    },
    intent: {
      interests: [],
      experienceFormats: ['point_visits'],
      explorationStyle: 'balanced',
      ...overrides.intent,
    },
    mobility: {
      allowedTransportationModes: ['walking'],
      maxWalkingDistancePerDayMeters: 5000,
      maxContinuousWalkingDistanceMeters: 1500,
      travelPace: 'moderate',
      accessibilityNeeds: [],
      ...overrides.mobility,
    },
  });

  let service: TourActivityGenerationService;
  let prisma: any;
  let toursService: any;
  let activitiesService: any;
  let langChainService: any;
  let googlePlacesService: any;
  let osmPlacesService: any;
  let wikidataApiService: any;
  let compositeActivityService: any;
  let tourImageService: any;
  let vectorStoreService: any;
  let destinationResolutionService: any;
  let proposalResolver: any;
  let activityDiscoveryService: any;

  const buildTour = (overrides: any = {}) => ({
    id: TOUR_ID,
    prompt: 'A tour of San Telmo',
    activities: [],
    metadata: {
      generationRequest: buildGenerationRequest(),
      ...overrides.metadata,
    },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      activity: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      activityWaypoint: { findMany: jest.fn().mockResolvedValue([]) },
      tourActivity: {
        create: jest.fn(async ({ data }: any) => ({
          id: `ta-${Math.random().toString(36).slice(2)}`,
          ...data,
        })),
        findUnique: jest.fn(),
        deleteMany: jest.fn(),
      },
      tourActivityWaypoint: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn(),
      },
      tour: { update: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([{ count: 0 }]),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ count: BigInt(0) }]),
    };

    toursService = { findOne: jest.fn().mockResolvedValue(buildTour()) };
    activitiesService = {
      findAll: jest.fn().mockResolvedValue([]),
      findManyByIds: jest.fn().mockResolvedValue([]),
    };
    langChainService = {
      // Force the JSON-mode chain (no OpenAI function-calling machinery to
      // mock) — most of this codebase's dev/CI setup runs against
      // Groq/Ollama anyway, per ai.config.ts.
      getChatModel: jest.fn().mockReturnValue(null),
      generateChatResponse: jest.fn(),
      // Kept small (not the real ~30s default) so the losing side of the
      // Promise.race in generateTourActivities doesn't leave a long-lived
      // timer handle open after each test — pure test-speed hygiene, this
      // doesn't touch any production timeout value.
      getGenerationTimeout: jest.fn().mockReturnValue(50),
      config: { provider: 'groq' },
    };
    googlePlacesService = {
      getProviderStatus: jest.fn().mockReturnValue({
        provider: 'google',
        available: true,
        cacheEnabled: false,
      }),
      crawlAndSaveActivities: jest.fn().mockResolvedValue({
        activitiesIds: [],
        fromCache: false,
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 0,
          acceptedCount: 0,
          rejectedCountByReason: {},
        },
      }),
    };
    osmPlacesService = {
      findNeighborhoodsWithin: jest.fn().mockResolvedValue([]),
      // Regression tripwires: the live flow must never call detailed OSM
      // discovery while selecting an itinerary.
      findStreetsWithin: jest.fn().mockResolvedValue([]),
      findPoisWithin: jest.fn().mockResolvedValue([]),
    };
    osmPlacesService.lookupNeighborhoodsWithin = jest.fn(
      async (...args: any[]): Promise<any> => {
        try {
          return {
            status: 'success',
            value: await osmPlacesService.findNeighborhoodsWithin(...args),
          };
        } catch (error: any) {
          return {
            status: 'failed',
            value: [],
            failureReason: error.message,
          };
        }
      },
    );
    destinationResolutionService = {
      resolveDestination: jest.fn().mockResolvedValue({ scale: 'point' }),
    };
    proposalResolver = { resolve: jest.fn() };
    activityDiscoveryService = {
      discoverGaps: jest.fn(),
      discoverBootstrap: jest.fn(),
    };
    wikidataApiService = {
      getEntitySummaries: jest.fn().mockResolvedValue(new Map()),
      lookupEntitySummaries: jest.fn().mockResolvedValue({
        summaries: new Map(),
        status: 'success',
        failedQids: new Set(),
        extractFailedQids: new Set(),
      }),
    };
    compositeActivityService = { createOrReuseComposite: jest.fn() };
    tourImageService = {
      generateTourCoverImage: jest.fn().mockResolvedValue(undefined),
    };
    vectorStoreService = {
      getSimilarityScores: jest.fn(async (ids: string[]) =>
        similarityResult(new Map(), ids.length),
      ),
      getCompatibleIndexCount: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TourActivityGenerationService,
        // Exercise the real selection-chain boundary. Composite persistence
        // remains wired only as a regression tripwire: live itinerary output
        // must never reach it.
        CompositeGenerationService,
        { provide: PrismaService, useValue: prisma },
        { provide: ToursService, useValue: toursService },
        { provide: ActivitiesService, useValue: activitiesService },
        { provide: LangChainService, useValue: langChainService },
        { provide: VectorStoreService, useValue: vectorStoreService },
        { provide: GooglePlacesService, useValue: googlePlacesService },
        { provide: TourImageService, useValue: tourImageService },
        { provide: OsmPlacesService, useValue: osmPlacesService },
        { provide: 'WikidataApiService', useValue: wikidataApiService },
        {
          provide: CompositeActivityService,
          useValue: compositeActivityService,
        },
        {
          provide: DestinationResolutionService,
          useValue: destinationResolutionService,
        },
        CatalogRefillAnchorPlanner,
        CoverageAnalyzer,
        TourCompletenessValidator,
        TourFormatCoverageValidator,
        {
          provide: ActivityDiscoveryService,
          useValue: activityDiscoveryService,
        },
        { provide: PROPOSAL_RESOLVER, useValue: proposalResolver },
      ],
    }).compile();

    service = module.get(TourActivityGenerationService);
  });

  const aiJsonResponse = (payload: any) =>
    JSON.stringify({
      title: 'Tour',
      description: 'A tour',
      activities: [],
      ...payload,
    });

  it('generates a plain POI tour successfully when there are no OSM/composite candidates at all', async () => {
    const poiId = testUuid();
    activitiesService.findAll.mockResolvedValue([
      {
        id: poiId,
        name: 'Museo canónico',
        type: 'museum',
        latitude: -34.62,
        longitude: -58.37,
      },
    ]);
    prisma.activity.findMany.mockResolvedValue([
      {
        id: poiId,
        latitude: -34.62,
        longitude: -58.37,
        kind: ActivityKind.POI,
      },
    ]);
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: poiId,
            // These fields are not part of the compact production schema.
            // Keeping malicious/stale values in the mock proves that the
            // server rehydrates canonical catalog data instead of trusting
            // generated identity or coordinates.
            activityName: 'Museo inventado',
            type: 'night_club',
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'Visit the museum',
            latitude: 99,
            longitude: 99,
            selectedWaypointIds: [],
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    expect(prisma.tourActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activityId: poiId,
          activityName: 'Museo canónico',
          activityType: 'museum',
          activityLatitude: -34.62,
          activityLongitude: -58.37,
        }),
      }),
    );
    // A plain POI never gets a waypoint snapshot.
    expect(prisma.tourActivityWaypoint.createMany).not.toHaveBeenCalled();
  });

  it('clears failure metadata after a retry completes successfully', async () => {
    const poiId = testUuid();
    const failedTour = buildTour();
    failedTour.metadata = {
      ...failedTour.metadata,
      generationStatus: 'failed',
      generationError: 'Previous provider failure',
      generationFailedAt: '2026-08-22T10:00:00.000Z',
    };
    toursService.findOne.mockResolvedValue(failedTour);
    activitiesService.findAll.mockResolvedValue([
      {
        id: poiId,
        name: 'Museo real',
        type: 'museum',
        latitude: -34.62,
        longitude: -58.37,
      },
    ]);
    prisma.activity.findMany.mockResolvedValue([
      {
        id: poiId,
        latitude: -34.62,
        longitude: -58.37,
        kind: ActivityKind.POI,
      },
    ]);
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        reasoning: 'Selected a verified museum.',
        activities: [
          {
            activityId: poiId,
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'Visit the museum.',
            selectedWaypointIds: [],
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    const nonFailedUpdates = prisma.tour.update.mock.calls
      .map(([input]: any[]) => input.data.metadata)
      .filter(
        (updatedMetadata: any) => updatedMetadata.generationStatus !== 'failed',
      );
    expect(nonFailedUpdates.length).toBeGreaterThan(0);
    for (const updatedMetadata of nonFailedUpdates) {
      expect(updatedMetadata).not.toHaveProperty('generationError');
      expect(updatedMetadata).not.toHaveProperty('generationFailedAt');
    }
    expect(
      nonFailedUpdates.some(
        (updatedMetadata: any) =>
          updatedMetadata.generationStatus === 'completed',
      ),
    ).toBe(true);
  });

  it('builds a step-by-step generation trace (bitácora) and persists it on the completed tour', async () => {
    const poiId = testUuid();
    const fifteenActivities = Array.from({ length: 15 }, (_, i) => ({
      id: i === 0 ? poiId : testUuid(),
      name: i === 0 ? 'Museo' : `Place ${i}`,
      latitude: -34.62,
      longitude: -58.37,
      rating: 4.5,
      ratingCount: 100,
      // Long enough alone to satisfy the default 'moderate' pace's
      // minMeaningfulHours, so this test's single-pick scenario exercises
      // the plain non-retry path — the completeness retry loop itself is
      // covered by its own dedicated tests below.
      duration: 4,
    }));
    activitiesService.findAll.mockResolvedValue(fifteenActivities);
    prisma.activity.findMany.mockResolvedValue(
      fifteenActivities.map((a) => ({
        id: a.id,
        latitude: a.latitude,
        longitude: a.longitude,
        kind: ActivityKind.POI,
      })),
    );
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        reasoning: 'Picked Museo because it matched the requested interests.',
        activities: [
          {
            activityId: poiId,
            activityName: 'Museo',
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'Visit the museum',
            latitude: -34.62,
            longitude: -58.37,
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    const completedCall = prisma.tour.update.mock.calls.find(
      (call: any) => call[0].data.metadata.generationStatus === 'completed',
    );
    expect(completedCall).toBeDefined();
    const trace = completedCall[0].data.metadata.generationTrace;
    expect(trace.aiReasoning).toBe(
      'Picked Museo because it matched the requested interests.',
    );
    expect(trace.hallucinatedCount).toBe(0);
    expect(trace.duplicateCount).toBe(0);
    expect(trace.auditFindings).toBeDefined();
    expect(trace.steps.map((s: any) => s.stage)).toEqual([
      'tour_intent',
      'destination_resolution',
      'coverage_analysis',
      'db_search',
      'candidate_pool',
      'embeddings',
      'llm_generation',
      'verification',
      'tour_completeness',
      'tour_format_coverage',
    ]);

    const dbSearchStep = trace.steps.find((s: any) => s.stage === 'db_search');
    expect(dbSearchStep.candidates).toHaveLength(15);
    expect(dbSearchStep.candidates[0]).toEqual(
      expect.objectContaining({ source: 'db', id: poiId, offered: true }),
    );

    const verificationStep = trace.steps.find(
      (s: any) => s.stage === 'verification',
    );
    expect(verificationStep.candidates).toEqual([
      expect.objectContaining({ id: poiId, chosen: true }),
    ]);

    const embeddingsStep = trace.steps.find(
      (s: any) => s.stage === 'embeddings',
    );
    expect(embeddingsStep.summary).toContain(
      'No se solicitó ranking semántico',
    );
    expect(embeddingsStep.semanticRanking.status).toBe('not_requested');

    const generatedUserPrompt =
      langChainService.generateChatResponse.mock.calls[0][1];
    expect(generatedUserPrompt.split(`id: ${poiId}`)).toHaveLength(2);
    expect(langChainService.generateChatResponse).toHaveBeenCalledTimes(1);
  });

  describe('tour completeness retry (PR 7.2)', () => {
    const buildCandidates = () =>
      Array.from({ length: 15 }, (_, i) => ({
        id: testUuid(),
        name: `Place ${i}`,
        type: 'cultural',
        latitude: -34.62,
        longitude: -58.37,
        rating: 4.5,
        ratingCount: 100,
        duration: 2,
      }));

    it('retries exactly once and persists the fuller retry result when the first attempt under-fills the day', async () => {
      const candidates = buildCandidates();
      activitiesService.findAll.mockResolvedValue(candidates);
      prisma.activity.findMany.mockResolvedValue(
        candidates.map((c) => ({
          id: c.id,
          latitude: c.latitude,
          longitude: c.longitude,
          kind: ActivityKind.POI,
        })),
      );

      const thinResponse = aiJsonResponse({
        reasoning: 'A single pick.',
        activities: [
          {
            activityId: candidates[0].id,
            dayNumber: 1,
            startTime: '10:00',
            duration: 2,
            notes: 'One stop',
            selectedWaypointIds: [],
          },
        ],
      });
      const fullerResponse = aiJsonResponse({
        reasoning: 'A fuller day.',
        activities: [0, 1, 2].map((i) => ({
          activityId: candidates[i].id,
          dayNumber: 1,
          startTime: `${10 + i * 2}:00`,
          duration: 2,
          notes: `Stop ${i}`,
          selectedWaypointIds: [] as string[],
        })),
      });
      langChainService.generateChatResponse
        .mockResolvedValueOnce(thinResponse)
        .mockResolvedValueOnce(fullerResponse);

      await service.generateTourActivities(TOUR_ID);

      expect(langChainService.generateChatResponse).toHaveBeenCalledTimes(2);

      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      expect(completedCall).toBeDefined();
      const trace = completedCall[0].data.metadata.generationTrace;
      expect(trace.aiReasoning).toBe('A fuller day.');
      expect(trace.tourCompleteness).toEqual(
        expect.objectContaining({ complete: true, retryAttempted: true }),
      );

      const completenessStep = trace.steps.find(
        (s: any) => s.stage === 'tour_completeness',
      );
      expect(completenessStep.providerStatus).toBe('success');
    });

    it('does not loop a second time when the retry itself is still under-filled', async () => {
      const candidates = buildCandidates();
      activitiesService.findAll.mockResolvedValue(candidates);
      prisma.activity.findMany.mockResolvedValue(
        candidates.map((c) => ({
          id: c.id,
          latitude: c.latitude,
          longitude: c.longitude,
          kind: ActivityKind.POI,
        })),
      );

      const thinResponse = aiJsonResponse({
        reasoning: 'Still thin.',
        activities: [
          {
            activityId: candidates[0].id,
            dayNumber: 1,
            startTime: '10:00',
            duration: 2,
            notes: 'One stop',
            selectedWaypointIds: [],
          },
        ],
      });
      langChainService.generateChatResponse.mockResolvedValue(thinResponse);

      await service.generateTourActivities(TOUR_ID);

      // Exactly one retry — not the initial call plus an unbounded loop.
      expect(langChainService.generateChatResponse).toHaveBeenCalledTimes(2);

      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      expect(completedCall).toBeDefined();
      const trace = completedCall[0].data.metadata.generationTrace;
      // 'completed' means the process finished, not that every gate
      // passed — the shortfall stays visible in the trace instead.
      expect(trace.tourCompleteness).toEqual(
        expect.objectContaining({ complete: false, retryAttempted: true }),
      );
      expect(trace.tourCompleteness.issues).toEqual([
        expect.objectContaining({ code: 'UNDERFILLED_DAY', dayNumber: 1 }),
      ]);

      const completenessStep = trace.steps.find(
        (s: any) => s.stage === 'tour_completeness',
      );
      expect(completenessStep.providerStatus).toBe('failed');
      expect(completenessStep.degradedReason).toBe('underfilled_day');
    });
  });

  describe('entity resolution (PR 8)', () => {
    // Discovery only fires when interests are requested and the pool is
    // insufficient (default activitiesService.findAll already returns []).
    // The Places refill afterward still needs a real candidate for the LLM
    // step to complete, so provide exactly one via mockResolvedValueOnce for
    // the pre-refill lookup and a second for the post-refill re-lookup —
    // same shape as the existing "records Geoapify provenance" test above.
    const buildThinPoolTour = () =>
      buildTour({
        metadata: {
          generationRequest: buildGenerationRequest({
            intent: { interests: ['history'] },
          }),
        },
      });

    const discoveryProposal = {
      name: 'Casa Histórica',
      kind: 'POI' as any,
      themes: ['history'],
      entityHints: [] as any[],
      suggestedDurationMinutes: 90,
      shortReason: 'test proposal',
      evidenceKeys: [] as string[],
    };

    const setUpSuccessfulRefillAndLlm = () => {
      const poiId = testUuid();
      const thinActivity = {
        id: poiId,
        name: 'Existing local place',
        latitude: -34.62,
        longitude: -58.37,
      };
      activitiesService.findAll
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([thinActivity]);
      prisma.activity.findMany.mockResolvedValue([
        { ...thinActivity, kind: ActivityKind.POI },
      ]);
      googlePlacesService.crawlAndSaveActivities.mockResolvedValue({
        activitiesIds: [],
        fromCache: false,
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 1,
          acceptedCount: 1,
          rejectedCountByReason: {},
        },
      });
      langChainService.generateChatResponse.mockResolvedValue(
        aiJsonResponse({
          activities: [
            {
              activityId: poiId,
              activityName: thinActivity.name,
              dayNumber: 1,
              startTime: '10:00',
              duration: 60,
              latitude: thinActivity.latitude,
              longitude: thinActivity.longitude,
            },
          ],
        }),
      );
      return poiId;
    };

    it('calls the resolver with discovery proposals and the destination boundary after a successful discovery', async () => {
      toursService.findOne.mockResolvedValue(buildThinPoolTour());
      setUpSuccessfulRefillAndLlm();
      activityDiscoveryService.discoverGaps.mockResolvedValue({
        proposals: [discoveryProposal],
        provider: 'groq',
        model: 'test-model',
        groundingStatus: 'applied',
      });
      proposalResolver.resolve.mockResolvedValue({
        resolved: [],
        totalProposals: 1,
        acceptedCount: 1,
        rejectedCount: 0,
      });

      await service.generateTourActivities(TOUR_ID);

      expect(proposalResolver.resolve).toHaveBeenCalledWith({
        proposals: [discoveryProposal],
        destinationName: 'San Telmo, Buenos Aires, Argentina',
        destinationBoundary: undefined,
      });
    });

    it('surfaces the resolution result as an entity_resolution trace step', async () => {
      toursService.findOne.mockResolvedValue(buildThinPoolTour());
      setUpSuccessfulRefillAndLlm();
      activityDiscoveryService.discoverGaps.mockResolvedValue({
        proposals: [discoveryProposal],
        provider: 'groq',
        model: 'test-model',
        groundingStatus: 'applied',
      });
      proposalResolver.resolve.mockResolvedValue({
        resolved: [
          {
            proposal: discoveryProposal,
            status: 'accepted',
            resolvedEntities: [],
            rejectionReasons: [],
            persistedActivityId: 'new-activity-1',
          },
        ],
        totalProposals: 1,
        acceptedCount: 1,
        rejectedCount: 0,
      });

      await service.generateTourActivities(TOUR_ID);

      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      const trace = completedCall[0].data.metadata.generationTrace;
      const resolutionStep = trace.steps.find(
        (s: any) => s.stage === 'entity_resolution',
      );
      expect(resolutionStep).toBeDefined();
      expect(resolutionStep.providerStatus).toBe('success');
      expect(resolutionStep.resolution.acceptedCount).toBe(1);
    });

    it('does not fail generation when entity resolution throws (non-fatal)', async () => {
      toursService.findOne.mockResolvedValue(buildThinPoolTour());
      setUpSuccessfulRefillAndLlm();
      activityDiscoveryService.discoverGaps.mockResolvedValue({
        proposals: [discoveryProposal],
        provider: 'groq',
        model: 'test-model',
        groundingStatus: 'applied',
      });
      proposalResolver.resolve.mockRejectedValue(new Error('resolver down'));

      await service.generateTourActivities(TOUR_ID);

      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      expect(completedCall).toBeDefined();
      const trace = completedCall[0].data.metadata.generationTrace;
      expect(
        trace.steps.find((s: any) => s.stage === 'entity_resolution'),
      ).toBeUndefined();
    });

    it("merges a newly resolved activity into this generation's own unified candidate pool (PR 9)", async () => {
      toursService.findOne.mockResolvedValue(buildThinPoolTour());
      const poiId = setUpSuccessfulRefillAndLlm();
      activityDiscoveryService.discoverGaps.mockResolvedValue({
        proposals: [discoveryProposal],
        provider: 'groq',
        model: 'test-model',
        groundingStatus: 'applied',
      });
      proposalResolver.resolve.mockResolvedValue({
        resolved: [
          {
            proposal: discoveryProposal,
            status: 'accepted',
            resolvedEntities: [],
            rejectionReasons: [],
            persistedActivityId: 'new-activity-1',
          },
        ],
        totalProposals: 1,
        acceptedCount: 1,
        rejectedCount: 0,
      });
      // PR 9: the re-query step fetches exactly the rows PR 8 just
      // persisted, by id — a real row is needed here so it can compete in
      // the same ranked window as the thin local pool.
      activitiesService.findManyByIds = jest.fn().mockResolvedValue([
        {
          id: 'new-activity-1',
          name: 'Casa Histórica',
          kind: ActivityKind.POI,
          latitude: -34.62,
          longitude: -58.37,
        },
      ]);

      await service.generateTourActivities(TOUR_ID);

      // The LLM mock in setUpSuccessfulRefillAndLlm only ever picks poiId —
      // this test asserts the newly resolved activity was made available
      // (offered) to this same request, not that the (separately mocked)
      // LLM happened to choose it.
      const createCalls = (
        prisma.tourActivity.create as jest.Mock
      ).mock.calls.map((call: any) => call[0].data.activityId);
      expect(createCalls).toEqual([poiId]);

      const completedCall = (prisma.tour.update as jest.Mock).mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      const trace = completedCall[0].data.metadata.generationTrace;
      const candidatePoolStep = trace.steps.find(
        (s: any) => s.stage === 'candidate_pool',
      );
      expect(candidatePoolStep.candidates).toContainEqual(
        expect.objectContaining({
          id: 'new-activity-1',
          source: 'discovery',
          offered: true,
        }),
      );
    });

    it('does not call the resolver when discovery returns zero proposals', async () => {
      toursService.findOne.mockResolvedValue(buildThinPoolTour());
      setUpSuccessfulRefillAndLlm();
      activityDiscoveryService.discoverGaps.mockResolvedValue({
        proposals: [],
        provider: 'groq',
        model: 'test-model',
        groundingStatus: 'no_usable_evidence',
      });

      await service.generateTourActivities(TOUR_ID);

      expect(proposalResolver.resolve).not.toHaveBeenCalled();
    });

    it('leaves a valid catalog-only tour possible when the discovery provider errors out (PR 9 acceptance)', async () => {
      toursService.findOne.mockResolvedValue(buildThinPoolTour());
      const poiId = setUpSuccessfulRefillAndLlm();
      activityDiscoveryService.discoverGaps.mockRejectedValue(
        new Error('grounded search provider outage'),
      );

      await service.generateTourActivities(TOUR_ID);

      expect(proposalResolver.resolve).not.toHaveBeenCalled();
      const createCalls = (
        prisma.tourActivity.create as jest.Mock
      ).mock.calls.map((call: any) => call[0].data.activityId);
      expect(createCalls).toEqual([poiId]);
    });
  });

  describe('unified candidate pool (PR 9)', () => {
    const buildThinPoolTour = () =>
      buildTour({
        metadata: {
          generationRequest: buildGenerationRequest({
            intent: { interests: ['history'] },
          }),
        },
      });

    it('lets the itinerary LLM select a freshly discovery-resolved activity, traced as chosen', async () => {
      toursService.findOne.mockResolvedValue(buildThinPoolTour());
      const newActivityId = testUuid();
      const thinActivity = {
        id: testUuid(),
        name: 'Existing local place',
        latitude: -34.62,
        longitude: -58.37,
      };
      activitiesService.findAll
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([thinActivity]);
      // Persistence re-hydrates every picked id from the DB directly — must
      // include the newly discovery-resolved activity too, not just the
      // pre-existing thin-pool one.
      prisma.activity.findMany.mockResolvedValue([
        { ...thinActivity, kind: ActivityKind.POI },
        {
          id: newActivityId,
          latitude: -34.62,
          longitude: -58.37,
          kind: ActivityKind.POI,
        },
      ]);
      googlePlacesService.crawlAndSaveActivities.mockResolvedValue({
        activitiesIds: [],
        fromCache: false,
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 1,
          acceptedCount: 1,
          rejectedCountByReason: {},
        },
      });
      activityDiscoveryService.discoverGaps.mockResolvedValue({
        proposals: [
          {
            name: 'Casa Histórica',
            kind: 'POI' as any,
            themes: ['history'],
            entityHints: [] as any[],
            suggestedDurationMinutes: 90,
            shortReason: 'test proposal',
            evidenceKeys: [] as string[],
          },
        ],
        provider: 'groq',
        model: 'test-model',
        groundingStatus: 'applied',
      });
      proposalResolver.resolve.mockResolvedValue({
        resolved: [
          {
            proposal: {
              name: 'Casa Histórica',
              kind: 'POI' as any,
              themes: ['history'],
              entityHints: [] as any[],
              suggestedDurationMinutes: 90,
              shortReason: 'test proposal',
              evidenceKeys: [] as string[],
            },
            status: 'accepted',
            resolvedEntities: [],
            rejectionReasons: [],
            persistedActivityId: newActivityId,
          },
        ],
        totalProposals: 1,
        acceptedCount: 1,
        rejectedCount: 0,
      });
      activitiesService.findManyByIds = jest.fn().mockResolvedValue([
        {
          id: newActivityId,
          name: 'Casa Histórica',
          kind: ActivityKind.POI,
          latitude: -34.62,
          longitude: -58.37,
        },
      ]);
      // The LLM picks the newly discovery-resolved activity, not the thin
      // pool's pre-existing one.
      langChainService.generateChatResponse.mockResolvedValue(
        aiJsonResponse({
          activities: [
            {
              activityId: newActivityId,
              activityName: 'Casa Histórica',
              dayNumber: 1,
              startTime: '10:00',
              duration: 60,
              latitude: -34.62,
              longitude: -58.37,
            },
          ],
        }),
      );

      await service.generateTourActivities(TOUR_ID);

      const createCalls = (
        prisma.tourActivity.create as jest.Mock
      ).mock.calls.map((call: any) => call[0].data.activityId);
      expect(createCalls).toEqual([newActivityId]);

      const completedCall = (prisma.tour.update as jest.Mock).mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      const trace = completedCall[0].data.metadata.generationTrace;
      const candidatePoolStep = trace.steps.find(
        (s: any) => s.stage === 'candidate_pool',
      );
      expect(candidatePoolStep.candidates).toContainEqual(
        expect.objectContaining({ id: newActivityId, source: 'discovery' }),
      );
      const verificationStep = trace.steps.find(
        (s: any) => s.stage === 'verification',
      );
      expect(verificationStep.candidates).toContainEqual(
        expect.objectContaining({
          id: newActivityId,
          source: 'discovery',
          chosen: true,
        }),
      );
    });

    it('exposes a real semantic similarity score for a freshly discovery-resolved activity, confirming it was already embedded when re-queried', async () => {
      toursService.findOne.mockResolvedValue(buildThinPoolTour());
      const thinActivity = {
        id: testUuid(),
        name: 'Existing local place',
        latitude: -34.62,
        longitude: -58.37,
      };
      activitiesService.findAll
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([thinActivity]);
      prisma.activity.findMany.mockResolvedValue([
        { ...thinActivity, kind: ActivityKind.POI },
      ]);
      googlePlacesService.crawlAndSaveActivities.mockResolvedValue({
        activitiesIds: [],
        fromCache: false,
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 1,
          acceptedCount: 1,
          rejectedCountByReason: {},
        },
      });
      activityDiscoveryService.discoverGaps.mockResolvedValue({
        proposals: [
          {
            name: 'Casa Histórica',
            kind: 'POI' as any,
            themes: ['history'],
            entityHints: [] as any[],
            suggestedDurationMinutes: 90,
            shortReason: 'test proposal',
            evidenceKeys: [] as string[],
          },
        ],
        provider: 'groq',
        model: 'test-model',
        groundingStatus: 'applied',
      });
      proposalResolver.resolve.mockResolvedValue({
        resolved: [
          {
            proposal: {
              name: 'Casa Histórica',
              kind: 'POI' as any,
              themes: ['history'],
              entityHints: [] as any[],
              suggestedDurationMinutes: 90,
              shortReason: 'test proposal',
              evidenceKeys: [] as string[],
            },
            status: 'accepted',
            resolvedEntities: [],
            rejectionReasons: [],
            persistedActivityId: 'new-activity-1',
          },
        ],
        totalProposals: 1,
        acceptedCount: 1,
        rejectedCount: 0,
      });
      activitiesService.findManyByIds = jest.fn().mockResolvedValue([
        {
          id: 'new-activity-1',
          name: 'Casa Histórica',
          kind: ActivityKind.POI,
          latitude: -34.62,
          longitude: -58.37,
        },
      ]);
      langChainService.generateChatResponse.mockResolvedValue(
        aiJsonResponse({
          activities: [
            {
              activityId: thinActivity.id,
              activityName: thinActivity.name,
              dayNumber: 1,
              startTime: '10:00',
              duration: 60,
              latitude: thinActivity.latitude,
              longitude: thinActivity.longitude,
            },
          ],
        }),
      );
      // A real embedding for the newly resolved composite/POI — already
      // written by CompositeActivityService/indexResolvedVenues at
      // persistence time (confirmed during PR 9 scoping), so it must
      // compete in the measured semantic tier, not the missing-embedding
      // fallback.
      vectorStoreService.getSimilarityScores.mockResolvedValue({
        status: 'applied',
        scores: new Map([
          [thinActivity.id, 0.4],
          ['new-activity-1', 0.7],
        ]),
        requestedCandidateCount: 2,
        indexedCandidateCount: 2,
      });

      await service.generateTourActivities(TOUR_ID);

      const completedCall = (prisma.tour.update as jest.Mock).mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      const trace = completedCall[0].data.metadata.generationTrace;
      const candidatePoolStep = trace.steps.find(
        (s: any) => s.stage === 'candidate_pool',
      );
      const discovered = candidatePoolStep.candidates.find(
        (c: any) => c.id === 'new-activity-1',
      );
      expect(discovered?.scoreBreakdown?.semanticSimilarity).toBe(0.7);
    });

    it('fails explicitly before any persistence when the merged pool has no usable candidates', async () => {
      toursService.findOne.mockResolvedValue(buildThinPoolTour());
      // A raw row with no real id — ineligible for coverage purposes
      // (CoverageAnalyzer.isEligibleCandidate) even though the raw pool
      // isn't empty, forcing the merged pool to be judged unusable.
      activitiesService.findAll
        .mockResolvedValueOnce([
          {
            id: '',
            name: 'Malformed row',
            latitude: -34.62,
            longitude: -58.37,
          },
        ])
        .mockResolvedValueOnce([]);
      prisma.activity.findMany.mockResolvedValue([]);
      googlePlacesService.crawlAndSaveActivities.mockResolvedValue({
        activitiesIds: [],
        fromCache: false,
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 0,
          acceptedCount: 0,
          rejectedCountByReason: {},
        },
      });
      activityDiscoveryService.discoverGaps.mockResolvedValue({
        proposals: [],
        provider: 'groq',
        model: 'test-model',
        groundingStatus: 'no_usable_evidence',
      });

      await expect(service.generateTourActivities(TOUR_ID)).rejects.toThrow(
        'sigue siendo insuficiente',
      );
      expect(prisma.tourActivity.create).not.toHaveBeenCalled();
    });
  });

  describe('requested experience format coverage (PR 7.4)', () => {
    const poiCandidate = (overrides: any = {}) => ({
      id: testUuid(),
      name: 'POI',
      type: 'museum',
      latitude: -34.62,
      longitude: -58.37,
      kind: ActivityKind.POI,
      duration: 2,
      ...overrides,
    });

    const walkCandidate = (overrides: any = {}) => ({
      id: testUuid(),
      name: 'Neighborhood Walk',
      type: 'walk',
      latitude: -34.62,
      longitude: -58.37,
      kind: ActivityKind.NEIGHBORHOOD_WALK,
      duration: 3,
      ...overrides,
    });

    // Discovery only fires on a blocking deficit. A thin, format-lacking
    // pool with zero requested THEMES still needs to reach discoverGaps()
    // today — before PR 7.4 this was silently swallowed by a stale
    // `if (interests.length > 0)` guard.
    it('calls discoverGaps for a format-only deficit even with zero requested themes', async () => {
      const candidates = [
        poiCandidate(),
        poiCandidate(),
        poiCandidate(),
        poiCandidate(),
      ];
      activitiesService.findAll.mockResolvedValue(candidates);
      prisma.activity.findMany.mockResolvedValue(
        candidates.map((c) => ({
          id: c.id,
          latitude: c.latitude,
          longitude: c.longitude,
          kind: ActivityKind.POI,
        })),
      );
      activityDiscoveryService.discoverGaps.mockResolvedValue({
        proposals: [],
        provider: 'groq',
        model: 'test-model',
        groundingStatus: 'no_usable_evidence',
      });
      langChainService.generateChatResponse.mockResolvedValue(
        aiJsonResponse({
          activities: [
            {
              activityId: candidates[0].id,
              dayNumber: 1,
              startTime: '10:00',
              duration: 2,
              notes: 'stop',
              selectedWaypointIds: [],
            },
          ],
        }),
      );
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            generationRequest: buildGenerationRequest({
              intent: {
                interests: [],
                experienceFormats: ['neighborhood_walks'],
              },
            }),
          },
        }),
      );

      await service.generateTourActivities(TOUR_ID);

      expect(activityDiscoveryService.discoverGaps).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        [],
        expect.any(Array),
        ['neighborhood_walks'],
        'balanced',
        undefined,
      );
    });

    it('retries once when a viable requested-format candidate was available but ignored, and succeeds when the retry includes it', async () => {
      const pois = [poiCandidate(), poiCandidate(), poiCandidate()];
      const walk = walkCandidate();
      const candidates = [...pois, walk];
      activitiesService.findAll.mockResolvedValue(candidates);
      prisma.activity.findMany.mockResolvedValue(
        candidates.map((c) => ({
          id: c.id,
          latitude: c.latitude,
          longitude: c.longitude,
          kind: c.kind,
        })),
      );
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            generationRequest: buildGenerationRequest({
              intent: {
                interests: [],
                experienceFormats: ['neighborhood_walks'],
              },
            }),
          },
        }),
      );

      const ignoresWalk = aiJsonResponse({
        reasoning: 'POIs only.',
        activities: pois.map((c, i) => ({
          activityId: c.id,
          dayNumber: 1,
          startTime: `${10 + i * 2}:00`,
          duration: 2,
          notes: `stop ${i}`,
          selectedWaypointIds: [] as string[],
        })),
      });
      const includesWalk = aiJsonResponse({
        reasoning: 'Includes the walk.',
        activities: [
          {
            activityId: walk.id,
            dayNumber: 1,
            startTime: '10:00',
            duration: 3,
            notes: 'walk',
            selectedWaypointIds: [],
          },
          ...pois.slice(0, 2).map((c, i) => ({
            activityId: c.id,
            dayNumber: 1,
            startTime: `${13 + i * 2}:00`,
            duration: 2,
            notes: `stop ${i}`,
            selectedWaypointIds: [] as string[],
          })),
        ],
      });
      langChainService.generateChatResponse
        .mockResolvedValueOnce(ignoresWalk)
        .mockResolvedValueOnce(includesWalk);

      await service.generateTourActivities(TOUR_ID);

      expect(langChainService.generateChatResponse).toHaveBeenCalledTimes(2);
      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      expect(completedCall).toBeDefined();
      const trace = completedCall[0].data.metadata.generationTrace;
      expect(trace.tourFormatCoverage).toEqual(
        expect.objectContaining({ valid: true, retryAttempted: true }),
      );
      const formatStep = trace.steps.find(
        (s: any) => s.stage === 'tour_format_coverage',
      );
      expect(formatStep.providerStatus).toBe('success');
    });

    it('does not retry a second time when the retry still omits the requested format', async () => {
      const pois = [poiCandidate(), poiCandidate(), poiCandidate()];
      const walk = walkCandidate();
      const candidates = [...pois, walk];
      activitiesService.findAll.mockResolvedValue(candidates);
      prisma.activity.findMany.mockResolvedValue(
        candidates.map((c) => ({
          id: c.id,
          latitude: c.latitude,
          longitude: c.longitude,
          kind: c.kind,
        })),
      );
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            generationRequest: buildGenerationRequest({
              intent: {
                interests: [],
                experienceFormats: ['neighborhood_walks'],
              },
            }),
          },
        }),
      );

      const ignoresWalk = aiJsonResponse({
        reasoning: 'POIs only, still.',
        activities: pois.map((c, i) => ({
          activityId: c.id,
          dayNumber: 1,
          startTime: `${10 + i * 2}:00`,
          duration: 2,
          notes: `stop ${i}`,
          selectedWaypointIds: [] as string[],
        })),
      });
      langChainService.generateChatResponse.mockResolvedValue(ignoresWalk);

      await service.generateTourActivities(TOUR_ID);

      // Bounded: exactly the initial call plus one retry, never a third.
      expect(langChainService.generateChatResponse).toHaveBeenCalledTimes(2);
      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      expect(completedCall).toBeDefined();
      const trace = completedCall[0].data.metadata.generationTrace;
      expect(trace.tourFormatCoverage).toEqual(
        expect.objectContaining({ valid: false, retryAttempted: true }),
      );
      expect(trace.tourFormatCoverage.issues).toEqual([
        expect.objectContaining({
          code: 'REQUESTED_FORMAT_MISSING',
          requestedFormat: 'neighborhood_walks',
        }),
      ]);
    });

    it('fires exactly one combined retry when both completeness and format coverage fail together', async () => {
      const walk = walkCandidate();
      const extraPois = [poiCandidate(), poiCandidate(), poiCandidate()];
      const candidates = [walk, ...extraPois];
      activitiesService.findAll.mockResolvedValue(candidates);
      prisma.activity.findMany.mockResolvedValue(
        candidates.map((c) => ({
          id: c.id,
          latitude: c.latitude,
          longitude: c.longitude,
          kind: c.kind,
        })),
      );
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            generationRequest: buildGenerationRequest({
              intent: {
                interests: [],
                experienceFormats: ['neighborhood_walks'],
              },
            }),
          },
        }),
      );

      // First attempt: a single short POI — both under-filled AND ignores
      // the available walk.
      const thinAndOffFormat = aiJsonResponse({
        reasoning: 'One short stop.',
        activities: [
          {
            activityId: extraPois[0].id,
            dayNumber: 1,
            startTime: '10:00',
            duration: 2,
            notes: 'stop',
            selectedWaypointIds: [],
          },
        ],
      });
      // Retry: includes the walk and is reasonably full.
      const fixedResponse = aiJsonResponse({
        reasoning: 'Fuller and includes the walk.',
        activities: [
          {
            activityId: walk.id,
            dayNumber: 1,
            startTime: '10:00',
            duration: 3,
            notes: 'walk',
            selectedWaypointIds: [],
          },
          ...extraPois.slice(0, 2).map((c, i) => ({
            activityId: c.id,
            dayNumber: 1,
            startTime: `${13 + i * 2}:00`,
            duration: 2,
            notes: `stop ${i}`,
            selectedWaypointIds: [] as string[],
          })),
        ],
      });
      langChainService.generateChatResponse
        .mockResolvedValueOnce(thinAndOffFormat)
        .mockResolvedValueOnce(fixedResponse);

      await service.generateTourActivities(TOUR_ID);

      // One combined retry, never a completeness retry followed by a
      // separate format retry.
      expect(langChainService.generateChatResponse).toHaveBeenCalledTimes(2);
      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      const trace = completedCall[0].data.metadata.generationTrace;
      expect(trace.tourCompleteness).toEqual(
        expect.objectContaining({ complete: true, retryAttempted: true }),
      );
      expect(trace.tourFormatCoverage).toEqual(
        expect.objectContaining({ valid: true, retryAttempted: true }),
      );
    });

    it('does not retry and reports valid coverage when only point_visits was requested (no behavior change)', async () => {
      const candidates = [
        poiCandidate({ duration: 3 }),
        poiCandidate({ duration: 3 }),
        poiCandidate({ duration: 3 }),
      ];
      activitiesService.findAll.mockResolvedValue(candidates);
      prisma.activity.findMany.mockResolvedValue(
        candidates.map((c) => ({
          id: c.id,
          latitude: c.latitude,
          longitude: c.longitude,
          kind: c.kind,
        })),
      );
      langChainService.generateChatResponse.mockResolvedValue(
        aiJsonResponse({
          activities: candidates.map((c, i) => ({
            activityId: c.id,
            dayNumber: 1,
            startTime: `${10 + i * 3}:00`,
            duration: 3,
            notes: `stop ${i}`,
            selectedWaypointIds: [] as string[],
          })),
        }),
      );

      await service.generateTourActivities(TOUR_ID);

      expect(langChainService.generateChatResponse).toHaveBeenCalledTimes(1);
      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      const trace = completedCall[0].data.metadata.generationTrace;
      expect(trace.tourFormatCoverage).toEqual(
        expect.objectContaining({ valid: true, retryAttempted: false }),
      );
    });
  });

  it('never persists a composite returned outside the live selection contract', async () => {
    const poiId = testUuid();
    activitiesService.findAll.mockResolvedValue([
      {
        id: poiId,
        name: 'Plaza Dorrego',
        latitude: -34.62,
        longitude: -58.37,
      },
    ]);
    prisma.activity.findMany.mockResolvedValue([
      {
        id: poiId,
        latitude: -34.62,
        longitude: -58.37,
        kind: ActivityKind.POI,
      },
    ]);
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: poiId,
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'Real catalog stop',
            selectedWaypointIds: [],
          },
        ],
        // A non-conforming provider response cannot reopen the removed live
        // composite-creation path.
        compositeActivities: [
          {
            name: 'Invented Walk',
            kind: 'NEIGHBORHOOD_WALK',
            waypointIds: ['invented'],
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    expect(
      compositeActivityService.createOrReuseComposite,
    ).not.toHaveBeenCalled();
    expect(prisma.tourActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activityId: poiId }),
      }),
    );
  });

  it('snapshots the current waypoints of an EXISTING variant picked directly from the flat activities list (not just freshly-created composites)', async () => {
    const existingVariant = {
      id: testUuid(),
      kind: ActivityKind.NEIGHBORHOOD_WALK,
      latitude: -34.62,
      longitude: -58.37,
    };
    const [poiA, poiB, poiC] = [testUuid(), testUuid(), testUuid()];
    activitiesService.findAll.mockResolvedValue([
      {
        id: existingVariant.id,
        name: 'San Telmo Historic Walk',
        latitude: -34.62,
        longitude: -58.37,
      },
    ]);
    prisma.activity.findMany.mockResolvedValue([existingVariant]);
    prisma.activityWaypoint.findMany.mockResolvedValue([
      {
        compositeActivityId: existingVariant.id,
        waypointActivityId: poiA,
        order: 1,
      },
      {
        compositeActivityId: existingVariant.id,
        waypointActivityId: poiB,
        order: 2,
      },
      {
        compositeActivityId: existingVariant.id,
        waypointActivityId: poiC,
        order: 3,
      },
    ]);

    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            // Picked directly by id, like any POI — no compositeActivities
            // entry at all for this one.
            activityId: existingVariant.id,
            dayNumber: 1,
            startTime: '10:00',
            duration: 90,
            notes: 'A historic walk',
            latitude: existingVariant.latitude,
            longitude: existingVariant.longitude,
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    expect(
      compositeActivityService.createOrReuseComposite,
    ).not.toHaveBeenCalled();
    expect(prisma.tourActivityWaypoint.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ waypointActivityId: poiA, order: 1 }),
        expect.objectContaining({ waypointActivityId: poiB, order: 2 }),
        expect.objectContaining({ waypointActivityId: poiC, order: 3 }),
      ],
    });
  });

  it('honors a valid selectedWaypointIds override, persisting only that subset instead of the full snapshot', async () => {
    const existingVariant = {
      id: testUuid(),
      kind: ActivityKind.NEIGHBORHOOD_WALK,
      latitude: -34.62,
      longitude: -58.37,
    };
    const [poiA, poiB, poiC] = [testUuid(), testUuid(), testUuid()];
    activitiesService.findAll.mockResolvedValue([
      {
        id: existingVariant.id,
        name: 'Walk',
        latitude: -34.62,
        longitude: -58.37,
      },
    ]);
    prisma.activity.findMany.mockResolvedValue([existingVariant]);
    prisma.activityWaypoint.findMany.mockResolvedValue([
      {
        compositeActivityId: existingVariant.id,
        waypointActivityId: poiA,
        order: 1,
      },
      {
        compositeActivityId: existingVariant.id,
        waypointActivityId: poiB,
        order: 2,
      },
      {
        compositeActivityId: existingVariant.id,
        waypointActivityId: poiC,
        order: 3,
      },
    ]);

    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: existingVariant.id,
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'Shorter, for a family with kids',
            latitude: existingVariant.latitude,
            longitude: existingVariant.longitude,
            selectedWaypointIds: [poiA, poiC],
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    expect(prisma.tourActivityWaypoint.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ waypointActivityId: poiA, order: 1 }),
        expect.objectContaining({ waypointActivityId: poiC, order: 2 }),
      ],
    });
  });

  it('falls back to the full snapshot when selectedWaypointIds would drop below the minimum of 2', async () => {
    const existingVariant = {
      id: testUuid(),
      kind: ActivityKind.NEIGHBORHOOD_WALK,
      latitude: -34.62,
      longitude: -58.37,
    };
    const [poiA, poiB] = [testUuid(), testUuid()];
    activitiesService.findAll.mockResolvedValue([
      {
        id: existingVariant.id,
        name: 'Walk',
        latitude: -34.62,
        longitude: -58.37,
      },
    ]);
    prisma.activity.findMany.mockResolvedValue([existingVariant]);
    prisma.activityWaypoint.findMany.mockResolvedValue([
      {
        compositeActivityId: existingVariant.id,
        waypointActivityId: poiA,
        order: 1,
      },
      {
        compositeActivityId: existingVariant.id,
        waypointActivityId: poiB,
        order: 2,
      },
    ]);

    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: existingVariant.id,
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'note',
            latitude: existingVariant.latitude,
            longitude: existingVariant.longitude,
            selectedWaypointIds: [poiA], // below the minimum of 2
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    expect(prisma.tourActivityWaypoint.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ waypointActivityId: poiA }),
        expect.objectContaining({ waypointActivityId: poiB }),
      ],
    });
  });

  it('triggers a Google Places crawl when the DB pool is thin but not empty', async () => {
    const thinPoiId = testUuid();
    activitiesService.findAll
      .mockResolvedValueOnce([
        {
          id: thinPoiId,
          name: 'Only one place',
          latitude: -34.62,
          longitude: -58.37,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: thinPoiId,
          name: 'Only one place',
          latitude: -34.62,
          longitude: -58.37,
        },
      ]);
    prisma.activity.findMany.mockResolvedValue([
      {
        id: thinPoiId,
        latitude: -34.62,
        longitude: -58.37,
        kind: ActivityKind.POI,
      },
    ]);
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: thinPoiId,
            activityName: 'Only one place',
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'Visit it',
            latitude: -34.62,
            longitude: -58.37,
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    expect(googlePlacesService.crawlAndSaveActivities).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        anchors: [
          expect.objectContaining({
            id: 'destination-point',
            source: 'destination_point',
            latitude: -34.62,
            longitude: -58.37,
          }),
        ],
      }),
    );
  });

  it('records Geoapify provenance without calling it Google in the trace', async () => {
    const thinPoiId = testUuid();
    const thinActivity = {
      id: thinPoiId,
      name: 'Existing local place',
      latitude: -34.62,
      longitude: -58.37,
    };
    activitiesService.findAll
      .mockResolvedValueOnce([thinActivity])
      .mockResolvedValueOnce([thinActivity]);
    prisma.activity.findMany.mockResolvedValue([
      { ...thinActivity, kind: ActivityKind.POI },
    ]);
    googlePlacesService.getProviderStatus.mockReturnValue({
      provider: 'geoapify',
      available: true,
      cacheEnabled: true,
      cacheMode: 'strict',
    });
    googlePlacesService.crawlAndSaveActivities.mockResolvedValue({
      activitiesIds: [],
      fromCache: true,
      provenance: {
        provider: 'geoapify',
        cacheStatus: 'hit',
        requestedCount: 20,
        receivedCount: 1,
        acceptedCount: 0,
        rejectedCountByReason: { existing_activity: 1 },
      },
    });
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: thinPoiId,
            activityName: thinActivity.name,
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            latitude: thinActivity.latitude,
            longitude: thinActivity.longitude,
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    const completedUpdate = prisma.tour.update.mock.calls
      .map(([input]: any[]) => input)
      .find(
        (input: any) => input.data.metadata?.generationStatus === 'completed',
      );
    const placesStep = completedUpdate.data.metadata.generationTrace.steps.find(
      (step: any) => step.stage === 'places_crawl',
    );
    expect(placesStep.label).toContain('Geoapify');
    expect(JSON.stringify(placesStep)).not.toContain('Google');
    expect(placesStep.placesProvenance.cacheStatus).toBe('hit');
  });

  it('does not trigger a crawl once the pool already meets the sufficiency threshold', async () => {
    const fifteenActivities = Array.from({ length: 15 }, (_, i) => ({
      id: testUuid(),
      name: `Place ${i}`,
      latitude: -34.62,
      longitude: -58.37,
    }));
    activitiesService.findAll.mockResolvedValue(fifteenActivities);
    prisma.activity.findMany.mockResolvedValue(
      fifteenActivities.map((a) => ({
        id: a.id,
        latitude: a.latitude,
        longitude: a.longitude,
        kind: ActivityKind.POI,
      })),
    );
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: fifteenActivities[0].id,
            activityName: fifteenActivities[0].name,
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'Visit it',
            latitude: -34.62,
            longitude: -58.37,
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    expect(googlePlacesService.crawlAndSaveActivities).not.toHaveBeenCalled();
    // PR 9 acceptance: existing catalog Activities are preferred over
    // equivalent newly proposed ones — a sufficient catalog pool never
    // even reaches Discovery, so there's nothing new to prefer over.
    expect(activityDiscoveryService.discoverGaps).not.toHaveBeenCalled();
  });

  it('falls back to thin pool when Google Places crawl fails, instead of leaving candidates empty', async () => {
    const thinActivities = Array.from({ length: 3 }, (_, i) => ({
      id: testUuid(),
      name: `Local Place ${i}`,
      latitude: -34.62,
      longitude: -58.37,
    }));
    // First call returns the thin pool, triggering crawl
    activitiesService.findAll.mockResolvedValueOnce(thinActivities);
    prisma.activity.findMany.mockResolvedValue(
      thinActivities.map((a) => ({
        id: a.id,
        latitude: a.latitude,
        longitude: a.longitude,
        kind: ActivityKind.POI,
      })),
    );
    // Crawl fails
    googlePlacesService.crawlAndSaveActivities.mockRejectedValue(
      new Error('Google API unavailable'),
    );
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: thinActivities[0].id,
            activityName: thinActivities[0].name,
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'Visit it',
            latitude: -34.62,
            longitude: -58.37,
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    // Should have created a tour activity using the thin pool, not failed empty
    expect(prisma.tourActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activityId: thinActivities[0].id }),
      }),
    );
  });

  it('reports provider quota exhaustion instead of claiming the destination has no places', async () => {
    googlePlacesService.crawlAndSaveActivities.mockRejectedValue(
      new PlacesCrawlError(
        'Google Places daily quota exhausted',
        {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 0,
          acceptedCount: 0,
          rejectedCountByReason: {},
        },
        undefined,
        'quota_exhausted',
      ),
    );

    await expect(service.generateTourActivities(TOUR_ID)).rejects.toThrow(
      'Google Places alcanzó su cuota diaria',
    );
  });

  it('reports a temporary provider rate limit instead of claiming the destination has no places', async () => {
    googlePlacesService.crawlAndSaveActivities.mockRejectedValue(
      new PlacesCrawlError(
        'Google Places rate limited',
        {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 0,
          acceptedCount: 0,
          rejectedCountByReason: {},
        },
        undefined,
        'rate_limited',
      ),
    );

    await expect(service.generateTourActivities(TOUR_ID)).rejects.toThrow(
      'Google Places limitó temporalmente las búsquedas',
    );
  });

  it('retrieves a relevant POI beyond the old rating top 20 and ranks it into the candidate window', async () => {
    const relevantId = testUuid();
    const irrelevantId = testUuid();
    toursService.findOne.mockResolvedValue(
      buildTour({
        metadata: {
          generationRequest: buildGenerationRequest({
            intent: { interests: ['history'] },
          }),
        },
        prompt: 'A tour',
      }),
    );
    activitiesService.findAll.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({
        id: i === 0 ? irrelevantId : i === 25 ? relevantId : testUuid(),
        name:
          i === 0
            ? 'Irrelevant but top-rated'
            : i === 25
              ? 'Relevant history site'
              : `Filler ${i}`,
        latitude: -34.62,
        longitude: -58.37,
        rating: i === 0 ? 4.9 : 3.5 - i * 0.01,
        ratingCount: 100,
        weightedScore: i === 0 ? 4.9 : 3.5 - i * 0.01,
        distance: i / 10,
      })),
    );
    vectorStoreService.getSimilarityScores.mockResolvedValue(
      similarityResult(
        new Map([
          [irrelevantId, 0.05],
          [relevantId, 0.95],
        ]),
        30,
      ),
    );
    prisma.activity.findMany.mockResolvedValue([
      {
        id: relevantId,
        latitude: -34.62,
        longitude: -58.37,
        kind: ActivityKind.POI,
      },
    ]);
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: relevantId,
            activityName: 'Relevant history site',
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'Visit it',
            latitude: -34.62,
            longitude: -58.37,
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    expect(activitiesService.findAll).toHaveBeenCalledWith(
      '-34.62',
      '-58.37',
      3000,
      250,
    );
    expect(vectorStoreService.getSimilarityScores).toHaveBeenCalledWith(
      expect.arrayContaining([relevantId, irrelevantId]),
      [
        'Interests: history',
        'Experience formats: point visits',
        'Exploration style: balanced',
      ].join('\n'),
    );
    const [, callArgs] = langChainService.generateChatResponse.mock.calls[0];
    // The prompt's "Available activities" text must list the relevant,
    // lower-rated site ahead of the irrelevant, higher-rated one.
    expect(callArgs.indexOf('Relevant history site')).toBeLessThan(
      callArgs.indexOf('Irrelevant but top-rated'),
    );
  });

  it('scores an existing curated composite variant from findAll by its curated bonus, not a fake rating', async () => {
    const curatedWalkId = testUuid();
    const mediocrePoiId = testUuid();
    toursService.findOne.mockResolvedValue(
      buildTour({
        metadata: {
          generationRequest: buildGenerationRequest({
            intent: { interests: ['history'] },
          }),
        },
        prompt: 'A tour',
      }),
    );
    activitiesService.findAll.mockResolvedValue([
      {
        id: mediocrePoiId,
        name: 'Mediocre plain POI',
        latitude: -34.62,
        longitude: -58.37,
        rating: 3.0,
        ratingCount: 50,
        kind: 'POI',
        weightedScore: 3.2,
      },
      {
        id: curatedWalkId,
        name: 'San Telmo Historic Walk',
        latitude: -34.62,
        longitude: -58.37,
        kind: 'NEIGHBORHOOD_WALK',
        isCurated: true,
        weightedScore: 4.0, // the old flat PRIOR_MEAN default — must NOT be used for a composite
      },
    ]);
    vectorStoreService.getSimilarityScores.mockResolvedValue(
      similarityResult(
        new Map([
          [mediocrePoiId, 0.5],
          [curatedWalkId, 0.5],
        ]),
        2,
      ),
    );
    prisma.activity.findMany.mockResolvedValue([
      {
        id: curatedWalkId,
        latitude: -34.62,
        longitude: -58.37,
        kind: ActivityKind.NEIGHBORHOOD_WALK,
      },
    ]);
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: curatedWalkId,
            activityName: 'San Telmo Historic Walk',
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'Walk it',
            latitude: -34.62,
            longitude: -58.37,
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    // Equal interest similarity (0.5): the curated composite's +0.15 bonus
    // must be compared against the POI's weightedScore-derived bonus
    // (3.2/5*0.2=0.128), not against the composite's own weightedScore field
    // (which would wrongly put it at 4.0/5*0.2=0.16, an even bigger margin,
    // masking whether the source-based branch actually ran instead of just
    // falling through to the 'poi' formula).
    const [, promptArg] = langChainService.generateChatResponse.mock.calls[0];
    expect(promptArg.indexOf('San Telmo Historic Walk')).toBeLessThan(
      promptArg.indexOf('Mediocre plain POI'),
    );
  });

  it('does not call getSimilarityScores when the tour has no interests', async () => {
    const poiId = testUuid();
    activitiesService.findAll.mockResolvedValue([
      { id: poiId, name: 'Museo', latitude: -34.62, longitude: -58.37 },
    ]);
    prisma.activity.findMany.mockResolvedValue([
      {
        id: poiId,
        latitude: -34.62,
        longitude: -58.37,
        kind: ActivityKind.POI,
      },
    ]);
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: poiId,
            activityName: 'Museo',
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'Visit it',
            latitude: -34.62,
            longitude: -58.37,
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    expect(vectorStoreService.getSimilarityScores).not.toHaveBeenCalled();
  });

  describe('area-scale destinations', () => {
    it('uses child areas only as Places coverage anchors and never as live composite candidates', async () => {
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            generationRequest: buildGenerationRequest({
              destination: {
                label: 'Buenos Aires',
                scaleHint: 'settlement',
              },
            }),
          },
          prompt: 'A tour of San Telmo',
        }),
      );
      const boundary = {
        id: 'osm:relation:1224652',
        name: 'Buenos Aires',
        osmType: 'relation' as const,
        osmId: 1224652,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-58.53, -34.7],
              [-58.33, -34.7],
              [-58.33, -34.53],
              [-58.53, -34.53],
              [-58.53, -34.7],
            ],
          ],
        },
        tags: { name: 'Buenos Aires', admin_level: '8' },
      };
      const areaActivity = {
        id: 'area-ba',
        kind: ActivityKind.AREA,
        name: 'Buenos Aires',
      };
      destinationResolutionService.resolveDestination.mockResolvedValue({
        scale: 'area',
        areaActivity,
        boundary,
      });
      const sanTelmo = {
        id: 'osm:relation:2223069',
        name: 'San Telmo',
        osmType: 'relation' as const,
        osmId: 2223069,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-58.39, -34.63],
              [-58.36, -34.63],
              [-58.36, -34.6],
              [-58.39, -34.63],
            ],
          ],
        },
        tags: { name: 'San Telmo', admin_level: '9' },
      };
      osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([sanTelmo]);
      const poiId = testUuid();
      activitiesService.findAll.mockResolvedValue([
        {
          id: poiId,
          name: 'Plaza Dorrego',
          latitude: -34.62,
          longitude: -58.37,
        },
      ]);
      prisma.activity.findMany.mockResolvedValue([
        {
          id: poiId,
          latitude: -34.62,
          longitude: -58.37,
          kind: ActivityKind.POI,
        },
      ]);
      langChainService.generateChatResponse.mockResolvedValue(
        aiJsonResponse({
          activities: [
            {
              activityId: poiId,
              dayNumber: 1,
              startTime: '10:00',
              duration: 60,
              notes: 'Visit Plaza Dorrego',
              selectedWaypointIds: [],
            },
          ],
        }),
      );

      await service.generateTourActivities(TOUR_ID);

      expect(
        destinationResolutionService.resolveDestination,
      ).toHaveBeenCalledWith(
        'Buenos Aires',
        {
          latitude: -34.62,
          longitude: -58.37,
        },
        'settlement',
      );
      expect(osmPlacesService.findNeighborhoodsWithin).toHaveBeenCalledWith(
        boundary,
      );
      expect(osmPlacesService.findNeighborhoodsWithin).toHaveBeenCalledTimes(1);
      expect(googlePlacesService.crawlAndSaveActivities).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          anchors: expect.arrayContaining([
            expect.objectContaining({
              id: sanTelmo.id,
              label: 'San Telmo',
              source: 'child_area_center',
            }),
            expect.objectContaining({
              id: 'destination-point',
              label: 'Buenos Aires',
              source: 'destination_point',
            }),
          ]),
          destinationBoundary: boundary.geometry,
        }),
      );
      expect(osmPlacesService.findStreetsWithin).not.toHaveBeenCalled();
      expect(osmPlacesService.findPoisWithin).not.toHaveBeenCalled();
      const [, promptArg] = langChainService.generateChatResponse.mock.calls[0];
      expect(promptArg).toContain(`id: ${poiId} - Plaza Dorrego`);
      expect(promptArg).not.toContain('Available OSM features');
      expect(
        compositeActivityService.createOrReuseComposite,
      ).not.toHaveBeenCalled();
      expect(prisma.tourActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ activityId: poiId }),
        }),
      );
    });

    it('bounds the POI search by the resolved area geometry instead of the tour options radius', async () => {
      const boundary = {
        id: 'osm:relation:1224652',
        name: 'Buenos Aires',
        osmType: 'relation' as const,
        osmId: 1224652,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-58.53, -34.7],
              [-58.33, -34.7],
              [-58.33, -34.53],
              [-58.53, -34.53],
              [-58.53, -34.7],
            ],
          ],
        },
        tags: { name: 'Buenos Aires', admin_level: '8' },
      };
      destinationResolutionService.resolveDestination.mockResolvedValue({
        scale: 'area',
        areaActivity: {
          id: 'area-ba',
          kind: ActivityKind.AREA,
          name: 'Buenos Aires',
        },
        boundary,
      });
      osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([]);
      activitiesService.findAll.mockResolvedValue([]);
      langChainService.generateChatResponse.mockResolvedValue(
        aiJsonResponse({}),
      );

      // Nothing real anywhere (no DB/Google activities, no neighborhoods,
      // hence no OSM streets/POIs either) — the anti-hallucination guard
      // correctly fails loudly rather than completing an empty tour.
      await expect(service.generateTourActivities(TOUR_ID)).rejects.toThrow();

      const [, , radiusArg] = activitiesService.findAll.mock.calls[0];
      // The mock tour's own options.radius is 3000 — the area-bounded call
      // must use a different, geometry-derived radius, not that value.
      expect(radiusArg).not.toBe(3000);
    });

    it('does not turn coverage neighborhoods into an OSM candidate budget', async () => {
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            generationRequest: buildGenerationRequest({
              destination: {
                label: 'Buenos Aires',
                scaleHint: 'settlement',
              },
            }),
          },
          prompt: 'A tour of Buenos Aires',
        }),
      );
      const boundary = {
        id: 'osm:relation:1224652',
        name: 'Buenos Aires',
        osmType: 'relation' as const,
        osmId: 1224652,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-58.53, -34.7],
              [-58.33, -34.7],
              [-58.33, -34.53],
              [-58.53, -34.53],
              [-58.53, -34.7],
            ],
          ],
        },
        tags: { name: 'Buenos Aires', admin_level: '8' },
      };
      destinationResolutionService.resolveDestination.mockResolvedValue({
        scale: 'area',
        areaActivity: {
          id: 'area-ba',
          kind: ActivityKind.AREA,
          name: 'Buenos Aires',
        },
        boundary,
      });
      const sanTelmo = {
        id: 'osm:relation:2223069',
        name: 'San Telmo',
        osmType: 'relation' as const,
        osmId: 2223069,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
        tags: { name: 'San Telmo', admin_level: '9' },
      };
      const recoleta = {
        id: 'osm:relation:2223070',
        name: 'Recoleta',
        osmType: 'relation' as const,
        osmId: 2223070,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [2, 2],
              [3, 2],
              [3, 3],
              [2, 2],
            ],
          ],
        },
        tags: { name: 'Recoleta', admin_level: '9' },
      };
      osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([
        sanTelmo,
        recoleta,
      ]);
      activitiesService.findAll.mockResolvedValue([]);
      langChainService.generateChatResponse.mockResolvedValue(
        aiJsonResponse({}),
      );

      await expect(service.generateTourActivities(TOUR_ID)).rejects.toThrow();

      expect(osmPlacesService.findStreetsWithin).not.toHaveBeenCalled();
      expect(osmPlacesService.findPoisWithin).not.toHaveBeenCalled();
      expect(langChainService.generateChatResponse).not.toHaveBeenCalled();
    });

    it('never launches detailed OSM neighborhood calls during live Sevilla generation', async () => {
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            generationRequest: buildGenerationRequest({
              destination: {
                label: 'Seville, Spain',
                latitude: 37.3891,
                longitude: -5.9845,
                radiusMeters: 12000,
                scaleHint: 'settlement',
              },
            }),
          },
          prompt: 'A tour of Sevilla',
        }),
      );
      const boundary = {
        id: 'osm:relation:342563',
        name: 'Sevilla',
        osmType: 'relation' as const,
        osmId: 342563,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-6.1, 37.3],
              [-5.8, 37.3],
              [-5.8, 37.5],
              [-6.1, 37.3],
            ],
          ],
        },
        tags: { name: 'Sevilla', admin_level: '8' },
      };
      destinationResolutionService.resolveDestination.mockResolvedValue({
        scale: 'area',
        areaActivity: {
          id: 'area-sevilla',
          kind: ActivityKind.AREA,
          name: 'Sevilla',
        },
        boundary,
      });
      const neighborhoodNames = [
        'Casco Antiguo',
        'Triana',
        'Barrio con fallo',
        'Distrito 04',
        'Distrito 05',
        'Distrito 06',
        'Distrito 07',
        'Distrito 08',
        'Distrito 09',
        'Distrito 10',
        'Distrito 11',
      ];
      const neighborhoods = neighborhoodNames.map((name, index) => ({
        id: `osm:relation:${9000 + index}`,
        name,
        osmType: 'relation' as const,
        osmId: 9000 + index,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-6, 37.35],
              [-5.95, 37.35],
              [-5.95, 37.4],
              [-6, 37.35],
            ],
          ],
        },
        tags: { name, admin_level: '9' },
      }));
      osmPlacesService.findNeighborhoodsWithin.mockResolvedValue(neighborhoods);
      const poiId = testUuid();
      activitiesService.findAll.mockResolvedValue([
        {
          id: poiId,
          name: 'Real catalog POI',
          latitude: 37.3891,
          longitude: -5.9845,
        },
      ]);
      langChainService.generateChatResponse.mockResolvedValue(
        aiJsonResponse({}),
      );

      await expect(service.generateTourActivities(TOUR_ID)).rejects.toThrow();

      expect(osmPlacesService.findPoisWithin).not.toHaveBeenCalled();
      expect(osmPlacesService.findStreetsWithin).not.toHaveBeenCalled();
    });

    it('reproduces Barcelona refill and semantic ranking without a global neighborhood-composite path', async () => {
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            generationRequest: buildGenerationRequest({
              destination: {
                label: 'Barcelona',
                latitude: 41.42,
                longitude: 2.15,
                radiusMeters: 11000,
                scaleHint: 'settlement',
              },
              intent: { interests: ['history', 'architecture'] },
            }),
          },
          prompt: 'A tour of Barcelona',
        }),
      );

      const boundary = {
        id: 'osm:relation:347950',
        name: 'Barcelona',
        osmType: 'relation' as const,
        osmId: 347950,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [2.05, 41.32],
              [2.23, 41.32],
              [2.23, 41.47],
              [2.05, 41.47],
              [2.05, 41.32],
            ],
          ],
        },
        tags: { name: 'Barcelona', admin_level: '8' },
      };
      destinationResolutionService.resolveDestination.mockResolvedValue({
        scale: 'area',
        areaActivity: {
          id: 'area-bcn',
          kind: ActivityKind.AREA,
          name: 'Barcelona',
        },
        boundary,
      });

      const ciutatVella = {
        id: 'osm:relation:900001',
        name: 'Ciutat Vella',
        osmType: 'relation' as const,
        osmId: 900001,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
        tags: { name: 'Ciutat Vella', admin_level: '9' },
      };
      osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([ciutatVella]);

      // Only a handful of low-relevance activities exist locally — same shape
      // as the real Barcelona bug report (hiking trails near Collserola).
      const hikingTrailId = testUuid();
      const historicSiteId = testUuid();
      activitiesService.findAll
        .mockResolvedValueOnce([
          {
            id: hikingTrailId,
            name: 'Collserola hiking trail',
            latitude: 41.42,
            longitude: 2.1,
            rating: 4.5,
            ratingCount: 300,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: hikingTrailId,
            name: 'Collserola hiking trail',
            latitude: 41.42,
            longitude: 2.1,
            rating: 4.5,
            ratingCount: 300,
          },
          {
            id: historicSiteId,
            name: 'Barri Gòtic historic site',
            latitude: 41.38,
            longitude: 2.17,
            rating: 4.2,
            ratingCount: 50,
          },
        ]);
      vectorStoreService.getSimilarityScores.mockResolvedValue(
        similarityResult(
          new Map([
            [hikingTrailId, 0.05],
            [historicSiteId, 0.9],
          ]),
          2,
        ),
      );
      prisma.activity.findMany.mockResolvedValue([
        {
          id: historicSiteId,
          latitude: 41.38,
          longitude: 2.17,
          kind: ActivityKind.POI,
        },
      ]);
      langChainService.generateChatResponse.mockResolvedValue(
        aiJsonResponse({
          activities: [
            {
              activityId: historicSiteId,
              activityName: 'Barri Gòtic historic site',
              dayNumber: 1,
              startTime: '10:00',
              duration: 60,
              notes: 'Visit it',
              latitude: 41.38,
              longitude: 2.17,
            },
          ],
        }),
      );

      await service.generateTourActivities(TOUR_ID);

      // 1. The thin pool (1 result) triggered a crawl refresh.
      expect(googlePlacesService.crawlAndSaveActivities).toHaveBeenCalled();
      // 2. Child areas distribute Places coverage only; detailed OSM
      // composite construction is not part of live generation.
      expect(osmPlacesService.findStreetsWithin).not.toHaveBeenCalled();
      // 3. The historically-relevant, lower-rated site outranked the irrelevant
      //    higher-rated one in what the LLM was offered.
      const [, promptArg] = langChainService.generateChatResponse.mock.calls[0];
      expect(promptArg.indexOf('Barri Gòtic historic site')).toBeLessThan(
        promptArg.indexOf('Collserola hiking trail'),
      );
      // 4. The bitácora records destination/refill stages but no speculative
      // neighborhood candidate stage. tour.update is called with a
      //    single { where, data } argument (see the $transaction block in
      //    generateTourActivities), so each mock call is a one-element array.
      // Two calls end up with generationStatus 'completed': the $transaction's
      // own update (which carries the freshly-built generationTrace) and a
      // second one from the post-transaction cover-image `finally` block,
      // which re-reads metadata via toursService.findOne and would carry the
      // trace forward too in production (a real DB read sees the just-
      // persisted trace) — but this test's static toursService.findOne mock
      // doesn't reflect intermediate prisma.tour.update calls, so that second
      // call's spread metadata omits it. Locate the call that actually
      // carries the trace rather than assuming it's the last one.
      const [completedCall] = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationTrace,
      );
      const stages = completedCall.data.metadata.generationTrace.steps.map(
        (s: any) => s.stage,
      );
      expect(stages).toEqual(
        expect.arrayContaining(['destination_resolution']),
      );
      expect(stages).not.toContain('neighborhood_shortlist');
    });
  });

  describe('updateTourActivityWaypoints', () => {
    it('replaces the snapshot with a valid subset', async () => {
      prisma.tourActivity.findUnique
        .mockResolvedValueOnce({
          id: 'ta-1',
          tourId: TOUR_ID,
          activityId: 'variant-1',
        })
        .mockResolvedValueOnce({
          id: 'ta-1',
          tourId: TOUR_ID,
          activityId: 'variant-1',
        });
      prisma.activityWaypoint.findMany.mockResolvedValue([
        { waypointActivityId: 'wp-1' },
        { waypointActivityId: 'wp-2' },
        { waypointActivityId: 'wp-3' },
      ]);

      await service.updateTourActivityWaypoints(TOUR_ID, 'ta-1', [
        'wp-1',
        'wp-3',
      ]);

      expect(prisma.tourActivityWaypoint.deleteMany).toHaveBeenCalledWith({
        where: { tourActivityId: 'ta-1' },
      });
      expect(prisma.tourActivityWaypoint.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ waypointActivityId: 'wp-1', order: 1 }),
          expect.objectContaining({ waypointActivityId: 'wp-3', order: 2 }),
        ],
      });
    });

    it('ignores an invalid/too-small subset, leaving the existing snapshot untouched', async () => {
      prisma.tourActivity.findUnique.mockResolvedValue({
        id: 'ta-1',
        tourId: TOUR_ID,
        activityId: 'variant-1',
      });
      prisma.activityWaypoint.findMany.mockResolvedValue([
        { waypointActivityId: 'wp-1' },
        { waypointActivityId: 'wp-2' },
      ]);

      await service.updateTourActivityWaypoints(TOUR_ID, 'ta-1', ['wp-1']);

      expect(prisma.tourActivityWaypoint.deleteMany).not.toHaveBeenCalled();
      expect(prisma.tourActivityWaypoint.createMany).not.toHaveBeenCalled();
    });

    it('rejects a TourActivity that does not belong to the given tour', async () => {
      prisma.tourActivity.findUnique.mockResolvedValue({
        id: 'ta-1',
        tourId: 'some-other-tour',
        activityId: 'variant-1',
      });

      await expect(
        service.updateTourActivityWaypoints(TOUR_ID, 'ta-1', ['wp-1', 'wp-2']),
      ).rejects.toThrow();
    });
  });
});
