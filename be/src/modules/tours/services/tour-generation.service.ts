import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CreateTourDto } from '../dto/create-tour.dto';
import { TourGenerationRequest } from '../interfaces/tour-generation.interface';
import { buildWizardSelectionInput } from '../utils/prompt-builder.util';
import { ToursService } from './tours.service';

@Injectable()
export class TourGenerationService {
  private readonly logger = new Logger(TourGenerationService.name);

  constructor(
    private readonly toursService: ToursService,
  ) {}

  /**
   * Creates the canonical wizard Tour and its durable generation request.
   * ToursService writes both records in one transaction; generation is owned by
   * TourGenerationProcessorService, not by this HTTP request process.
   */
  async createTourFromWizard(request: TourGenerationRequest, ownerId: string) {
    const startTime = Date.now();
    const selectorInput = buildWizardSelectionInput(request);

    this.logger.log(
      `Creating tour from wizard with canonical intent: ${selectorInput.substring(0, 100)}...`,
    );

    try {
      const tourName = request.destination.label || 'Nuevo Tour';

      const tourData: CreateTourDto = {
        ownerId,
        name: tourName,
        description: 'Tour personalizado',
        duration: undefined,
        totalDays: request.days,
        prompt: selectorInput,
        categories: request.categories,
        metadata: {
          generatedAt: new Date().toISOString(),
          generationRequest: request as any,
          generationStatus: 'pending',
        },
      };

      const createStartTime = Date.now();
      const tour = await this.toursService.create(tourData);
      const createTime = Date.now() - createStartTime;
      const totalTime = Date.now() - startTime;

      this.logger.log(
        `Tour created with ID ${tour.id} and durable generation request (DB: ${createTime}ms, total: ${totalTime}ms).`,
      );
      return tour;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      const errorMessage = error?.message || String(error);

      this.logger.error(
        `Error creating tour from wizard after ${totalTime}ms: ${errorMessage}`,
        error.stack,
      );

      throw new BadRequestException(`Failed to create tour: ${errorMessage}`);
    }
  }

}
