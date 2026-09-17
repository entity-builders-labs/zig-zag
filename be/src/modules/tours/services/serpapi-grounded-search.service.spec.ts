import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SerpApiGroundedSearchService } from './serpapi-grounded-search.service';
import { AiCacheService } from '@shared/ai/services/ai-cache.service';

describe('SerpApiGroundedSearchService', () => {
  let service: SerpApiGroundedSearchService;
  let configService: { get: jest.Mock };
  let aiCache: { getCachedResponse: jest.Mock; cacheResponse: jest.Mock };
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    configService = { get: jest.fn() };
    aiCache = {
      getCachedResponse: jest.fn().mockResolvedValue(null),
      cacheResponse: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SerpApiGroundedSearchService,
        { provide: ConfigService, useValue: configService },
        { provide: AiCacheService, useValue: aiCache },
      ],
    }).compile();
    service = module.get(SerpApiGroundedSearchService);
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
  });

  function mockFetchOk(organicResults: any[]) {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ organic_results: organicResults }),
    } as any);
  }

  it('reports unavailable when no SerpApi key is configured', async () => {
    configService.get.mockReturnValue(undefined);
    const result = await service.search({
      destinationName: 'Buenos Aires',
      requestedThemes: ['tango'],
      query: '',
    });

    expect(result.groundingStatus).toBe('unavailable');
    expect(result.evidence).toEqual([]);
    expect(fetchSpy).toBeUndefined();
  });

  it('reuses an applied result from the persistent cache without calling SerpAPI', async () => {
    configService.get.mockReturnValue('test-key');
    aiCache.getCachedResponse.mockResolvedValue(
      JSON.stringify({
        provider: 'serpapi',
        model: 'google-search',
        groundingStatus: 'applied',
        evidence: [{ key: 'ev-1', source: 'guide', snippet: 'San Telmo walk' }],
      }),
    );

    const result = await service.search({
      destinationName: 'Buenos Aires',
      requestedThemes: ['walk'],
      query: 'historical walk in San Telmo',
    });

    expect(result.groundingStatus).toBe('applied');
    expect(fetchSpy).toBeUndefined();
    expect(aiCache.cacheResponse).not.toHaveBeenCalled();
  });

  describe('general path (empty query — engine=google)', () => {
    it('normalizes organic results with snippets into evidence', async () => {
      configService.get.mockReturnValue('test-key');
      mockFetchOk([
        {
          title: 'San Telmo Guide',
          link: 'https://example.com/san-telmo',
          snippet: 'San Telmo is the oldest barrio of Buenos Aires.',
        },
        {
          title: 'Caminito',
          link: 'https://example.com/caminito',
          snippet: 'Caminito in La Boca is a colorful pedestrian street.',
        },
      ]);

      const result = await service.search({
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        query: '',
      });

      expect(fetchSpy).toHaveBeenCalled();
      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(new URL(calledUrl).searchParams.get('engine')).toBe('google');
      expect(result.groundingStatus).toBe('applied');
      expect(result.evidence).toHaveLength(2);
      expect(result.evidence[0]).toEqual({
        key: 'ev-1',
        source: 'San Telmo Guide',
        snippet: 'San Telmo is the oldest barrio of Buenos Aires.',
        url: 'https://example.com/san-telmo',
      });
    });

    it('skips organic results with no snippet', async () => {
      configService.get.mockReturnValue('test-key');
      mockFetchOk([
        { title: 'No snippet here', link: 'https://example.com/x' },
        {
          title: 'Has snippet',
          link: 'https://example.com/y',
          snippet: 'Real content.',
        },
      ]);

      const result = await service.search({
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        query: '',
      });

      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].key).toBe('ev-1');
      expect(result.evidence[0].source).toBe('Has snippet');
    });

    it('reports no_usable_evidence when there are no organic results', async () => {
      configService.get.mockReturnValue('test-key');
      mockFetchOk([]);

      const result = await service.search({
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        query: '',
      });

      expect(result.groundingStatus).toBe('no_usable_evidence');
      expect(result.evidence).toEqual([]);
    });

    it('reports failed when SerpApi returns an error status', async () => {
      configService.get.mockReturnValue('test-key');
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid api key',
      } as any);

      const result = await service.search({
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        query: '',
      });

      expect(result.groundingStatus).toBe('failed');
      expect(result.failureReason).toBe('serpapi_error_401');
      expect(result.evidence).toEqual([]);
    });

    it('uses the V2 fallback query without legacy format slugs', async () => {
      configService.get.mockReturnValue('test-key');
      mockFetchOk([]);

      await service.search({
        destinationName: 'La Rioja',
        destinationCountry: 'Argentina',
        requestedThemes: ['history'],
        query: '',
      });

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      const q = new URL(calledUrl).searchParams.get('q');
      expect(q).toContain('real tourism experiences');
      expect(q).not.toContain('neighborhood_walks');
    });

    it('reports failed when the request throws', async () => {
      configService.get.mockReturnValue('test-key');
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('network down'));

      const result = await service.search({
        destinationName: 'Buenos Aires',
        requestedThemes: ['culture'],
        query: '',
      });

      expect(result.groundingStatus).toBe('failed');
      expect(result.failureReason).toBe('network down');
    });
  });

  describe('semantic path (query present — engine=google_ai_mode)', () => {
    function mockFetchAiModeOk(body: object) {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify(body),
      } as any);
    }

    it('calls SerpApi with engine=google_ai_mode, the query verbatim, and location/hl', async () => {
      configService.get.mockReturnValue('test-key');
      mockFetchAiModeOk({ text_blocks: [] });

      await service.search({
        destinationName: 'Salta',
        destinationCountry: 'Salta Province, Argentina',
        requestedThemes: [],
        query: 'Find 8-10 real neighborhood walking experiences inside Salta.',
      });

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      const params = new URL(calledUrl).searchParams;
      expect(params.get('engine')).toBe('google_ai_mode');
      expect(params.get('q')).toBe(
        'Find 8-10 real neighborhood walking experiences inside Salta.',
      );
      expect(params.get('location')).toBe('Salta');
      expect(params.get('hl')).toBe('en');
    });

    it("uses a request timeout with real margin over google_ai_mode's observed cold-query latency (live-confirmed: a fresh, never-cached query took 50.88s against the real SerpApi endpoint, 2026-09-17)", async () => {
      configService.get.mockReturnValue('test-key');
      mockFetchAiModeOk({ text_blocks: [] });
      const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');

      await service.search({
        destinationName: 'Buenos Aires',
        requestedThemes: [],
        query: 'Buenos Aires historic sites history walking tours walks',
      });

      expect(timeoutSpy).toHaveBeenCalled();
      const usedTimeoutMs = timeoutSpy.mock.calls[0][0];
      // Real margin above the measured 50.88s cold-query latency, not just
      // "a bit more than 15s" — matches how the local OSM services already
      // size their own timeouts against real observed provider latency.
      expect(usedTimeoutMs).toBeGreaterThanOrEqual(60000);

      timeoutSpy.mockRestore();
    });

    it('parses a realistic text_blocks fixture into GroundingEvidence[] and GroundedTextBlock[]', async () => {
      configService.get.mockReturnValue('test-key');
      mockFetchAiModeOk({
        search_metadata: {
          google_ai_mode_url: 'https://www.google.com/search?q=shared',
        },
        text_blocks: [
          { type: 'paragraph', snippet: 'Intro framing text.' },
          { type: 'heading', snippet: 'Centro Histórico' },
          {
            type: 'list',
            list: [
              {
                snippet: 'Plaza 9 de Julio anchors the historic core.',
                snippet_links: [{ link: 'https://example.com/plaza' }],
              },
              { snippet: 'Cabildo de Salta, a colonial civic landmark.' },
            ],
          },
        ],
      });

      const result = await service.search({
        destinationName: 'Salta',
        requestedThemes: [],
        query: 'Find real neighborhood walks inside Salta.',
      });

      expect(result.groundingStatus).toBe('applied');
      expect(result.evidence).toHaveLength(3);
      expect(result.evidence[0]).toEqual({
        key: 'ev-1',
        source: 'google_ai_mode',
        snippet: 'Intro framing text.',
        kind: 'narrative_paragraph',
        order: 1,
        contextHeading: undefined,
        title: undefined,
        url: undefined,
      });
      expect(result.evidence[1]).toMatchObject({
        key: 'ev-2',
        source: 'Centro Histórico',
        snippet: 'Plaza 9 de Julio anchors the historic core.',
        kind: 'list_item',
        url: 'https://example.com/plaza',
      });
      expect(result.evidence[2].url).toBeUndefined();

      expect(result.textBlocks).toEqual([
        { text: 'Intro framing text.', evidenceKeys: ['ev-1'] },
        { text: 'Centro Histórico', evidenceKeys: [] },
        {
          text: 'Plaza 9 de Julio anchors the historic core. Cabildo de Salta, a colonial civic landmark.',
          evidenceKeys: ['ev-2', 'ev-3'],
        },
      ]);
      expect(result.normalizationAudit?.decisions).toHaveLength(4);
      expect(result.normalizationAudit?.decisions[0].reason).toBe(
        'PARAGRAPH_EMITTED',
      );
    });

    it('does not repeat the shared google_ai_mode_url across many evidence items (prompt-bloat regression)', async () => {
      configService.get.mockReturnValue('test-key');
      const hugeSharedUrl = `https://www.google.com/search?q=${'x'.repeat(1700)}`;
      mockFetchAiModeOk({
        search_metadata: { google_ai_mode_url: hugeSharedUrl },
        text_blocks: [
          {
            type: 'list',
            // 30 items, none with their own snippet_links — matches the
            // real-world shape that live-tripped Groq's TPM limit.
            list: Array.from({ length: 30 }, (_, i) => ({
              snippet: `Real named place number ${i} with a modestly long description.`,
            })),
          },
        ],
      });

      const result = await service.search({
        destinationName: 'Buenos Aires',
        requestedThemes: [],
        query: 'Find real neighborhood walks inside Buenos Aires.',
      });

      expect(result.evidence).toHaveLength(30);
      expect(result.evidence.every((e) => e.url === undefined)).toBe(true);
      // Total serialized size stays proportional to the real snippet
      // content, not inflated by 30x a ~1700-char shared URL.
      expect(JSON.stringify(result.evidence).length).toBeLessThan(5000);
    });

    it('salvages usable evidence from a malformed-JSON response instead of failing outright', async () => {
      configService.get.mockReturnValue('test-key');
      const malformed =
        '{"text_blocks":[{"type":"list","list":[{"snippet":"San Telmo (\\\\"Saint Pedro\\\\") is the oldest barrio."}]}]';
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => malformed,
      } as any);

      const result = await service.search({
        destinationName: 'Buenos Aires',
        requestedThemes: [],
        query: 'Find real neighborhood walks inside Buenos Aires.',
      });

      expect(result.groundingStatus).toBe('applied');
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].snippet).toContain('San Telmo');
    });

    it('retries once without location when SerpApi rejects it, then succeeds', async () => {
      configService.get.mockReturnValue('test-key');
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: async () =>
            '{"error": "Unsupported `La Rioja city, Argentina` location - location parameter."}',
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ text_blocks: [] }),
        } as any);

      const result = await service.search({
        destinationName: 'La Rioja city',
        destinationCountry: 'Argentina',
        requestedThemes: [],
        query: 'Find real neighborhood walks inside La Rioja city, Argentina.',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const secondUrl = fetchSpy.mock.calls[1][0] as string;
      expect(new URL(secondUrl).searchParams.has('location')).toBe(false);
      expect(result.groundingStatus).toBe('no_usable_evidence');
      expect(result.failureReason).toBeUndefined();
    });

    it('does not retry when the 400 is unrelated to location', async () => {
      configService.get.mockReturnValue('test-key');
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => '{"error": "Missing query parameter q."}',
      } as any);

      const result = await service.search({
        destinationName: 'Buenos Aires',
        requestedThemes: [],
        query: 'Find real experiences inside Buenos Aires.',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result.groundingStatus).toBe('failed');
      expect(result.failureReason).toBe('serpapi_error_400');
    });

    it('reports failed when the semantic request throws', async () => {
      configService.get.mockReturnValue('test-key');
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('network down'));

      const result = await service.search({
        destinationName: 'Buenos Aires',
        requestedThemes: [],
        query: 'Find real experiences inside Buenos Aires.',
      });

      expect(result.groundingStatus).toBe('failed');
      expect(result.failureReason).toBe('network down');
    });
  });
});
