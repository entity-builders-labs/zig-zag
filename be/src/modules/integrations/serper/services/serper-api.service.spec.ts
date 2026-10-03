import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SerperApiService } from './serper-api.service';
import { SerperApiError } from '../interfaces/serper.interface';

describe('SerperApiService', () => {
  let env: Record<string, string | undefined>;
  let service: SerperApiService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    env = { SERPER_API_KEY: 'test-serper-key' };
    const config = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    service = new SerperApiService(config);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    jest.restoreAllMocks();
  });

  function mockResponse(status: number, body: unknown) {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        typeof body === 'string' ? body : JSON.stringify(body),
    } as Response);
  }

  function lastCall(): { url: string; init: RequestInit } {
    const [url, init] = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    return { url: url as string, init: init as RequestInit };
  }

  it('reports configuration from SERPER_API_KEY only', () => {
    expect(service.isConfigured()).toBe(true);
    env.SERPER_API_KEY = undefined;
    expect(service.isConfigured()).toBe(false);
  });

  it('throws missing_api_key without making any HTTP request', async () => {
    env.SERPER_API_KEY = undefined;
    fetchSpy = jest.spyOn(global, 'fetch');

    await expect(service.search({ q: 'x' })).rejects.toMatchObject({
      code: 'missing_api_key',
      endpoint: 'search',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs /search with the key in X-API-KEY (never in the URL) and a JSON body', async () => {
    mockResponse(200, {
      organic: [{ title: 't', link: 'https://a.example', snippet: 's' }],
      credits: 1,
    });

    const result = await service.search({
      q: 'San Telmo walk',
      gl: 'ar',
      hl: undefined,
      num: 10,
    });

    const { url, init } = lastCall();
    expect(url).toBe('https://google.serper.dev/search');
    expect(url).not.toContain('test-serper-key');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'X-API-KEY': 'test-serper-key',
      'Content-Type': 'application/json',
    });
    // undefined params are dropped, not serialized as null
    expect(JSON.parse(init.body as string)).toEqual({
      q: 'San Telmo walk',
      gl: 'ar',
      num: 10,
    });
    expect(init.signal).toBeDefined();
    expect(result.data.organic?.[0].link).toBe('https://a.example');
    expect(result.meta).toEqual(
      expect.objectContaining({ endpoint: 'search', httpStatus: 200 }),
    );
    expect(typeof result.meta.durationMs).toBe('number');
  });

  it('POSTs /maps with the ll viewport and returns places verbatim', async () => {
    mockResponse(200, {
      ll: '@-34.6037,-58.3816,14z',
      places: [
        {
          position: 1,
          title: 'Estatua de Mafalda',
          latitude: -34.6158,
          longitude: -58.3716,
          type: 'Sculpture',
          placeId: 'ChIJeRQn1k01o5UR5o5Yb5aJJ5Y',
          cid: '10819767908987080422',
        },
      ],
    });

    const result = await service.searchMaps({
      q: 'Mafalda Statue',
      ll: '@-34.6037,-58.3816,14z',
    });

    const { url, init } = lastCall();
    expect(url).toBe('https://google.serper.dev/maps');
    expect(JSON.parse(init.body as string)).toEqual({
      q: 'Mafalda Statue',
      ll: '@-34.6037,-58.3816,14z',
    });
    expect(result.data.places?.[0]).toEqual(
      expect.objectContaining({
        placeId: 'ChIJeRQn1k01o5UR5o5Yb5aJJ5Y',
        cid: '10819767908987080422',
      }),
    );
    expect(result.meta.endpoint).toBe('maps');
  });

  it('POSTs /places with location context', async () => {
    mockResponse(200, { places: [{ position: 1, title: 'Plaza Dorrego' }] });

    const result = await service.searchPlaces({
      q: 'Plaza Dorrego',
      location: 'Buenos Aires, Argentina',
    });

    const { url, init } = lastCall();
    expect(url).toBe('https://google.serper.dev/places');
    expect(JSON.parse(init.body as string)).toEqual({
      q: 'Plaza Dorrego',
      location: 'Buenos Aires, Argentina',
    });
    expect(result.data.places).toHaveLength(1);
    expect(result.meta.endpoint).toBe('places');
  });

  it('honors SERPER_API_URL (trailing slash tolerated)', async () => {
    env.SERPER_API_URL = 'http://localhost:9999/';
    mockResponse(200, { organic: [] });

    await service.search({ q: 'x' });

    expect(lastCall().url).toBe('http://localhost:9999/search');
  });

  it.each([400, 401, 403, 429, 500, 503])(
    'maps HTTP %i to an http_error carrying status and a truncated body',
    async (status) => {
      mockResponse(status, 'x'.repeat(2000));

      const error = await service
        .search({ q: 'x' })
        .catch((e: unknown) => e as SerperApiError);

      expect(error).toBeInstanceOf(SerperApiError);
      expect(error).toMatchObject({
        code: 'http_error',
        endpoint: 'search',
        httpStatus: status,
      });
      expect((error as SerperApiError).responseBody).toHaveLength(500);
    },
  );

  it('maps an aborted request (timeout) to code=timeout', async () => {
    const abort = new Error('The operation was aborted due to timeout');
    abort.name = 'TimeoutError';
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(abort);

    await expect(service.searchMaps({ q: 'x' })).rejects.toMatchObject({
      code: 'timeout',
      endpoint: 'maps',
    });
  });

  it('passes a timeout signal honoring SERPER_TIMEOUT_MS', async () => {
    env.SERPER_TIMEOUT_MS = '1234';
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    mockResponse(200, { organic: [] });

    await service.search({ q: 'x' });

    expect(timeoutSpy).toHaveBeenCalledWith(1234);
    timeoutSpy.mockRestore();
  });

  it('maps a network failure to code=network_error', async () => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));

    await expect(service.searchPlaces({ q: 'x' })).rejects.toMatchObject({
      code: 'network_error',
      endpoint: 'places',
    });
  });

  it('maps a non-JSON 200 body to code=invalid_response', async () => {
    mockResponse(200, '<html>not json</html>');

    await expect(service.search({ q: 'x' })).rejects.toMatchObject({
      code: 'invalid_response',
      httpStatus: 200,
    });
  });
});
