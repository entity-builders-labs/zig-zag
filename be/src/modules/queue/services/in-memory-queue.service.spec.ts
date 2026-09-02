import { InMemoryQueueService } from './in-memory-queue.service';

describe('InMemoryQueueService acknowledgement semantics', () => {
  let queue: InMemoryQueueService;

  beforeEach(() => {
    queue = new InMemoryQueueService();
  });

  it('acknowledges optional topics that intentionally have no local consumer', async () => {
    await expect(
      queue.publish('TourProgressUpdated', { tourId: 'tour-1' }),
    ).resolves.toBeUndefined();
    await expect(
      queue.publish('ExperienceMediaUpdated', { experienceId: 'exp-1' }),
    ).resolves.toBeUndefined();
  });

  it('rejects publication when a critical topic has no local subscriber registered', async () => {
    await expect(
      queue.publish('TourGenerationRequested', { tourId: 'tour-1' }),
    ).rejects.toThrow(
      'No local subscribers registered for critical topic "TourGenerationRequested". Outbox must retry.',
    );
    await expect(
      queue.publish('ExperienceMediaEnrichmentRequested', {
        experienceId: 'exp-1',
      }),
    ).rejects.toThrow(
      'No local subscribers registered for critical topic "ExperienceMediaEnrichmentRequested". Outbox must retry.',
    );
  });

  it('does not acknowledge until the consumer has completed', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = jest.fn(async () => blocked);
    queue.subscribe('TourGenerationRequested', handler);

    let acknowledged = false;
    const publishing = queue
      .publish('TourGenerationRequested', { tourId: 'tour-1' })
      .then(() => {
        acknowledged = true;
      });

    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(acknowledged).toBe(false);

    release();
    await publishing;
    expect(acknowledged).toBe(true);
  });

  it('rejects publication if any registered consumer fails', async () => {
    queue.subscribe('ExperienceMediaUpdated', async () => undefined);
    queue.subscribe('ExperienceMediaUpdated', async () => {
      throw new Error('consumer failed');
    });

    await expect(
      queue.publish('ExperienceMediaUpdated', { experienceId: 'exp-1' }),
    ).rejects.toThrow('Consumer failure');
  });
});
