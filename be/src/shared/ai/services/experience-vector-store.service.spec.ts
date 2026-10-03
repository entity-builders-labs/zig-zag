import { ExperienceVectorStoreService } from './experience-vector-store.service';

describe('ExperienceVectorStoreService', () => {
  it('retrieves semantic scores only for the 300 requested Experience ids', async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `exp-${i}`);
    const prisma: any = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue(ids.map((id, i) => ({ id, distance: i / 1000 }))),
    };
    const embeddingService: any = {
      getIndexIdentity: () => ({
        provider: 'ollama',
        model: 'nomic',
        dimensions: 2,
        documentVersion: 1,
      }),
      getStatus: () => ({
        status: 'ready',
        identity: {
          provider: 'ollama',
          model: 'nomic',
          dimensions: 2,
          documentVersion: 1,
        },
      }),
      getEmbeddings: () => ({
        embedQuery: jest.fn().mockResolvedValue([0.1, 0.2]),
      }),
    };
    const result = await new ExperienceVectorStoreService(
      embeddingService,
      prisma,
    ).getSimilarityScores(ids, 'nature and culture');
    expect(result.status).toBe('applied');
    expect(result.requestedCandidateCount).toBe(300);
    expect(result.indexedCandidateCount).toBe(300);
    expect(result.scores.get('exp-0')).toBe(1);
  });
});
