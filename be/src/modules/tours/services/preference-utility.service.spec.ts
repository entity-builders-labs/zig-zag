import { composableExperience } from '../fixtures/composable-experience.fixture';
import { PreferenceUtilityService } from './preference-utility.service';
import { PreferenceSpec } from '../interfaces/preference-spec.interface';

const identity = {
  provider: 'ollama',
  model: 'nomic-embed-text',
  dimensions: 256,
  documentVersion: 2,
};

const spec = (
  semanticQuery: string,
): Pick<PreferenceSpec, 'facets' | 'assertions' | 'semanticQuery'> => ({
  facets: [],
  assertions: [],
  semanticQuery,
});

describe('PreferenceUtilityService semantic batch', () => {
  it('queries embeddings once and keeps a missing embedding UNKNOWN, never 0', async () => {
    const getSimilarityScores = jest.fn().mockResolvedValue({
      status: 'applied',
      scores: new Map([['known', 0.91]]),
      requestedCandidateCount: 2,
      indexedCandidateCount: 1,
      identity,
    });
    const service = new PreferenceUtilityService({
      getSimilarityScores,
    } as any);

    const result = await service.derive({
      experiences: [
        composableExperience({
          id: 'unknown',
          components: [],
          qualityScore: 4,
        }),
        composableExperience({ id: 'known', components: [], qualityScore: 4 }),
      ],
      preferenceSpec: spec('history walk'),
      softAnchorIds: [],
    });

    expect(getSimilarityScores).toHaveBeenCalledTimes(1);
    expect(getSimilarityScores).toHaveBeenCalledWith(
      ['known', 'unknown'],
      'history walk',
    );
    expect(result.byId.get('known')!.breakdown.semantic).toEqual({
      status: 'KNOWN',
      similarity: 0.91,
    });
    expect(result.byId.get('unknown')!.breakdown.semantic).toEqual({
      status: 'UNKNOWN',
      reason: 'NO_COMPATIBLE_EMBEDDING',
    });
    expect(result.semanticRanking).toMatchObject({
      status: 'applied',
      requestedCandidateCount: 2,
      indexedCandidateCount: 1,
    });
  });

  it('reports unavailable embeddings as UNKNOWN without failing', async () => {
    const service = new PreferenceUtilityService({
      getSimilarityScores: jest.fn().mockResolvedValue({
        status: 'unavailable',
        scores: new Map(),
        requestedCandidateCount: 1,
        indexedCandidateCount: 0,
        identity,
        reason: 'provider unavailable',
      }),
    } as any);

    const result = await service.derive({
      experiences: [composableExperience({ id: 'one', components: [] })],
      preferenceSpec: spec('history walk'),
      softAnchorIds: [],
    });

    expect(result.byId.get('one')!.breakdown.semantic).toEqual({
      status: 'UNKNOWN',
      reason: 'PROVIDER_UNAVAILABLE',
    });
    expect(result.semanticRanking).toMatchObject({
      status: 'unavailable',
      reason: 'provider unavailable',
    });
  });

  it('never queries embeddings for an empty semantic query', async () => {
    const getSimilarityScores = jest.fn();
    const service = new PreferenceUtilityService({
      getSimilarityScores,
    } as any);

    const result = await service.derive({
      experiences: [composableExperience({ id: 'one', components: [] })],
      preferenceSpec: spec('  '),
      softAnchorIds: ['one'],
    });

    expect(getSimilarityScores).not.toHaveBeenCalled();
    expect(result.byId.get('one')!.breakdown).toMatchObject({
      semantic: { status: 'UNKNOWN', reason: 'EMPTY_QUERY' },
      softAnchor: true,
    });
    expect(result.semanticRanking.status).toBe('not_requested');
    expect(result.policyVersion).toBe('preference-utility-v2');
  });
});
