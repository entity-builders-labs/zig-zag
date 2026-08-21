import { VectorStoreService } from './vector-store.service';
import { AiEmbeddingService } from './ai-embedding.service';
import { PrismaService } from '../../../core/database/prisma.service';

describe('VectorStoreService', () => {
  let service: VectorStoreService;
  let mockEmbedDocuments: jest.Mock;
  let mockEmbedQuery: jest.Mock;
  let mockGetEmbeddings: jest.Mock;
  let mockExecuteRaw: jest.Mock;
  let mockQueryRaw: jest.Mock;
  let mockFindMany: jest.Mock;

  beforeEach(() => {
    mockEmbedDocuments = jest.fn();
    mockEmbedQuery = jest.fn();
    mockGetEmbeddings = jest.fn(() => ({
      embedDocuments: mockEmbedDocuments,
      embedQuery: mockEmbedQuery,
    }));
    mockExecuteRaw = jest.fn().mockResolvedValue(1);
    mockQueryRaw = jest.fn().mockResolvedValue([]);
    mockFindMany = jest.fn().mockResolvedValue([]);

    const mockEmbeddingService = {
      getEmbeddings: mockGetEmbeddings,
      ensureInitialized: jest.fn().mockResolvedValue(undefined),
    } as unknown as AiEmbeddingService;

    const mockPrisma = {
      $executeRaw: mockExecuteRaw,
      $queryRaw: mockQueryRaw,
      activity: { findMany: mockFindMany },
    } as unknown as PrismaService;

    service = new VectorStoreService(mockEmbeddingService, mockPrisma);
  });

  const activity = (overrides: Record<string, unknown> = {}) => ({
    id: 'a1',
    name: 'Museum of Art',
    description: 'A fine arts museum',
    type: 'museum',
    metadata: { tags: ['art', 'indoor'] },
    ...overrides,
  });

  describe('saveActivityEmbedding', () => {
    it('does nothing when embeddings are not ready', async () => {
      mockGetEmbeddings.mockReturnValue(null);

      await service.saveActivityEmbedding([activity() as any]);

      expect(mockExecuteRaw).not.toHaveBeenCalled();
    });

    it('does nothing for an empty activity list', async () => {
      await service.saveActivityEmbedding([]);

      expect(mockEmbedDocuments).not.toHaveBeenCalled();
      expect(mockExecuteRaw).not.toHaveBeenCalled();
    });

    it('embeds each activity and issues one UPDATE per activity with a vector literal', async () => {
      mockEmbedDocuments.mockResolvedValue([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);
      const activities = [
        activity({ id: 'a1' }),
        activity({ id: 'a2', name: 'City Park' }),
      ];

      await service.saveActivityEmbedding(activities as any);

      expect(mockEmbedDocuments).toHaveBeenCalledWith([
        expect.stringContaining('Museum of Art'),
        expect.stringContaining('City Park'),
      ]);
      expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
      expect(mockExecuteRaw.mock.calls[0][1]).toBe('[0.1,0.2,0.3]');
      expect(mockExecuteRaw.mock.calls[0][2]).toBe('a1');
      expect(mockExecuteRaw.mock.calls[1][1]).toBe('[0.4,0.5,0.6]');
      expect(mockExecuteRaw.mock.calls[1][2]).toBe('a2');
    });

    it('swallows embedding errors without throwing', async () => {
      mockEmbedDocuments.mockRejectedValue(new Error('provider down'));

      await expect(
        service.saveActivityEmbedding([activity() as any]),
      ).resolves.toBeUndefined();
    });
  });

  describe('addActivityToVectorStore', () => {
    it('does nothing when embeddings are not ready', async () => {
      mockGetEmbeddings.mockReturnValue(null);

      await service.addActivityToVectorStore(activity() as any);

      expect(mockExecuteRaw).not.toHaveBeenCalled();
    });

    it('builds the rich activity text, embeds it, and upserts the vector', async () => {
      mockEmbedQuery.mockResolvedValue([0.7, 0.8]);

      await service.addActivityToVectorStore(activity() as any);

      const [text] = mockEmbedQuery.mock.calls[0];
      expect(text).toContain('Museum of Art is a 3 intensity activity');
      expect(text).toContain('Keywords: art, indoor');
      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
      expect(mockExecuteRaw.mock.calls[0][1]).toBe('[0.7,0.8]');
      expect(mockExecuteRaw.mock.calls[0][2]).toBe('a1');
    });
  });

  describe('findSimilarActivities', () => {
    it('returns an empty array when embeddings are not ready', async () => {
      mockGetEmbeddings.mockReturnValue(null);

      const result = await service.findSimilarActivities('museums nearby');

      expect(result).toEqual([]);
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });

    it('embeds the query and runs an ORDER BY ... <=> ... LIMIT search', async () => {
      mockEmbedQuery.mockResolvedValue([0.1, 0.2]);
      mockQueryRaw.mockResolvedValue([
        {
          id: 'a1',
          name: 'Museum of Art',
          description: 'A fine arts museum',
          type: 'museum',
          metadata: { tags: ['art'] },
          distance: 0.05,
        },
      ]);

      const result = await service.findSimilarActivities('art museums', 3);

      expect(mockEmbedQuery).toHaveBeenCalledWith('art museums');
      expect(mockQueryRaw.mock.calls[0][1]).toBe('[0.1,0.2]');
      expect(mockQueryRaw.mock.calls[0][3]).toBe(3);
      expect(result).toEqual([
        {
          pageContent: expect.stringContaining('Museum of Art'),
          metadata: {
            activityId: 'a1',
            activityName: 'Museum of Art',
            activityType: 'museum',
            distance: 0.05,
            tags: ['art'],
          },
        },
      ]);
    });
  });

  describe('resetVectorStore', () => {
    it('nulls out every stored embedding', async () => {
      await service.resetVectorStore();

      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('rebuildVectorStore', () => {
    it('re-embeds every activity with non-null metadata and reports the count', async () => {
      mockEmbedQuery.mockResolvedValue([0.1]);
      mockFindMany.mockResolvedValue([
        activity({ id: 'a1' }),
        activity({ id: 'a2' }),
      ]);

      const result = await service.rebuildVectorStore();

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { metadata: { not: null } },
      });
      expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true, count: 2 });
    });

    it('continues past a single activity failure and reports a reduced count', async () => {
      mockEmbedQuery
        .mockResolvedValueOnce([0.1])
        .mockRejectedValueOnce(new Error('embed failed'))
        .mockResolvedValueOnce([0.3]);
      mockFindMany.mockResolvedValue([
        activity({ id: 'a1' }),
        activity({ id: 'a2' }),
        activity({ id: 'a3' }),
      ]);

      const result = await service.rebuildVectorStore();

      expect(result).toEqual({ success: true, count: 2 });
    });
  });

  describe('testVectorStoreConnection', () => {
    it('reports connected status with the embedded row count', async () => {
      mockQueryRaw.mockResolvedValue([{ count: BigInt(7) }]);

      const result = await service.testVectorStoreConnection();

      expect(result.status).toBe('connected');
      expect(result.embeddedCount).toBe(7);
    });

    it('reports error status when the query fails', async () => {
      mockQueryRaw.mockRejectedValue(new Error('connection refused'));

      const result = await service.testVectorStoreConnection();

      expect(result.status).toBe('error');
      expect(result.error).toBe('connection refused');
    });
  });

  describe('getSimilarityScores', () => {
    it('returns an empty map without querying when embeddings are unavailable', async () => {
      mockGetEmbeddings.mockReturnValue(null);

      const result = await service.getSimilarityScores(['a', 'b'], 'history, art');

      expect(result.size).toBe(0);
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });

    it('returns an empty map without querying when there are no candidate ids', async () => {
      mockGetEmbeddings.mockReturnValue({ embedQuery: jest.fn() });

      const result = await service.getSimilarityScores([], 'history, art');

      expect(result.size).toBe(0);
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });

    it('embeds the query text and returns cosine similarity (1 - distance) per candidate id', async () => {
      const embedQuery = jest.fn().mockResolvedValue([0.1, 0.2, 0.3]);
      mockGetEmbeddings.mockReturnValue({ embedQuery });
      mockQueryRaw.mockResolvedValue([
        { id: 'a', distance: 0.2 },
        { id: 'b', distance: 0.9 },
      ]);

      const result = await service.getSimilarityScores(['a', 'b'], 'history, art');

      expect(embedQuery).toHaveBeenCalledWith('history, art');
      expect(result.get('a')).toBeCloseTo(0.8);
      expect(result.get('b')).toBeCloseTo(0.1);
    });

    it('omits candidates that have no indexed embedding rather than defaulting them', async () => {
      const embedQuery = jest.fn().mockResolvedValue([0.1, 0.2, 0.3]);
      mockGetEmbeddings.mockReturnValue({ embedQuery });
      mockQueryRaw.mockResolvedValue([{ id: 'a', distance: 0.2 }]);

      const result = await service.getSimilarityScores(['a', 'b'], 'history, art');

      expect(result.has('a')).toBe(true);
      expect(result.has('b')).toBe(false);
    });
  });
});
