import { ConfigService } from '@nestjs/config';
import { TavilyGroundedSearchService } from './tavily-grounded-search.service';
import { ExperienceGroundedSearchRequest } from '../interfaces/experience-grounding.interface';

const request: ExperienceGroundedSearchRequest = {
  destinationName: 'Gualeguaychú',
  destinationCountry: 'Argentina',
  requestedThemes: ['history', 'architecture'],
  query:
    'Find real thematic walking routes in Gualeguaychú, Argentina focused on history and architecture.',
};

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
    const service = new TavilyGroundedSearchService(config);

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
    const service = new TavilyGroundedSearchService(config);

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
    const service = new TavilyGroundedSearchService(config);
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
    const service = new TavilyGroundedSearchService(config);
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
    const service = new TavilyGroundedSearchService(config);
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
    const service = new TavilyGroundedSearchService(config);

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

  it('does NOT automatically extract or enrich URLs — Tavily search is a pure discovery transport', async () => {
    const config = {
      get: jest.fn().mockReturnValue('tvly-test'),
    } as unknown as ConfigService;
    const service = new TavilyGroundedSearchService(config);

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
        url: 'https://example.com/walk',
      }),
    ]);
    expect(result.groundingStatus).toBe('applied');
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
        const service = new TavilyGroundedSearchService(config);
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
      'folds the requested themes into the Spanish walk phrase (a history walk != a food walk)',
      expectQuery(
        { ...request, requestedIntents: ['walk'] },
        '10 caminatas históricas y arquitectónicas icónicas en Gualeguaychú',
      ),
    );

    it(
      'builds the same themed phrase for route_like too — one query, not made distinct from walk',
      expectQuery(
        { ...request, requestedIntents: ['route_like'] },
        '10 caminatas históricas y arquitectónicas icónicas en Gualeguaychú',
      ),
    );

    it(
      'folds themes into the English phrase for a non-Spanish-speaking destination',
      expectQuery(
        {
          ...request,
          destinationCountry: 'France',
          requestedIntents: ['walk'],
        },
        '10 iconic history and architecture walking routes in Gualeguaychú',
      ),
    );

    it(
      'folds themes into the English phrase when destinationCountry is unknown',
      expectQuery(
        {
          ...request,
          destinationCountry: undefined,
          requestedIntents: ['walk'],
        },
        '10 iconic history and architecture walking routes in Gualeguaychú',
      ),
    );

    it(
      'falls back to the exact legacy phrase when no themes are requested',
      expectQuery(
        { ...request, requestedThemes: [], requestedIntents: ['walk'] },
        '10 caminatas icónicas en Gualeguaychú',
      ),
    );

    it(
      'keeps an unmapped theme key in the phrase rather than dropping it',
      expectQuery(
        { ...request, requestedThemes: ['tango'], requestedIntents: ['walk'] },
        '10 caminatas tango icónicas en Gualeguaychú',
      ),
    );

    it(
      'uses at most the first two themes (a themed walk never explodes into multiple queries)',
      expectQuery(
        {
          ...request,
          requestedThemes: ['history', 'architecture', 'food', 'nature'],
          requestedIntents: ['walk'],
        },
        '10 caminatas históricas y arquitectónicas icónicas en Gualeguaychú',
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

    it(
      'folds a single anchor name into the destination phrase (Task B5)',
      expectQuery(
        {
          ...request,
          requestedThemes: [],
          requestedIntents: ['walk'],
          anchorNames: ['San Telmo'],
        },
        '10 caminatas icónicas en San Telmo, Gualeguaychú',
      ),
    );

    it(
      'folds BOTH anchor names into the destination phrase, never picking one (Task B5)',
      expectQuery(
        {
          ...request,
          requestedThemes: [],
          requestedIntents: ['walk'],
          anchorNames: ['San Telmo', 'La Boca'],
        },
        '10 caminatas icónicas en San Telmo a La Boca, Gualeguaychú',
      ),
    );

    it(
      'joins multiple anchor names with "to" (not "a") for a non-Spanish-speaking destination',
      expectQuery(
        {
          ...request,
          destinationCountry: 'France',
          requestedThemes: [],
          requestedIntents: ['route_like'],
          anchorNames: ['San Telmo', 'La Boca'],
        },
        '10 iconic walking routes in San Telmo to La Boca, Gualeguaychú',
      ),
    );

    it(
      'ignores anchorNames entirely for a non-walk/route_like request',
      expectQuery(
        { ...request, requestedIntents: ['visit'], anchorNames: ['San Telmo'] },
        request.query,
      ),
    );
  });
});
