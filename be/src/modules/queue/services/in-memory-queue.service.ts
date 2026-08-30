import { Injectable, Logger } from '@nestjs/common';
import {
  IMessageQueueService,
  MessageHandler,
} from '../interfaces/message-queue.interface';

@Injectable()
export class InMemoryQueueService implements IMessageQueueService {
  private readonly logger = new Logger(InMemoryQueueService.name);
  private readonly subscribers = new Map<string, Set<MessageHandler>>();

  async publish<T = any>(topic: string, payload: T): Promise<void> {
    const handlers = this.subscribers.get(topic);
    if (!handlers || handlers.size === 0) {
      this.logger.debug(
        `[InMemoryQueue] No subscribers registered for topic "${topic}". Message buffered/skipped.`,
      );
      return;
    }

    this.logger.debug(
      `[InMemoryQueue] Dispatching topic "${topic}" to ${handlers.size} subscriber(s).`,
    );

    // Execute handlers asynchronously (decoupled from caller)
    for (const handler of handlers) {
      setImmediate(async () => {
        try {
          await handler(payload);
        } catch (error) {
          this.logger.error(
            `[InMemoryQueue] Handler failed for topic "${topic}": ${error?.message || error}`,
            error?.stack,
          );
        }
      });
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
