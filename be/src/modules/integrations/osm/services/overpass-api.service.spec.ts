import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { OverpassApiService } from './overpass-api.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('OverpassApiService', () => {
  let service: OverpassApiService;

  const buildConfigService = (overrides: Record<string, string> = {}) => ({
    get: jest.fn((key: string) => overrides[key]),
  });

  const setup = async (
    configOverrides: Record<string, string> = {},
  ): Promise<OverpassApiService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverpassApiService,
        {
          provide: ConfigService,
          useValue: buildConfigService(configOverrides),
        },
      ],
    }).compile();
    return module.get(OverpassApiService);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POSTs the built query as form-encoded data to the configured Overpass URL', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { elements: [{ type: 'way', id: 1 }] },
    });
    service = await setup({ OVERPASS_API_URL: 'https://custom-overpass/api' });

    const result = await service.queryStreets({
      latitude: -34.6,
      longitude: -58.4,
      radiusMeters: 2000,
    });

    expect(result).toEqual([{ type: 'way', id: 1 }]);
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://custom-overpass/api');
    expect(body).toContain('highway');
    expect(config?.headers?.['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    // Overpass's public instance 406s a generic/bot-looking User-Agent
    // (axios's own default) — every request must self-identify.
    expect(config?.headers?.['User-Agent']).toBeTruthy();
  });

  it('falls back to the public overpass-api.de endpoint when unconfigured', async () => {
    mockedAxios.post.mockResolvedValue({ data: { elements: [] } });
    service = await setup();

    await service.queryContainingBoundary({ latitude: 0, longitude: 0 });

    const [url] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://overpass-api.de/api/interpreter');
  });

  it('queryFeaturesNear POSTs a bounded union query built from structured selectors', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { elements: [{ type: 'node', id: 7 }] },
    });
    service = await setup();

    const result = await service.queryFeaturesNear({
      latitude: -34.6,
      longitude: -58.38,
      radiusMeters: 3000,
      selectors: [
        { key: 'tourism', value: 'museum', requireName: true },
        {
          key: 'leisure',
          value: 'park',
          requireName: true,
          elementTypes: ['way', 'relation'],
        },
      ],
    });

    expect(result).toEqual([{ type: 'node', id: 7 }]);
    const [, body] = mockedAxios.post.mock.calls[0];
    const decoded = decodeURIComponent(String(body).replace(/\+/g, ' '));
    expect(decoded).toContain('out tags center;');
    expect(decoded).toContain(
      'nwr["tourism"="museum"]["name"](around:3000,-34.6,-58.38);',
    );
    expect(decoded).toContain('way["leisure"="park"]["name"](around:3000');
    expect(decoded).toContain('relation["leisure"="park"]["name"](around:3000');
  });

  it('returns an empty array when the response has no elements', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} });
    service = await setup();

    const result = await service.queryStreets({
      latitude: 0,
      longitude: 0,
      radiusMeters: 1000,
    });

    expect(result).toEqual([]);
  });

  it('propagates the error when the request fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('network down'));
    service = await setup();

    await expect(
      service.queryStreets({ latitude: 0, longitude: 0, radiusMeters: 1000 }),
    ).rejects.toThrow('network down');
  });

  it('retries a 429 within budget and honors Retry-After', async () => {
    mockedAxios.post
      .mockRejectedValueOnce({
        message: 'rate limited',
        response: { status: 429, headers: { 'retry-after': '0' } },
      })
      .mockResolvedValueOnce({ data: { elements: [{ type: 'node', id: 1 }] } });
    service = await setup({
      OVERPASS_MAX_RETRIES: '1',
      OVERPASS_RETRY_BASE_MS: '1',
      OVERPASS_TOTAL_BUDGET_MS: '1000',
    });

    const result = await service.queryContainingBoundary({
      latitude: 0,
      longitude: 0,
    });

    expect(result).toEqual([{ type: 'node', id: 1 }]);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('stops retrying a 503 after the bounded retry count is exhausted', async () => {
    const error = {
      message: 'unavailable',
      response: { status: 503, headers: { 'retry-after': '0' } },
    };
    mockedAxios.post.mockRejectedValue(error);
    service = await setup({
      OVERPASS_MAX_RETRIES: '2',
      OVERPASS_RETRY_BASE_MS: '1',
      OVERPASS_TOTAL_BUDGET_MS: '1000',
    });

    await expect(
      service.queryContainingBoundary({ latitude: 0, longitude: 0 }),
    ).rejects.toBe(error);
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
  });

  it('respects OVERPASS_MAX_CONCURRENCY, not letting more than N requests run at once', async () => {
    let active = 0;
    let maxActive = 0;
    mockedAxios.post.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { data: { elements: [] } };
    });

    service = await setup({ OVERPASS_MAX_CONCURRENCY: '2' });

    await Promise.all([
      service.queryStreets({ latitude: 0, longitude: 0, radiusMeters: 1000 }),
      service.queryStreets({ latitude: 0, longitude: 0, radiusMeters: 1000 }),
      service.queryStreets({ latitude: 0, longitude: 0, radiusMeters: 1000 }),
      service.queryStreets({ latitude: 0, longitude: 0, radiusMeters: 1000 }),
    ]);

    expect(maxActive).toBe(2);
  });
});
