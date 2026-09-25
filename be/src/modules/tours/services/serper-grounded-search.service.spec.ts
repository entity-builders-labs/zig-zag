import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiCacheService } from '@shared/ai/services/ai-cache.service';
import { SerperApiService } from '@integrations/serper/services/serper-api.service';
import { SerperGroundedSearchService } from './serper-grounded-search.service';

describe('SerperGroundedSearchService', () => {
  let env: Record<string, string | undefined>;
  let aiCache: { getCachedResponse: jest.Mock; cacheResponse: jest.Mock };
  let service: SerperGroundedSearchService;
  let fetchSpy: jest.SpyInstance | undefined;

  const request = {
    destinationName: 'San Telmo, Buenos Aires, Argentina',
    requestedThemes: ['history'],
    query: 'caminata histórica por San Telmo',
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    env = { SERPER_API_KEY: 'test-serper-key' };
    aiCache = {
      getCachedResponse: jest.fn().mockResolvedValue(null),
      cacheResponse: jest.fn().mockResolvedValue(undefined),
    };
    const client = new SerperApiService({
      get: (key: string) => env[key],
    } as unknown as ConfigService);
    service = new SerperGroundedSearchService(
      client,
      aiCache as unknown as AiCacheService,
    );
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    jest.restoreAllMocks();
  });

  function mockSerper(status: number, body: unknown) {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        typeof body === 'string' ? body : JSON.stringify(body),
    } as Response);
  }

  function sentBody(): Record<string, unknown> {
    const [, init] = fetchSpy!.mock.calls[0];
    return JSON.parse((init as RequestInit).body as string);
  }

  it('normalizes organic results into organic_result evidence with serper / google-search provenance', async () => {
    mockSerper(200, {
      searchParameters: { q: request.query, type: 'search', num: 10 },
      organic: [
        {
          title: 'San Telmo Walking Tour',
          link: 'https://example.com/san-telmo',
          snippet: 'Walk Defensa street from Plaza de Mayo to Parque Lezama.',
          position: 1,
        },
        {
          title: 'Casa Mínima',
          link: 'https://example.com/casa-minima',
          snippet: 'The narrowest house in Buenos Aires.',
          position: 2,
        },
      ],
      credits: 1,
    });

    const result = await service.search(request);

    expect(result.provider).toBe('serper');
    expect(result.model).toBe('google-search');
    expect(result.groundingStatus).toBe('applied');
    expect(result.evidence).toEqual([
      {
        key: 'ev-1',
        source: 'San Telmo Walking Tour',
        title: 'San Telmo Walking Tour',
        url: 'https://example.com/san-telmo',
        snippet: 'Walk Defensa street from Plaza de Mayo to Parque Lezama.',
        kind: 'organic_result',
        order: 1,
      },
      {
        key: 'ev-2',
        source: 'Casa Mínima',
        title: 'Casa Mínima',
        url: 'https://example.com/casa-minima',
        snippet: 'The narrowest house in Buenos Aires.',
        kind: 'organic_result',
        order: 2,
      },
    ]);
    expect(result.normalizationAudit).toEqual({
      mode: 'structured',
      rawItemCount: 2,
      emittedEvidenceCount: 2,
      decisions: [
        expect.objectContaining({
          sourceLocator: 'organic[0]',
          sourceKind: 'organic_result',
          action: 'EMITTED_EVIDENCE',
          evidenceKey: 'ev-1',
          reason: 'ORGANIC_RESULT_EMITTED',
        }),
        expect.objectContaining({
          sourceLocator: 'organic[1]',
          evidenceKey: 'ev-2',
          reason: 'ORGANIC_RESULT_EMITTED',
        }),
      ],
    });
  });

  it('never claims google_ai_mode, whatever the query shape', async () => {
    mockSerper(200, {
      organic: [{ title: 't', link: 'https://a.example', snippet: 's' }],
    });

    const semantic = await service.search(request);
    const general = await service.search({ ...request, query: '' });

    for (const result of [semantic, general]) {
      expect(result.model).toBe('google-search');
      expect(result.model).not.toMatch(/ai[-_ ]?mode/i);
    }
  });

  it('sends only q and num by default (no hl/location invented, key only in the header)', async () => {
    mockSerper(200, { organic: [] });

    await service.search(request);

    const [url, init] = fetchSpy!.mock.calls[0];
    expect(url).toBe('https://google.serper.dev/search');
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({ 'X-API-KEY': 'test-serper-key' }),
    );
    expect(sentBody()).toEqual({ q: request.query, num: 10 });
  });

  it('derives gl only from an ISO alpha-2 destinationCountry fact', async () => {
    mockSerper(200, { organic: [] });
    await service.search({ ...request, destinationCountry: 'AR' });
    expect(sentBody()).toEqual({ q: request.query, gl: 'ar', num: 10 });

    fetchSpy!.mockClear();
    await service.search({ ...request, destinationCountry: 'Argentina' });
    expect(sentBody()).toEqual({ q: request.query, num: 10 });
  });

  it('falls back to the general destination+themes query when request.query is empty', async () => {
    mockSerper(200, { organic: [] });

    await service.search({ ...request, query: '   ' });

    expect(sentBody().q).toBe(
      'San Telmo, Buenos Aires, Argentina history real tourism experiences',
    );
  });

  it('reports no_usable_evidence for a successful response without organic snippets', async () => {
    mockSerper(200, {
      organic: [],
      peopleAlsoAsk: [{ question: 'Is San Telmo safe?', snippet: 'Yes.' }],
      knowledgeGraph: { title: 'San Telmo', description: 'Barrio.' },
    });

    const result = await service.search(request);

    // Non-organic SERP sections never become evidence.
    expect(result.groundingStatus).toBe('no_usable_evidence');
    expect(result.evidence).toEqual([]);
    expect(aiCache.cacheResponse).not.toHaveBeenCalled();
  });

  it('skips empty snippets and duplicate url+snippet pairs, recording why', async () => {
    mockSerper(200, {
      organic: [
        { title: 'No snippet', link: 'https://a.example' },
        { title: 'Blank', link: 'https://b.example', snippet: '   ' },
        { title: 'Real', link: 'https://c.example', snippet: 'Real  content.' },
        { title: 'Dup', link: 'https://C.example', snippet: 'real content.' },
        {
          title: 'Same text, other url',
          link: 'https://d.example',
          snippet: 'Real content.',
        },
      ],
    });

    const result = await service.search(request);

    expect(result.evidence.map((e) => [e.key, e.url, e.order])).toEqual([
      ['ev-1', 'https://c.example', 1],
      ['ev-2', 'https://d.example', 2],
    ]);
    expect(
      result.normalizationAudit!.decisions.map((d) => [
        d.sourceLocator,
        d.action,
        d.reason,
      ]),
    ).toEqual([
      ['organic[0]', 'SKIPPED', 'EMPTY_SNIPPET'],
      ['organic[1]', 'SKIPPED', 'EMPTY_SNIPPET'],
      ['organic[2]', 'EMITTED_EVIDENCE', 'ORGANIC_RESULT_EMITTED'],
      ['organic[3]', 'SKIPPED', 'DUPLICATE_EVIDENCE'],
      ['organic[4]', 'EMITTED_EVIDENCE', 'ORGANIC_RESULT_EMITTED'],
    ]);
    expect(result.normalizationAudit).toEqual(
      expect.objectContaining({ rawItemCount: 5, emittedEvidenceCount: 2 }),
    );
  });

  it('reports unavailable without any HTTP call when SERPER_API_KEY is missing', async () => {
    env.SERPER_API_KEY = undefined;
    fetchSpy = jest.spyOn(global, 'fetch');

    const result = await service.search(request);

    expect(result).toEqual({
      provider: 'serper',
      model: 'google-search',
      groundingStatus: 'unavailable',
      evidence: [],
      failureReason: 'missing_serper_key',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'serper_error_403'],
    [429, 'serper_error_429'],
    [500, 'serper_error_500'],
    [503, 'serper_error_503'],
  ])('reports failed on HTTP %i', async (status, reason) => {
    mockSerper(status, '{"message":"Unauthorized.","statusCode":403}');

    const result = await service.search(request);

    expect(result).toEqual(
      expect.objectContaining({
        provider: 'serper',
        model: 'google-search',
        groundingStatus: 'failed',
        evidence: [],
        failureReason: reason,
      }),
    );
    expect(aiCache.cacheResponse).not.toHaveBeenCalled();
  });

  it('reports failed on timeout', async () => {
    const abort = new Error('aborted');
    abort.name = 'TimeoutError';
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(abort);

    const result = await service.search(request);

    expect(result.groundingStatus).toBe('failed');
    expect(result.failureReason).toBe('serper_timeout');
  });

  it('reports failed on a network error', async () => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));

    const result = await service.search(request);

    expect(result.groundingStatus).toBe('failed');
    expect(result.failureReason).toBe('serper_network_error');
  });

  it('writes applied results to a Serper-only cache namespace keyed on what was sent', async () => {
    mockSerper(200, {
      organic: [{ title: 't', link: 'https://a.example', snippet: 's' }],
    });

    const result = await service.search({
      ...request,
      destinationCountry: 'ar',
    });

    expect(aiCache.cacheResponse).toHaveBeenCalledTimes(1);
    const [key, payload, options] = aiCache.cacheResponse.mock.calls[0];
    expect(key.startsWith('serper-grounded-search:v1:')).toBe(true);
    expect(JSON.parse(key.slice('serper-grounded-search:v1:'.length))).toEqual({
      destinationName: request.destinationName,
      q: request.query,
      gl: 'ar',
      hl: null,
      location: null,
      num: 10,
    });
    expect(options).toEqual({ type: 'grounded-search', provider: 'serper' });
    expect(JSON.parse(payload)).toEqual(result);
    // Same key is used for the lookup.
    expect(aiCache.getCachedResponse).toHaveBeenCalledWith(key, options);
  });

  it('serves a cached applied Serper result without calling Serper', async () => {
    fetchSpy = jest.spyOn(global, 'fetch');
    aiCache.getCachedResponse.mockResolvedValue(
      JSON.stringify({
        provider: 'serper',
        model: 'google-search',
        groundingStatus: 'applied',
        evidence: [{ key: 'ev-1', source: 's', snippet: 'cached' }],
      }),
    );

    const result = await service.search(request);

    expect(result.evidence[0].snippet).toBe('cached');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(aiCache.cacheResponse).not.toHaveBeenCalled();
  });

  it('never serves a cache entry produced by another provider', async () => {
    aiCache.getCachedResponse.mockResolvedValue(
      JSON.stringify({
        provider: 'serpapi',
        model: 'google-ai-mode',
        groundingStatus: 'applied',
        evidence: [{ key: 'ev-1', source: 's', snippet: 'serpapi text' }],
      }),
    );
    mockSerper(200, {
      organic: [{ title: 't', link: 'https://a.example', snippet: 'fresh' }],
    });

    const result = await service.search(request);

    expect(result.provider).toBe('serper');
    expect(result.evidence[0].snippet).toBe('fresh');
  });

  it('only ever contacts google.serper.dev (0 SerpApi requests)', async () => {
    mockSerper(200, {
      organic: [{ title: 't', link: 'https://a.example', snippet: 's' }],
    });
    await service.search(request);
    await service.search({ ...request, query: '' });

    const hosts = fetchSpy!.mock.calls.map(
      ([url]) => new URL(url as string).hostname,
    );
    expect(hosts).toEqual(['google.serper.dev', 'google.serper.dev']);
  });
});
