import { Test, TestingModule } from '@nestjs/testing';
import { ActivityKind } from '@prisma/client';
import { ConfigModule } from '@core/config/config.module';
import { PrismaService } from '@core/database/prisma.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';
import { CompositeGenerationService } from '@tours/services/composite-generation.service';
import { GenerateTemplatesCommand } from '../src/commands/scripts/commands/generate-templates.command';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

// Exercises generate-templates against real Postgres — specifically the
// parts a mocked Prisma can't certify: the ActivityFamily unique constraint,
// the Activity `sourceId_externalId` dedup for the area and each variant,
// and the ActivityWaypoint rows actually landing with real foreign keys.
// Only the external network calls (OSM/Wikidata/LLM) are stubbed — nothing
// here should ever hit a real third-party API.
describe('generate-templates CLI (e2e)', () => {
  let prisma: PrismaService;
  let command: GenerateTemplatesCommand;
  let langChainService: any;
  let osmPlacesService: any;
  let activitiesService: any;

  // A high, made-up osmId keeps this test's Area Activity's externalId
  // ("relation/900000001") from ever colliding with real crawled data.
  const AREA_CANDIDATE: OsmCandidate = {
    id: 'osm:relation:900000001',
    name: 'Generate Templates Test Area',
    osmType: 'relation',
    osmId: 900000001,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-58.372, -34.62],
          [-58.372, -34.63],
          [-58.362, -34.63],
          [-58.372, -34.62],
        ],
      ],
    },
    tags: { name: 'Generate Templates Test Area' },
  };

  let poi1Id: string;
  let poi2Id: string;
  let poi3Id: string;
  const createdVariantIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule],
      providers: [PrismaService],
    }).compile();
    prisma = moduleFixture.get(PrismaService);

    const poi1 = await prisma.activity.create({
      data: {
        name: 'Plaza Dorrego',
        kind: ActivityKind.POI,
        latitude: -34.62,
        longitude: -58.37,
      },
    });
    const poi2 = await prisma.activity.create({
      data: {
        name: 'Mercado de San Telmo',
        kind: ActivityKind.POI,
        latitude: -34.621,
        longitude: -58.371,
      },
    });
    const poi3 = await prisma.activity.create({
      data: {
        name: 'Parque Lezama',
        kind: ActivityKind.POI,
        latitude: -34.628,
        longitude: -58.369,
      },
    });
    poi1Id = poi1.id;
    poi2Id = poi2.id;
    poi3Id = poi3.id;

    const vectorStoreService = {
      saveActivityEmbedding: jest.fn().mockResolvedValue(undefined),
    } as any;
    const compositeActivityService = new CompositeActivityService(
      prisma,
      vectorStoreService,
    );

    langChainService = {
      getChatModel: (): null => null,
      generateChatResponse: jest.fn(),
      generateCompletionResponse: jest.fn(),
      config: { provider: 'groq' },
    };
    const wikidataApiService = {
      getEntitySummaries: jest.fn().mockResolvedValue(new Map()),
    };
    const compositeGenerationService = new CompositeGenerationService(
      langChainService,
      wikidataApiService as any,
      compositeActivityService,
    );

    osmPlacesService = {
      findBoundaryByName: jest.fn().mockResolvedValue(AREA_CANDIDATE),
      findStreetsNear: jest.fn().mockResolvedValue([]),
    };
    activitiesService = { findAll: jest.fn() };

    command = new GenerateTemplatesCommand(
      osmPlacesService,
      activitiesService,
      compositeGenerationService,
    );
  });

  afterAll(async () => {
    const areaRow = await prisma.activity.findFirst({
      where: { externalId: `relation/${AREA_CANDIDATE.osmId}` },
    });

    // Deleting the variants first cascades their own ActivityWaypoint rows
    // (compositeActivity is onDelete: Cascade), which is what frees the POIs
    // from ActivityWaypoint.waypointActivity's onDelete: Restrict.
    await prisma.activity.deleteMany({
      where: { id: { in: createdVariantIds } },
    });
    await prisma.activity.deleteMany({
      where: { id: { in: [poi1Id, poi2Id, poi3Id] } },
    });
    if (areaRow) {
      // Cascades away via ActivityFamily.areaActivity's onDelete: Cascade.
      await prisma.activity.delete({ where: { id: areaRow.id } });
    }
    await prisma.$disconnect();
  });

  // Every generateChatResponse call is themed via the "theme MUST be" clause
  // baked into GenerateTemplatesCommand's synthetic input — parsed back out
  // here so each mocked LLM response proposes a variant with the theme that
  // was actually requested for that call.
  function mockLlmProposal(waypointIds: string[]) {
    langChainService.generateChatResponse.mockImplementation(
      async (_system: string, userPrompt: string) => {
        const theme = userPrompt.match(/theme MUST be "([A-Z_]+)"/)?.[1];
        return JSON.stringify({
          title: 'x',
          description: 'x',
          activities: [],
          compositeActivities: [
            {
              name: `Test ${theme} Walk`,
              kind: 'NEIGHBORHOOD_WALK',
              variantTheme: theme,
              themeReasoning: 'test reasoning',
              areaId: AREA_CANDIDATE.id,
              waypointIds,
            },
          ],
        });
      },
    );
  }

  it('creates one real ActivityFamily and one Activity variant per requested theme, with real ActivityWaypoint rows', async () => {
    activitiesService.findAll.mockResolvedValue([
      {
        id: poi1Id,
        name: 'Plaza Dorrego',
        latitude: -34.62,
        longitude: -58.37,
      },
      {
        id: poi2Id,
        name: 'Mercado de San Telmo',
        latitude: -34.621,
        longitude: -58.371,
      },
    ]);
    mockLlmProposal([poi1Id, poi2Id]);

    await command.run([], {
      lat: -34.62,
      lng: -58.37,
      name: 'Generate Templates Test Area',
      themes: 'history,food',
    });

    const areaRow = await prisma.activity.findFirst({
      where: { externalId: `relation/${AREA_CANDIDATE.osmId}` },
    });
    expect(areaRow).not.toBeNull();

    const family = await prisma.activityFamily.findFirst({
      where: {
        areaActivityId: areaRow!.id,
        kind: ActivityKind.NEIGHBORHOOD_WALK,
      },
    });
    expect(family).not.toBeNull();

    const variants = await prisma.activity.findMany({
      where: { familyId: family!.id },
    });
    expect(variants).toHaveLength(2);
    createdVariantIds.push(...variants.map((v) => v.id));

    const variantThemes = variants.map((v) => v.variantTheme).sort();
    expect(variantThemes).toEqual(['FOOD', 'HISTORY']);

    for (const variant of variants) {
      const waypoints = await prisma.activityWaypoint.findMany({
        where: { compositeActivityId: variant.id },
      });
      expect(waypoints.map((w) => w.waypointActivityId).sort()).toEqual(
        [poi1Id, poi2Id].sort(),
      );
    }
  });

  it('leaves an existing variant untouched on a second run without --update-existing, and replaces it with --update-existing', async () => {
    activitiesService.findAll.mockResolvedValue([
      {
        id: poi1Id,
        name: 'Plaza Dorrego',
        latitude: -34.62,
        longitude: -58.37,
      },
      {
        id: poi3Id,
        name: 'Parque Lezama',
        latitude: -34.628,
        longitude: -58.369,
      },
    ]);
    // A DIFFERENT waypoint set than the first test's HISTORY variant.
    mockLlmProposal([poi1Id, poi3Id]);

    await command.run([], {
      lat: -34.62,
      lng: -58.37,
      name: 'Generate Templates Test Area',
      themes: 'history',
    });

    const areaRow = await prisma.activity.findFirst({
      where: { externalId: `relation/${AREA_CANDIDATE.osmId}` },
    });
    const family = await prisma.activityFamily.findFirst({
      where: {
        areaActivityId: areaRow!.id,
        kind: ActivityKind.NEIGHBORHOOD_WALK,
      },
    });
    const historyVariant = await prisma.activity.findFirst({
      where: { familyId: family!.id, variantTheme: 'HISTORY' as any },
    });

    // Still the original content (poi1+poi2), untouched by the re-run.
    let waypoints = await prisma.activityWaypoint.findMany({
      where: { compositeActivityId: historyVariant!.id },
    });
    expect(waypoints.map((w) => w.waypointActivityId).sort()).toEqual(
      [poi1Id, poi2Id].sort(),
    );

    await command.run([], {
      lat: -34.62,
      lng: -58.37,
      name: 'Generate Templates Test Area',
      themes: 'history',
      updateExisting: true,
    });

    waypoints = await prisma.activityWaypoint.findMany({
      where: { compositeActivityId: historyVariant!.id },
    });
    expect(waypoints.map((w) => w.waypointActivityId).sort()).toEqual(
      [poi1Id, poi3Id].sort(),
    );
  });
});
