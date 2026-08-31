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
  MediaLookupResult,
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

    const lookup = await this.wikimediaCommons.findPhotosForActivity({
      name,
      destinationLabel,
      latitude,
      longitude,
    });

    if (lookup.outcome === 'RETRYABLE_FAILURE') {
      // Let the durable outbox retry this request. Do not write FAILED and do
      // not emit ActivityMediaUpdated for a transient upstream incident.
      throw new Error(`Retryable media lookup failure: ${lookup.error}`);
    }

    if (lookup.outcome === 'PERMANENT_FAILURE') {
      await this.persistPermanentFailure(activityId, name, lookup);
      return;
    }

    const photos = lookup.outcome === 'FOUND' ? lookup.photos : [];
    await this.prisma.$transaction(async (tx) => {
      const mediaUpdatedAt = new Date();
      await tx.activity.update({
        where: { id: activityId },
        data: {
          photos: photos.length > 0 ? (photos as any) : Prisma.JsonNull,
          mediaStatus: MediaStatus.ENRICHED,
          mediaUpdatedAt,
          mediaError: null,
        },
      });

      const updatedPayload: ActivityMediaUpdatedPayload = {
        activityId,
        mediaStatus: 'ENRICHED',
        photoCount: photos.length,
        mediaUpdatedAt: mediaUpdatedAt.toISOString(),
        photos,
      };

      await this.outboxService.createInTx(tx, {
        eventType: 'ActivityMediaUpdated',
        payload: updatedPayload,
      });
    });

    this.logger.log(
      lookup.outcome === 'FOUND'
        ? `[MediaEnrichmentProcessor] Enriched activity "${name}" with ${photos.length} authentic photo(s).`
        : `[MediaEnrichmentProcessor] Wikimedia authoritatively returned no documentary photo for "${name}".`,
    );
  }

  private async persistPermanentFailure(
    activityId: string,
    name: string,
    lookup: Extract<MediaLookupResult, { outcome: 'PERMANENT_FAILURE' }>,
  ): Promise<void> {
    const errorMessage = lookup.error.slice(0, 500);
    this.logger.error(
      `[MediaEnrichmentProcessor] Permanent media enrichment failure for activity "${name}" (id: ${activityId}): ${errorMessage}`,
    );

    await this.prisma.$transaction(async (tx) => {
      const mediaUpdatedAt = new Date();
      await tx.activity.update({
        where: { id: activityId },
        data: {
          mediaStatus: MediaStatus.FAILED,
          mediaUpdatedAt,
          mediaError: errorMessage,
        },
      });

      const failedPayload: ActivityMediaUpdatedPayload = {
        activityId,
        mediaStatus: 'FAILED',
        photoCount: 0,
        mediaUpdatedAt: mediaUpdatedAt.toISOString(),
      };

      await this.outboxService.createInTx(tx, {
        eventType: 'ActivityMediaUpdated',
        payload: failedPayload,
      });
    });
  }
}
