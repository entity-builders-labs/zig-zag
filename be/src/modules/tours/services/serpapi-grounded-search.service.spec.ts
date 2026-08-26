import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SerpApiGroundedSearchService } from './serpapi-grounded-search.service';

describe('SerpApiGroundedSearchService', () => {
  let service: SerpApiGroundedSearchService;
  let configService: { get: jest.Mock };
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    configService = { get: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SerpApiGroundedSearchService,
        { provide: ConfigService, useValue: configService },
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
      query: 'Buenos Aires tango',
    });

    expect(result.groundingStatus).toBe('unavailable');
    expect(result.evidence).toEqual([]);
    expect(fetchSpy).toBeUndefined();
  });

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
      query: 'Buenos Aires culture',
    });

    expect(fetchSpy).toHaveBeenCalled();
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
      query: 'Buenos Aires',
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
      query: 'Buenos Aires',
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
      query: 'Buenos Aires',
    });

    expect(result.groundingStatus).toBe('failed');
    expect(result.failureReason).toBe('serpapi_error_401');
    expect(result.evidence).toEqual([]);
  });

  it('reports failed when the request throws', async () => {
    configService.get.mockReturnValue('test-key');
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('network down'));

    const result = await service.search({
      destinationName: 'Buenos Aires',
      requestedThemes: ['culture'],
      query: 'Buenos Aires',
    });

    expect(result.groundingStatus).toBe('failed');
    expect(result.failureReason).toBe('network down');
  });
});
