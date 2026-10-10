import { ExperienceEmbeddingIndexerService } from './experience-embedding-indexer.service';
import { EXPERIENCE_EMBEDDING_DOCUMENT_VERSION } from '../interfaces/embedding-index.interface';

function experience(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    canonicalName: `Experience ${id}`,
    description: 'History and architecture',
    durationMinutes: 120,
    price: 0,
    metadata: { themes: ['history'], intents: ['visit-like'] },
    components: [
      {
        id: `component-${id}`,
        geoEntityId: `geo-${id}`,
        role: 'venue',
        geoEntity: {
          name: `Venue ${id}`,
          kind: 'PLACE',
          address: 'Buenos Aires',
        },
      },
    ],
    traits: [
      {
        traitDefinition: {
          dimension: 'mobility',
          key: 'walking',
          label: 'walking',
        },
      },
    ],
    ...overrides,
  };
}

function identity() {
  return {
    provider: 'ollama',
    model: 'nomic',
    dimensions: 2,
    documentVersion: EXPERIENCE_EMBEDDING_DOCUMENT_VERSION,
  };
}

describe('ExperienceEmbeddingIndexerService', () => {
  it('indexes verified experiences with the canonical identity and semantic document', async () => {
    const embedDocuments = jest.fn().mockResolvedValue([[0.1, 0.2]]);
    const prisma: any = {
      experience: {
        findMany: jest.fn().mockResolvedValue([experience('exp-1')]),
      },
      $executeRaw: jest.fn(),
    };
    const embeddings: any = {
      getIndexIdentity: identity,
      getEmbeddings: () => ({ embedDocuments }),
    };

    const result = await new ExperienceEmbeddingIndexerService(
      prisma,
      embeddings,
    ).index();

    expect(result.status).toBe('indexed');
    expect(result.indexedIds).toEqual(['exp-1']);
    expect(embedDocuments).toHaveBeenCalledWith([
      expect.stringContaining(
        'component: role=venue | kind=PLACE | Venue exp-1',
      ),
    ]);
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('reports unavailable provider without writing and leaves the row retryable', async () => {
    const prisma: any = {
      experience: {
        findMany: jest.fn().mockResolvedValue([experience('exp-1')]),
      },
      $executeRaw: jest.fn(),
    };
    const embeddings: any = {
      getIndexIdentity: identity,
      getEmbeddings: (): any => null,
      getStatus: () => ({ status: 'unavailable', reason: 'offline' }),
    };

    const result = await new ExperienceEmbeddingIndexerService(
      prisma,
      embeddings,
    ).index();

    expect(result.status).toBe('unavailable');
    expect(result.indexedIds).toEqual([]);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('rebuild is idempotent when no stale rows remain', async () => {
    const prisma: any = {
      experience: { findMany: jest.fn().mockResolvedValue([]) },
      $executeRaw: jest.fn(),
    };
    const embeddings: any = {
      getIndexIdentity: identity,
      getEmbeddings: jest.fn(),
    };

    const result = await new ExperienceEmbeddingIndexerService(
      prisma,
      embeddings,
    ).rebuild();

    expect(result.status).toBe('no_work');
    expect(embeddings.getEmbeddings).not.toHaveBeenCalled();
  });

  it('indexes a 300-experience verified pool without falling back to legacy records', async () => {
    const experiences = Array.from({ length: 300 }, (_, index) =>
      experience(`exp-${index}`, {
        description: 'Nature and culture',
        metadata: { themes: ['nature', 'culture'] },
      }),
    );
    const prisma: any = {
      experience: { findMany: jest.fn().mockResolvedValue(experiences) },
      $executeRaw: jest.fn(),
    };
    const embeddings: any = {
      getIndexIdentity: identity,
      getEmbeddings: () => ({
        embedDocuments: jest
          .fn()
          .mockResolvedValue(experiences.map(() => [0.1, 0.2])),
      }),
    };

    const result = await new ExperienceEmbeddingIndexerService(
      prisma,
      embeddings,
    ).index();

    expect(result.status).toBe('indexed');
    expect(result.requestedIds).toHaveLength(300);
    expect(result.indexedIds).toHaveLength(300);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(300);
  });

  it('rejects a provider response with the wrong vector dimensions', async () => {
    const prisma: any = {
      experience: {
        findMany: jest.fn().mockResolvedValue([experience('exp-1')]),
      },
      $executeRaw: jest.fn(),
    };
    const embeddings: any = {
      getIndexIdentity: identity,
      getEmbeddings: () => ({
        embedDocuments: jest.fn().mockResolvedValue([[0.1]]),
      }),
    };

    const result = await new ExperienceEmbeddingIndexerService(
      prisma,
      embeddings,
    ).index();

    expect(result.status).toBe('unavailable');
    expect(result.reason).toMatch(/expected 2/i);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  /**
   * Stage 2 cutover (component-resolution-and-partial-composite-recovery-
   * plan.md, embedding migration): removing the `required`/`optional`
   * component token bumped EXPERIENCE_EMBEDDING_DOCUMENT_VERSION. A stale
   * VERIFIED row indexed under the previous document version must be
   * selected for reindex through this same existing version-aware query --
   * no new indexing path was introduced.
   */
  it('selects stale VERIFIED rows carrying a previous embeddingDocumentVersion for reindex', async () => {
    const prisma: any = {
      experience: {
        findMany: jest.fn().mockResolvedValue([experience('exp-stale-v2')]),
      },
      $executeRaw: jest.fn(),
    };
    const embeddings: any = {
      getIndexIdentity: identity,
      getEmbeddings: () => ({
        embedDocuments: jest.fn().mockResolvedValue([[0.1, 0.2]]),
      }),
    };

    const result = await new ExperienceEmbeddingIndexerService(
      prisma,
      embeddings,
    ).index();

    const whereClause = prisma.experience.findMany.mock.calls[0][0].where;
    expect(whereClause.status).toBe('VERIFIED');
    expect(whereClause.OR).toEqual(
      expect.arrayContaining([
        { embeddingDocumentVersion: null },
        {
          embeddingDocumentVersion: {
            not: EXPERIENCE_EMBEDDING_DOCUMENT_VERSION,
          },
        },
      ]),
    );
    expect(result.status).toBe('indexed');
    expect(result.indexedIds).toEqual(['exp-stale-v2']);
  });
});
