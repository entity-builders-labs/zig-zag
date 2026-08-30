import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
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

@Injectable()
export class NotificationDeliveryService implements OnModuleInit {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    @Inject(MESSAGE_QUEUE_SERVICE)
    private readonly messageQueue: IMessageQueueService,
    private readonly sseHub: SSEHubService,
    private readonly pushService: PushNotificationService,
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

    // Check SSE on tour channel
    if (this.sseHub.hasActiveClients(tourId)) {
      sseDelivered = this.sseHub.emit(tourId, eventName, payload);
    }

    // Check SSE on user channel
    if (userId && this.sseHub.hasActiveClients(userId)) {
      sseDelivered = this.sseHub.emit(userId, eventName, payload) || sseDelivered;
    }

    // If SSE was not connected and it's a terminal state, deliver via Push Notification
    if (!sseDelivered && (eventName === 'tour.completed' || eventName === 'tour.failed')) {
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
    if (this.sseHub.hasActiveClients(`activity_${activityId}`)) {
      this.sseHub.emit(
        `activity_${activityId}`,
        'activity.media.updated',
        payload,
      );
    }
    // Also broadcast to any active tour/user streams so open tour screens update instantly
    this.sseHub.broadcastAll('activity.media.updated', payload);
  }
}
