import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GroqGroundedSearchService } from './groq-grounded-search.service';

describe('GroqGroundedSearchService', () => {
  let service: GroqGroundedSearchService;
  let configService: { get: jest.Mock };
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    configService = { get: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroqGroundedSearchService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    service = module.get(GroqGroundedSearchService);
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
  });

  function mockFetchOk(content: string) {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    } as any);
  }

  it('reports unavailable when no Groq API key is configured', async () => {
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

  it('translates requestedExperienceFormats into real phrases, never the raw enum slug', async () => {
    configService.get.mockReturnValue('test-key');
    mockFetchOk('No evidence found.');

    await service.search({
      destinationName: 'La Rioja',
      destinationCountry: 'Argentina',
      requestedThemes: ['history'],
      requestedExperienceFormats: ['neighborhood_walks'],
      query: 'unused by this provider',
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const userMessage = body.messages.find(
      (m: any) => m.role === 'user',
    ).content;
    expect(userMessage).toContain('walking tour');
    expect(userMessage).not.toContain('neighborhood_walks');
  });

  it('executes browser search and normalizes evidence', async () => {
    configService.get.mockReturnValue('test-key');
    mockFetchOk(
      'San Telmo is a historic barrio.【1†L1-L2】La Boca has Caminito.【2†L3-L4】',
    );

    const result = await service.search({
      destinationName: 'Buenos Aires',
      requestedThemes: ['culture'],
      query: 'Buenos Aires culture',
    });

    expect(fetchSpy).toHaveBeenCalled();
    expect(result.groundingStatus).toBe('applied');
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0].key).toMatch(/^ev-/);
  });

  it('extracts evidence even when no citation markers are present', async () => {
    configService.get.mockReturnValue('test-key');
    mockFetchOk('Buenos Aires has many museums and landmarks worth visiting.');

    const result = await service.search({
      destinationName: 'Buenos Aires',
      requestedThemes: ['culture'],
      query: 'Buenos Aires',
    });

    expect(result.groundingStatus).toBe('applied');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].key).toBe('ev-1');
  });

  it('reports failed when the API returns an error', async () => {
    configService.get.mockReturnValue('test-key');
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error',
    } as any);

    const result = await service.search({
      destinationName: 'Buenos Aires',
      requestedThemes: ['culture'],
      query: 'Buenos Aires',
    });

    expect(result.groundingStatus).toBe('failed');
    expect(result.evidence).toEqual([]);
  });

  it('reports no_usable_evidence when content is empty', async () => {
    configService.get.mockReturnValue('test-key');
    mockFetchOk('   ');

    const result = await service.search({
      destinationName: 'Buenos Aires',
      requestedThemes: ['culture'],
      query: 'Buenos Aires',
    });

    expect(result.groundingStatus).toBe('no_usable_evidence');
  });
});
