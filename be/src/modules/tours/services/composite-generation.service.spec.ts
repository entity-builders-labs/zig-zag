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
    wikidataApiService = {
      getEntitySummaries: jest.fn(),
      lookupEntitySummaries: jest.fn(),
    };
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
          reasoning: 'Selected only verified candidates.',
          activities: [],
        }),
      );

      const chain = service.createTourChain();
      const result = await chain.invoke({
        input: 'Plan a tour',
        activities: '',
      });

      expect(result.reasoning).toBe('Selected only verified candidates.');
      expect(langChainService.generateChatResponse).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        {},
        expect.objectContaining({
          groq: {
            maxCompletionTokens: 3000,
            reasoningEffort: 'low',
            includeReasoning: false,
          },
          responseFormat: expect.objectContaining({
            type: 'json_schema',
            json_schema: expect.objectContaining({
              name: 'tour_generation',
              strict: true,
              schema: expect.objectContaining({
                required: ['reasoning', 'activities'],
              }),
            }),
          }),
        }),
      );
    });

    it('repairs and parses a malformed-but-recoverable JSON response', async () => {
      // A trailing comma is the kind of thing repairJson fixes.
      langChainService.generateChatResponse.mockResolvedValue(
        '{"reasoning": "Verified picks.", "activities": [],}',
      );

      const chain = service.createTourChain();
      const result = await chain.invoke({
        input: 'Plan a tour',
        activities: '',
      });

      expect(result.reasoning).toBe('Verified picks.');
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

  describe('createCompositeProposalChain (offline curation only)', () => {
    it('uses the isolated composite schema and OSM evidence prompt', async () => {
      langChainService.generateChatResponse.mockResolvedValue(
        JSON.stringify({
          reasoning: 'Enough verified evidence.',
          compositeActivities: [],
          activities: [],
        }),
      );

      const chain = service.createCompositeProposalChain();
      await chain.invoke({
        input: 'Propose one walk',
        activities: 'id: poi-1 - Museum',
        osmFeatures: 'id: osm:way:1 - Defensa',
        area: 'id: osm:relation:1 - San Telmo',
        themes: 'HISTORY',
      });

      const [systemPrompt, userPrompt, , options] =
        langChainService.generateChatResponse.mock.calls[0];
      expect(systemPrompt).toContain('offline curation command');
      expect(userPrompt).toContain('osm:way:1');
      expect(userPrompt).toContain('osm:relation:1');
      expect(options.responseFormat.json_schema).toMatchObject({
        name: 'composite_proposal',
        strict: true,
        schema: expect.objectContaining({
          required: ['reasoning', 'compositeActivities', 'activities'],
        }),
      });
    });
  });

  describe('enrichCandidatesWithWikidata', () => {
    it('returns 0 and makes no calls when no candidate carries a wikidata tag', async () => {
      const candidates = [osmCandidate({ tags: { name: 'San Telmo' } })];

      const outcome = await service.enrichCandidatesWithWikidata(candidates);

      expect(outcome).toMatchObject({
        withoutQid: 1,
        withQid: 0,
        fetched: 0,
        acceptedSafe: 0,
      });
      expect(wikidataApiService.lookupEntitySummaries).not.toHaveBeenCalled();
    });

    it('mutates narrativeContext onto candidates whose extract is available', async () => {
      const candidates = [
        osmCandidate({
          id: 'osm:way:1',
          tags: { name: 'Defensa', wikidata: 'Q123' },
        }),
      ];
      wikidataApiService.lookupEntitySummaries.mockResolvedValue({
        summaries: new Map([
          [
            'Q123',
            { qid: 'Q123', label: 'Defensa', extract: 'A real street.' },
          ],
        ]),
        status: 'success',
        failedQids: new Set(),
        extractFailedQids: new Set(),
      });
      langChainService.generateCompletionResponse.mockResolvedValue(
        JSON.stringify({ Q123: true }),
      );

      const outcome = await service.enrichCandidatesWithWikidata(candidates);

      expect(outcome).toMatchObject({
        withoutQid: 0,
        withQid: 1,
        fetched: 1,
        acceptedSafe: 1,
        rejectedUnsafe: 0,
        providerFailed: 0,
        safetyCheckFailed: 0,
      });
      expect(candidates[0].narrativeContext).toBe('A real street.');
    });

    it('degrades to 0 without throwing when the Wikidata call fails', async () => {
      const candidates = [
        osmCandidate({ tags: { name: 'Defensa', wikidata: 'Q123' } }),
      ];
      wikidataApiService.lookupEntitySummaries.mockRejectedValue(
        new Error('wikidata down'),
      );

      const outcome = await service.enrichCandidatesWithWikidata(candidates);

      expect(outcome).toMatchObject({
        withQid: 1,
        fetched: 0,
        acceptedSafe: 0,
        providerFailed: 1,
      });
      expect(candidates[0].narrativeContext).toBeUndefined();
    });

    it('distinguishes an unsafe extract from a failed safety provider', async () => {
      const unsafeCandidate = osmCandidate({
        id: 'osm:way:unsafe',
        tags: { name: 'Unsafe', wikidata: 'Q1' },
      });
      wikidataApiService.lookupEntitySummaries.mockResolvedValue({
        summaries: new Map([
          ['Q1', { qid: 'Q1', label: 'Unsafe', extract: 'An extract.' }],
        ]),
        status: 'success',
        failedQids: new Set(),
        extractFailedQids: new Set(),
      });
      langChainService.generateCompletionResponse.mockResolvedValue(
        '{"Q1":false}',
      );

      const unsafe = await service.enrichCandidatesWithWikidata([
        unsafeCandidate,
      ]);

      langChainService.generateCompletionResponse.mockRejectedValue(
        new Error('safety provider down'),
      );
      const safetyFailed = await service.enrichCandidatesWithWikidata([
        osmCandidate({
          id: 'osm:way:failed',
          tags: { name: 'Failed', wikidata: 'Q1' },
        }),
      ]);

      expect(unsafe).toMatchObject({
        rejectedUnsafe: 1,
        safetyCheckFailed: 0,
      });
      expect(safetyFailed).toMatchObject({
        rejectedUnsafe: 0,
        safetyCheckFailed: 1,
      });
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
          name: 'San Telmo Historic Walk',
          kind: ActivityKind.NEIGHBORHOOD_WALK,
          variantTheme: VariantTheme.HISTORY,
          areaCandidate,
          waypointIds: ['poi-1', 'poi-2'],
          forceUpdateWaypoints: undefined,
        }),
      );
    });

    it('resolves the proposed area from multiple offered neighborhoods and never persists the free-form model name', async () => {
      const laBoca = osmCandidate({
        id: 'osm:relation:la-boca',
        name: 'La Boca',
        osmId: 2,
      });
      compositeActivityService.createOrReuseComposite.mockResolvedValue({
        id: 'variant-la-boca',
      });

      await service.verifyAndPersistComposites({
        rawComposites: [
          {
            name: 'Recoleta Architectural Walk',
            kind: 'NEIGHBORHOOD_WALK',
            variantTheme: 'ARCHITECTURE',
            areaId: laBoca.id,
            waypointIds: ['osm:way:1', 'osm:way:2'],
          },
        ],
        candidateActivityIds: new Set(),
        candidateOsmFeaturesById: new Map([
          [
            'osm:way:1',
            osmCandidate({ id: 'osm:way:1', osmId: 1, name: 'Defensa' }),
          ],
          [
            'osm:way:2',
            osmCandidate({ id: 'osm:way:2', osmId: 2, name: 'Caminito' }),
          ],
        ]),
        areaCandidate,
        areaCandidatesById: new Map([
          [areaCandidate.id, areaCandidate],
          [laBoca.id, laBoca],
        ]),
        candidateAreaIdsByWaypointId: new Map([
          ['osm:way:1', new Set([laBoca.id])],
          ['osm:way:2', new Set([laBoca.id])],
        ]),
        logContext: 'test',
      });

      expect(
        compositeActivityService.createOrReuseComposite,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'La Boca Architecture Walk',
          areaCandidate: laBoca,
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
