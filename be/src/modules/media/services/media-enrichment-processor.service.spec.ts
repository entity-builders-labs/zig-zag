import { MediaStatus } from '@prisma/client';
import { MediaEnrichmentProcessorService } from './media-enrichment-processor.service';

describe('MediaEnrichmentProcessorService', () => {
  const payload = {
    experienceId: 'experience-1',
    name: 'Museo de prueba',
    destinationLabel: 'Buenos Aires',
    latitude: -34.6,
    longitude: -58.4,
  };

  function setup(lookup: any) {
    const tx = {
      experienceMedia: {
        upsert: jest.fn(async () => ({})),
      },
      experience: {
        update: jest.fn(async () => ({})),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const outbox = {
      createInTx: jest.fn(async () => ({})),
    };
    const wikimedia = {
      findPhotosForExperience: jest.fn(async () => lookup),
    };
    const queue = {
      subscribe: jest.fn(),
    };
    const service = new MediaEnrichmentProcessorService(
      prisma as any,
      outbox as any,
      wikimedia as any,
      queue as any,
    );
    return { service, prisma, tx, outbox, wikimedia };
  }

  it('persists every found photo as URL metadata before reporting ENRICHED', async () => {
    const photos = [
      {
        url: 'https://commons.example/photo-a.jpg',
        width: 1200,
        height: 800,
        caption: 'A',
        author: 'Author A',
        license: 'CC BY-SA 4.0',
        sourceUrl: 'https://commons.example/file-a',
        provider: 'wikimedia_commons' as const,
      },
      {
        url: 'https://commons.example/photo-b.jpg',
        caption: 'B',
        provider: 'wikimedia_commons' as const,
      },
    ];
    const { service, tx, outbox } = setup({ outcome: 'FOUND', photos });

    await service.handleMediaEnrichment(payload);

    expect(tx.experienceMedia.upsert).toHaveBeenCalledTimes(2);
    expect(tx.experienceMedia.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          experienceId_url: {
            experienceId: payload.experienceId,
            url: photos[0].url,
          },
        },
        create: expect.objectContaining({
          experienceId: payload.experienceId,
          url: photos[0].url,
          provider: 'wikimedia_commons',
          position: 0,
        }),
      }),
    );
    expect(tx.experience.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: payload.experienceId },
        data: expect.objectContaining({
          mediaStatus: MediaStatus.ENRICHED,
          mediaError: null,
        }),
      }),
    );
    expect(outbox.createInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'ExperienceMediaUpdated',
        payload: expect.objectContaining({
          experienceId: payload.experienceId,
          mediaStatus: 'ENRICHED',
          photoCount: 2,
          photos,
        }),
      }),
    );
  });

  it('uses replay-safe upserts keyed by experience and URL', async () => {
    const photo = {
      url: 'https://commons.example/photo-a.jpg',
      provider: 'wikimedia_commons' as const,
    };
    const { service, tx } = setup({ outcome: 'FOUND', photos: [photo] });

    await service.handleMediaEnrichment(payload);
    await service.handleMediaEnrichment(payload);

    const expectedUpsert = expect.objectContaining({
      where: {
        experienceId_url: {
          experienceId: payload.experienceId,
          url: photo.url,
        },
      },
    });
    expect(tx.experienceMedia.upsert).toHaveBeenCalledTimes(2);
    expect(tx.experienceMedia.upsert).toHaveBeenNthCalledWith(1, expectedUpsert);
    expect(tx.experienceMedia.upsert).toHaveBeenNthCalledWith(2, expectedUpsert);
  });

  it('does not persist FAILED or negative media state for retryable failures', async () => {
    const { service, prisma, tx, outbox } = setup({
      outcome: 'RETRYABLE_FAILURE',
      photos: [],
      error: '429 rate limited',
    });

    await expect(service.handleMediaEnrichment(payload)).rejects.toThrow(
      'Retryable media lookup failure',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.experienceMedia.upsert).not.toHaveBeenCalled();
    expect(tx.experience.update).not.toHaveBeenCalled();
    expect(outbox.createInTx).not.toHaveBeenCalled();
  });

  it('records authoritative empty as ENRICHED with zero URLs, not as a transient failure', async () => {
    const { service, tx, outbox } = setup({
      outcome: 'AUTHORITATIVE_EMPTY',
      photos: [],
    });

    await service.handleMediaEnrichment(payload);

    expect(tx.experienceMedia.upsert).not.toHaveBeenCalled();
    expect(tx.experience.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mediaStatus: MediaStatus.ENRICHED }),
      }),
    );
    expect(outbox.createInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        payload: expect.objectContaining({ photoCount: 0 }),
      }),
    );
  });
});
