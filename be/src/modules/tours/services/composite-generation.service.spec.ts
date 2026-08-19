import { Test, TestingModule } from '@nestjs/testing';
import { LangChainService } from '@shared/ai/langchain.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';
import { ActivityKind, VariantTheme } from '@prisma/client';
import { CompositeGenerationService } from './composite-generation.service';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

describe('CompositeGenerationService', () => {
  let service: CompositeGenerationService;
  let langChainService: any;
  let wikidataApiService: any;
  let compositeActivityService: any;

  const osmCandidate = (
    overrides: Partial<OsmCandidate> = {},
  ): OsmCandidate => ({
    id: 'osm:relation:49518',
    name: 'San Telmo',
    osmType: 'relation',
    osmId: 49518,
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
    tags: { name: 'San Telmo' },
    ...overrides,
  });

  beforeEach(async () => {
    langChainService = {
      getChatModel: jest.fn().mockReturnValue(null),
      generateChatResponse: jest.fn(),
      generateCompletionResponse: jest.fn(),
      config: { provider: 'groq' },
    };
    wikidataApiService = { getEntitySummaries: jest.fn() };
    compositeActivityService = { createOrReuseComposite: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompositeGenerationService,
        { provide: LangChainService, useValue: langChainService },
        { provide: 'WikidataApiService', useValue: wikidataApiService },
        {
          provide: CompositeActivityService,
          useValue: compositeActivityService,
        },
      ],
    }).compile();

    service = module.get(CompositeGenerationService);
  });

  describe('createTourChain (JSON-mode fallback — no OpenAI function-calling model configured)', () => {
    it('parses the raw JSON response from generateChatResponse', async () => {
      langChainService.generateChatResponse.mockResolvedValue(
        JSON.stringify({
          title: 'Tour',
          description: 'A tour',
          activities: [],
          compositeActivities: [],
        }),
      );

      const chain = service.createTourChain();
      const result = await chain.invoke({
        input: 'Plan a tour',
        activities: '',
      });

      expect(result.title).toBe('Tour');
      expect(langChainService.generateChatResponse).toHaveBeenCalled();
    });

    it('repairs and parses a malformed-but-recoverable JSON response', async () => {
      // A trailing comma is the kind of thing repairJson fixes.
      langChainService.generateChatResponse.mockResolvedValue(
        '{"title": "Tour", "description": "A tour", "activities": [],}',
      );

      const chain = service.createTourChain();
      const result = await chain.invoke({
        input: 'Plan a tour',
        activities: '',
      });

      expect(result.title).toBe('Tour');
    });

    it('throws when the response is not recoverable JSON', async () => {
      langChainService.generateChatResponse.mockResolvedValue(
        'not json at all {{{',
      );

      const chain = service.createTourChain();

      await expect(
        chain.invoke({ input: 'Plan a tour', activities: '' }),
      ).rejects.toThrow();
    });
  });

  describe('enrichCandidatesWithWikidata', () => {
    it('returns 0 and makes no calls when no candidate carries a wikidata tag', async () => {
      const candidates = [osmCandidate({ tags: { name: 'San Telmo' } })];

      const count = await service.enrichCandidatesWithWikidata(candidates);

      expect(count).toBe(0);
      expect(wikidataApiService.getEntitySummaries).not.toHaveBeenCalled();
    });

    it('mutates narrativeContext onto candidates whose extract is available', async () => {
      const candidates = [
        osmCandidate({
          id: 'osm:way:1',
          tags: { name: 'Defensa', wikidata: 'Q123' },
        }),
      ];
      wikidataApiService.getEntitySummaries.mockResolvedValue(
        new Map([
          [
            'Q123',
            { qid: 'Q123', label: 'Defensa', extract: 'A real street.' },
          ],
        ]),
      );
      langChainService.generateCompletionResponse.mockResolvedValue(
        JSON.stringify({ Q123: true }),
      );

      const count = await service.enrichCandidatesWithWikidata(candidates);

      expect(count).toBe(1);
      expect(candidates[0].narrativeContext).toBe('A real street.');
    });

    it('degrades to 0 without throwing when the Wikidata call fails', async () => {
      const candidates = [
        osmCandidate({ tags: { name: 'Defensa', wikidata: 'Q123' } }),
      ];
      wikidataApiService.getEntitySummaries.mockRejectedValue(
        new Error('wikidata down'),
      );

      const count = await service.enrichCandidatesWithWikidata(candidates);

      expect(count).toBe(0);
      expect(candidates[0].narrativeContext).toBeUndefined();
    });
  });

  describe('verifyAndPersistComposites', () => {
    const areaCandidate = osmCandidate();

    it('persists a verified composite and carries themeReasoning/dayNumber/startTime through', async () => {
      const variant = { id: 'variant-1', name: 'San Telmo Historic Walk' };
      compositeActivityService.createOrReuseComposite.mockResolvedValue(
        variant,
      );

      const { persisted, hallucinatedWaypointCount, invalidCompositeCount } =
        await service.verifyAndPersistComposites({
          rawComposites: [
            {
              name: 'San Telmo Historic Walk',
              kind: 'NEIGHBORHOOD_WALK',
              variantTheme: 'HISTORY',
              themeReasoning: 'A historic walk',
              areaId: areaCandidate.id,
              dayNumber: 1,
              startTime: '10:00',
              waypointIds: ['poi-1', 'poi-2'],
            },
          ],
          candidateActivityIds: new Set(['poi-1', 'poi-2']),
          candidateOsmFeaturesById: new Map(),
          areaCandidate,
          logContext: 'test',
        });

      expect(hallucinatedWaypointCount).toBe(0);
      expect(invalidCompositeCount).toBe(0);
      expect(persisted).toEqual([
        {
          variant,
          themeReasoning: 'A historic walk',
          dayNumber: 1,
          startTime: '10:00',
        },
      ]);
      expect(
        compositeActivityService.createOrReuseComposite,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          variantTheme: VariantTheme.HISTORY,
          waypointIds: ['poi-1', 'poi-2'],
          forceUpdateWaypoints: undefined,
        }),
      );
    });

    it('forwards forceUpdateWaypoints through to CompositeActivityService', async () => {
      compositeActivityService.createOrReuseComposite.mockResolvedValue({
        id: 'variant-1',
      });

      await service.verifyAndPersistComposites({
        rawComposites: [
          {
            name: 'Walk',
            kind: 'NEIGHBORHOOD_WALK',
            variantTheme: 'HISTORY',
            areaId: areaCandidate.id,
            waypointIds: ['poi-1', 'poi-2'],
          },
        ],
        candidateActivityIds: new Set(['poi-1', 'poi-2']),
        candidateOsmFeaturesById: new Map(),
        areaCandidate,
        logContext: 'test',
        forceUpdateWaypoints: true,
      });

      expect(
        compositeActivityService.createOrReuseComposite,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ forceUpdateWaypoints: true }),
      );
    });

    it('drops an invalid proposal and never calls CompositeActivityService for it', async () => {
      const { persisted, invalidCompositeCount } =
        await service.verifyAndPersistComposites({
          rawComposites: [
            {
              name: 'Bad',
              kind: 'NOT_A_REAL_KIND',
              variantTheme: 'HISTORY',
              areaId: areaCandidate.id,
              waypointIds: ['poi-1', 'poi-2'],
            },
          ],
          candidateActivityIds: new Set(['poi-1', 'poi-2']),
          candidateOsmFeaturesById: new Map(),
          areaCandidate,
          logContext: 'test',
        });

      expect(invalidCompositeCount).toBe(1);
      expect(persisted).toHaveLength(0);
      expect(
        compositeActivityService.createOrReuseComposite,
      ).not.toHaveBeenCalled();
    });

    it('continues past a persistence failure for one composite without throwing', async () => {
      compositeActivityService.createOrReuseComposite.mockRejectedValue(
        new Error('db down'),
      );

      const { persisted } = await service.verifyAndPersistComposites({
        rawComposites: [
          {
            name: 'Walk',
            kind: 'NEIGHBORHOOD_WALK',
            variantTheme: 'HISTORY',
            areaId: areaCandidate.id,
            waypointIds: ['poi-1', 'poi-2'],
          },
        ],
        candidateActivityIds: new Set(['poi-1', 'poi-2']),
        candidateOsmFeaturesById: new Map(),
        areaCandidate,
        logContext: 'test',
      });

      expect(persisted).toHaveLength(0);
    });

    it('never persists anything when areaCandidate is null', async () => {
      const { persisted } = await service.verifyAndPersistComposites({
        rawComposites: [
          {
            name: 'Walk',
            kind: 'NEIGHBORHOOD_WALK',
            variantTheme: 'HISTORY',
            areaId: 'osm:relation:49518',
            waypointIds: ['poi-1', 'poi-2'],
          },
        ],
        candidateActivityIds: new Set(['poi-1', 'poi-2']),
        candidateOsmFeaturesById: new Map(),
        areaCandidate: null,
        logContext: 'test',
      });

      expect(persisted).toHaveLength(0);
      expect(
        compositeActivityService.createOrReuseComposite,
      ).not.toHaveBeenCalled();
    });
  });
});
