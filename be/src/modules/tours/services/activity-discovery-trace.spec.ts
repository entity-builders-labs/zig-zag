import { ActivityKind } from '@prisma/client';
import { DiscoveryResponse } from '../interfaces/activity-discovery.interface';
import { ActivityDiscoveryService } from './activity-discovery.service';

describe('ActivityDiscoveryService trace provenance', () => {
  it('returns the exact semantic query and target kind used for grounded search', async () => {
    const searchProvider = {
      search: jest.fn(async (request: any) => ({
        provider: 'serpapi',
        model: 'google_ai_mode',
        groundingStatus: 'applied' as const,
        evidence: [
          {
            key: 'e1',
            source: 'example',
            snippet: `Evidence for ${request.query}`,
          },
        ],
      })),
    };
    const extractionProvider = {
      discover: jest.fn(
        async (_request: any, searchResult: any): Promise<DiscoveryResponse> => ({
          proposals: [],
          provider: 'gemini',
          model: 'gemini-flash',
          groundingStatus: 'applied',
          groundingProvider: searchResult.provider,
          groundingModel: searchResult.model,
          groundingEvidence: searchResult.evidence,
        }),
      ),
    };

    const service = new ActivityDiscoveryService(
      searchProvider as any,
      extractionProvider as any,
    );

    const result = await service.discoverGaps(
      'Puerto Madryn',
      'Argentina',
      ['nature'],
      [
        {
          reason: 'missing_requested_experience_format',
          severity: 'blocking',
          message: 'Missing experience',
          experienceFormat: 'experiences',
          expectedCount: 1,
          actualCount: 0,
        },
      ],
      ['experiences'],
      'balanced',
      'quiero ver ballenas y pingüinos',
    );

    expect(searchProvider.search).toHaveBeenCalledTimes(1);
    expect(result.searchTrace).toHaveLength(1);
    expect(result.searchTrace?.[0]).toEqual(
      expect.objectContaining({
        targetKind: ActivityKind.EXPERIENCE,
        provider: 'serpapi',
        model: 'google_ai_mode',
        groundingStatus: 'applied',
        evidenceCount: 1,
      }),
    );
    expect(result.searchTrace?.[0].query).toEqual(expect.any(String));
    expect(result.searchTrace?.[0].query.length).toBeGreaterThan(0);
    expect(result.searchTrace?.[0].query).toContain('Puerto Madryn');
  });
});
