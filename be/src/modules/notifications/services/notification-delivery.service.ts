import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import {
  IMessageQueueService,
  MESSAGE_QUEUE_SERVICE,
} from '../../queue/interfaces/message-queue.interface';
import { SSEHubService } from './sse-hub.service';
import { PushNotificationService } from './push-notification.service';
import {
  TourNotificationPayload,
  ActivityMediaNotificationPayload,
} from '../interfaces/notification.interface';
import { PrismaService } from '../../../core/database/prisma.service';
import { notificationChannel } from '../utils/notification-channel.util';

@Injectable()
export class NotificationDeliveryService implements OnModuleInit {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    @Inject(MESSAGE_QUEUE_SERVICE)
    private readonly messageQueue: IMessageQueueService,
    private readonly sseHub: SSEHubService,
    private readonly pushService: PushNotificationService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    // 1. Tour completed event
    this.messageQueue.subscribe<TourNotificationPayload>(
      'TourCompleted',
      async (payload) => this.handleTourEvent('tour.completed', payload),
    );

    // 2. Tour failed event
    this.messageQueue.subscribe<TourNotificationPayload>(
      'TourFailed',
      async (payload) => this.handleTourEvent('tour.failed', payload),
    );

    // 3. Tour progress updated event
    this.messageQueue.subscribe<TourNotificationPayload>(
      'TourProgressUpdated',
      async (payload) => this.handleTourEvent('tour.progress', payload),
    );

    // 4. Activity media updated event
    this.messageQueue.subscribe<ActivityMediaNotificationPayload>(
      'ActivityMediaUpdated',
      async (payload) => this.handleMediaUpdated(payload),
    );

    this.logger.log(
      '[NotificationDelivery] Subscribed to domain events (TourCompleted, TourFailed, TourProgressUpdated, ActivityMediaUpdated).',
    );
  }

  private async handleTourEvent(
    eventName: string,
    payload: TourNotificationPayload,
  ): Promise<void> {
    const { tourId, userId, message } = payload;
    let sseDelivered = false;

    const tourChannel = notificationChannel.tour(tourId);
    if (this.sseHub.hasActiveClients(tourChannel)) {
      sseDelivered = this.sseHub.emit(tourChannel, eventName, payload);
    }

    // If SSE was not connected and it's a terminal state, deliver via Push Notification
    if (
      !sseDelivered &&
      (eventName === 'tour.completed' || eventName === 'tour.failed')
    ) {
      this.logger.log(
        `[NotificationDelivery] SSE stream inactive for tour "${tourId}". Routing to Push Notification fallback...`,
      );

      const title =
        eventName === 'tour.completed'
          ? '🎉 ¡Tu itinerario está listo!'
          : '⚠️ No pudimos completar tu itinerario';

      const body =
        message ||
        (eventName === 'tour.completed'
          ? 'Abrí Zig-Zag para ver tu recorrido personalizado.'
          : 'Ocurrió un error al generar tu itinerario. Tocá para reintentar.');

      await this.pushService.sendPushNotification({
        userId,
        title,
        body,
        data: { tourId, eventName },
      });
    }
  }

  private async handleMediaUpdated(
    payload: ActivityMediaNotificationPayload,
  ): Promise<void> {
    const { activityId } = payload;
    const channels = new Set<string>([
      notificationChannel.activity(activityId),
    ]);
    const relatedTours = await this.prisma.tourActivity.findMany({
      where: { activityId },
      select: { tourId: true },
      distinct: ['tourId'],
    });
    for (const { tourId } of relatedTours) {
      channels.add(notificationChannel.tour(tourId));
    }

    for (const channel of channels) {
      if (this.sseHub.hasActiveClients(channel)) {
        this.sseHub.emit(channel, 'activity.media.updated', payload);
      }
    }
  }
}
