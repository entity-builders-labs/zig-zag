import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import {
  IMessageQueueService,
  MESSAGE_QUEUE_SERVICE,
} from '../../queue/interfaces/message-queue.interface';
import { TourGenerationRequestedPayload } from '../interfaces/tour-generation-events.interface';
import { TourActivityGenerationService } from './tour-activity-generation.service';
import { ToursService } from './tours.service';

@Injectable()
export class TourGenerationProcessorService implements OnModuleInit {
  private readonly logger = new Logger(TourGenerationProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toursService: ToursService,
    private readonly tourActivityGenerationService: TourActivityGenerationService,
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
      tour.activities.length > 0
    ) {
      this.logger.debug(
        `[TourGenerationProcessor] ${payload.eventKey} already completed; duplicate delivery is a no-op.`,
      );
      return;
    }

    if (metadata.generationStatus === 'failed') {
      // Generation failures are persisted as terminal domain state by the
      // generator. A redelivered outbox event must be acknowledged without
      // re-running providers/planning; explicit user retry creates a new
      // generation attempt through the normal API path.
      this.logger.debug(
        `[TourGenerationProcessor] ${payload.eventKey} already failed; duplicate delivery is a no-op.`,
      );
      return;
    }

    if (metadata.generationStatus === 'generating') {
      // A TourGenerationRequested outbox row is acknowledged only after this
      // handler completes. Seeing `generating` at the start of a redelivery
      // therefore means a previous process died after changing tour state but
      // before the durable event was acknowledged. Move it back to pending so
      // the canonical generator can restart deterministically from the stored
      // generationRequest.
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
        `[TourGenerationProcessor] Recovering interrupted generation for tour ${payload.tourId}.`,
      );
    }

    await this.tourActivityGenerationService.generateTourActivities(
      payload.tourId,
    );
  }
}
