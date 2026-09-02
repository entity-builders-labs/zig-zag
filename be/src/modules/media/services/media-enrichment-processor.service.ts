import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { MediaStatus } from '@prisma/client';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  IMessageQueueService,
  MESSAGE_QUEUE_SERVICE,
} from '../../queue/interfaces/message-queue.interface';
import { OutboxService } from '../../outbox/services/outbox.service';
import {
  DocumentaryPhoto,
  ExperienceMediaEnrichmentPayload,
  ExperienceMediaUpdatedPayload,
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
    this.messageQueue.subscribe<ExperienceMediaEnrichmentPayload>(
      'ExperienceMediaEnrichmentRequested',
      this.handleMediaEnrichment.bind(this),
    );
    this.logger.log(
      '[MediaEnrichmentProcessor] Subscribed to topic "ExperienceMediaEnrichmentRequested".',
    );
  }

  async handleMediaEnrichment(
    payload: ExperienceMediaEnrichmentPayload,
  ): Promise<void> {
    const { experienceId, name, destinationLabel, latitude, longitude } = payload;
    this.logger.log(
      `[MediaEnrichmentProcessor] Processing media enrichment for experience "${name}" (id: ${experienceId})...`,
    );

    const lookup = await this.wikimediaCommons.findPhotosForExperience({
      name,
      destinationLabel,
      latitude,
      longitude,
    });

    if (lookup.outcome === 'RETRYABLE_FAILURE') {
      // Let the durable outbox retry this request. Do not write FAILED, do not
      // write a negative cache here, and do not emit ExperienceMediaUpdated.
      throw new Error(`Retryable media lookup failure: ${lookup.error}`);
    }

    if (lookup.outcome === 'PERMANENT_FAILURE') {
      await this.persistPermanentFailure(experienceId, name, lookup);
      return;
    }

    const photos = lookup.outcome === 'FOUND' ? lookup.photos : [];
    await this.prisma.$transaction(async (tx) => {
      const mediaUpdatedAt = new Date();

      // URL-only persistence. No binary/image body is downloaded or stored.
      // Upsert on (experienceId,url) makes replay safe while still allowing
      // provider metadata to become richer on later successful lookups.
      for (const [position, photo] of photos.entries()) {
        await tx.experienceMedia.upsert({
          where: {
            experienceId_url: {
              experienceId,
              url: photo.url,
            },
          },
          create: this.mediaRow(experienceId, photo, position),
          update: {
            provider: photo.provider,
            width: photo.width,
            height: photo.height,
            caption: photo.caption,
            author: photo.author,
            authorUrl: photo.authorUrl,
            license: photo.license,
            licenseUrl: photo.licenseUrl,
            sourceUrl: photo.sourceUrl,
            position,
          },
        });
      }

      await tx.experience.update({
        where: { id: experienceId },
        data: {
          mediaStatus: MediaStatus.ENRICHED,
          mediaUpdatedAt,
          mediaError: null,
        },
      });

      const updatedPayload: ExperienceMediaUpdatedPayload = {
        experienceId,
        mediaStatus: 'ENRICHED',
        photoCount: photos.length,
        mediaUpdatedAt: mediaUpdatedAt.toISOString(),
        photos,
      };

      await this.outboxService.createInTx(tx, {
        eventType: 'ExperienceMediaUpdated',
        payload: updatedPayload,
      });
    });

    this.logger.log(
      lookup.outcome === 'FOUND'
        ? `[MediaEnrichmentProcessor] Enriched experience "${name}" with ${photos.length} persisted documentary photo URL(s).`
        : `[MediaEnrichmentProcessor] Wikimedia authoritatively returned no documentary photo for "${name}".`,
    );
  }

  private mediaRow(
    experienceId: string,
    photo: DocumentaryPhoto,
    position: number,
  ) {
    return {
      experienceId,
      provider: photo.provider,
      url: photo.url,
      width: photo.width,
      height: photo.height,
      caption: photo.caption,
      author: photo.author,
      authorUrl: photo.authorUrl,
      license: photo.license,
      licenseUrl: photo.licenseUrl,
      sourceUrl: photo.sourceUrl,
      position,
    };
  }

  private async persistPermanentFailure(
    experienceId: string,
    name: string,
    lookup: Extract<MediaLookupResult, { outcome: 'PERMANENT_FAILURE' }>,
  ): Promise<void> {
    const errorMessage = lookup.error.slice(0, 500);
    this.logger.error(
      `[MediaEnrichmentProcessor] Permanent media enrichment failure for experience "${name}" (id: ${experienceId}): ${errorMessage}`,
    );

    await this.prisma.$transaction(async (tx) => {
      const mediaUpdatedAt = new Date();
      await tx.experience.update({
        where: { id: experienceId },
        data: {
          mediaStatus: MediaStatus.FAILED,
          mediaUpdatedAt,
          mediaError: errorMessage,
        },
      });

      const failedPayload: ExperienceMediaUpdatedPayload = {
        experienceId,
        mediaStatus: 'FAILED',
        photoCount: 0,
        mediaUpdatedAt: mediaUpdatedAt.toISOString(),
      };

      await this.outboxService.createInTx(tx, {
        eventType: 'ExperienceMediaUpdated',
        payload: failedPayload,
      });
    });
  }
}
