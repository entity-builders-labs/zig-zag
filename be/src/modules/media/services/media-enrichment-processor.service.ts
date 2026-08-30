import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, MediaStatus } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  IMessageQueueService,
  MESSAGE_QUEUE_SERVICE,
} from '../../queue/interfaces/message-queue.interface';
import { OutboxService } from '../../outbox/services/outbox.service';
import {
  ActivityMediaEnrichmentPayload,
  ActivityMediaUpdatedPayload,
} from '../interfaces/media.interface';
import { WikimediaCommonsService } from './wikimedia-commons.service';

@Injectable()
export class MediaEnrichmentProcessorService implements OnModuleInit {
  private readonly logger = new Logger(MediaEnrichmentProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxService: OutboxService,
    private readonly wikimediaCommons: WikimediaCommonsService,
    @Inject(MESSAGE_QUEUE_SERVICE)
    private readonly messageQueue: IMessageQueueService,
  ) {}

  onModuleInit(): void {
    this.messageQueue.subscribe<ActivityMediaEnrichmentPayload>(
      'ActivityMediaEnrichmentRequested',
      this.handleMediaEnrichment.bind(this),
    );
    this.logger.log(
      '[MediaEnrichmentProcessor] Subscribed to topic "ActivityMediaEnrichmentRequested".',
    );
  }

  async handleMediaEnrichment(
    payload: ActivityMediaEnrichmentPayload,
  ): Promise<void> {
    const { activityId, name, destinationLabel, latitude, longitude } = payload;
    this.logger.log(
      `[MediaEnrichmentProcessor] Processing media enrichment for activity "${name}" (id: ${activityId})...`,
    );

    try {
      // 1. Fetch authentic documentary photos via Wikimedia Commons
      const photos = await this.wikimediaCommons.findPhotosForActivity({
        name,
        destinationLabel,
        latitude,
        longitude,
      });

      // 2. Persist in database and emit domain event in single transaction
      await this.prisma.$transaction(async (tx) => {
        await tx.activity.update({
          where: { id: activityId },
          data: {
            photos: photos.length > 0 ? (photos as any) : Prisma.JsonNull,
            mediaStatus: MediaStatus.ENRICHED,
            mediaUpdatedAt: new Date(),
            mediaError: null,
          },
        });

        const updatedPayload: ActivityMediaUpdatedPayload = {
          activityId,
          mediaStatus: 'ENRICHED',
          photoCount: photos.length,
        };

        await this.outboxService.createInTx(tx, {
          eventType: 'ActivityMediaUpdated',
          payload: updatedPayload,
        });
      });

      this.logger.log(
        `[MediaEnrichmentProcessor] Enriched activity "${name}" with ${photos.length} authentic photo(s).`,
      );
    } catch (error) {
      const errorMessage = String(error?.message || error);
      this.logger.error(
        `[MediaEnrichmentProcessor] Media enrichment failed for activity "${name}" (id: ${activityId}): ${errorMessage}`,
        error?.stack,
      );

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.activity.update({
            where: { id: activityId },
            data: {
              mediaStatus: MediaStatus.FAILED,
              mediaUpdatedAt: new Date(),
              mediaError: errorMessage.slice(0, 500),
            },
          });

          const failedPayload: ActivityMediaUpdatedPayload = {
            activityId,
            mediaStatus: 'FAILED',
            photoCount: 0,
          };

          await this.outboxService.createInTx(tx, {
            eventType: 'ActivityMediaUpdated',
            payload: failedPayload,
          });
        });
      } catch (txError) {
        this.logger.error(
          `[MediaEnrichmentProcessor] Failed to persist media failure state: ${txError?.message || txError}`,
        );
      }
    }
  }
}
