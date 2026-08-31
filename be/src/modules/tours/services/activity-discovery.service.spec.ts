import { Test, TestingModule } from '@nestjs/testing';
import { ActivityKind } from '@prisma/client';
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
    provider: 'serpapi',
    model: 'google-ai-mode',
    groundingStatus: 'applied' as const,
    evidence: [{ key: 'ev-1', source: 'web', snippet: 'real evidence' }],
  };

  beforeEach(async () => {
    mockProvider = {
      discover: jest.fn().mockResolvedValue({
        proposals: [],
        provider: 'gemini',
        model: 'gemini-flash',
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

  it('executes real search before extraction for a pure theme gap', async () => {
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
        query: '',
      }),
    );
    expect(mockProvider.discover).toHaveBeenCalledTimes(1);
  });

  it('does NOT run generic extraction when a pure-theme grounded search fails', async () => {
    mockSearchProvider.search.mockResolvedValue({
      provider: 'serpapi',
      model: 'google-ai-mode',
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

  it('issues one search AND one extraction call per missing structural kind', async () => {
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
    mockProvider.discover.mockImplementation(async (request) => ({
      proposals: [
        {
          name: `${request.targetKind} candidate`,
          kind: request.targetKind as any,
          themes: ['history'],
          entityHints:
            request.targetKind === ActivityKind.ROUTE
              ? [
                  {
                    key: 'route-1',
                    name: 'Costanera',
                    role: 'route' as const,
                    expectedType: 'promenade',
                    required: true,
                    evidenceKeys: ['c0-ev-1'],
                  },
                ]
              : [
                  {
                    key: 'venue-1',
                    name: 'Carnaval venue',
                    role: 'venue' as const,
                    expectedType: 'venue',
                    required: true,
                    evidenceKeys: ['c1-ev-1'],
                  },
                  {
                    key: 'waypoint-1',
                    name: 'Carnaval museum',
                    role: 'waypoint' as const,
                    expectedType: 'museum',
                    required: false,
                    evidenceKeys: ['c1-ev-1'],
                  },
                ],
          suggestedDurationMinutes: 120,
          shortReason: 'grounded',
          evidenceKeys: [
            request.targetKind === ActivityKind.ROUTE ? 'c0-ev-1' : 'c1-ev-1',
          ],
        },
      ],
      provider: 'gemini',
      model: 'gemini-flash',
      groundingStatus: 'applied' as const,
    }));

    const result = await service.discoverGaps(
      'Gualeguaychú',
      'Argentina',
      ['nature', 'beach', 'architecture', 'history'],
      [
        {
          reason: 'missing_requested_experience_format',
          severity: 'blocking',
          message: 'Falta thematic_routes',
          experienceFormat: 'thematic_routes',
        },
        {
          reason: 'missing_requested_experience_format',
          severity: 'blocking',
          message: 'Falta experiences',
          experienceFormat: 'experiences',
        },
      ],
      ['thematic_routes', 'experiences'],
    );

    expect(mockSearchProvider.search).toHaveBeenCalledTimes(2);
    expect(mockProvider.discover).toHaveBeenCalledTimes(2);

    const searchKinds = mockSearchProvider.search.mock.calls
      .map((call) => call[0].targetKind)
      .sort();
    expect(searchKinds).toEqual(
      [ActivityKind.ROUTE, ActivityKind.EXPERIENCE].sort(),
    );

    const extractionRequests = mockProvider.discover.mock.calls.map(
      (call) => call[0],
    );
    expect(extractionRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetKind: ActivityKind.ROUTE,
          requestedExperienceFormats: ['thematic_routes'],
        }),
        expect.objectContaining({
          targetKind: ActivityKind.EXPERIENCE,
          requestedExperienceFormats: ['experiences'],
        }),
      ]),
    );
    expect(result.proposals.map((proposal) => proposal.kind).sort()).toEqual(
      [ActivityKind.ROUTE, ActivityKind.EXPERIENCE].sort(),
    );
    expect(result.searchTrace?.map((entry) => entry.targetKind).sort()).toEqual(
      [ActivityKind.ROUTE, ActivityKind.EXPERIENCE].sort(),
    );
  });

  it('discards wrong-kind proposals instead of letting POIs satisfy a composite gap', async () => {
    mockProvider.discover.mockResolvedValue({
      proposals: [
        {
          name: 'A museum POI',
          kind: 'POI',
          themes: ['history'],
          entityHints: [
            {
              key: 'venue-1',
              name: 'Museum',
              role: 'venue',
              expectedType: 'museum',
              required: true,
              evidenceKeys: ['c0-ev-1'],
            },
          ],
          suggestedDurationMinutes: 60,
          shortReason: 'wrong kind',
          evidenceKeys: ['c0-ev-1'],
        },
      ],
      provider: 'gemini',
      model: 'gemini-flash',
      groundingStatus: 'applied',
    });

    const result = await service.discoverGaps(
      'Gualeguaychú',
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

    expect(result.proposals).toEqual([]);
    expect(result.validationErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('mismatched kind POI')]),
    );
  });

  it('keeps successful kinds when another kind search fails', async () => {
    mockSearchProvider.search.mockImplementation(async (request) => {
      if (request.targetKind === ActivityKind.ROUTE) {
        return {
          provider: 'serpapi',
          model: 'google-ai-mode',
          groundingStatus: 'failed' as const,
          evidence: [],
          failureReason: 'route_search_failed',
        };
      }
      return appliedResult;
    });
    mockProvider.discover.mockImplementation(async (request) => ({
      proposals: [
        {
          name: 'Carnaval experience',
          kind: request.targetKind as any,
          themes: ['history'],
          entityHints: [
            {
              key: 'venue-1',
              name: 'Carnaval venue',
              role: 'venue' as const,
              expectedType: 'venue',
              required: true,
              evidenceKeys: ['c1-ev-1'],
            },
            {
              key: 'waypoint-1',
              name: 'Carnaval museum',
              role: 'waypoint' as const,
              expectedType: 'museum',
              required: false,
              evidenceKeys: ['c1-ev-1'],
            },
          ],
          suggestedDurationMinutes: 120,
          shortReason: 'grounded',
          evidenceKeys: ['c1-ev-1'],
        },
      ],
      provider: 'gemini',
      model: 'gemini-flash',
      groundingStatus: 'applied' as const,
    }));

    const result = await service.discoverGaps(
      'Gualeguaychú',
      'Argentina',
      ['history'],
      [
        {
          reason: 'missing_requested_experience_format',
          severity: 'blocking',
          message: 'Falta thematic_routes',
          experienceFormat: 'thematic_routes',
        },
        {
          reason: 'missing_requested_experience_format',
          severity: 'blocking',
          message: 'Falta experiences',
          experienceFormat: 'experiences',
        },
      ],
      ['thematic_routes', 'experiences'],
    );

    expect(mockProvider.discover).toHaveBeenCalledTimes(1);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].kind).toBe(ActivityKind.EXPERIENCE);
    expect(result.validationErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('ROUTE: grounded search failed'),
      ]),
    );
  });

  it('runs ROUTE evidence extraction before route-specific extraction', async () => {
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

    const [, searchResult] = mockProvider.discover.mock.calls[0];
    expect(searchResult?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'route_evidence_extraction',
          snippet: expect.stringContaining('Calle Caseros'),
        }),
      ]),
    );
  });

  it('never touches Prisma or persists anything', () => {
    expect((service as any).prisma).toBeUndefined();
  });
});
