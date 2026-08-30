import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export interface MessageEvent {
  data: string | object;
  id?: string;
  type?: string;
  retry?: number;
}

@Injectable()
export class SSEHubService {
  private readonly logger = new Logger(SSEHubService.name);
  private readonly streams = new Map<string, Subject<MessageEvent>>();
  private readonly clientCounts = new Map<string, number>();

  /**
   * Returns an Observable stream for a given tourId or userId topic.
   */
  getStream(channelId: string): Observable<MessageEvent> {
    if (!this.streams.has(channelId)) {
      this.streams.set(channelId, new Subject<MessageEvent>());
      this.clientCounts.set(channelId, 0);
    }

    const currentCount = this.clientCounts.get(channelId) || 0;
    this.clientCounts.set(channelId, currentCount + 1);
    this.logger.debug(
      `[SSEHub] Client connected to channel "${channelId}" (active clients: ${currentCount + 1}).`,
    );

    return this.streams.get(channelId)!.asObservable();
  }

  /**
   * Registers client disconnection.
   */
  removeClient(channelId: string): void {
    const currentCount = this.clientCounts.get(channelId) || 0;
    if (currentCount <= 1) {
      this.clientCounts.delete(channelId);
      this.streams.get(channelId)?.complete();
      this.streams.delete(channelId);
      this.logger.debug(
        `[SSEHub] Channel "${channelId}" closed (0 active clients remaining).`,
      );
    } else {
      this.clientCounts.set(channelId, currentCount - 1);
      this.logger.debug(
        `[SSEHub] Client disconnected from channel "${channelId}" (remaining: ${currentCount - 1}).`,
      );
    }
  }

  /**
   * Checks if there are active SSE clients listening on this channel.
   */
  hasActiveClients(channelId: string): boolean {
    return (this.clientCounts.get(channelId) ?? 0) > 0;
  }

  /**
   * Emits an event to all connected SSE clients on a channel.
   */
  emit(channelId: string, eventType: string, data: any): boolean {
    const subject = this.streams.get(channelId);
    if (!subject || !this.hasActiveClients(channelId)) {
      return false;
    }

    subject.next({
      type: eventType,
      data,
    });
    this.logger.debug(
      `[SSEHub] Emitted SSE "${eventType}" to channel "${channelId}".`,
    );
    return true;
  }

  /**
   * Broadcasts an event to all active channels.
   */
  broadcastAll(eventType: string, data: any): void {
    for (const [channelId, subject] of this.streams.entries()) {
      if (this.hasActiveClients(channelId)) {
        subject.next({
          type: eventType,
          data,
        });
        this.logger.debug(
          `[SSEHub] Broadcasted SSE "${eventType}" to channel "${channelId}".`,
        );
      }
    }
  }
}
