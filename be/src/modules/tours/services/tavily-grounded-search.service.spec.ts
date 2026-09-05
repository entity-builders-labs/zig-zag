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

  it('scopes the search to the destination country to avoid cross-country name collisions (e.g. San Juan, Argentina vs San Juan, Puerto Rico)', async () => {
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
    expect(body.country).toBe('argentina');
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

  it('omits the country param when the destination country is unknown', async () => {
    const config = {
      get: jest.fn().mockReturnValue('tvly-test'),
    } as unknown as ConfigService;
    const service = new TavilyGroundedSearchService(config);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] as any[] }),
    }) as jest.Mock;

    await service.search({ ...request, destinationCountry: undefined });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).not.toHaveProperty('country');
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
});
