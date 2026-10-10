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

/**
 * Fired once, after the durable event's own status row is already committed
 * as FAILED — i.e. the publisher has permanently given up and no further
 * redelivery of this exact event will ever occur. Domain-side subscribers
 * use this to reconcile state that was left assuming a retry was still
 * coming (see TourGenerationProcessorService's `handleGenerationRequested`
 * compensation, which sets `generationFailureKind: 'retryable'` on every
 * transient failure but has no way of knowing, on its own, when the outbox
 * has exhausted every attempt it was ever going to make).
 */
export interface OutboxTerminalFailureEvent {
  id: string;
  eventType: string;
  payload: any;
  attemptCount: number;
  maxAttempts: number;
  lastError: string;
}

export type OutboxTerminalFailureHandler = (
  event: OutboxTerminalFailureEvent,
) => Promise<void> | void;
