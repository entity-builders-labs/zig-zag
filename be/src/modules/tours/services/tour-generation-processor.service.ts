import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import {
  IMessageQueueService,
  MESSAGE_QUEUE_SERVICE,
} from '../../queue/interfaces/message-queue.interface';
import { TourGenerationRequestedPayload } from '../interfaces/tour-generation-events.interface';
import { classifyGenerationFailure } from '../utils/generation-failure-classifier.util';
import { ExperienceGenerationService } from './experience-generation.service';
import { ToursService } from './tours.service';

@Injectable()
export class TourGenerationProcessorService implements OnModuleInit {
  private readonly logger = new Logger(TourGenerationProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toursService: ToursService,
    private readonly experienceGenerationService: ExperienceGenerationService,
    @Inject(MESSAGE_QUEUE_SERVICE)
    private readonly messageQueue: IMessageQueueService,
  ) {}

  onModuleInit(): void {
    this.messageQueue.subscribe<TourGenerationRequestedPayload>(
      'TourGenerationRequested',
      this.handleGenerationRequested.bind(this),
    );
    this.logger.log(
      '[TourGenerationProcessor] Subscribed to topic "TourGenerationRequested".',
    );
  }

  async handleGenerationRequested(
    payload: TourGenerationRequestedPayload,
  ): Promise<void> {
    const tour = await this.toursService.findOne(payload.tourId);
    const metadata = (tour.metadata ?? {}) as any;

    if (
      metadata.generationStatus === 'completed' &&
      (tour.experiences?.length ?? 0) > 0
    ) {
      this.logger.debug(
        `[TourGenerationProcessor] ${payload.eventKey} already completed; duplicate delivery is a no-op.`,
      );
      return;
    }

    if (
      metadata.generationStatus === 'failed' &&
      metadata.generationFailureKind !== 'retryable'
    ) {
      // Only explicitly terminal failures are acknowledged as no-ops. A
      // transient provider failure is compensated back to pending below and
      // must never be converted into a successful outbox acknowledgement.
      this.logger.debug(
        `[TourGenerationProcessor] ${payload.eventKey} already failed terminally; duplicate delivery is a no-op.`,
      );
      return;
    }

    if (
      metadata.generationStatus === 'generating' ||
      metadata.generationFailureKind === 'retryable'
    ) {
      await this.prisma.tour.update({
        where: { id: payload.tourId },
        data: {
          metadata: {
            ...metadata,
            generationStatus: 'pending',
            generationMessage: 'Recuperando generación interrumpida...',
            generationRecoveredAt: new Date().toISOString(),
          },
        },
      });
      this.logger.warn(
        `[TourGenerationProcessor] Recovering interrupted/retryable generation for tour ${payload.tourId}.`,
      );
    }

    try {
      await this.experienceGenerationService.generateTourExperiences(
        payload.tourId,
      );
    } catch (error: unknown) {
      const latestTour = await this.toursService.findOne(payload.tourId);
      const latestMetadata = (latestTour.metadata ?? {}) as any;
      const classification = classifyGenerationFailure(error, latestMetadata);

      if (!classification.retryable) {
        throw error;
      }

      // ExperienceGenerationService persists a terminal-looking failure before
      // propagating its exception. Compensate it while the original durable
      // TourGenerationRequested event is still PROCESSING. The publisher will
      // observe this rethrow, move that event back to PENDING with backoff, and
      // redeliver it. Any TourFailed row created by the generator is still
      // unpublished at this point and is removed atomically with the state
      // correction so users never receive a false terminal notification.
      const retryableMetadata = { ...latestMetadata };
      delete retryableMetadata.generationFailedAt;
      delete retryableMetadata.generationCompletedAt;
      const retryCount = Number(latestMetadata.generationRetryCount ?? 0) + 1;
      const retryableAt = new Date().toISOString();

      await this.prisma.$transaction(async (tx) => {
        await tx.tour.update({
          where: { id: payload.tourId },
          data: {
            metadata: {
              ...retryableMetadata,
              generationStatus: 'pending',
              generationFailureKind: 'retryable',
              generationRetryReasonCode: classification.reasonCode,
              generationRetryCount: retryCount,
              generationRetryableAt: retryableAt,
              generationMessage: `Reintento pendiente: ${classification.reasonCode}`,
              generationError: classification.message,
              generationTrace: {
                ...(latestMetadata.generationTrace ?? {}),
                executionSummary: {
                  ...(latestMetadata.generationTrace?.executionSummary ?? {}),
                  status: 'retryable',
                  retryable: true,
                  reasonCode: classification.reasonCode,
                  failure: classification.message,
                },
              },
            },
          },
        });
        await tx.outboxEvent.deleteMany({
          where: {
            eventType: 'TourFailed',
            status: 'PENDING',
            payload: {
              path: ['tourId'],
              equals: payload.tourId,
            },
          },
        });
      });

      this.logger.warn(
        `[TourGenerationProcessor] Retryable generation failure for ${payload.tourId}: ${classification.reasonCode}. Durable event will be retried.`,
      );
      throw error;
    }
  }
}
