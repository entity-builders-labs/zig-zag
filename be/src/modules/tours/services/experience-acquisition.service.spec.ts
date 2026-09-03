import { ExperienceAcquisitionService } from './experience-acquisition.service';

describe('ExperienceAcquisitionService', () => {
  const input = {
    latitude: -34.6037,
    longitude: -58.3816,
    radius: 5000,
    interests: ['culture'],
    maxResultCount: 20,
  };

  it('indexes every acquired Experience and exposes embedding provenance', async () => {
    const catalog = {
      acquireNearbyAsExperiences: jest.fn().mockResolvedValue({
        experienceIds: ['exp-1', 'exp-2'],
        experiences: [{ id: 'exp-1' }, { id: 'exp-2' }],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 2,
        },
      }),
    };
    const embeddingIndexer = {
      index: jest.fn().mockResolvedValue({
        status: 'indexed',
        requestedIds: ['exp-1', 'exp-2'],
        indexedIds: ['exp-1', 'exp-2'],
        identity: {
          provider: 'ollama',
          model: 'nomic-embed-text',
          dimensions: 256,
          documentVersion: 2,
        },
      }),
    };
    const service = new ExperienceAcquisitionService(
      catalog as any,
      embeddingIndexer as any,
    );

    const result = await service.acquireNearby(input);

    expect(catalog.acquireNearbyAsExperiences).toHaveBeenCalledWith(input);
    expect(embeddingIndexer.index).toHaveBeenCalledWith(['exp-1', 'exp-2']);
    expect(result.provenance).toMatchObject({
      acceptedCount: 2,
      embeddedCount: 2,
      embeddingWriteStatus: 'indexed',
      embeddingIdentity: {
        model: 'nomic-embed-text',
        dimensions: 256,
        documentVersion: 2,
      },
    });
  });

  it('keeps provider unavailability observable without discarding persisted Experiences', async () => {
    const catalog = {
      acquireNearbyAsExperiences: jest.fn().mockResolvedValue({
        experienceIds: ['exp-1'],
        experiences: [{ id: 'exp-1' }],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 1,
        },
      }),
    };
    const embeddingIndexer = {
      index: jest.fn().mockResolvedValue({
        status: 'unavailable',
        requestedIds: ['exp-1'],
        indexedIds: [],
        identity: {
          provider: 'ollama',
          model: 'nomic-embed-text',
          dimensions: 256,
          documentVersion: 2,
        },
        reason: 'embedding provider unavailable',
      }),
    };
    const service = new ExperienceAcquisitionService(
      catalog as any,
      embeddingIndexer as any,
    );

    const result = await service.acquireNearby(input);

    expect(result.experienceIds).toEqual(['exp-1']);
    expect(result.provenance).toMatchObject({
      acceptedCount: 1,
      embeddedCount: 0,
      embeddingWriteStatus: 'unavailable',
      embeddingFailureReason: 'embedding provider unavailable',
    });
  });

  it('still records a no-work index result for an empty acquisition', async () => {
    const catalog = {
      acquireNearbyAsExperiences: jest.fn().mockResolvedValue({
        experienceIds: [],
        experiences: [],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 20,
          receivedCount: 0,
        },
      }),
    };
    const embeddingIndexer = {
      index: jest.fn().mockResolvedValue({
        status: 'no_work',
        requestedIds: [],
        indexedIds: [],
        identity: {
          provider: 'ollama',
          model: 'nomic-embed-text',
          dimensions: 256,
          documentVersion: 2,
        },
      }),
    };
    const service = new ExperienceAcquisitionService(
      catalog as any,
      embeddingIndexer as any,
    );

    const result = await service.acquireNearby(input);

    expect(embeddingIndexer.index).toHaveBeenCalledWith([]);
    expect(result.provenance.embeddingWriteStatus).toBe('no_work');
    expect(result.provenance.embeddedCount).toBe(0);
  });
});
