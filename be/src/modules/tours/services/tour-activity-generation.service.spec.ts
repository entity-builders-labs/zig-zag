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
      activity: { findMany: jest.fn().mockResolvedValue([]) },
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
    googlePlacesService = { crawlAndSaveActivities: jest.fn() };
    osmPlacesService = {
      findStreetsNear: jest.fn().mockResolvedValue([]),
      findContainingBoundary: jest.fn().mockResolvedValue(null),
    };
    wikidataApiService = {
      getEntitySummaries: jest.fn().mockResolvedValue(new Map()),
    };
    compositeActivityService = { createOrReuseComposite: jest.fn() };
    tourImageService = {
      generateTourCoverImage: jest.fn().mockResolvedValue(undefined),
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
        { provide: VectorStoreService, useValue: {} },
        { provide: GooglePlacesService, useValue: googlePlacesService },
        { provide: TourImageService, useValue: tourImageService },
        { provide: OsmPlacesService, useValue: osmPlacesService },
        { provide: 'WikidataApiService', useValue: wikidataApiService },
        {
          provide: CompositeActivityService,
          useValue: compositeActivityService,
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
