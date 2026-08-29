import { ActivityKind } from '@prisma/client';
import { AiEmbeddingService } from './ai-embedding.service';
import { SemanticActivityDocumentBuilder } from './semantic-activity-document-builder.service';
import {
  EmbeddingWriteError,
  VectorStoreService,
} from './vector-store.service';
import { PrismaService } from '../../../core/database/prisma.service';

describe('VectorStoreService', () => {
  const identity = {
    provider: 'ollama' as const,
    model: 'nomic-embed-text',
    dimensions: 256,
    documentVersion: 1,
  };

  let service: VectorStoreService;
  let mockEmbedDocuments: jest.Mock;
  let mockEmbedQuery: jest.Mock;
  let mockGetStatus: jest.Mock;
  let mockExecuteRaw: jest.Mock;
  let mockQueryRaw: jest.Mock;
  let mockFindMany: jest.Mock;
  let mockTransaction: jest.Mock;

  const activity = (overrides: Record<string, unknown> = {}): any => ({
    id: 'a1',
    name: 'Museum of Art',
    description: 'A fine arts museum',
    kind: ActivityKind.POI,
    type: 'museum',
    knownActivityTypeName: 'Museum',
    variantTheme: null,
    duration: 1.5,
    family: null,
    compositeWaypoints: [],
    ...overrides,
  });

  beforeEach(() => {
    mockEmbedDocuments = jest.fn();
    mockEmbedQuery = jest.fn();
    mockGetStatus = jest.fn(() => ({ status: 'ready', identity }));
    mockExecuteRaw = jest.fn().mockResolvedValue(1);
    mockQueryRaw = jest.fn().mockResolvedValue([]);
    mockFindMany = jest.fn().mockResolvedValue([]);
    mockTransaction = jest.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );

    const mockEmbeddingService = {
      getEmbeddings: jest.fn(() => ({
        embedDocuments: mockEmbedDocuments,
        embedQuery: mockEmbedQuery,
      })),
      getStatus: mockGetStatus,
      getIndexIdentity: jest.fn(() => identity),
      ensureInitialized: jest.fn().mockResolvedValue(undefined),
    } as unknown as AiEmbeddingService;

    const mockPrisma = {
      $executeRaw: mockExecuteRaw,
      $queryRaw: mockQueryRaw,
      $transaction: mockTransaction,
      activity: { findMany: mockFindMany },
    } as unknown as PrismaService;

    service = new VectorStoreService(
      mockEmbeddingService,
      mockPrisma,
      new SemanticActivityDocumentBuilder(),
    );
  });

  describe('saveActivityEmbedding', () => {
    it('returns an explicit unavailable result without querying or writing', async () => {
      mockGetStatus.mockReturnValue({
        status: 'unavailable',
        identity,
        reason: 'Ollama is offline',
      });

      const result = await service.saveActivityEmbedding([{ id: 'a1' }]);

      expect(result).toEqual({
        status: 'unavailable',
        requestedIds: ['a1'],
        indexedIds: [],
        identity,
        reason: 'Ollama is offline',
      });
      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockExecuteRaw).not.toHaveBeenCalled();
    });

    it('uses the canonical semantic document and persists exact index identity', async () => {
      mockFindMany.mockResolvedValue([
        activity(),
        activity({ id: 'a2', name: 'Historic Walk' }),
      ]);
      mockEmbedDocuments.mockResolvedValue([
        Array(256).fill(0.1),
        Array(256).fill(0.2),
      ]);

      const result = await service.saveActivityEmbedding([
        { id: 'a1' },
        { id: 'a2' },
      ]);

      expect(mockEmbedDocuments).toHaveBeenCalledWith([
        [
          'Name: Museum of Art',
          'Kind: POI',
          'Description: A fine arts museum',
          'Themes and types: Museum, museum',
          'Suggested duration: 1.5 hours',
        ].join('\n'),
        expect.stringContaining('Name: Historic Walk'),
      ]);
      expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
      expect(mockExecuteRaw.mock.calls[0]).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^\[0\.1,/),
          'ollama',
          'nomic-embed-text',
          256,
          1,
          'a1',
        ]),
      );
      expect(result).toEqual({
        status: 'indexed',
        requestedIds: ['a1', 'a2'],
        indexedIds: ['a1', 'a2'],
        identity,
      });
    });

    it('throws a typed error instead of claiming success on provider failure', async () => {
      mockFindMany.mockResolvedValue([activity()]);
      mockEmbedDocuments.mockRejectedValue(new Error('provider down'));

      await expect(
        service.saveActivityEmbedding([{ id: 'a1' }]),
      ).rejects.toMatchObject<Partial<EmbeddingWriteError>>({
        name: 'EmbeddingWriteError',
        requestedIds: ['a1'],
        identity,
      });
      expect(mockExecuteRaw).not.toHaveBeenCalled();
    });

    it('fails the whole write when the provider returns the wrong vector count', async () => {
      mockFindMany.mockResolvedValue([activity()]);
      mockEmbedDocuments.mockResolvedValue([]);

      await expect(
        service.saveActivityEmbedding([{ id: 'a1' }]),
      ).rejects.toThrow('returned 0 vectors for 1 documents');
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });

  describe('backfillMissingActivityEmbeddings', () => {
    it('re-indexes rows whose vector is absent or identity is incompatible', async () => {
      mockQueryRaw.mockResolvedValue([{ id: 'stale' }]);
      mockFindMany.mockResolvedValue([activity({ id: 'stale' })]);
      mockEmbedDocuments.mockResolvedValue([Array(256).fill(0.1)]);

      const result = await service.backfillMissingActivityEmbeddings([
        { id: 'compatible' },
        { id: 'stale' },
      ]);

      expect(result.status).toBe('indexed');
      expect(result.indexedIds).toEqual(['stale']);
      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSimilarityScores', () => {
    it('reports provider failure as unavailable', async () => {
      mockGetStatus.mockReturnValue({
        status: 'unavailable',
        identity,
        reason: 'Bedrock access denied',
      });

      const result = await service.getSimilarityScores(
        ['a', 'b'],
        'history and architecture',
      );

      expect(result).toMatchObject({
        status: 'unavailable',
        requestedCandidateCount: 2,
        indexedCandidateCount: 0,
        reason: 'Bedrock access denied',
      });
      expect(result.scores.size).toBe(0);
      expect(mockEmbedQuery).not.toHaveBeenCalled();
    });

    it('returns scores only for vectors matching the active index identity', async () => {
      mockEmbedQuery.mockResolvedValue(Array(256).fill(0.1));
      mockQueryRaw.mockResolvedValue([
        { id: 'a', distance: 0.2 },
        { id: 'b', distance: 0.9 },
      ]);

      const result = await service.getSimilarityScores(
        ['a', 'b', 'missing'],
        'history and architecture',
      );

      expect(result.status).toBe('applied');
      expect(result.requestedCandidateCount).toBe(3);
      expect(result.indexedCandidateCount).toBe(2);
      expect(result.scores.get('a')).toBeCloseTo(0.8);
      expect(result.scores.get('b')).toBeCloseTo(0.1);
      expect(result.scores.has('missing')).toBe(false);
      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    });

    it('does not claim application when the query embedding call fails', async () => {
      mockEmbedQuery.mockRejectedValue(new Error('model unavailable'));

      const result = await service.getSimilarityScores(['a'], 'art');

      expect(result).toMatchObject({
        status: 'unavailable',
        requestedCandidateCount: 1,
        indexedCandidateCount: 0,
        reason: 'model unavailable',
      });
    });
  });

  describe('findSimilarActivitiesForActivity', () => {
    it('queries with the same canonical document used to index the activity', async () => {
      mockFindMany.mockResolvedValue([activity()]);
      mockEmbedQuery.mockResolvedValue(Array(256).fill(0.1));
      mockQueryRaw.mockResolvedValue([]);

      await service.findSimilarActivitiesForActivity('a1', 4);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['a1'] } } }),
      );
      expect(mockEmbedQuery).toHaveBeenCalledWith(
        [
          'Name: Museum of Art',
          'Kind: POI',
          'Description: A fine arts museum',
          'Themes and types: Museum, museum',
          'Suggested duration: 1.5 hours',
        ].join('\n'),
      );
    });
  });

  describe('rebuildVectorStore', () => {
    it('clears the mixed index and rebuilds all active recommendable kinds', async () => {
      mockFindMany.mockImplementation(async (args: any) => {
        if (args.select) return [{ id: 'a1' }, { id: 'a2' }];
        return [activity({ id: 'a1' }), activity({ id: 'a2' })];
      });
      mockEmbedDocuments.mockResolvedValue([
        Array(256).fill(0.1),
        Array(256).fill(0.2),
      ]);

      const result = await service.rebuildVectorStore();

      expect(mockFindMany).toHaveBeenNthCalledWith(1, {
        where: {
          isArchived: false,
          kind: { not: ActivityKind.AREA },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      expect(mockExecuteRaw).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ success: true, count: 2, identity });
    });

    it('refuses to clear the index when the configured provider is unavailable', async () => {
      mockGetStatus.mockReturnValue({
        status: 'unavailable',
        identity,
        reason: 'Ollama is offline',
      });

      await expect(service.rebuildVectorStore()).rejects.toThrow(
        'Cannot rebuild embeddings: Ollama is offline',
      );
      expect(mockExecuteRaw).not.toHaveBeenCalled();
    });

    it('clears partial batches when a full rebuild fails', async () => {
      const rows = Array.from({ length: 51 }, (_, index) => ({
        id: `a${index + 1}`,
      }));
      mockFindMany.mockImplementation(async (args: any) => {
        if (args.select) return rows;
        return args.where.id.in.map((id: string) => activity({ id }));
      });
      mockEmbedDocuments
        .mockResolvedValueOnce(
          Array.from({ length: 50 }, () => Array(256).fill(0.1)),
        )
        .mockRejectedValueOnce(new Error('provider failed mid-rebuild'));

      await expect(service.rebuildVectorStore()).rejects.toThrow(
        'provider failed mid-rebuild',
      );

      // One reset before rebuilding, 50 successful row writes, then a second
      // reset that invalidates the partial result.
      expect(mockExecuteRaw).toHaveBeenCalledTimes(52);
    });
  });

  describe('testVectorStoreConnection', () => {
    it('reports compatible and mixed vectors separately', async () => {
      mockQueryRaw.mockResolvedValue([
        { compatibleCount: BigInt(7), incompatibleCount: BigInt(2) },
      ]);

      const result = await service.testVectorStoreConnection();

      expect(result).toMatchObject({
        status: 'connected',
        compatibleCount: 7,
        incompatibleCount: 2,
        identity,
      });
    });
  });
});
