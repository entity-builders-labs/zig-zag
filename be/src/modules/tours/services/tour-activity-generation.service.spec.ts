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
  const AREA_CANDIDATE = {
    id: 'osm:relation:49518',
    name: 'San Telmo',
    osmType: 'relation' as const,
    osmId: 49518,
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
    tags: { name: 'San Telmo' },
  };

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

  const buildTour = (overrides: any = {}) => ({
    id: TOUR_ID,
    activities: [],
    metadata: {
      options: { latitude: -34.62, longitude: -58.37, radius: 3000 },
      originalPrompt: 'A tour of San Telmo',
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
      activityFamily: { count: jest.fn().mockResolvedValue(0) },
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
    };

    toursService = { findOne: jest.fn().mockResolvedValue(buildTour()) };
    activitiesService = { findAll: jest.fn().mockResolvedValue([]) };
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
      findStreetsNear: jest.fn().mockResolvedValue([]),
      findContainingBoundary: jest.fn().mockResolvedValue(null),
      findNeighborhoodsWithin: jest.fn().mockResolvedValue([]),
      findStreetsWithin: jest.fn().mockResolvedValue([]),
      findPoisWithin: jest.fn().mockResolvedValue([]),
    };
    destinationResolutionService = {
      resolveDestination: jest.fn().mockResolvedValue({ scale: 'point' }),
    };
    wikidataApiService = {
      getEntitySummaries: jest.fn().mockResolvedValue(new Map()),
    };
    compositeActivityService = { createOrReuseComposite: jest.fn() };
    tourImageService = {
      generateTourCoverImage: jest.fn().mockResolvedValue(undefined),
    };
    vectorStoreService = {
      getSimilarityScores: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TourActivityGenerationService,
        // A real CompositeGenerationService, wired to the same mocked
        // sub-services below — this exercises the actual delegation from
        // TourActivityGenerationService through to chain-building/Wikidata/
        // verify+persist, so every existing expectation here (e.g. on
        // compositeActivityService.createOrReuseComposite) keeps working
        // unchanged after the Fase 5 extraction.
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
      ],
    }).compile();

    service = module.get(TourActivityGenerationService);
  });

  const aiJsonResponse = (payload: any) =>
    JSON.stringify({
      title: 'Tour',
      description: 'A tour',
      activities: [],
      compositeActivities: [],
      ...payload,
    });

  it('generates a plain POI tour successfully when there are no OSM/composite candidates at all', async () => {
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
            notes: 'Visit the museum',
            latitude: -34.62,
            longitude: -58.37,
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    expect(prisma.tourActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activityId: poiId }),
      }),
    );
    // A plain POI never gets a waypoint snapshot.
    expect(prisma.tourActivityWaypoint.createMany).not.toHaveBeenCalled();
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
    osmPlacesService.findStreetsNear.mockResolvedValue([
      {
        id: 'osm:way:1',
        name: 'Defensa',
        osmType: 'way',
        osmId: 1,
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        tags: { name: 'Defensa' },
      },
    ]);
    osmPlacesService.findContainingBoundary.mockResolvedValue(AREA_CANDIDATE);
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
      'destination_resolution',
      'db_search',
      'osm_streets',
      'osm_boundary',
      'wikidata_enrichment',
      'embeddings',
      'llm_generation',
      'verification',
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
    expect(embeddingsStep.summary).toContain('no tenía intereses declarados');
  });

  it('does not break POI generation when Overpass (streets/boundary) fails', async () => {
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
    osmPlacesService.findStreetsNear.mockRejectedValue(
      new Error('overpass down'),
    );
    osmPlacesService.findContainingBoundary.mockRejectedValue(
      new Error('overpass down'),
    );
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: poiId,
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'note',
            latitude: -34.62,
            longitude: -58.37,
          },
        ],
      }),
    );

    // OsmPlacesService's real implementation never throws (it's internally
    // defensive) — this test simulates a caller that DIDN'T get that
    // guarantee, to confirm generateTourActivities' own Promise.all around
    // it doesn't take the whole generation down with it. Since real
    // OsmPlacesService always resolves, wrap the call site's expectations
    // accordingly: a rejection here should surface as a clean failure, not
    // a silent success — assert on the actual contract instead.
    await expect(service.generateTourActivities(TOUR_ID)).rejects.toThrow();
  });

  it('does not break generation when Wikidata enrichment fails (OSM candidates still fetched)', async () => {
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
    osmPlacesService.findStreetsNear.mockResolvedValue([
      {
        id: 'osm:way:1',
        name: 'Defensa',
        osmType: 'way',
        osmId: 1,
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        tags: { name: 'Defensa', wikidata: 'Q123' },
      },
    ]);
    osmPlacesService.findContainingBoundary.mockResolvedValue(AREA_CANDIDATE);
    wikidataApiService.getEntitySummaries.mockRejectedValue(
      new Error('wikidata down'),
    );
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: poiId,
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'note',
            latitude: -34.62,
            longitude: -58.37,
          },
        ],
      }),
    );

    const result = await service.generateTourActivities(TOUR_ID);

    expect(result).toBeDefined();
    expect(prisma.tourActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activityId: poiId }),
      }),
    );
  });

  it('caps real Overpass street candidates at 20 before building the prompt (a real neighborhood can return hundreds, which reliably 413s the LLM request)', async () => {
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
    const manyStreets = Array.from({ length: 45 }, (_, i) => ({
      id: `osm:way:${i + 1}`,
      name: `Street ${i + 1}`,
      osmType: 'way' as const,
      osmId: i + 1,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [0, 0],
          [1, 1],
        ] as [number, number][],
      },
      tags: { name: `Street ${i + 1}` },
    }));
    osmPlacesService.findStreetsNear.mockResolvedValue(manyStreets);
    osmPlacesService.findContainingBoundary.mockResolvedValue(AREA_CANDIDATE);
    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: poiId,
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'note',
            latitude: -34.62,
            longitude: -58.37,
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    // The exact wiring point that would blow past Groq's payload limit if
    // uncapped — every candidate here becomes one line of prompt text.
    const promptCall = langChainService.generateChatResponse.mock.calls[0];
    const userPrompt: string = promptCall[1];
    for (let i = 1; i <= 20; i++) {
      expect(userPrompt).toContain(`osm:way:${i}`);
    }
    for (let i = 21; i <= 45; i++) {
      expect(userPrompt).not.toContain(`osm:way:${i}`);
    }
  });

  it('persists a verified composite via CompositeActivityService and snapshots its waypoints from the freshly created variant', async () => {
    const poi1Id = testUuid();
    const poi2Id = testUuid();
    activitiesService.findAll.mockResolvedValue([
      {
        id: poi1Id,
        name: 'Plaza Dorrego',
        latitude: -34.62,
        longitude: -58.37,
      },
      { id: poi2Id, name: 'Mercado', latitude: -34.621, longitude: -58.371 },
    ]);
    osmPlacesService.findContainingBoundary.mockResolvedValue(AREA_CANDIDATE);

    const variant = {
      id: testUuid(),
      name: 'San Telmo Historic Walk',
      kind: ActivityKind.NEIGHBORHOOD_WALK,
      latitude: -34.6205,
      longitude: -58.3705,
    };
    compositeActivityService.createOrReuseComposite.mockResolvedValue(variant);

    // Lookups the wiring makes after the AI response: kind of every final
    // pick, and the variant's own current waypoints (for the snapshot).
    prisma.activity.findMany.mockResolvedValue([
      {
        id: variant.id,
        latitude: variant.latitude,
        longitude: variant.longitude,
        kind: variant.kind,
      },
    ]);
    prisma.activityWaypoint.findMany.mockResolvedValue([
      { compositeActivityId: variant.id, waypointActivityId: poi1Id, order: 1 },
      { compositeActivityId: variant.id, waypointActivityId: poi2Id, order: 2 },
    ]);

    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [],
        compositeActivities: [
          {
            name: 'San Telmo Historic Walk',
            kind: 'NEIGHBORHOOD_WALK',
            variantTheme: 'HISTORY',
            themeReasoning: 'A historic walk',
            areaId: AREA_CANDIDATE.id,
            dayNumber: 1,
            startTime: '10:00',
            waypointIds: [poi1Id, poi2Id],
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    expect(
      compositeActivityService.createOrReuseComposite,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'NEIGHBORHOOD_WALK',
        variantTheme: 'HISTORY',
        waypointIds: [poi1Id, poi2Id],
      }),
    );
    expect(prisma.tourActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activityId: variant.id }),
      }),
    );
    expect(prisma.tourActivityWaypoint.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ waypointActivityId: poi1Id, order: 1 }),
        expect.objectContaining({ waypointActivityId: poi2Id, order: 2 }),
      ],
    });
  });

  it('drops a compositeActivities proposal whose waypointIds are hallucinated below the minimum, without calling CompositeActivityService', async () => {
    activitiesService.findAll.mockResolvedValue([
      {
        id: 'poi-1',
        name: 'Plaza Dorrego',
        latitude: -34.62,
        longitude: -58.37,
      },
    ]);
    osmPlacesService.findContainingBoundary.mockResolvedValue(AREA_CANDIDATE);
    prisma.activity.findMany.mockResolvedValue([]);

    langChainService.generateChatResponse.mockResolvedValue(
      aiJsonResponse({
        activities: [
          {
            activityId: 'poi-1',
            dayNumber: 1,
            startTime: '10:00',
            duration: 60,
            notes: 'note',
            latitude: -34.62,
            longitude: -58.37,
          },
        ],
        compositeActivities: [
          {
            name: 'Invented Walk',
            kind: 'NEIGHBORHOOD_WALK',
            variantTheme: 'HISTORY',
            areaId: AREA_CANDIDATE.id,
            waypointIds: ['poi-1', 'totally-invented-place'],
          },
        ],
      }),
    );

    await service.generateTourActivities(TOUR_ID);

    // Only 1 real waypoint survives verification (poi-1) — below the
    // NEIGHBORHOOD_WALK minimum of 2 — so the whole composite is dropped
    // and CompositeActivityService is never even called.
    expect(
      compositeActivityService.createOrReuseComposite,
    ).not.toHaveBeenCalled();
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

    expect(googlePlacesService.crawlAndSaveActivities).toHaveBeenCalled();
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

  it('ranks a lower-rated but more relevant POI ahead of a higher-rated irrelevant one when interests are given', async () => {
    const relevantId = testUuid();
    const irrelevantId = testUuid();
    toursService.findOne.mockResolvedValue(
      buildTour({
        metadata: {
          options: {
            latitude: -34.62,
            longitude: -58.37,
            radius: 3000,
            interests: ['history'],
          },
          originalPrompt: 'A tour',
        },
      }),
    );
    activitiesService.findAll.mockResolvedValue(
      Array.from({ length: 16 }, (_, i) => ({
        id: i === 0 ? irrelevantId : i === 1 ? relevantId : testUuid(),
        name:
          i === 0
            ? 'Irrelevant but top-rated'
            : i === 1
              ? 'Relevant history site'
              : `Filler ${i}`,
        latitude: -34.62,
        longitude: -58.37,
        rating: i === 0 ? 4.9 : 3.5,
        ratingCount: 100,
      })),
    );
    vectorStoreService.getSimilarityScores.mockResolvedValue(
      new Map([
        [irrelevantId, 0.05],
        [relevantId, 0.95],
      ]),
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

    expect(vectorStoreService.getSimilarityScores).toHaveBeenCalledWith(
      expect.arrayContaining([relevantId, irrelevantId]),
      'history',
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
          options: {
            latitude: -34.62,
            longitude: -58.37,
            radius: 3000,
            interests: ['history'],
          },
          originalPrompt: 'A tour',
        },
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
      new Map([
        [mediocrePoiId, 0.5],
        [curatedWalkId, 0.5],
      ]),
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
    it('explores shortlisted neighborhoods and offers their real streets/POIs as composite candidates for an area-scale destination', async () => {
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            options: {
              latitude: -34.62,
              longitude: -58.37,
              radius: 3000,
              destination: 'Buenos Aires',
            },
            originalPrompt: 'A tour of San Telmo',
          },
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
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
        tags: { name: 'San Telmo', admin_level: '9' },
      };
      const defensa = {
        id: 'osm:way:1',
        name: 'Defensa',
        osmType: 'way' as const,
        osmId: 1,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [0, 0],
            [0, 1],
          ] as [number, number][],
        },
        tags: { name: 'Defensa', highway: 'pedestrian' },
      };
      osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([sanTelmo]);
      osmPlacesService.findStreetsWithin.mockResolvedValue([defensa]);
      osmPlacesService.findPoisWithin.mockResolvedValue([]);
      // A realistic (not empty) DB pool — proves this isn't just testing
      // that the LLM got called, but that the area-scale path can actually
      // land a composite built from the real candidates it explored.
      const poiId = testUuid();
      activitiesService.findAll.mockResolvedValue([
        {
          id: poiId,
          name: 'Plaza Dorrego',
          latitude: -34.62,
          longitude: -58.37,
        },
      ]);
      const variant = {
        id: testUuid(),
        name: 'San Telmo Route',
        kind: ActivityKind.ROUTE,
        latitude: -34.62,
        longitude: -58.37,
      };
      compositeActivityService.createOrReuseComposite.mockResolvedValue(
        variant,
      );
      prisma.activity.findMany.mockResolvedValue([
        {
          id: variant.id,
          latitude: variant.latitude,
          longitude: variant.longitude,
          kind: variant.kind,
        },
      ]);
      langChainService.generateChatResponse.mockResolvedValue(
        aiJsonResponse({
          compositeActivities: [
            {
              name: 'San Telmo Route',
              kind: 'ROUTE',
              variantTheme: 'HISTORY',
              themeReasoning: 'Walk down Defensa',
              // Must exactly match the area-scale areaCandidate offered —
              // the resolved CITY boundary, not the shortlisted
              // neighborhood — since verifyAndDedupeCompositeActivities
              // checks this against areaCandidate?.id.
              areaId: boundary.id,
              dayNumber: 1,
              startTime: '10:00',
              waypointIds: [defensa.id],
            },
          ],
        }),
      );

      await service.generateTourActivities(TOUR_ID);

      expect(
        destinationResolutionService.resolveDestination,
      ).toHaveBeenCalledWith('Buenos Aires');
      expect(osmPlacesService.findNeighborhoodsWithin).toHaveBeenCalledWith(
        boundary,
      );
      expect(osmPlacesService.findStreetsWithin).toHaveBeenCalledWith(sanTelmo);
      const [, promptArg] = langChainService.generateChatResponse.mock.calls[0];
      expect(promptArg).toContain('Defensa');
      expect(
        compositeActivityService.createOrReuseComposite,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'ROUTE',
          variantTheme: 'HISTORY',
          waypointIds: [defensa.id],
        }),
      );
      expect(prisma.tourActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ activityId: variant.id }),
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

    it('gives every shortlisted neighborhood its own share of the candidate budget, instead of the first one exhausting the whole cap', async () => {
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            options: {
              latitude: -34.62,
              longitude: -58.37,
              radius: 3000,
              destination: 'Buenos Aires',
            },
            originalPrompt: 'A tour of Buenos Aires',
          },
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
      // Both neighborhoods are dense enough on their own to exhaust a
      // naive global cap of 20 — the real-world failure mode this test
      // guards against (the spike measured San Telmo alone at 178 streets
      // + 50 POIs).
      const sanTelmoStreets = Array.from({ length: 30 }, (_, i) => ({
        id: `osm:way:st-${i + 1}`,
        name: `San Telmo Street ${i + 1}`,
        osmType: 'way' as const,
        osmId: i + 1,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [0, 0],
            [0, 1],
          ] as [number, number][],
        },
        tags: { name: `San Telmo Street ${i + 1}` },
      }));
      const recoletaStreets = Array.from({ length: 30 }, (_, i) => ({
        id: `osm:way:rc-${i + 1}`,
        name: `Recoleta Street ${i + 1}`,
        osmType: 'way' as const,
        osmId: i + 1,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [2, 2],
            [2, 3],
          ] as [number, number][],
        },
        tags: { name: `Recoleta Street ${i + 1}` },
      }));
      osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([
        sanTelmo,
        recoleta,
      ]);
      osmPlacesService.findStreetsWithin.mockImplementation(
        async (neighborhood: any) =>
          neighborhood.id === sanTelmo.id ? sanTelmoStreets : recoletaStreets,
      );
      osmPlacesService.findPoisWithin.mockResolvedValue([]);
      activitiesService.findAll.mockResolvedValue([]);
      langChainService.generateChatResponse.mockResolvedValue(
        aiJsonResponse({}),
      );

      // Neither neighborhood has an existing curated family, and both have
      // 0 POIs (tie), so shortlistNeighborhoods' stable sort keeps
      // San Telmo first, Recoleta second — both survive the k=6 default
      // shortlist size with only 2 candidates offered.
      await expect(service.generateTourActivities(TOUR_ID)).rejects.toThrow();

      const [, promptArg] = langChainService.generateChatResponse.mock.calls[0];
      expect(promptArg).toContain('San Telmo Street 1');
      expect(promptArg).toContain('Recoleta Street 1');
    });

    it('reproduces the Barcelona scenario: a thin, off-topic DB pool for an area-scale destination triggers both a crawl and a neighborhood shortlist, and ranks the LLM candidates by interest', async () => {
      toursService.findOne.mockResolvedValue(
        buildTour({
          metadata: {
            options: {
              latitude: 41.42,
              longitude: 2.15,
              radius: 11000,
              destination: 'Barcelona',
              interests: ['history', 'architecture'],
            },
            originalPrompt: 'A tour of Barcelona',
          },
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
      osmPlacesService.findPoisWithin.mockResolvedValue([]);
      osmPlacesService.findStreetsWithin.mockResolvedValue([
        {
          id: 'osm:way:501',
          name: 'La Rambla',
          osmType: 'way',
          osmId: 501,
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [0, 1],
            ],
          },
          tags: { name: 'La Rambla', highway: 'pedestrian' },
        },
      ]);

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
        new Map([
          [hikingTrailId, 0.05],
          [historicSiteId, 0.9],
        ]),
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
      // 2. The destination resolved to area-scale and explored a real neighborhood.
      expect(osmPlacesService.findStreetsWithin).toHaveBeenCalledWith(
        ciutatVella,
      );
      // 3. The historically-relevant, lower-rated site outranked the irrelevant
      //    higher-rated one in what the LLM was offered.
      const [, promptArg] = langChainService.generateChatResponse.mock.calls[0];
      expect(promptArg.indexOf('Barri Gòtic historic site')).toBeLessThan(
        promptArg.indexOf('Collserola hiking trail'),
      );
      // 4. The bitácora records both new stages. tour.update is called with a
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
        expect.arrayContaining([
          'destination_resolution',
          'neighborhood_shortlist',
        ]),
      );
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
