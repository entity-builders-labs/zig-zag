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
   * Generate a cover image for a tour.
   *
   * Absence of a Tour or a provider returning no image is represented as null.
   * Provider/database failures are deliberately allowed to propagate so the
   * generation orchestrator can make the non-fatal degradation explicit and
   * record it in trace/metadata instead of silently converting errors to null.
   */
  async generateTourCoverImage(tourId: string): Promise<string | null> {
    const tour = await this.prisma.tour.findUnique({
      where: { id: tourId },
      include: { experiences: { include: { experience: true } } },
    });

    if (!tour) return null;

    this.logger.debug(`Generating cover image for tour: ${tour.name}`);

    const experienceNames = tour.experiences
      .slice(0, 3)
      .map((snapshot) => snapshot.experience.canonicalName)
      .join(', ');

    const prompt = generateCoverImagePrompt(
      tour.name,
      tour.description || tour.name,
      experienceNames,
    );

    const imageUrl = await this.imageGenerationService.generateImage(prompt);

    if (imageUrl) {
      await this.prisma.tour.update({
        where: { id: tour.id },
        data: { coverImage: imageUrl },
      });
      this.logger.log(`Generated and saved cover image for tour ${tourId}`);
    }

    return imageUrl;
  }
}
