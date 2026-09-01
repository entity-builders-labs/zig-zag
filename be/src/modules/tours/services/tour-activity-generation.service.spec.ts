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
import { DestinationResolutionService } from './destination-resolution.service';
import { CatalogRefillAnchorPlanner } from './catalog-refill-anchor-planner.service';
import { CoverageAnalyzer } from './coverage-analyzer.service';
import { ActivityDiscoveryService } from './activity-discovery.service';
import { TourCompletenessValidator } from './tour-completeness-validator.service';
import { TourFormatCoverageValidator } from './tour-format-coverage-validator.service';
import { PROPOSAL_RESOLVER } from '../interfaces/proposal-resolution.interface';
import { PlacesCrawlError } from '@integrations/google-places/interfaces/places-api.interface';
import { PlanningCandidateNormalizerService } from './planning-candidate-normalizer.service';
import {
  DAILY_PLANNING_SOLVER,
  DailyPlanningInput,
  DailyPlanningSolution,
  TOUR_PLANNING_FEASIBILITY_VALIDATOR,
} from '../interfaces/daily-planning.interface';
import dailyPlanningPolicyConfig, {
  DailyPlanningPolicy,
} from '../config/daily-planning-policy.config';

// Deliberately NOT the 9:00-20:00 production default: the wizard must read
// the planning window from policy, so a mocked window that differs from the
// old hardcoded literals is what proves the value actually flows through.
const dailyPlanningPolicy = {
  window: { startMinutesFromMidnight: 8 * 60, endMinutesFromMidnight: 21 * 60 },
} as DailyPlanningPolicy;

// Real Activity rows always carry a UUID (Prisma @default(uuid())), while
// hand-written fixtures like "poi-1" don't. This generates deterministic,
// valid-looking UUIDv4 strings so fixtures look like real catalog rows.
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
  let planningCandidateNormalizer: any;
  let dailyPlanningSolver: any;
  let tourPlanningFeasibilityValidator: any;

  /**
   * The wizard path no longer asks an LLM which candidates to use —
   * the deterministic solver both selects and schedules. This default stub
   * stands in for the real GreedyDailyPlanningSolver by scheduling every
   * offered candidate back to back on day 1 (and emitting the remaining
   * requested days empty), which is what most of these tests need: a
   * solution built strictly out of the pool the service actually offered.
   * Tests that care about *which* candidate wins override `solve` with
   * `planSelecting(...)`.
   */
  const planAll = (input: DailyPlanningInput): DailyPlanningSolution =>
    planSelecting(
      input,
      input.candidates.map((c) => c.activityId),
    );

  const planSelecting = (
    input: DailyPlanningInput,
    activityIds: string[],
  ): DailyPlanningSolution => {
    const selected = input.candidates.filter((c) =>
      activityIds.includes(c.activityId),
    );
    let cursor = input.planningWindow.startMinutesFromMidnight;
    const activities = selected.map((candidate) => {
      const startMinutesFromMidnight = cursor;
      const endMinutesFromMidnight =
        startMinutesFromMidnight + (candidate.durationMinutes || 60);
      cursor = endMinutesFromMidnight;
      return {
        activityId: candidate.activityId,
        startMinutesFromMidnight,
        endMinutesFromMidnight,
      };
    });
    const totalActivityMinutes = activities.reduce(
      (sum, a) => sum + (a.endMinutesFromMidnight - a.startMinutesFromMidnight),
      0,
    );
    return {
      days: Array.from({ length: input.requestedDays }, (_, index) => ({
        dayNumber: index + 1,
        activities: index === 0 ? activities : [],
        totalActivityMinutes: index === 0 ? totalActivityMinutes : 0,
        totalTravelMinutes: 0,
        totalWalkingMinutes: 0,
        utilizationMinutes: index === 0 ? totalActivityMinutes : 0,
      })),
      unselected: input.candidates
        .filter((c) => !activityIds.includes(c.activityId))
        .map((c) => ({
          activityId: c.activityId,
          reasons: ['LOWER_RANKED_THAN_SELECTED' as const],
        })),
      score: totalActivityMinutes,
      metadata: { solver: 'test-solver', approximateTravel: true },
    };
  };

  /** The ids the service actually handed the solver, in offered order. */
  const solvedCandidateIds = (): string[] =>
    (
      dailyPlanningSolver.solve.mock.calls[0][0] as DailyPlanningInput
    ).candidates.map((c) => c.activityId);

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
      crawlerSearch: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
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
    // Boundary adapter (Task 12) — stubbed to a faithful, order-preserving
    // projection of the very rows the service offered, so assertions about
    // *which* candidates reached the planner (and in what order) exercise
    // the service's own ranking/windowing rather than the adapter's.
    planningCandidateNormalizer = {
      normalize: jest.fn(
        async (activities: any[], scoreBreakdownById: Map<string, any>) =>
          activities.map((activity) => ({
            activityId: activity.id,
            kind: activity.kind ?? ActivityKind.POI,
            title: activity.name,
            durationMinutes: (activity.duration ?? 1) * 60,
            spatialFootprint: {
              type: 'POINT' as const,
              centroid: { lat: activity.latitude, lng: activity.longitude },
            },
            semanticScore:
              scoreBreakdownById.get(activity.id)?.semanticSimilarity ?? 0,
            qualityScore: scoreBreakdownById.get(activity.id)?.qualityBonus,
          })),
      ),
    };
    dailyPlanningSolver = {
      solve: jest.fn(async (input: DailyPlanningInput) => planAll(input)),
    };
    tourPlanningFeasibilityValidator = {
      validate: jest.fn().mockReturnValue({ valid: true, issues: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TourActivityGenerationService,
        // LangChainService and CompositeActivityService remain wired only as
        // regression tripwires: the wizard path is fully
        // deterministic, so neither an itinerary LLM call nor live composite
        // persistence may happen during generation.
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
        {
          provide: PlanningCandidateNormalizerService,
          useValue: planningCandidateNormalizer,
        },
        { provide: DAILY_PLANNING_SOLVER, useValue: dailyPlanningSolver },
        {
          provide: TOUR_PLANNING_FEASIBILITY_VALIDATOR,
          useValue: tourPlanningFeasibilityValidator,
        },
        {
          provide: dailyPlanningPolicyConfig.KEY,
          useValue: dailyPlanningPolicy,
        },
      ],
    }).compile();

    service = module.get(TourActivityGenerationService);
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
    dailyPlanningSolver.solve.mockImplementation(
      async (input: DailyPlanningInput) => planSelecting(input, [poiId]),
    );

    await service.generateTourActivities(TOUR_ID);

    const completedCall = prisma.tour.update.mock.calls.find(
      (call: any) => call[0].data.metadata.generationStatus === 'completed',
    );
    expect(completedCall).toBeDefined();
    const trace = completedCall[0].data.metadata.generationTrace;
    // No LLM in this path anymore, so no AI reasoning and no
    // anti-hallucination bookkeeping is reported — a deterministic
    // daily_planning step takes their place.
    expect(trace.aiReasoning).toBeUndefined();
    expect(trace.hallucinatedCount).toBeUndefined();
    expect(trace.duplicateCount).toBeUndefined();
    expect(trace.auditFindings).toBeUndefined();
    expect(trace.steps.map((s: any) => s.stage)).toEqual([
      'preference_interpretation',
      'tour_intent',
      'destination_resolution',
      'coverage_analysis',
      'db_search',
      'candidate_pool',
      'embeddings',
      'daily_planning',
      'tour_completeness',
      'tour_format_coverage',
    ]);

    const dbSearchStep = trace.steps.find((s: any) => s.stage === 'db_search');
    expect(dbSearchStep.candidates).toHaveLength(15);
    expect(dbSearchStep.candidates[0]).toEqual(
      expect.objectContaining({ source: 'db', id: poiId, offered: true }),
    );

    const dailyPlanningStep = trace.steps.find(
      (s: any) => s.stage === 'daily_planning',
    );
    expect(dailyPlanningStep.dailyPlanning).toEqual(
      expect.objectContaining({
        solver: 'test-solver',
        dayCount: 1,
        selectedCount: 1,
      }),
    );

    const embeddingsStep = trace.steps.find(
      (s: any) => s.stage === 'embeddings',
    );
    expect(embeddingsStep.summary).toContain(
      'No se solicitó ranking semántico',
    );
    expect(embeddingsStep.semanticRanking.status).toBe('not_requested');

    // The planner is handed the offered window exactly once — every id in it
    // real, and the picked one among them.
    expect(dailyPlanningSolver.solve).toHaveBeenCalledTimes(1);
    expect(solvedCandidateIds()).toContain(poiId);
  });

  describe('deterministic daily planning', () => {
    const buildCandidates = () =>
      Array.from({ length: 4 }, (_, i) => ({
        id: testUuid(),
        name: `Place ${i}`,
        type: 'cultural',
        latitude: -34.62,
        longitude: -58.37,
        rating: 4.5,
        ratingCount: 100,
        duration: 2,
      }));

    const setUpPool = () => {
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
      return candidates;
    };

    it('selects and schedules through the solver instead of an itinerary LLM', async () => {
      setUpPool();

      await service.generateTourActivities(TOUR_ID);

      expect(dailyPlanningSolver.solve).toHaveBeenCalledTimes(1);
      // The itinerary LLM is gone from this critical path entirely — not
      // called once, and never re-invoked with corrective feedback.
      expect(langChainService.generateChatResponse).not.toHaveBeenCalled();
      expect(planningCandidateNormalizer.normalize).toHaveBeenCalledTimes(1);
      expect(tourPlanningFeasibilityValidator.validate).toHaveBeenCalledTimes(
        1,
      );
    });

    it('hands the solver the real request constraints and offered pool', async () => {
      const candidates = setUpPool();
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            generationRequest: buildGenerationRequest({
              days: 2,
              startDates: ['2026-09-01T00:00:00.000Z'],
              mobility: { travelPace: 'relaxed' },
            }),
          },
        }),
      );

      await service.generateTourActivities(TOUR_ID);

      const input = dailyPlanningSolver.solve.mock
        .calls[0][0] as DailyPlanningInput;
      expect(input.requestedDays).toBe(2);
      expect(input.travelPace).toBe('relaxed');
      expect(input.startDates).toEqual(['2026-09-01T00:00:00.000Z']);
      // Comes from `dailyPlanningPolicy.window`, never a literal at the call site.
      expect(input.planningWindow).toEqual(dailyPlanningPolicy.window);
      expect(input.planningWindow).toEqual({
        startMinutesFromMidnight: 8 * 60,
        endMinutesFromMidnight: 21 * 60,
      });
      expect(input.mobility.allowedTransportationModes).toEqual(['walking']);
      expect(input.candidates.map((c) => c.activityId).sort()).toEqual(
        candidates.map((c) => c.id).sort(),
      );
    });

    it('persists day, order, duration and travel straight from the planned solution', async () => {
      const candidates = setUpPool();
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            generationRequest: buildGenerationRequest({
              days: 2,
              startDates: ['2026-09-01T00:00:00.000Z'],
            }),
          },
        }),
      );
      dailyPlanningSolver.solve.mockResolvedValue({
        days: [
          {
            dayNumber: 1,
            activities: [
              {
                activityId: candidates[0].id,
                startMinutesFromMidnight: 9 * 60,
                endMinutesFromMidnight: 11 * 60,
              },
              {
                activityId: candidates[1].id,
                startMinutesFromMidnight: 11 * 60 + 30,
                endMinutesFromMidnight: 13 * 60,
                travelFromPrevious: {
                  mode: 'walking',
                  durationMinutes: 30,
                  distanceMeters: 2000,
                  walkingMinutes: 30,
                  walkingDistanceMeters: 2000,
                  approximate: true,
                },
              },
            ],
            totalActivityMinutes: 210,
            totalTravelMinutes: 30,
            totalWalkingMinutes: 30,
            utilizationMinutes: 240,
          },
          {
            dayNumber: 2,
            activities: [
              {
                activityId: candidates[2].id,
                startMinutesFromMidnight: 10 * 60,
                endMinutesFromMidnight: 12 * 60,
              },
            ],
            totalActivityMinutes: 120,
            totalTravelMinutes: 0,
            totalWalkingMinutes: 0,
            utilizationMinutes: 120,
          },
        ],
        unselected: [],
        score: 10,
        metadata: { solver: 'test-solver', approximateTravel: true },
      } as DailyPlanningSolution);

      await service.generateTourActivities(TOUR_ID);

      const rows = prisma.tourActivity.create.mock.calls.map(
        (call: any) => call[0].data,
      );
      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          activityId: candidates[0].id,
          dayNumber: 1,
          order: 1,
          duration: 2,
          // The next stop's inbound leg is this stop's outbound travel.
          travelTimeToNext: 30,
          distanceToNext: 2,
        }),
      );
      expect(rows[1]).toEqual(
        expect.objectContaining({
          activityId: candidates[1].id,
          dayNumber: 1,
          order: 2,
          travelTimeToNext: undefined,
          distanceToNext: undefined,
        }),
      );
      // Order restarts per day, straight from the solution's own grouping.
      expect(rows[2]).toEqual(
        expect.objectContaining({
          activityId: candidates[2].id,
          dayNumber: 2,
          order: 1,
        }),
      );
      // A real base date exists, so the planned minutes become a real Date
      // on the right day; no LLM-authored notes survive anymore.
      // UTC day arithmetic: day 1 stays on exactly the picked calendar date
      // regardless of the server's own timezone.
      expect(rows[0].startTime.toISOString()).toBe('2026-09-01T09:00:00.000Z');
      expect(rows[2].startTime.toISOString()).toBe('2026-09-02T10:00:00.000Z');
      expect(rows[0].notes).toBeUndefined();
    });

    it('never invents a start date when the request has none', async () => {
      setUpPool();

      await service.generateTourActivities(TOUR_ID);

      const rows = prisma.tourActivity.create.mock.calls.map(
        (call: any) => call[0].data,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.startTime).toBeUndefined();
      }
    });

    it('fails without persisting anything when the feasibility validator rejects the solution', async () => {
      setUpPool();
      tourPlanningFeasibilityValidator.validate.mockReturnValue({
        valid: false,
        issues: [
          {
            code: 'DAY_COUNT_MISMATCH',
            message: 'Expected 1 days, got 2.',
          },
        ],
      });

      await expect(service.generateTourActivities(TOUR_ID)).rejects.toThrow(
        'infeasible solution',
      );
      expect(prisma.tourActivity.create).not.toHaveBeenCalled();
    });

    it('fails explicitly when the solver schedules nothing at all', async () => {
      setUpPool();
      dailyPlanningSolver.solve.mockImplementation(
        async (input: DailyPlanningInput) => planSelecting(input, []),
      );

      await expect(service.generateTourActivities(TOUR_ID)).rejects.toThrow(
        'No se encontraron lugares reales',
      );
      expect(prisma.tourActivity.create).not.toHaveBeenCalled();
    });

    it('records a completeness shortfall in the trace without any corrective retry', async () => {
      const candidates = setUpPool();
      dailyPlanningSolver.solve.mockImplementation(
        async (input: DailyPlanningInput) =>
          planSelecting(input, [candidates[0].id]),
      );

      await service.generateTourActivities(TOUR_ID);

      // Bounded and non-blocking: one solve, no re-plan, shortfall visible.
      expect(dailyPlanningSolver.solve).toHaveBeenCalledTimes(1);
      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      const trace = completedCall[0].data.metadata.generationTrace;
      expect(trace.tourCompleteness).toEqual(
        expect.objectContaining({ complete: false, retryAttempted: false }),
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

    it('does not count physically infeasible rejections as viable unused candidates', async () => {
      const candidates = setUpPool();
      // One short stop out of four: the day is thin, but every candidate the
      // solver left out was hard-rejected as physically infeasible, so there
      // was nothing viable left to add — TourCompletenessValidator's own
      // contract says such a day must not be flagged as under-filled.
      dailyPlanningSolver.solve.mockImplementation(
        async (input: DailyPlanningInput) => {
          const solution = planSelecting(input, [candidates[0].id]);
          return {
            ...solution,
            unselected: solution.unselected.map((u) => ({
              activityId: u.activityId,
              reasons: ['NO_FEASIBLE_DAY'],
            })),
          } as DailyPlanningSolution;
        },
      );

      await service.generateTourActivities(TOUR_ID);

      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      const trace = completedCall[0].data.metadata.generationTrace;
      expect(trace.tourCompleteness).toEqual(
        expect.objectContaining({ complete: true, issues: [] }),
      );
    });

    it('still reports an under-filled day when a genuinely viable candidate went unused', async () => {
      const candidates = setUpPool();
      // Same thin day, but this time the leftovers were merely out-ranked —
      // a real, addable option the plan did not use.
      dailyPlanningSolver.solve.mockImplementation(
        async (input: DailyPlanningInput) => {
          const solution = planSelecting(input, [candidates[0].id]);
          return {
            ...solution,
            unselected: [
              solution.unselected[0],
              {
                activityId: solution.unselected[1].activityId,
                reasons: ['NO_FEASIBLE_DAY'],
              },
              ...solution.unselected.slice(2),
            ],
          } as DailyPlanningSolution;
        },
      );

      await service.generateTourActivities(TOUR_ID);

      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      const trace = completedCall[0].data.metadata.generationTrace;
      expect(trace.tourCompleteness.complete).toBe(false);
      // 4 candidates, 1 selected, 3 unselected, of which 1 was infeasible.
      expect(trace.tourCompleteness.issues).toEqual([
        expect.objectContaining({
          code: 'UNDERFILLED_DAY',
          dayNumber: 1,
          viableUnusedCandidateCount: 2,
        }),
      ]);
    });

    it("carries the refill branch's real score breakdowns into the planner", async () => {
      // Regression guard for the per-branch score-breakdown hoisting: every
      // acquisition branch must carry its offered candidates' real scores
      // forward. A branch that forgot to would silently produce
      // semanticScore: 0 — a valid-looking number, not an error, so nothing
      // else in this suite would catch it.
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            generationRequest: buildGenerationRequest({
              intent: { interests: ['history'] },
            }),
          },
        }),
      );
      const thinActivity = {
        id: testUuid(),
        name: 'Existing local place',
        latitude: -34.62,
        longitude: -58.37,
      };
      const refilledActivity = {
        id: testUuid(),
        name: 'Crawled history museum',
        latitude: -34.62,
        longitude: -58.37,
      };
      // Thin pool first (forces the crawl), then the post-refill re-query
      // that actually introduces the new row.
      activitiesService.findAll
        .mockResolvedValueOnce([thinActivity])
        .mockResolvedValueOnce([thinActivity, refilledActivity]);
      prisma.activity.findMany.mockResolvedValue([
        { ...thinActivity, kind: ActivityKind.POI },
        { ...refilledActivity, kind: ActivityKind.POI },
      ]);
      googlePlacesService.crawlAndSaveActivities.mockResolvedValue({
        activitiesIds: [refilledActivity.id],
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
        proposals: [],
        provider: 'groq',
        model: 'test-model',
        groundingStatus: 'no_usable_evidence',
      });
      vectorStoreService.getSimilarityScores.mockResolvedValue(
        similarityResult(
          new Map([
            [thinActivity.id, 0.1],
            [refilledActivity.id, 0.82],
          ]),
          2,
        ),
      );

      await service.generateTourActivities(TOUR_ID);

      expect(planningCandidateNormalizer.normalize).toHaveBeenCalledTimes(1);
      const [offeredActivities, breakdownById] =
        planningCandidateNormalizer.normalize.mock.calls[0];
      expect(offeredActivities.map((a: any) => a.id)).toEqual(
        expect.arrayContaining([thinActivity.id, refilledActivity.id]),
      );
      expect(breakdownById.get(refilledActivity.id)?.semanticSimilarity).toBe(
        0.82,
      );
      expect(breakdownById.get(thinActivity.id)?.semanticSimilarity).toBe(0.1);
      // ...and the score survives all the way into the solver's input.
      const input = dailyPlanningSolver.solve.mock
        .calls[0][0] as DailyPlanningInput;
      expect(
        input.candidates.find((c) => c.activityId === refilledActivity.id)
          ?.semanticScore,
      ).toBe(0.82);
    });

    it('does not count a physically infeasible candidate as an ignored requested format', async () => {
      const walk = {
        id: testUuid(),
        name: 'Neighborhood Walk',
        type: 'walk',
        latitude: -34.62,
        longitude: -58.37,
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        duration: 3,
      };
      const pois = buildCandidates();
      const candidates = [...pois, walk];
      activitiesService.findAll.mockResolvedValue(candidates);
      prisma.activity.findMany.mockResolvedValue(
        candidates.map((c: any) => ({
          id: c.id,
          latitude: c.latitude,
          longitude: c.longitude,
          kind: c.kind ?? ActivityKind.POI,
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
      // The walk was left out because it could not physically fit any day —
      // not because the planner ignored the requested format.
      dailyPlanningSolver.solve.mockImplementation(
        async (input: DailyPlanningInput) => {
          const solution = planSelecting(
            input,
            pois.map((p) => p.id),
          );
          return {
            ...solution,
            unselected: [
              {
                activityId: walk.id,
                reasons: ['MAX_WALKING_PER_DAY_EXCEEDED'],
              },
            ],
          } as DailyPlanningSolution;
        },
      );

      await service.generateTourActivities(TOUR_ID);

      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      const trace = completedCall[0].data.metadata.generationTrace;
      expect(trace.tourFormatCoverage).toEqual(
        expect.objectContaining({
          valid: false,
          issues: [
            expect.objectContaining({
              code: 'REQUESTED_FORMAT_UNAVAILABLE',
              requestedFormat: 'neighborhood_walks',
            }),
          ],
          retryAttempted: false,
        }),
      );
    });

    it('preserves a genuinely feasible requested-format candidate through to the planned, persisted tour', async () => {
      // Mirror of the previous test's pool, but this time nothing makes the
      // walk infeasible — the default solver stub (planAll) schedules every
      // offered candidate, so the walk survives soft scoring and lands in
      // the final plan, satisfying the requested format for real rather
      // than by the validator merely declining to flag an absence.
      const walk = {
        id: testUuid(),
        name: 'Neighborhood Walk',
        type: 'walk',
        latitude: -34.62,
        longitude: -58.37,
        kind: ActivityKind.NEIGHBORHOOD_WALK,
        duration: 2,
      };
      const pois = buildCandidates();
      const candidates = [...pois, walk];
      activitiesService.findAll.mockResolvedValue(candidates);
      prisma.activity.findMany.mockResolvedValue(
        candidates.map((c: any) => ({
          id: c.id,
          latitude: c.latitude,
          longitude: c.longitude,
          kind: c.kind ?? ActivityKind.POI,
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

      await service.generateTourActivities(TOUR_ID);

      const rows = prisma.tourActivity.create.mock.calls.map(
        (call: any) => call[0].data,
      );
      expect(rows.map((r: any) => r.activityId)).toContain(walk.id);

      const completedCall2 = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      const trace2 = completedCall2[0].data.metadata.generationTrace;
      expect(trace2.tourFormatCoverage).toEqual(
        expect.objectContaining({
          valid: true,
          issues: [],
          retryAttempted: false,
        }),
      );
    });
  });

  describe('entity resolution', () => {
    // Discovery only fires when interests are requested and the pool is
    // insufficient (default activitiesService.findAll already returns []).
    // The Places refill afterward still needs a real candidate for the
    // planning step to produce a tour, so provide exactly one via
    // mockResolvedValueOnce for the pre-refill lookup and a second for the
    // post-refill re-lookup.
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

    const setUpSuccessfulRefill = () => {
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
      return poiId;
    };

    it('calls the resolver with discovery proposals and the destination boundary after a successful discovery', async () => {
      toursService.findOne.mockResolvedValue(buildThinPoolTour());
      setUpSuccessfulRefill();
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
        destinationBoundary: expect.objectContaining({
          id: 'point-radius-scope',
          geometry: expect.objectContaining({ type: 'Polygon' }),
        }),
      });
    });

    it('surfaces the resolution result as an entity_resolution trace step', async () => {
      toursService.findOne.mockResolvedValue(buildThinPoolTour());
      setUpSuccessfulRefill();
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
      setUpSuccessfulRefill();
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

    it("merges a newly resolved activity into this generation's own unified candidate pool", async () => {
      toursService.findOne.mockResolvedValue(buildThinPoolTour());
      const poiId = setUpSuccessfulRefill();
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
      // The re-query step fetches exactly the rows proposal resolution just
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
      dailyPlanningSolver.solve.mockImplementation(
        async (input: DailyPlanningInput) => planSelecting(input, [poiId]),
      );

      await service.generateTourActivities(TOUR_ID);

      // The solver is pinned to poiId here — this test asserts the newly
      // resolved activity was made available (offered) to this same request,
      // not that the (separately mocked) planner happened to choose it.
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
      setUpSuccessfulRefill();
      activityDiscoveryService.discoverGaps.mockResolvedValue({
        proposals: [],
        provider: 'groq',
        model: 'test-model',
        groundingStatus: 'no_usable_evidence',
      });

      await service.generateTourActivities(TOUR_ID);

      expect(proposalResolver.resolve).not.toHaveBeenCalled();
    });

    it('leaves a valid catalog-only tour possible when the discovery provider errors out', async () => {
      toursService.findOne.mockResolvedValue(buildThinPoolTour());
      const poiId = setUpSuccessfulRefill();
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

  describe('unified candidate pool', () => {
    const buildThinPoolTour = () =>
      buildTour({
        metadata: {
          generationRequest: buildGenerationRequest({
            intent: { interests: ['history'] },
          }),
        },
      });

    it('lets the planner select a freshly discovery-resolved activity from this same request', async () => {
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
      // The planner picks the newly discovery-resolved activity, not the
      // thin pool's pre-existing one.
      dailyPlanningSolver.solve.mockImplementation(
        async (input: DailyPlanningInput) =>
          planSelecting(input, [newActivityId]),
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
      // A real embedding for the newly resolved composite/POI — already
      // written by CompositeActivityService/indexResolvedVenues at
      // persistence time, so it must
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

  describe('requested experience format coverage', () => {
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
    // today — previously this was swallowed by a stale
    // `if (interests.length > 0)` guard.
    it('does not call structural discovery for a format-only deficit', async () => {
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
        proposals: [
          {
            name: 'Paseo San Telmo',
            kind: ActivityKind.NEIGHBORHOOD_WALK,
            themes: [],
            entityHints: [],
            suggestedDurationMinutes: 120,
            shortReason: 'Grounded walk',
            evidenceKeys: ['evidence-1'],
          },
        ],
        provider: 'groq',
        model: 'test-model',
        groundingStatus: 'grounded',
        groundingEvidence: [{ key: 'evidence-1', snippet: 'San Telmo' }],
      });
      proposalResolver.resolve.mockResolvedValue({
        resolved: [
          {
            proposal: {
              name: 'Paseo San Telmo',
              kind: ActivityKind.NEIGHBORHOOD_WALK,
              themes: [],
              entityHints: [],
              suggestedDurationMinutes: 120,
              shortReason: 'Grounded walk',
              evidenceKeys: ['evidence-1'],
            },
            status: 'accepted',
            resolvedEntities: [
              {
                id: 'osm-1',
                name: 'Paseo San Telmo',
                kind: ActivityKind.NEIGHBORHOOD_WALK,
                status: 'resolved',
                latitude: -34.62,
                longitude: -58.37,
              },
            ],
            rejectionReasons: [],
            persistedActivityId: 'materialized-walk-1',
          },
        ],
        totalProposals: 1,
        acceptedCount: 1,
        rejectedCount: 0,
      });
      prisma.activity.findMany.mockResolvedValue([
        ...candidates.map((c) => ({
          id: c.id,
          latitude: c.latitude,
          longitude: c.longitude,
          kind: ActivityKind.POI,
        })),
        {
          id: 'materialized-walk-1',
          latitude: -34.62,
          longitude: -58.37,
          kind: ActivityKind.NEIGHBORHOOD_WALK,
        },
      ]);
      activitiesService.findManyByIds = jest.fn().mockResolvedValue([
        {
          id: 'materialized-walk-1',
          name: 'Paseo San Telmo',
          latitude: -34.62,
          longitude: -58.37,
          kind: ActivityKind.NEIGHBORHOOD_WALK,
        },
      ]);
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

      expect(activityDiscoveryService.discoverGaps).not.toHaveBeenCalled();
    });

    it('reports an ignored requested format without any corrective retry', async () => {
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
      // The walk was offered and was schedulable, but the planner left it
      // out for a non-physical reason — a real coverage shortfall.
      dailyPlanningSolver.solve.mockImplementation(
        async (input: DailyPlanningInput) =>
          planSelecting(
            input,
            pois.map((p) => p.id),
          ),
      );

      await service.generateTourActivities(TOUR_ID);

      // With the daily planning solver: there is no LLM left to re-invoke with feedback, so the
      // shortfall is reported, never retried — and never papered over by
      // forcing the walk into the tour.
      expect(dailyPlanningSolver.solve).toHaveBeenCalledTimes(1);
      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      expect(completedCall).toBeDefined();
      const trace = completedCall[0].data.metadata.generationTrace;
      expect(trace.tourFormatCoverage).toEqual(
        expect.objectContaining({ valid: false, retryAttempted: false }),
      );
      expect(trace.tourFormatCoverage.issues).toEqual([
        expect.objectContaining({
          code: 'REQUESTED_FORMAT_MISSING',
          requestedFormat: 'neighborhood_walks',
        }),
      ]);
      const formatStep = trace.steps.find(
        (s: any) => s.stage === 'tour_format_coverage',
      );
      expect(formatStep.providerStatus).toBe('failed');
    });

    it('reports completeness and format-coverage shortfalls together, still without retrying', async () => {
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
      // A single short POI — both under-filled AND ignoring the available
      // walk. One solve, two independent shortfalls, zero retries.
      dailyPlanningSolver.solve.mockImplementation(
        async (input: DailyPlanningInput) =>
          planSelecting(input, [extraPois[0].id]),
      );

      await service.generateTourActivities(TOUR_ID);

      expect(dailyPlanningSolver.solve).toHaveBeenCalledTimes(1);
      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      const trace = completedCall[0].data.metadata.generationTrace;
      expect(trace.tourCompleteness).toEqual(
        expect.objectContaining({ complete: false, retryAttempted: false }),
      );
      expect(trace.tourFormatCoverage).toEqual(
        expect.objectContaining({ valid: false, retryAttempted: false }),
      );
    });

    it('reports valid coverage when only point_visits was requested (no behavior change)', async () => {
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

      await service.generateTourActivities(TOUR_ID);

      expect(dailyPlanningSolver.solve).toHaveBeenCalledTimes(1);
      const completedCall = prisma.tour.update.mock.calls.find(
        (call: any) => call[0].data.metadata.generationStatus === 'completed',
      );
      const trace = completedCall[0].data.metadata.generationTrace;
      expect(trace.tourFormatCoverage).toEqual(
        expect.objectContaining({ valid: true, retryAttempted: false }),
      );
    });
  });

  // The deterministic planner can only schedule ids from the offered
  // catalog pool, so live composite persistence must stay unreachable here.
  it('never persists a composite during live generation', async () => {
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

  // Per-tour waypoint trimming at generation time is gone with the
  // LLM that used to request it — every composite is snapshotted with its
  // full current waypoint set, and trimming now happens post-generation on
  // the review screen instead.
  it("persists a composite's full current waypoint set, never a generation-time subset", async () => {
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
    expect(prisma.crawlerSearch.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          latitude_longitude: { latitude: -34.62, longitude: -58.37 },
        },
      }),
    );
  });

  it('skips the Google Places crawl when this area was already refilled within 24h', async () => {
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
    prisma.crawlerSearch.findFirst.mockResolvedValue({
      id: 'existing-search',
      latitude: -34.62,
      longitude: -58.37,
      createdAt: new Date(),
    });

    await service.generateTourActivities(TOUR_ID);

    expect(googlePlacesService.crawlAndSaveActivities).not.toHaveBeenCalled();
    expect(prisma.crawlerSearch.upsert).not.toHaveBeenCalled();
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

    await service.generateTourActivities(TOUR_ID);

    expect(googlePlacesService.crawlAndSaveActivities).not.toHaveBeenCalled();
    // Existing catalog Activities are preferred over
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
    // The offered window handed to the planner must rank the relevant,
    // lower-rated site ahead of the irrelevant, higher-rated one.
    const offered = solvedCandidateIds();
    expect(offered.indexOf(relevantId)).toBeGreaterThanOrEqual(0);
    expect(offered.indexOf(relevantId)).toBeLessThan(
      offered.indexOf(irrelevantId),
    );
  });

  it('scores an existing curated composite variant from findAll by its curated bonus, not a fake rating', async () => {
    const curatedWalkId = testUuid();
    const mediocrePoiId = testUuid();
    toursService.findOne.mockResolvedValue(
      buildTour({
        metadata: {
          generationRequest: buildGenerationRequest({
            intent: {
              interests: ['history'],
              experienceFormats: [],
            },
          }),
        },
        prompt: 'A tour',
      }),
    );
    const fillerPoiId = testUuid();
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
      {
        id: fillerPoiId,
        name: 'Low score filler POI',
        latitude: -34.62,
        longitude: -58.37,
        rating: 2.0,
        ratingCount: 10,
        kind: 'POI',
        weightedScore: 2.0,
      },
    ]);
    vectorStoreService.getSimilarityScores.mockResolvedValue(
      similarityResult(
        new Map([
          [mediocrePoiId, 0.5],
          [curatedWalkId, 0.5],
          [fillerPoiId, 0.1],
        ]),
        3,
      ),
    );
    prisma.activity.findMany.mockResolvedValue([
      {
        id: mediocrePoiId,
        latitude: -34.62,
        longitude: -58.37,
        kind: ActivityKind.POI,
      },
      {
        id: curatedWalkId,
        latitude: -34.62,
        longitude: -58.37,
        kind: ActivityKind.NEIGHBORHOOD_WALK,
      },
      {
        id: fillerPoiId,
        latitude: -34.62,
        longitude: -58.37,
        kind: ActivityKind.POI,
      },
    ]);

    await service.generateTourActivities(TOUR_ID);

    // Equal interest similarity (0.5): the curated composite's +0.15 bonus
    // must be compared against the POI's weightedScore-derived bonus
    // (3.2/5*0.2=0.128), not against the composite's own weightedScore field
    // (which would wrongly put it at 4.0/5*0.2=0.16, an even bigger margin,
    // masking whether the source-based branch actually ran instead of just
    // falling through to the 'poi' formula).
    const offered = solvedCandidateIds();
    expect(offered.indexOf(curatedWalkId)).toBeLessThan(
      offered.indexOf(mediocrePoiId),
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
      // The real catalog POI is what reached the planner; raw OSM features
      // never become live candidates.
      expect(solvedCandidateIds()).toEqual([poiId]);
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

      // Nothing real anywhere (no DB/Google activities, no neighborhoods,
      // hence no OSM streets/POIs either) — generation fails loudly rather
      // than completing an empty tour.
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

      await expect(service.generateTourActivities(TOUR_ID)).rejects.toThrow();

      expect(osmPlacesService.findStreetsWithin).not.toHaveBeenCalled();
      expect(osmPlacesService.findPoisWithin).not.toHaveBeenCalled();
      expect(dailyPlanningSolver.solve).not.toHaveBeenCalled();
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

      await service.generateTourActivities(TOUR_ID);

      expect(osmPlacesService.findPoisWithin).not.toHaveBeenCalled();
      expect(osmPlacesService.findStreetsWithin).not.toHaveBeenCalled();
      // Only the real catalog row is planned — no neighborhood ever becomes
      // a candidate of its own.
      expect(solvedCandidateIds()).toEqual([poiId]);
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

      await service.generateTourActivities(TOUR_ID);

      // 1. The thin pool (1 result) triggered a crawl refresh.
      expect(googlePlacesService.crawlAndSaveActivities).toHaveBeenCalled();
      // 2. Child areas distribute Places coverage only; detailed OSM
      // composite construction is not part of live generation.
      expect(osmPlacesService.findStreetsWithin).not.toHaveBeenCalled();
      // 3. The historically-relevant, lower-rated site outranked the
      //    irrelevant higher-rated one in what the planner was offered.
      const offered = solvedCandidateIds();
      expect(offered.indexOf(historicSiteId)).toBeLessThan(
        offered.indexOf(hikingTrailId),
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
