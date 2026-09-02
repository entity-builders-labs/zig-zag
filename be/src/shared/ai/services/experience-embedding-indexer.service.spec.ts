import { ExperienceEmbeddingIndexerService } from './experience-embedding-indexer.service';

describe('ExperienceEmbeddingIndexerService', () => {
  it('indexes verified experiences with the canonical identity', async () => {
    const prisma: any = { experience: { findMany: jest.fn().mockResolvedValue([{ id: 'exp-1', canonicalName: 'Museum', description: 'History', metadata: {} }]) }, $executeRaw: jest.fn() };
    const embeddings: any = { getIndexIdentity: () => ({ provider: 'ollama', model: 'nomic', dimensions: 2, documentVersion: 1 }), getEmbeddings: () => ({ embedDocuments: jest.fn().mockResolvedValue([[0.1, 0.2]]) }) };
    const result = await new ExperienceEmbeddingIndexerService(prisma, embeddings).index();
    expect(result.status).toBe('indexed');
    expect(result.indexedIds).toEqual(['exp-1']);
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('reports unavailable provider without writing', async () => {
    const prisma: any = { experience: { findMany: jest.fn().mockResolvedValue([{ id: 'exp-1', canonicalName: 'Museum', description: null, metadata: null }]) }, $executeRaw: jest.fn() };
    const embeddings: any = { getIndexIdentity: () => ({ provider: 'ollama', model: 'nomic', dimensions: 2, documentVersion: 1 }), getEmbeddings: (): any => null, getStatus: () => ({ status: 'unavailable', reason: 'offline' }) };
    const result = await new ExperienceEmbeddingIndexerService(prisma, embeddings).index();
    expect(result.status).toBe('unavailable');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
