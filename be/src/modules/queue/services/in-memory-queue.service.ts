import { Injectable, Logger } from '@nestjs/common';
import {
  IMessageQueueService,
  MessageHandler,
} from '../interfaces/message-queue.interface';

export const CRITICAL_TOPICS = new Set<string>([
  'TourGenerationRequested',
  'ExperienceMediaEnrichmentRequested',
]);

/**
 * In-process transport used behind the durable database outbox.
 *
 * Durability lives in OutboxEvent, not in this adapter: when a local consumer
 * exists, publish resolves only after every registered consumer has completed
 * successfully. A consumer failure therefore keeps the outbox row retryable.
 *
 * Critical topics (TourGenerationRequested, ExperienceMediaEnrichmentRequested)
 * require a registered local subscriber and throw an error when missing so the
 * outbox loop retries. Optional topics (e.g. ExperienceMediaUpdated, TourProgressUpdated)
 * are acknowledged as no-ops when no in-process consumer is listening.
 */
@Injectable()
export class InMemoryQueueService implements IMessageQueueService {
  private readonly logger = new Logger(InMemoryQueueService.name);
  private readonly subscribers = new Map<string, Set<MessageHandler>>();

  async publish<T = any>(topic: string, payload: T): Promise<void> {
    const handlers = this.subscribers.get(topic);
    if (!handlers || handlers.size === 0) {
      if (CRITICAL_TOPICS.has(topic)) {
        this.logger.error(
          `[InMemoryQueue] No local subscribers registered for critical topic "${topic}". Outbox must retry.`,
        );
        throw new Error(
          `No local subscribers registered for critical topic "${topic}". Outbox must retry.`,
        );
      }
      this.logger.debug(
        `[InMemoryQueue] No local subscribers registered for optional topic "${topic}". Publication acknowledged as a no-op.`,
      );
      return;
    }

    this.logger.debug(
      `[InMemoryQueue] Dispatching topic "${topic}" to ${handlers.size} subscriber(s).`,
    );

    const results = await Promise.allSettled(
      Array.from(handlers, (handler) => handler(payload)),
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failures.length > 0) {
      const reasons = failures
        .map((failure) => String(failure.reason))
        .join('; ');
      this.logger.error(
        `[InMemoryQueue] ${failures.length}/${handlers.size} handler(s) failed for topic "${topic}": ${reasons}`,
      );
      throw new Error(`Consumer failure for topic "${topic}": ${reasons}`);
    }
  }

  subscribe<T = any>(topic: string, handler: MessageHandler<T>): void {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set());
    }
    this.subscribers.get(topic)!.add(handler as MessageHandler);
    this.logger.debug(
      `[InMemoryQueue] Registered subscriber for topic "${topic}".`,
    );
  }

  unsubscribe(topic: string, handler?: MessageHandler): void {
    if (!handler) {
      this.subscribers.delete(topic);
      this.logger.debug(
        `[InMemoryQueue] Cleared all subscribers for topic "${topic}".`,
      );
      return;
    }

    const handlers = this.subscribers.get(topic);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscribers.delete(topic);
      }
      this.logger.debug(
        `[InMemoryQueue] Unregistered subscriber for topic "${topic}".`,
      );
    }
  }
}
