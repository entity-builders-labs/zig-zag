import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  IMessageQueueService,
  MESSAGE_QUEUE_SERVICE,
} from '../../queue/interfaces/message-queue.interface';
import {
  ClaimedOutboxEventRow,
  OutboxMetrics,
  OutboxPublisherConfig,
  OutboxStatus,
} from '../interfaces/outbox.interface';

@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);

  private readonly config: Required<OutboxPublisherConfig>;
  private pollTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  // Runtime counters for observability
  private publishAttemptsTotal = 0;
  private publishSuccessTotal = 0;
  private publishFailuresTotal = 0;
  private staleLeaseRecoveriesTotal = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGE_QUEUE_SERVICE)
    private readonly messageQueue: IMessageQueueService,
  ) {
    this.config = {
      pollIntervalMs: 1500,
      batchSize: 50,
      leaseDurationSeconds: 30,
      baseBackoffMs: 2000,
      maxBackoffMs: 300000, // 5 minutes
      autoStart: true,
    };
  }

  configure(customConfig: Partial<OutboxPublisherConfig>): void {
    Object.assign(this.config, customConfig);
  }

  onModuleInit(): void {
    if (this.config.autoStart && process.env.NODE_ENV !== 'test') {
      this.startPolling();
    }
  }

  onModuleDestroy(): void {
    this.stopPolling();
  }

  startPolling(): void {
    if (this.pollTimer) return;
    this.logger.log(
      `[OutboxPublisher] Starting periodic poller (interval: ${this.config.pollIntervalMs}ms, batchSize: ${this.config.batchSize}, leaseDuration: ${this.config.leaseDurationSeconds}s).`,
    );
    this.pollTimer = setInterval(() => {
      this.processNextBatch().catch((err) => {
        this.logger.error(
          `[OutboxPublisher] Unexpected error during batch cycle: ${err?.message || err}`,
          err?.stack,
        );
      });
    }, this.config.pollIntervalMs);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.logger.log('[OutboxPublisher] Periodic poller stopped.');
    }
  }

  /**
   * Main dispatch cycle:
   * Phase 1: Atomically claims a batch using FOR UPDATE SKIP LOCKED and marks them PROCESSING with a lease.
   * Phase 2: Dispatches events to the message broker outside the DB transaction.
   */
  async processNextBatch(): Promise<{
    claimedCount: number;
    publishedCount: number;
    failedCount: number;
  }> {
    if (this.isProcessing) {
      return { claimedCount: 0, publishedCount: 0, failedCount: 0 };
    }

    this.isProcessing = true;
    try {
      const claimedRows = await this.claimBatch(
        this.config.batchSize,
        this.config.leaseDurationSeconds,
      );

      if (claimedRows.length === 0) {
        return { claimedCount: 0, publishedCount: 0, failedCount: 0 };
      }

      this.logger.debug(
        `[OutboxPublisher] Successfully claimed ${claimedRows.length} outbox event(s). Dispatching to broker...`,
      );

      let publishedCount = 0;
      let failedCount = 0;

      for (const event of claimedRows) {
        this.publishAttemptsTotal++;
        try {
          // Broker publication outside DB transaction
          await this.messageQueue.publish(event.eventType, event.payload);

          // Broker confirmed OK: transition to PUBLISHED
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: OutboxStatus.PUBLISHED,
              publishedAt: new Date(),
              leaseUntil: null,
              lastError: null,
            },
          });

          this.publishSuccessTotal++;
          publishedCount++;
          this.logger.debug(
            `[OutboxPublisher] Published event "${event.eventType}" (id: ${event.id}).`,
          );
        } catch (error) {
          this.publishFailuresTotal++;
          failedCount++;
          const errorMessage = String(error?.message || error);
          const truncatedError = errorMessage.slice(0, 1000);
          const isTerminal = event.attemptCount >= event.maxAttempts;

          if (isTerminal) {
            // Exceeded max attempts: move to terminal FAILED status (Dead Letter)
            await this.prisma.outboxEvent.update({
              where: { id: event.id },
              data: {
                status: OutboxStatus.FAILED,
                failedAt: new Date(),
                lastError: truncatedError,
                leaseUntil: null,
              },
            });
            this.logger.error(
              `[OutboxPublisher] Event "${event.eventType}" (id: ${event.id}) reached max attempts (${event.attemptCount}/${event.maxAttempts}). Marked as FAILED. Error: ${truncatedError}`,
            );
          } else {
            // Transient error: calculate exponential backoff and return to PENDING
            const backoffMs = Math.min(
              this.config.maxBackoffMs,
              this.config.baseBackoffMs *
                Math.pow(2, Math.max(0, event.attemptCount - 1)),
            );
            const nextAttemptAt = new Date(Date.now() + backoffMs);

            await this.prisma.outboxEvent.update({
              where: { id: event.id },
              data: {
                status: OutboxStatus.PENDING,
                nextAttemptAt,
                lastError: truncatedError,
                leaseUntil: null,
              },
            });
            this.logger.warn(
              `[OutboxPublisher] Transient error publishing "${event.eventType}" (id: ${event.id}, attempt: ${event.attemptCount}/${event.maxAttempts}). Retrying in ${Math.round(backoffMs / 1000)}s at ${nextAttemptAt.toISOString()}. Error: ${truncatedError}`,
            );
          }
        }
      }

      return { claimedCount: claimedRows.length, publishedCount, failedCount };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Atomically claims eligible rows in a short DB transaction.
   * Eligible criteria:
   * 1. (status = 'PENDING' AND (nextAttemptAt IS NULL OR nextAttemptAt <= NOW()))
   * 2. (status = 'PROCESSING' AND leaseUntil <= NOW()) [Stale Lease Recovery]
   */
  async claimBatch(
    batchSize: number,
    leaseSeconds: number,
  ): Promise<ClaimedOutboxEventRow[]> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Fetch and row-lock eligible events with SKIP LOCKED
      const claimed = await tx.$queryRaw<ClaimedOutboxEventRow[]>`
        SELECT 
          id,
          "eventType",
          payload,
          status,
          "attemptCount",
          "maxAttempts",
          "leaseUntil"
        FROM outbox_event
        WHERE (
          (status = 'PENDING' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW()))
          OR
          (status = 'PROCESSING' AND "leaseUntil" <= NOW())
        )
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED;
      `;

      if (!claimed || claimed.length === 0) {
        return [];
      }

      const claimedIds = claimed.map((r) => r.id);

      // Track stale lease recoveries
      const staleCount = claimed.filter((r) => r.status === 'PROCESSING').length;
      if (staleCount > 0) {
        this.staleLeaseRecoveriesTotal += staleCount;
        this.logger.warn(
          `[OutboxPublisher] Stale lease recovery triggered for ${staleCount} event(s).`,
        );
      }

      // 2. Mark claimed rows as PROCESSING with lease timestamp
      await tx.$executeRaw`
        UPDATE outbox_event
        SET 
          status = 'PROCESSING',
          "claimedAt" = NOW(),
          "leaseUntil" = NOW() + (${leaseSeconds} || ' seconds')::INTERVAL,
          "attemptCount" = "attemptCount" + 1,
          "updatedAt" = NOW()
        WHERE id = ANY(${claimedIds}::text[]);
      `;

      // Return updated in-memory attempt counts
      return claimed.map((c) => ({
        ...c,
        attemptCount: c.attemptCount + 1,
      }));
    });
  }

  /**
   * Returns production-grade observability metrics.
   */
  async getMetrics(): Promise<OutboxMetrics> {
    const [counts, oldestPending] = await Promise.all([
      this.prisma.outboxEvent.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.outboxEvent.findFirst({
        where: { status: OutboxStatus.PENDING },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    const countMap: Record<string, number> = {
      PENDING: 0,
      PROCESSING: 0,
      FAILED: 0,
      PUBLISHED: 0,
    };

    for (const item of counts) {
      countMap[item.status] = item._count._all;
    }

    const oldestPendingAgeMs = oldestPending
      ? Date.now() - oldestPending.createdAt.getTime()
      : null;

    return {
      pendingCount: countMap.PENDING,
      processingCount: countMap.PROCESSING,
      failedCount: countMap.FAILED,
      publishedCount: countMap.PUBLISHED,
      oldestPendingAgeMs,
      publishAttemptsTotal: this.publishAttemptsTotal,
      publishSuccessTotal: this.publishSuccessTotal,
      publishFailuresTotal: this.publishFailuresTotal,
      staleLeaseRecoveriesTotal: this.staleLeaseRecoveriesTotal,
      cleanupDeletedTotal: 0, // Managed by OutboxCleanerService
    };
  }
}
