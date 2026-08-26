import { Test, TestingModule } from '@nestjs/testing';
import { ActivityDiscoveryService } from './activity-discovery.service';
import {
  DISCOVERY_PROVIDER,
  GROUNDED_SEARCH_PROVIDER,
  SearchGroundedDiscoveryProvider,
  GroundedSearchProvider,
} from '../interfaces/activity-discovery.interface';

describe('ActivityDiscoveryService', () => {
  let service: ActivityDiscoveryService;
  let mockProvider: jest.Mocked<SearchGroundedDiscoveryProvider>;
  let mockSearchProvider: jest.Mocked<GroundedSearchProvider>;

  const appliedResult = {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    groundingStatus: 'applied' as const,
    evidence: [{ key: 'ev-1', source: 'web', snippet: 'real' }],
  };

  beforeEach(async () => {
    mockProvider = {
      discover: jest.fn().mockResolvedValue({
        proposals: [],
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        groundingStatus: 'applied',
      }),
    };
    mockSearchProvider = {
      search: jest.fn().mockResolvedValue(appliedResult),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityDiscoveryService,
        { provide: GROUNDED_SEARCH_PROVIDER, useValue: mockSearchProvider },
        { provide: DISCOVERY_PROVIDER, useValue: mockProvider },
      ],
    }).compile();

    service = module.get(ActivityDiscoveryService);
  });

  it('executes real search before extraction', async () => {
    await service.discoverGaps(
      'Buenos Aires',
      'Argentina',
      ['nature', 'tango'],
      [
        {
          reason: 'missing_requested_theme',
          severity: 'blocking',
          message: 'Falta tango',
        },
      ],
    );

    expect(mockSearchProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationName: 'Buenos Aires',
        requestedThemes: ['nature', 'tango'],
      }),
    );
    expect(mockProvider.discover).toHaveBeenCalled();
  });

  it('forwards requestedExperienceFormats to the search provider when provided (PR 7.4)', async () => {
    await service.discoverGaps(
      'Buenos Aires',
      'Argentina',
      ['history'],
      [
        {
          reason: 'missing_requested_experience_format',
          severity: 'blocking',
          message: 'Falta neighborhood_walks',
        },
      ],
      ['neighborhood_walks'],
    );

    expect(mockSearchProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedExperienceFormats: ['neighborhood_walks'],
      }),
    );
  });

  it('still works when called without requestedExperienceFormats', async () => {
    await service.discoverGaps(
      'Buenos Aires',
      'Argentina',
      ['history'],
      [
        {
          reason: 'missing_requested_theme',
          severity: 'blocking',
          message: 'Falta historia',
        },
      ],
    );

    expect(mockSearchProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({ requestedExperienceFormats: undefined }),
    );
  });

  it('does NOT run extraction when search fails', async () => {
    mockSearchProvider.search.mockResolvedValue({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      groundingStatus: 'failed',
      evidence: [],
      failureReason: 'network_error',
    });

    const result = await service.discoverGaps(
      'Buenos Aires',
      'Argentina',
      ['tango'],
      [
        {
          reason: 'missing_requested_theme',
          severity: 'blocking',
          message: 'Falta tango',
        },
      ],
    );

    expect(mockProvider.discover).not.toHaveBeenCalled();
    expect(result.groundingStatus).toBe('failed');
    expect(result.proposals).toEqual([]);
  });

  it('does NOT run extraction when search returns no usable evidence', async () => {
    mockSearchProvider.search.mockResolvedValue({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      groundingStatus: 'no_usable_evidence',
      evidence: [],
    });

    const result = await service.discoverBootstrap('Salta', 'Argentina', [
      'history',
    ]);

    expect(mockProvider.discover).not.toHaveBeenCalled();
    expect(result.groundingStatus).toBe('no_usable_evidence');
  });

  it('delegates bootstrap discovery after successful search', async () => {
    await service.discoverBootstrap('Salta', 'Argentina', [
      'history',
      'nature',
    ]);

    expect(mockSearchProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({ destinationName: 'Salta' }),
    );
    expect(mockProvider.discover).toHaveBeenCalled();
  });

  it('never touches Prisma or persists anything', () => {
    const constructorParams = Reflect.getOwnPropertyDescriptor(
      ActivityDiscoveryService.prototype,
      'constructor',
    );
    expect(constructorParams).toBeDefined();
    expect((service as any).prisma).toBeUndefined();
  });
});
