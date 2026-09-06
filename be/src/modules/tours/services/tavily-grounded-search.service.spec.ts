import { ConfigService } from '@nestjs/config';
import { TavilyGroundedSearchService } from './tavily-grounded-search.service';
import {
  TavilyExtractResult,
  TavilyExtractService,
} from './tavily-extract.service';
import { ExperienceGroundedSearchRequest } from '../interfaces/experience-grounding.interface';

const request: ExperienceGroundedSearchRequest = {
  destinationName: 'Gualeguaychú',
  destinationCountry: 'Argentina',
  requestedThemes: ['history', 'architecture'],
  query:
    'Find real thematic walking routes in Gualeguaychú, Argentina focused on history and architecture.',
};

// Most tests don't care about the top-K full-content enrichment step — an
// empty extract result map keeps their existing snippet-based assertions
// intact, since enrichTopResultsWithFullContent leaves an item's evidence
// snippet untouched when extraction didn't return anything for its url.
function tavilyExtract(
  results: Record<string, TavilyExtractResult> = {},
): TavilyExtractService {
  return {
    extract: jest.fn().mockResolvedValue(new Map(Object.entries(results))),
  } as unknown as TavilyExtractService;
}

describe('TavilyGroundedSearchService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns unavailable when the API key is missing', async () => {
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new TavilyGroundedSearchService(config, tavilyExtract());

    const result = await service.search(request);

    expect(result).toMatchObject({
      provider: 'tavily',
      groundingStatus: 'unavailable',
      evidence: [],
      failureReason: 'missing_tavily_api_key',
    });
  });

  it('normalizes Tavily results into grounded evidence', async () => {
    const config = {
      get: jest.fn().mockReturnValue('tvly-test'),
    } as unknown as ConfigService;
    const service = new TavilyGroundedSearchService(config, tavilyExtract());

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Historic waterfront walk',
            url: 'https://example.com/walk',
            content:
              'A documented historic walking route along the waterfront.',
          },
        ],
      }),
    }) as jest.Mock;

    const result = await service.search(request);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tvly-test',
        }),
      }),
    );
    expect(result).toMatchObject({
      provider: 'tavily',
      model: 'tavily-search-basic',
      groundingStatus: 'applied',
      evidence: [
        {
          key: 'ev-1',
          source: 'Historic waterfront walk',
          title: 'Historic waterfront walk',
          url: 'https://example.com/walk',
          snippet: 'A documented historic walking route along the waterfront.',
        },
      ],
    });
  });

  it("never sends Tavily's country boost param, even when destinationCountry is known — repeated live calls with the identical query showed 0-to-20 result-count variance, and pairing that with `country` occasionally returned zero results outright (catastrophic — no evidence at all) instead of the milder, already-handled risk of some wrong-country noise slipping into evidence (CompositeGeographicValidationService's destination_mismatch check already rejects those downstream, before persistence)", async () => {
    const config = {
      get: jest.fn().mockReturnValue('tvly-test'),
    } as unknown as ConfigService;
    const service = new TavilyGroundedSearchService(config, tavilyExtract());
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] as any[] }),
    }) as jest.Mock;

    await service.search(request);

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).not.toHaveProperty('country');
  });

  it("requests 20 results, not 10 — verified live: a real page enumerating three distinct extra themes (nature, water sports, a separate national park) only entered Tavily's own top 10 once results were raised to 20, with no second API call needed", async () => {
    const config = {
      get: jest.fn().mockReturnValue('tvly-test'),
    } as unknown as ConfigService;
    const service = new TavilyGroundedSearchService(config, tavilyExtract());
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] as any[] }),
    }) as jest.Mock;

    await service.search(request);

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.max_results).toBe(20);
  });

  it("trusts a long, well-structured query as-is instead of silently discarding it (regression: the old 200-char cutoff had no basis in Tavily's own API and replaced a working query with a cruder, noisier fallback)", async () => {
    const config = {
      get: jest.fn().mockReturnValue('tvly-test'),
    } as unknown as ConfigService;
    const service = new TavilyGroundedSearchService(config, tavilyExtract());
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] as any[] }),
    }) as jest.Mock;

    const longQuery =
      'San Juan Argentina history nature architecture valle de la luna ischigualasto desert landscapes scenic geological day trips from San Juan returning the same day no overnight real named places official tourism attractions';
    expect(longQuery.length).toBeGreaterThan(200);

    await service.search({ ...request, query: longQuery });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.query).toBe(longQuery);
  });

  it('reports Tavily rate limiting explicitly', async () => {
    const config = {
      get: jest.fn().mockReturnValue('tvly-test'),
    } as unknown as ConfigService;
    const service = new TavilyGroundedSearchService(config, tavilyExtract());

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }) as jest.Mock;

    const result = await service.search(request);

    expect(result).toMatchObject({
      provider: 'tavily',
      groundingStatus: 'failed',
      evidence: [],
      failureReason: 'tavily_rate_limited',
    });
  });

  it("replaces a top-scored result's short snippet with the full extracted article, and records provenance for it — a walking route's actual stop-by-stop detail rarely survives into Tavily's own relevance snippet", async () => {
    const config = {
      get: jest.fn().mockReturnValue('tvly-test'),
    } as unknown as ConfigService;
    const extract = tavilyExtract({
      'https://example.com/walk': {
        status: 'success',
        content:
          'Full article: start at Plaza Dorrego, then walk down Calle Defensa to the Feria de San Telmo, ending at Parque Lezama.',
      },
    });
    const service = new TavilyGroundedSearchService(config, extract);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'San Telmo walking tour',
            url: 'https://example.com/walk',
            content: 'A historic walk through San Telmo.',
            score: 0.9,
          },
        ],
      }),
    }) as jest.Mock;

    const result = await service.search(request);

    expect(extract.extract).toHaveBeenCalledWith(['https://example.com/walk']);
    expect(result.evidence).toEqual([
      expect.objectContaining({
        key: 'ev-1',
        snippet:
          'Full article: start at Plaza Dorrego, then walk down Calle Defensa to the Feria de San Telmo, ending at Parque Lezama.',
      }),
    ]);
    expect(result.evidenceProvenance).toEqual([
      expect.objectContaining({
        provider: 'tavily',
        url: 'https://example.com/walk',
        extractionProvider: 'tavily',
        extractionStatus: 'success',
        evidenceQuality: 'original_content',
        evidenceKeys: ['ev-1'],
      }),
    ]);
  });

  it('only sends the top 5 results (by score, not result order) to extract, and leaves the rest with their original short snippet', async () => {
    const config = {
      get: jest.fn().mockReturnValue('tvly-test'),
    } as unknown as ConfigService;
    const extract = tavilyExtract();
    const service = new TavilyGroundedSearchService(config, extract);

    const results = Array.from({ length: 8 }, (_, index) => ({
      title: `Result ${index + 1}`,
      url: `https://example.com/${index + 1}`,
      content: `Snippet ${index + 1}`,
      // Deliberately out of order relative to array position — the top 5
      // by score are 8, 7, 6, 5, 4 (scores 8..1), not results[0..4].
      score: 8 - index,
    }));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results }),
    }) as jest.Mock;

    await service.search(request);

    expect(extract.extract).toHaveBeenCalledWith([
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
      'https://example.com/4',
      'https://example.com/5',
    ]);
  });

  it('leaves a snippet untouched when extraction fails for its url instead of dropping the evidence', async () => {
    const config = {
      get: jest.fn().mockReturnValue('tvly-test'),
    } as unknown as ConfigService;
    const extract = tavilyExtract({
      'https://example.com/walk': {
        status: 'failed',
        error: 'tavily_extract_error_500',
      },
    });
    const service = new TavilyGroundedSearchService(config, extract);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'San Telmo walking tour',
            url: 'https://example.com/walk',
            content: 'A historic walk through San Telmo.',
            score: 0.9,
          },
        ],
      }),
    }) as jest.Mock;

    const result = await service.search(request);

    expect(result.evidence).toEqual([
      expect.objectContaining({
        key: 'ev-1',
        snippet: 'A historic walk through San Telmo.',
      }),
    ]);
    expect(result.evidenceProvenance ?? []).toEqual([]);
  });

  it('caps extracted content length so one very long article cannot blow up the extractor prompt', async () => {
    const config = {
      get: jest.fn().mockReturnValue('tvly-test'),
    } as unknown as ConfigService;
    const longContent = 'x'.repeat(20000);
    const extract = tavilyExtract({
      'https://example.com/walk': { status: 'success', content: longContent },
    });
    const service = new TavilyGroundedSearchService(config, extract);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'San Telmo walking tour',
            url: 'https://example.com/walk',
            content: 'A historic walk through San Telmo.',
            score: 0.9,
          },
        ],
      }),
    }) as jest.Mock;

    const result = await service.search(request);

    expect(result.evidence[0].snippet.length).toBeLessThan(longContent.length);
    expect(result.evidence[0].snippet.length).toBeLessThanOrEqual(6000);
  });

  describe('walk/route_like query phrasing', () => {
    // Verified live against the real Tavily API: the planner's flat keyword
    // join ("{destination} history culture walk") returns commercial
    // tour-booking listings, not the itemized city guides that actually name
    // a route's stops; "N caminatas icónicas en {destino}" (Spanish) or "N
    // iconic walking routes in {destino}" (elsewhere) returns real enumerated
    // walk articles instead. Also verified live: without "icónicas", plain
    // "caminatas en {destino}" reads as senderismo/trekking in Spanish, not
    // urban walking routes — that qualifier is doing real disambiguating
    // work, not just adding words.
    function expectQuery(
      req: ExperienceGroundedSearchRequest,
      expected: string,
    ) {
      return async () => {
        const config = {
          get: jest.fn().mockReturnValue('tvly-test'),
        } as unknown as ConfigService;
        const service = new TavilyGroundedSearchService(
          config,
          tavilyExtract(),
        );
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ results: [] as any[] }),
        }) as jest.Mock;

        await service.search(req);

        const [, options] = (global.fetch as jest.Mock).mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.query).toBe(expected);
      };
    }

    it(
      'builds a Spanish "iconic walks" phrase for a Spanish-speaking destination when walk is requested',
      expectQuery(
        { ...request, requestedIntents: ['walk'] },
        '10 caminatas icónicas en Gualeguaychú',
      ),
    );

    it(
      'builds the same Spanish phrase for route_like too, not just walk',
      expectQuery(
        { ...request, requestedIntents: ['route_like'] },
        '10 caminatas icónicas en Gualeguaychú',
      ),
    );

    it(
      'builds an English "iconic walking routes" phrase for a non-Spanish-speaking destination',
      expectQuery(
        {
          ...request,
          destinationCountry: 'France',
          requestedIntents: ['walk'],
        },
        '10 iconic walking routes in Gualeguaychú',
      ),
    );

    it(
      'builds the English phrase when destinationCountry is unknown',
      expectQuery(
        {
          ...request,
          destinationCountry: undefined,
          requestedIntents: ['walk'],
        },
        '10 iconic walking routes in Gualeguaychú',
      ),
    );

    it(
      "ignores the walk phrasing and trusts the planner's query when neither walk nor route_like is requested",
      expectQuery(
        { ...request, requestedIntents: ['visit', 'food'] },
        request.query,
      ),
    );

    it(
      'ignores the walk phrasing when requestedIntents is absent (unaffected default)',
      expectQuery(request, request.query),
    );
  });
});
