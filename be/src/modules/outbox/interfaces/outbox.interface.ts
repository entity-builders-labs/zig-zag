import { OutboxStatus, OutboxEvent } from '@prisma/client';

export { OutboxStatus, OutboxEvent };

export interface CreateOutboxEventDto<T = any> {
  eventType: string;
  payload: T;
  maxAttempts?: number;
}

export interface ClaimedOutboxEventRow {
  id: string;
  eventType: string;
  payload: any;
  status: OutboxStatus;
  attemptCount: number;
  maxAttempts: number;
  leaseUntil: Date | null;
}

export interface OutboxMetrics {
  pendingCount: number;
  processingCount: number;
  failedCount: number;
  publishedCount: number;
  oldestPendingAgeMs: number | null;
  publishAttemptsTotal: number;
  publishSuccessTotal: number;
  publishFailuresTotal: number;
  staleLeaseRecoveriesTotal: number;
  cleanupDeletedTotal: number;
}

export interface OutboxPublisherConfig {
  pollIntervalMs?: number;
  batchSize?: number;
  leaseDurationSeconds?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  autoStart?: boolean;
}

export interface OutboxCleanerConfig {
  cleanIntervalMs?: number;
  publishedRetentionDays?: number;
  failedRetentionDays?: number;
  batchSize?: number;
  autoStart?: boolean;
}
