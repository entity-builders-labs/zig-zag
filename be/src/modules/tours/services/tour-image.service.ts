import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { ImageGenerationService } from '@shared/ai/image-generation.service';
import { generateCoverImagePrompt } from '../prompts/media-generation.prompt';

@Injectable()
export class TourImageService {
  private readonly logger = new Logger(TourImageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageGenerationService: ImageGenerationService,
  ) {}

  /**
   * Generate a cover image for a tour
   */
  async generateTourCoverImage(tourId: string): Promise<string | null> {
    try {
      const tour = await this.prisma.tour.findUnique({
        where: { id: tourId },
        include: { activities: true },
      });

      if (!tour) return null;

      this.logger.debug(`Generating cover image for tour: ${tour.name}`);

      // Create a rich prompt based on tour details
      const activityNames = tour.activities
        .slice(0, 3)
        .map((a) => a.activityName)
        .join(', ');

      const prompt = generateCoverImagePrompt(
        tour.name,
        tour.description || tour.name,
        activityNames,
      );

      const imageUrl = await this.imageGenerationService.generateImage(prompt);

      if (imageUrl) {
        // Save to DB
        await this.prisma.tour.update({
          where: { id: tour.id },
          data: { coverImage: imageUrl },
        });
        this.logger.log(`Generated and saved cover image for tour ${tourId}`);
      }

      return imageUrl;
    } catch (error) {
      this.logger.error(`Error generating tour cover image: ${error.message}`);
      return null;
    }
  }
}
