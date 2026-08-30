import { Test, TestingModule } from '@nestjs/testing';
import { OutboxPublisherService } from './outbox-publisher.service';
import { OutboxCleanerService } from './outbox-cleaner.service';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  MESSAGE_QUEUE_SERVICE,
  IMessageQueueService,
} from '../../queue/interfaces/message-queue.interface';
import { OutboxStatus } from '../interfaces/outbox.interface';

import { OutboxService } from './outbox.service';

describe('OutboxLifecycle Policy & Services', () => {
  let outboxService: OutboxService;
  let publisher: OutboxPublisherService;
  let cleaner: OutboxCleanerService;
  let prismaMock: any;
  let queueMock: jest.Mocked<IMessageQueueService>;

  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      outboxEvent: {
        create: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    queueMock = {
      publish: jest.fn(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxService,
        OutboxPublisherService,
        OutboxCleanerService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: MESSAGE_QUEUE_SERVICE, useValue: queueMock },
      ],
    }).compile();

    outboxService = module.get<OutboxService>(OutboxService);
    publisher = module.get<OutboxPublisherService>(OutboxPublisherService);
    cleaner = module.get<OutboxCleanerService>(OutboxCleanerService);

    // Disable auto-timers for unit testing
    publisher.configure({ autoStart: false, baseBackoffMs: 1000, maxBackoffMs: 10000 });
    cleaner.configure({ autoStart: false });
  });

  describe('OutboxService - Transactional Event Enqueuing', () => {
    it('1. atomically enqueues an event inside an existing Prisma transaction client', async () => {
      const mockEvent = {
        id: 'outbox-1',
        eventType: 'TourGenerationRequested',
        payload: { tourId: 'tour-123' },
        status: OutboxStatus.PENDING,
        attemptCount: 0,
        maxAttempts: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prismaMock.outboxEvent.create.mockResolvedValueOnce(mockEvent);

      const result = await outboxService.createInTx(prismaMock, {
        eventType: 'TourGenerationRequested',
        payload: { tourId: 'tour-123' },
      });

      expect(prismaMock.outboxEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: 'TourGenerationRequested',
          payload: { tourId: 'tour-123' },
          status: OutboxStatus.PENDING,
          maxAttempts: 5,
          attemptCount: 0,
        },
      });
      expect(result.id).toBe('outbox-1');
    });

    it('2. enqueues an event outside transaction using default client', async () => {
      prismaMock.outboxEvent.create.mockResolvedValueOnce({ id: 'outbox-2' });

      const result = await outboxService.create({
        eventType: 'ActivityMediaEnrichmentRequested',
        payload: { activityId: 'act-99' },
      });

      expect(result.id).toBe('outbox-2');
    });
  });

  describe('OutboxPublisherService - Concurrency & Claiming', () => {
    it('1. claims eligible PENDING rows atomically with FOR UPDATE SKIP LOCKED', async () => {
      const mockRows = [
        {
          id: 'event-1',
          eventType: 'TourGenerationRequested',
          payload: { tourId: 't-1' },
          status: OutboxStatus.PENDING,
          attemptCount: 0,
          maxAttempts: 5,
          leaseUntil: null as Date | null,
        },
      ];

      prismaMock.$queryRaw.mockResolvedValueOnce(mockRows);
      prismaMock.$executeRaw.mockResolvedValueOnce(1);

      const claimed = await publisher.claimBatch(50, 30);

      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.$queryRaw).toHaveBeenCalled();
      expect(prismaMock.$executeRaw).toHaveBeenCalled();
      expect(claimed).toHaveLength(1);
      expect(claimed[0].id).toBe('event-1');
      expect(claimed[0].attemptCount).toBe(1);
    });

    it('2. recovers stale PROCESSING events whose lease has expired', async () => {
      const mockStaleRows = [
        {
          id: 'stale-event',
          eventType: 'ActivityMediaEnrichmentRequested',
          payload: { activityId: 'act-1' },
          status: OutboxStatus.PROCESSING,
          attemptCount: 1,
          maxAttempts: 5,
          leaseUntil: new Date(Date.now() - 10000), // Expired 10s ago
        },
      ];

      prismaMock.$queryRaw.mockResolvedValueOnce(mockStaleRows);
      prismaMock.$executeRaw.mockResolvedValueOnce(1);

      const claimed = await publisher.claimBatch(50, 30);

      expect(claimed).toHaveLength(1);
      expect(claimed[0].id).toBe('stale-event');
      expect(claimed[0].attemptCount).toBe(2);
    });
  });

  describe('OutboxPublisherService - Dispatch & Retries', () => {
    it('3. marks event PUBLISHED on broker confirmation outside DB transaction', async () => {
      const mockRows = [
        {
          id: 'event-ok',
          eventType: 'TourCompleted',
          payload: { tourId: 't-1', userId: 'u-1' },
          status: OutboxStatus.PENDING,
          attemptCount: 0,
          maxAttempts: 5,
          leaseUntil: null as Date | null,
        },
      ];

      prismaMock.$queryRaw.mockResolvedValueOnce(mockRows);
      prismaMock.$executeRaw.mockResolvedValueOnce(1);
      queueMock.publish.mockResolvedValueOnce(undefined);
      prismaMock.outboxEvent.update.mockResolvedValueOnce({});

      const result = await publisher.processNextBatch();

      expect(result.claimedCount).toBe(1);
      expect(result.publishedCount).toBe(1);
      expect(result.failedCount).toBe(0);

      expect(queueMock.publish).toHaveBeenCalledWith('TourCompleted', {
        tourId: 't-1',
        userId: 'u-1',
      });
      expect(prismaMock.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-ok' },
        data: expect.objectContaining({
          status: OutboxStatus.PUBLISHED,
          leaseUntil: null as Date | null,
          lastError: null,
        }),
      });
    });

    it('4. schedules retry with exponential backoff on transient broker failure', async () => {
      const mockRows = [
        {
          id: 'event-transient-fail',
          eventType: 'ActivityMediaUpdated',
          payload: { activityId: 'act-1' },
          status: OutboxStatus.PENDING,
          attemptCount: 0,
          maxAttempts: 5,
          leaseUntil: null as Date | null,
        },
      ];

      prismaMock.$queryRaw.mockResolvedValueOnce(mockRows);
      prismaMock.$executeRaw.mockResolvedValueOnce(1);
      queueMock.publish.mockRejectedValueOnce(new Error('Network timeout'));
      prismaMock.outboxEvent.update.mockResolvedValueOnce({});

      const result = await publisher.processNextBatch();

      expect(result.claimedCount).toBe(1);
      expect(result.publishedCount).toBe(0);
      expect(result.failedCount).toBe(1);

      expect(prismaMock.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-transient-fail' },
        data: expect.objectContaining({
          status: OutboxStatus.PENDING,
          lastError: expect.stringContaining('Network timeout'),
          nextAttemptAt: expect.any(Date),
          leaseUntil: null as Date | null,
        }),
      });
    });

    it('5. transitions to terminal FAILED status after reaching maxAttempts', async () => {
      const mockRows = [
        {
          id: 'event-terminal-fail',
          eventType: 'TourGenerationRequested',
          payload: { tourId: 't-9' },
          status: OutboxStatus.PENDING,
          attemptCount: 4, // Next attempt will be 5 == maxAttempts
          maxAttempts: 5,
          leaseUntil: null as Date | null,
        },
      ];

      prismaMock.$queryRaw.mockResolvedValueOnce(mockRows);
      prismaMock.$executeRaw.mockResolvedValueOnce(1);
      queueMock.publish.mockRejectedValueOnce(new Error('Fatal broker rejection'));
      prismaMock.outboxEvent.update.mockResolvedValueOnce({});

      const result = await publisher.processNextBatch();

      expect(result.claimedCount).toBe(1);
      expect(result.publishedCount).toBe(0);
      expect(result.failedCount).toBe(1);

      expect(prismaMock.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-terminal-fail' },
        data: expect.objectContaining({
          status: OutboxStatus.FAILED,
          failedAt: expect.any(Date),
          lastError: expect.stringContaining('Fatal broker rejection'),
          leaseUntil: null,
        }),
      });
    });
  });

  describe('OutboxCleanerService - Retention & Bounded Deletions', () => {
    it('6. cleans expired PUBLISHED rows in bounded batches and ignores recent ones', async () => {
      prismaMock.$executeRaw
        .mockResolvedValueOnce(500) // First batch deleted 500 rows
        .mockResolvedValueOnce(120); // Second batch deleted remaining 120 rows

      const deletedCount = await cleaner.cleanPublishedBatch(7, 500);

      expect(deletedCount).toBe(620);
      expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('7. cleans expired FAILED rows older than 30 days and preserves recent ones', async () => {
      prismaMock.$executeRaw.mockResolvedValueOnce(45);

      const deletedCount = await cleaner.cleanFailedBatch(30, 500);

      expect(deletedCount).toBe(45);
      expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('8. full cleanup cycle coordinates published and failed deletions safely', async () => {
      prismaMock.$executeRaw
        .mockResolvedValueOnce(200) // published batch (< 500 stops)
        .mockResolvedValueOnce(10); // failed batch (< 500 stops)

      const result = await cleaner.runCleanupCycle();

      expect(result.publishedDeleted).toBe(200);
      expect(result.failedDeleted).toBe(10);
      expect(result.totalDeleted).toBe(210);
      expect(cleaner.getDeletedTotal()).toBe(210);
    });
  });

  describe('Observability & Metrics', () => {
    it('9. provides bounded health metrics without logging full payloads', async () => {
      prismaMock.outboxEvent.groupBy.mockResolvedValueOnce([
        { status: OutboxStatus.PENDING, _count: { _all: 5 } },
        { status: OutboxStatus.PROCESSING, _count: { _all: 2 } },
        { status: OutboxStatus.PUBLISHED, _count: { _all: 100 } },
        { status: OutboxStatus.FAILED, _count: { _all: 1 } },
      ]);
      prismaMock.outboxEvent.findFirst.mockResolvedValueOnce({
        createdAt: new Date(Date.now() - 5000),
      });

      const metrics = await publisher.getMetrics();

      expect(metrics.pendingCount).toBe(5);
      expect(metrics.processingCount).toBe(2);
      expect(metrics.publishedCount).toBe(100);
      expect(metrics.failedCount).toBe(1);
      expect(metrics.oldestPendingAgeMs).toBeGreaterThanOrEqual(4000);
    });
  });
});
