import { Injectable, Logger } from '@nestjs/common';
import {
  IMessageQueueService,
  MessageHandler,
} from '../interfaces/message-queue.interface';

/**
 * In-process transport used behind the durable database outbox.
 *
 * Durability lives in OutboxEvent, not in this adapter: publish must therefore
 * resolve only after every registered consumer has completed successfully.
 * If there is no consumer, or any consumer fails, the promise rejects and the
 * outbox row remains retryable instead of being falsely marked PUBLISHED.
 */
@Injectable()
export class InMemoryQueueService implements IMessageQueueService {
  private readonly logger = new Logger(InMemoryQueueService.name);
  private readonly subscribers = new Map<string, Set<MessageHandler>>();

  async publish<T = any>(topic: string, payload: T): Promise<void> {
    const handlers = this.subscribers.get(topic);
    if (!handlers || handlers.size === 0) {
      const message = `No subscribers registered for topic "${topic}"`;
      this.logger.warn(`[InMemoryQueue] ${message}. Publication not acknowledged.`);
      throw new Error(message);
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
      const reasons = failures.map((failure) => String(failure.reason)).join('; ');
      this.logger.error(
        `[InMemoryQueue] ${failures.length}/${handlers.size} handler(s) failed for topic "${topic}": ${reasons}`,
      );
      throw new Error(
        `Consumer failure for topic "${topic}": ${reasons}`,
      );
    }
  }

  subscribe<T = any>(topic: string, handler: MessageHandler<T>): void {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set());
    }
    this.subscribers.get(topic)!.add(handler as MessageHandler);
    this.logger.debug(`[InMemoryQueue] Registered subscriber for topic "${topic}".`);
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
