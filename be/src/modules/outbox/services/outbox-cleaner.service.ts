import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { OutboxCleanerConfig } from '../interfaces/outbox.interface';

@Injectable()
export class OutboxCleanerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxCleanerService.name);

  private readonly config: Required<OutboxCleanerConfig>;
  private cleanTimer: NodeJS.Timeout | null = null;
  private isCleaning = false;
  private cleanupDeletedTotal = 0;

  constructor(private readonly prisma: PrismaService) {
    this.config = {
      cleanIntervalMs: 24 * 60 * 60 * 1000, // 24 hours (daily)
      publishedRetentionDays: 7,
      failedRetentionDays: 30,
      batchSize: 500,
      autoStart: true,
    };
  }

  configure(customConfig: Partial<OutboxCleanerConfig>): void {
    Object.assign(this.config, customConfig);
  }

  onModuleInit(): void {
    if (this.config.autoStart && process.env.NODE_ENV !== 'test') {
      this.startCleaner();
    }
  }

  onModuleDestroy(): void {
    this.stopCleaner();
  }

  startCleaner(): void {
    if (this.cleanTimer) return;
    this.logger.log(
      `[OutboxCleaner] Starting periodic cleaner (interval: ${Math.round(this.config.cleanIntervalMs / 1000 / 60)}min, publishedRetention: ${this.config.publishedRetentionDays}d, failedRetention: ${this.config.failedRetentionDays}d, batchSize: ${this.config.batchSize}).`,
    );
    this.cleanTimer = setInterval(() => {
      this.runCleanupCycle().catch((err) => {
        this.logger.error(
          `[OutboxCleaner] Error during periodic cleanup cycle: ${err?.message || err}`,
          err?.stack,
        );
      });
    }, this.config.cleanIntervalMs);
  }

  stopCleaner(): void {
    if (this.cleanTimer) {
      clearInterval(this.cleanTimer);
      this.cleanTimer = null;
      this.logger.log('[OutboxCleaner] Periodic cleaner stopped.');
    }
  }

  /**
   * Executes a bounded cleanup cycle:
   * 1. Deletes PUBLISHED rows older than publishedRetentionDays in batches of batchSize.
   * 2. Deletes FAILED rows older than failedRetentionDays in batches of batchSize.
   * Invariants:
   * - PENDING rows are never deleted.
   * - PROCESSING rows are never deleted.
   */
  async runCleanupCycle(): Promise<{
    publishedDeleted: number;
    failedDeleted: number;
    totalDeleted: number;
  }> {
    if (this.isCleaning) {
      return { publishedDeleted: 0, failedDeleted: 0, totalDeleted: 0 };
    }

    this.isCleaning = true;
    try {
      this.logger.log('[OutboxCleaner] Starting bounded cleanup cycle...');

      const publishedDeleted = await this.cleanPublishedBatch(
        this.config.publishedRetentionDays,
        this.config.batchSize,
      );

      const failedDeleted = await this.cleanFailedBatch(
        this.config.failedRetentionDays,
        this.config.batchSize,
      );

      const totalDeleted = publishedDeleted + failedDeleted;
      this.cleanupDeletedTotal += totalDeleted;

      this.logger.log(
        `[OutboxCleaner] Cleanup cycle completed. Deleted ${publishedDeleted} expired PUBLISHED row(s) and ${failedDeleted} expired FAILED row(s).`,
      );

      return { publishedDeleted, failedDeleted, totalDeleted };
    } finally {
      this.isCleaning = false;
    }
  }

  /**
   * Deletes expired PUBLISHED rows iteratively in bounded batches via CTE with LIMIT.
   */
  async cleanPublishedBatch(
    retentionDays: number,
    batchSize: number,
  ): Promise<number> {
    let totalDeleted = 0;
    const maxIterations = 100; // Safety brake
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;
      const deletedCount = await this.prisma.$executeRaw`
        WITH to_delete AS (
          SELECT id FROM outbox_event
          WHERE status = 'PUBLISHED'
            AND "publishedAt" < NOW() - (${retentionDays} || ' days')::INTERVAL
          LIMIT ${batchSize}
        )
        DELETE FROM outbox_event
        WHERE id IN (SELECT id FROM to_delete);
      `;

      totalDeleted += deletedCount;
      if (deletedCount < batchSize) {
        break; // No more eligible rows
      }
    }

    return totalDeleted;
  }

  /**
   * Deletes expired FAILED rows iteratively in bounded batches via CTE with LIMIT.
   */
  async cleanFailedBatch(
    retentionDays: number,
    batchSize: number,
  ): Promise<number> {
    let totalDeleted = 0;
    const maxIterations = 100; // Safety brake
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;
      const deletedCount = await this.prisma.$executeRaw`
        WITH to_delete AS (
          SELECT id FROM outbox_event
          WHERE status = 'FAILED'
            AND COALESCE("failedAt", "updatedAt", "createdAt") < NOW() - (${retentionDays} || ' days')::INTERVAL
          LIMIT ${batchSize}
        )
        DELETE FROM outbox_event
        WHERE id IN (SELECT id FROM to_delete);
      `;

      totalDeleted += deletedCount;
      if (deletedCount < batchSize) {
        break; // No more eligible rows
      }
    }

    return totalDeleted;
  }

  getDeletedTotal(): number {
    return this.cleanupDeletedTotal;
  }
}
