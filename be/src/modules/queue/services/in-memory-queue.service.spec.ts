import { InMemoryQueueService } from './in-memory-queue.service';

describe('InMemoryQueueService acknowledgement semantics', () => {
  let queue: InMemoryQueueService;

  beforeEach(() => {
    queue = new InMemoryQueueService();
  });

  it('rejects publication when no consumer is registered', async () => {
    await expect(queue.publish('TourGenerationRequested', {})).rejects.toThrow(
      'No subscribers registered',
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

  it('rejects publication if any consumer fails', async () => {
    queue.subscribe('ActivityMediaUpdated', async () => undefined);
    queue.subscribe('ActivityMediaUpdated', async () => {
      throw new Error('consumer failed');
    });

    await expect(
      queue.publish('ActivityMediaUpdated', { activityId: 'a-1' }),
    ).rejects.toThrow('Consumer failure');
  });
});
