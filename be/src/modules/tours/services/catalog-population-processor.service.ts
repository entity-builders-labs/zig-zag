import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  IMessageQueueService,
  MESSAGE_QUEUE_SERVICE,
} from '../../queue/interfaces/message-queue.interface';
import { CatalogPopulationRequestedPayload } from '../interfaces/catalog-population.interface';
import { CatalogPopulationService } from './catalog-population.service';

@Injectable()
export class CatalogPopulationProcessorService implements OnModuleInit {
  constructor(
    private readonly population: CatalogPopulationService,
    @Inject(MESSAGE_QUEUE_SERVICE)
    private readonly queue: IMessageQueueService,
  ) {}

  onModuleInit(): void {
    this.queue.subscribe<CatalogPopulationRequestedPayload>(
      'CatalogPopulationRequested',
      this.handleRequested.bind(this),
    );
  }

  async handleRequested(payload: CatalogPopulationRequestedPayload) {
    await this.population.process(payload.jobId);
  }
}
