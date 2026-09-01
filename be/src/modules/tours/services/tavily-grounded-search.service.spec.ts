import { ConfigService } from '@nestjs/config';
import { TavilyGroundedSearchService } from './tavily-grounded-search.service';
import { GroundedSearchRequest } from '../interfaces/activity-discovery.interface';

const request: GroundedSearchRequest = {
  destinationName: 'Gualeguaychú',
  destinationCountry: 'Argentina',
  requestedThemes: ['history', 'architecture'],
  requestedExperienceFormats: ['thematic_routes'],
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
