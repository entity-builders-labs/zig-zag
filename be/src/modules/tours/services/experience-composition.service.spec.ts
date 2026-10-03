import { ExperienceCompositionService } from './experience-composition.service';
import { PreferenceSpec } from '../interfaces/preference-spec.interface';

const preferenceSpec: PreferenceSpec = {
  facets: [],
  exclusions: { themes: [], traits: [], hard: [] },
  anchors: [],
  semanticQuery: 'history walk',
  explorationStyle: 'balanced',
  softConstraints: { dietary: [], accessibility: [], budget: [], group: [] },
  trip: { days: 1, startDates: [], pace: 'moderate' },
};

describe('ExperienceCompositionService semantic handoff', () => {
  it('queries embeddings once and preserves known versus unknown scores', async () => {
    const getSimilarityScores = jest.fn().mockResolvedValue({
      status: 'applied',
      scores: new Map([['known', 0.91]]),
      requestedCandidateCount: 2,
      indexedCandidateCount: 1,
      identity: {
        provider: 'ollama',
        model: 'nomic-embed-text',
        dimensions: 256,
        documentVersion: 2,
      },
    });
    const service = new ExperienceCompositionService({
      getSimilarityScores,
    } as any);

    const output = await service.compose({
      experiences: [
        { id: 'known', components: [], qualityScore: 4 },
        { id: 'unknown', components: [], qualityScore: 4 },
      ],
      preferenceSpec,
    });

    expect(getSimilarityScores).toHaveBeenCalledTimes(1);
    expect(output.semanticSimilarityById).toEqual(new Map([['known', 0.91]]));
    expect(output.semanticRanking).toMatchObject({
      status: 'applied',
      requestedCandidateCount: 2,
      indexedCandidateCount: 1,
    });
    expect(output.candidatesById.has('known')).toBe(true);
    expect(output.candidatesById.has('unknown')).toBe(true);
  });

  it('reports unavailable embeddings without failing composition', async () => {
    const service = new ExperienceCompositionService({
      getSimilarityScores: jest.fn().mockResolvedValue({
        status: 'unavailable',
        scores: new Map(),
        requestedCandidateCount: 1,
        indexedCandidateCount: 0,
        identity: {
          provider: 'ollama',
          model: 'nomic-embed-text',
          dimensions: 256,
          documentVersion: 2,
        },
        reason: 'provider unavailable',
      }),
    } as any);

    const output = await service.compose({
      experiences: [{ id: 'one', components: [] }],
      preferenceSpec,
    });

    expect(output.candidatesById.has('one')).toBe(true);
    expect(output.semanticRanking).toMatchObject({
      status: 'unavailable',
      reason: 'provider unavailable',
    });
    expect(output.semanticSimilarityById.size).toBe(0);
  });
});
