export const MESSAGE_QUEUE_SERVICE = 'MESSAGE_QUEUE_SERVICE';

export type MessageHandler<T = any> = (payload: T) => Promise<void>;

export interface IMessageQueueService {
  /**
   * Publishes a message payload to a designated topic/queue.
   * Throws an error if the publication fails to allow the publisher to schedule retries.
   */
  publish<T = any>(topic: string, payload: T): Promise<void>;

  /**
   * Subscribes a consumer handler to a designated topic/queue.
   */
  subscribe<T = any>(topic: string, handler: MessageHandler<T>): void;

  /**
   * Unsubscribes a consumer handler or all handlers for a topic.
   */
  unsubscribe(topic: string, handler?: MessageHandler): void;
}
