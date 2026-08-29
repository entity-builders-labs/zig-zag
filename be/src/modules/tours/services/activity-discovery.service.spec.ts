import { Test, TestingModule } from '@nestjs/testing';
import { ActivityDiscoveryService } from './activity-discovery.service';
import {
  DISCOVERY_PROVIDER,
  GROUNDED_SEARCH_PROVIDER,
  SearchGroundedDiscoveryProvider,
  GroundedSearchProvider,
  GroundedSearchRequest,
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
      expect.objectContaining({ destinationName: 'Salta', query: '' }),
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

  describe('per-missing-kind semantic search orchestration', () => {
    it('issues one semantic search call per missing kind derived from deficits, not a combined general call', async () => {
      mockSearchProvider.search.mockImplementation(
        async (request: GroundedSearchRequest) => ({
          provider: 'serpapi',
          model: 'google-ai-mode',
          groundingStatus: 'applied' as const,
          evidence: [
            {
              key: 'ev-1',
              source: 'web',
              snippet: `evidence for ${request.targetKind}`,
            },
          ],
        }),
      );

      await service.discoverGaps(
        'Buenos Aires',
        'Argentina',
        ['history'],
        [
          {
            reason: 'missing_requested_experience_format',
            severity: 'blocking',
            message: 'Falta neighborhood_walks',
            experienceFormat: 'neighborhood_walks',
          },
          {
            reason: 'missing_requested_experience_format',
            severity: 'blocking',
            message: 'Falta thematic_routes',
            experienceFormat: 'thematic_routes',
          },
        ],
        ['neighborhood_walks', 'thematic_routes'],
      );

      expect(mockSearchProvider.search).toHaveBeenCalledTimes(2);
      const calls = mockSearchProvider.search.mock.calls.map((c) => c[0]);
      expect(calls.map((c) => c.targetKind).sort()).toEqual(
        ['NEIGHBORHOOD_WALK', 'ROUTE'].sort(),
      );
      // Each call gets its own kind-specific query, built by
      // SemanticDiscoveryQueryBuilder — never a combined/blended one.
      for (const call of calls) {
        expect(call.query.length).toBeGreaterThan(0);
      }
      expect(new Set(calls.map((c) => c.query)).size).toBe(2);
    });

    it('falls back to a single general call when no missing kind is derivable (pure theme gap)', async () => {
      await service.discoverGaps(
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

      expect(mockSearchProvider.search).toHaveBeenCalledTimes(1);
      const call = mockSearchProvider.search.mock.calls[0][0];
      expect(call.query).toBe('');
      expect(call.targetKind).toBeUndefined();
    });

    it('falls back to a single general call when a format deficit has no experienceFormat set (malformed input safety net)', async () => {
      await service.discoverGaps(
        'Buenos Aires',
        'Argentina',
        ['history'],
        [
          {
            reason: 'missing_requested_experience_format',
            severity: 'blocking',
            message: 'Falta un formato',
          },
        ],
      );

      expect(mockSearchProvider.search).toHaveBeenCalledTimes(1);
      expect(mockSearchProvider.search.mock.calls[0][0].query).toBe('');
    });

    it('forwards explorationStyle and additionalPreferences into the built query', async () => {
      mockSearchProvider.search.mockResolvedValue(appliedResult);

      await service.discoverGaps(
        'Mendoza',
        'Argentina',
        ['wine'],
        [
          {
            reason: 'missing_requested_experience_format',
            severity: 'blocking',
            message: 'Falta experiences',
            experienceFormat: 'experiences',
          },
        ],
        ['experiences'],
        'local_deep_dive',
        'vegetarian preferred',
      );

      const call = mockSearchProvider.search.mock.calls[0][0];
      expect(call.query).toContain(
        'Prioritize locally distinctive and neighborhood-level experiences',
      );
      expect(call.query).toContain('vegetarian preferred');
    });

    it('merges evidence from multiple search calls before the single extraction call', async () => {
      mockSearchProvider.search
        .mockResolvedValueOnce({
          provider: 'serpapi',
          model: 'google-ai-mode',
          groundingStatus: 'applied',
          evidence: [{ key: 'ev-1', source: 'a', snippet: 'walk evidence' }],
        })
        .mockResolvedValueOnce({
          provider: 'serpapi',
          model: 'google-ai-mode',
          groundingStatus: 'applied',
          evidence: [
            { key: 'ev-1', source: 'b', snippet: 'experience evidence' },
          ],
        });

      await service.discoverGaps(
        'Buenos Aires',
        'Argentina',
        ['culture'],
        [
          {
            reason: 'missing_requested_experience_format',
            severity: 'blocking',
            message: 'Falta neighborhood_walks',
            experienceFormat: 'neighborhood_walks',
          },
          {
            reason: 'missing_requested_experience_format',
            severity: 'blocking',
            message: 'Falta experiences',
            experienceFormat: 'experiences',
          },
        ],
        ['neighborhood_walks', 'experiences'],
      );

      expect(mockProvider.discover).toHaveBeenCalledTimes(1);
      const [, mergedResult] = mockProvider.discover.mock.calls[0];
      expect(mergedResult?.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ snippet: 'walk evidence' }),
          expect.objectContaining({ snippet: 'experience evidence' }),
        ]),
      );
      expect(mergedResult?.groundingStatus).toBe('applied');
    });

    it('runs ROUTE evidence extraction only when a ROUTE plan ran, folding hints in as extra evidence', async () => {
      mockSearchProvider.search.mockResolvedValue({
        provider: 'serpapi',
        model: 'google-ai-mode',
        groundingStatus: 'applied',
        evidence: [
          {
            key: 'ev-1',
            source: 'web',
            snippet: 'Calle Caseros flanks the colonial civic power center.',
          },
        ],
        textBlocks: [
          {
            text: 'Calle Caseros flanks the colonial civic power center.',
            evidenceKeys: ['ev-1'],
          },
        ],
      });

      await service.discoverGaps(
        'Córdoba',
        'Argentina',
        ['history'],
        [
          {
            reason: 'missing_requested_experience_format',
            severity: 'blocking',
            message: 'Falta thematic_routes',
            experienceFormat: 'thematic_routes',
          },
        ],
        ['thematic_routes'],
      );

      const [, mergedResult] = mockProvider.discover.mock.calls[0];
      expect(mergedResult?.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'route_evidence_extraction',
            snippet: expect.stringContaining('Calle Caseros'),
          }),
        ]),
      );
    });
  });
});
