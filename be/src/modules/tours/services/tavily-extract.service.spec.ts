import { TavilyExtractService } from './tavily-extract.service';

describe('TavilyExtractService', () => {
  let config: { get: jest.Mock };
  let aiCache: {
    getCachedResponse: jest.Mock;
    cacheResponse: jest.Mock;
  };
  let service: TavilyExtractService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    config = {
      get: jest.fn((key: string) =>
        key === 'ai.tavilyApiKey' ? 'test-key' : undefined,
      ),
    };
    aiCache = {
      getCachedResponse: jest.fn().mockResolvedValue(null),
      cacheResponse: jest.fn().mockResolvedValue(undefined),
    };
    service = new TavilyExtractService(config as any, aiCache as any);
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  it('dedups URLs before calling the real API', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ url: 'https://a.example', raw_content: 'Content A' }],
      }),
    });

    await service.extract([
      'https://a.example',
      'https://a.example',
      'https://a.example',
    ]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.urls).toEqual(['https://a.example']);
  });

  it('caps the number of URLs sent in a single call', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const manyUrls = Array.from(
      { length: 30 },
      (_, i) => `https://example.com/${i}`,
    );

    await service.extract(manyUrls);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.urls).toHaveLength(20);
  });

  it('returns a cached result without calling the real API', async () => {
    aiCache.getCachedResponse.mockResolvedValue(
      JSON.stringify({ status: 'success', content: 'Cached content' }),
    );

    const result = await service.extract(['https://cached.example']);

    expect(result.get('https://cached.example')).toEqual({
      status: 'success',
      content: 'Cached content',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps successful and failed results and caches only the successes', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { url: 'https://ok.example', raw_content: 'Real page content' },
        ],
        failed_results: [{ url: 'https://bad.example', error: 'timeout' }],
      }),
    });

    const result = await service.extract([
      'https://ok.example',
      'https://bad.example',
    ]);

    expect(result.get('https://ok.example')).toEqual({
      status: 'success',
      content: 'Real page content',
    });
    expect(result.get('https://bad.example')).toEqual({
      status: 'failed',
      error: 'timeout',
    });
    expect(aiCache.cacheResponse).toHaveBeenCalledTimes(1);
    expect(aiCache.cacheResponse).toHaveBeenCalledWith(
      'extract:https://ok.example',
      JSON.stringify({ status: 'success', content: 'Real page content' }),
    );
  });

  it('marks a URL Tavily never mentioned as an explicit failure, never silently dropped', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [] as unknown[],
        failed_results: [] as unknown[],
      }),
    });

    const result = await service.extract(['https://unmentioned.example']);

    expect(result.get('https://unmentioned.example')).toEqual({
      status: 'failed',
      error: 'tavily_extract_no_response',
    });
  });

  it('marks every URL as explicitly failed on a non-ok HTTP response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    });

    const result = await service.extract(['https://a.example']);

    expect(result.get('https://a.example')).toEqual({
      status: 'failed',
      error: 'tavily_extract_rate_limited',
    });
  });

  it('marks every URL as explicitly failed on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await service.extract(['https://a.example']);

    expect(result.get('https://a.example')).toEqual({
      status: 'failed',
      error: 'network down',
    });
  });

  it('returns explicit failures without calling the API when no key is configured', async () => {
    config.get.mockReturnValue(undefined);
    const noKeyService = new TavilyExtractService(
      config as any,
      aiCache as any,
    );

    const result = await noKeyService.extract(['https://a.example']);

    expect(result.get('https://a.example')).toEqual({
      status: 'failed',
      error: 'missing_tavily_api_key',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an empty map for an empty URL list without calling anything', async () => {
    const result = await service.extract([]);

    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(aiCache.getCachedResponse).not.toHaveBeenCalled();
  });

  describe('retrieve()', () => {
    it('returns typed WebSourceContentResult with truncated items when content exceeds maxContentChars', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              url: 'https://example.com/walk',
              raw_content: 'A'.repeat(100),
            },
          ],
        }),
      });

      const res = await service.retrieve({
        urls: ['https://example.com/walk'],
        maxContentChars: 50,
      });

      expect(res.provider).toBe('tavily');
      expect(res.requestedCount).toBe(1);
      expect(res.retrievedCount).toBe(1);
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({
        requestedUrl: 'https://example.com/walk',
        status: 'retrieved',
        contentType: 'markdown',
        contentChars: 100,
        truncated: true,
        content: 'A'.repeat(50),
      });
    });

    it('returns typed missing_credentials failure when API key is missing', async () => {
      config.get.mockReturnValue(undefined);
      const noKeyService = new TavilyExtractService(
        config as any,
        aiCache as any,
      );

      const res = await noKeyService.retrieve({
        urls: ['https://example.com/walk'],
      });

      expect(res.items[0]).toMatchObject({
        status: 'failed',
        failureReason: 'missing_credentials',
      });
    });
  });
});
