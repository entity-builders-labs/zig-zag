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
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

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
      maxBackoffMs: 300000,
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
   * Claims durable database work, then dispatches it outside the claim
   * transaction. A PUBLISHED transition happens only after the selected
   * transport/consumer boundary has acknowledged completion.
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
        `[OutboxPublisher] Successfully claimed ${claimedRows.length} outbox event(s). Dispatching...`,
      );

      let publishedCount = 0;
      let failedCount = 0;

      for (const event of claimedRows) {
        this.publishAttemptsTotal++;
        try {
          await this.publishWithLeaseHeartbeat(event);

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
   * Long-running consumers such as tour generation can exceed the initial
   * lease. Renew it while the handler owns the row so another application
   * instance cannot recover the same event as stale and execute it in
   * parallel. If this process dies, heartbeat stops and normal stale-lease
   * recovery becomes possible after leaseDurationSeconds.
   */
  private async publishWithLeaseHeartbeat(
    event: ClaimedOutboxEventRow,
  ): Promise<void> {
    const leaseMs = this.config.leaseDurationSeconds * 1000;
    const heartbeatMs = Math.max(1000, Math.floor(leaseMs / 3));
    let heartbeatRunning = false;

    const renew = async () => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      try {
        const leaseUntil = new Date(Date.now() + leaseMs);
        const updated = await this.prisma.outboxEvent.updateMany({
          where: {
            id: event.id,
            status: OutboxStatus.PROCESSING,
          },
          data: { leaseUntil },
        });
        if (updated.count === 0) {
          this.logger.warn(
            `[OutboxPublisher] Lease heartbeat lost ownership of event ${event.id}.`,
          );
        }
      } catch (error: any) {
        this.logger.warn(
          `[OutboxPublisher] Lease heartbeat failed for event ${event.id}: ${error?.message || error}`,
        );
      } finally {
        heartbeatRunning = false;
      }
    };

    const timer = setInterval(() => {
      void renew();
    }, heartbeatMs);
    try {
      await this.messageQueue.publish(event.eventType, event.payload);
    } finally {
      clearInterval(timer);
    }
  }

  /**
   * Atomically claims eligible rows in a short DB transaction.
   */
  async claimBatch(
    batchSize: number,
    leaseSeconds: number,
  ): Promise<ClaimedOutboxEventRow[]> {
    return this.prisma.$transaction(async (tx) => {
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
      const staleCount = claimed.filter(
        (r) => r.status === 'PROCESSING',
      ).length;
      if (staleCount > 0) {
        this.staleLeaseRecoveriesTotal += staleCount;
        this.logger.warn(
          `[OutboxPublisher] Stale lease recovery triggered for ${staleCount} event(s).`,
        );
      }

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

      return claimed.map((c) => ({
        ...c,
        attemptCount: c.attemptCount + 1,
      }));
    });
  }

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
      cleanupDeletedTotal: 0,
    };
  }
}
