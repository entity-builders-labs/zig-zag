import { CloudflareWebSourceContentProvider } from './cloudflare-web-source-content.provider';

describe('CloudflareWebSourceContentProvider', () => {
  let config: any;
  let aiCache: {
    getCachedResponse: jest.Mock;
    cacheResponse: jest.Mock;
  };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    config = {
      webSourceContent: {
        provider: 'cloudflare',
        cloudflare: {
          accountId: 'test-account-id',
          apiToken: 'test-api-token',
          timeoutMs: 5000,
          minRequestIntervalMs: 0, // 0 for fast tests
        },
      },
    };
    aiCache = {
      getCachedResponse: jest.fn().mockResolvedValue(null),
      cacheResponse: jest.fn().mockResolvedValue(undefined),
    };
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fails with missing_credentials if accountId or apiToken is missing', async () => {
    config.webSourceContent.cloudflare.accountId = '';

    const provider = new CloudflareWebSourceContentProvider(
      config,
      aiCache as any,
    );

    const res = await provider.retrieve({
      urls: ['https://example.com/tour'],
    });

    expect(res.provider).toBe('cloudflare');
    expect(res.requestedCount).toBe(1);
    expect(res.retrievedCount).toBe(0);
    expect(res.items[0]).toMatchObject({
      requestedUrl: 'https://example.com/tour',
      status: 'failed',
      failureReason: 'missing_credentials',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns empty result for empty URL list', async () => {
    const provider = new CloudflareWebSourceContentProvider(
      config,
      aiCache as any,
    );

    const res = await provider.retrieve({ urls: [] });
    expect(res.requestedCount).toBe(0);
    expect(res.items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retrieves complete content via Cloudflare markdown endpoint and caches it, never slicing it', async () => {
    const provider = new CloudflareWebSourceContentProvider(
      config,
      aiCache as any,
    );

    const markdownBody = '# Tour Guide\n\n- Stop 1: Plaza\n- Stop 2: Museum';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: markdownBody,
      }),
    });

    const res = await provider.retrieve({
      urls: ['https://example.com/guide'],
    });

    expect(res.retrievedCount).toBe(1);
    expect(res.items[0]).toMatchObject({
      requestedUrl: 'https://example.com/guide',
      status: 'retrieved',
      contentType: 'markdown',
      contentChars: markdownBody.length,
      content: markdownBody,
    });

    // Check Cloudflare endpoint and headers
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/test-account-id/browser-rendering/markdown',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-api-token',
        },
        body: JSON.stringify({ url: 'https://example.com/guide' }),
      }),
    );

    // Verify cache call
    expect(aiCache.cacheResponse).toHaveBeenCalledWith(
      'cloudflare-browser-run:https://example.com/guide',
      JSON.stringify({ status: 'success', content: markdownBody }),
    );
  });

  it('returns cached content without calling fetch', async () => {
    const cachedContent = 'Cached markdown from previous run';
    aiCache.getCachedResponse.mockResolvedValue(
      JSON.stringify({ status: 'success', content: cachedContent }),
    );

    const provider = new CloudflareWebSourceContentProvider(
      config,
      aiCache as any,
    );

    const res = await provider.retrieve({
      urls: ['https://example.com/cached'],
    });

    expect(res.retrievedCount).toBe(1);
    expect(res.items[0]).toMatchObject({
      requestedUrl: 'https://example.com/cached',
      status: 'retrieved',
      content: cachedContent,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps HTTP 401 to missing_credentials', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized token',
    });

    const provider = new CloudflareWebSourceContentProvider(
      config,
      aiCache as any,
    );

    const res = await provider.retrieve({
      urls: ['https://example.com/secret'],
    });

    expect(res.retrievedCount).toBe(0);
    expect(res.items[0]).toMatchObject({
      status: 'failed',
      failureReason: 'missing_credentials',
    });
  });

  it('maps HTTP 429 to rate_limited', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded: 1 request per 10s',
    });

    const provider = new CloudflareWebSourceContentProvider(
      config,
      aiCache as any,
    );

    const res = await provider.retrieve({
      urls: ['https://example.com/busy'],
    });

    expect(res.retrievedCount).toBe(0);
    expect(res.items[0]).toMatchObject({
      status: 'failed',
      failureReason: 'rate_limited',
    });
  });

  it('maps HTTP 404 to http_error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    });

    const provider = new CloudflareWebSourceContentProvider(
      config,
      aiCache as any,
    );

    const res = await provider.retrieve({
      urls: ['https://example.com/missing'],
    });

    expect(res.retrievedCount).toBe(0);
    expect(res.items[0]).toMatchObject({
      status: 'failed',
      failureReason: 'http_error',
    });
  });
});
