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
   * Cover generation is best-effort presentation work, not a reason to fail an
   * otherwise valid Tour. The outcome is nevertheless persisted in Tour
   * metadata before returning/rethrowing so the generation orchestrator may
   * degrade non-fatally without turning the provider failure into a silent
   * catch-and-log only path.
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

    try {
      const imageUrl = await this.imageGenerationService.generateImage(prompt);
      const completedAt = new Date().toISOString();

      await this.prisma.tour.update({
        where: { id: tour.id },
        data: {
          ...(imageUrl ? { coverImage: imageUrl } : {}),
          metadata: {
            ...this.objectMetadata(tour.metadata),
            coverImageGeneration: imageUrl
              ? {
                  status: 'generated',
                  provider: 'ImageGenerationService',
                  completedAt,
                }
              : {
                  status: 'not_generated',
                  provider: 'ImageGenerationService',
                  reasonCode: 'PROVIDER_RETURNED_NO_IMAGE',
                  completedAt,
                },
          },
        },
      });

      if (imageUrl) {
        this.logger.log(`Generated and saved cover image for tour ${tourId}`);
      } else {
        this.logger.warn(
          `Cover image provider returned no image for tour ${tourId}`,
        );
      }

      return imageUrl;
    } catch (error: any) {
      const message = error?.message ?? String(error);
      const failedAt = new Date().toISOString();
      try {
        await this.prisma.tour.update({
          where: { id: tour.id },
          data: {
            metadata: {
              ...this.objectMetadata(tour.metadata),
              coverImageGeneration: {
                status: 'failed',
                provider: 'ImageGenerationService',
                reasonCode: 'COVER_IMAGE_PROVIDER_FAILED',
                error: message,
                failedAt,
              },
            },
          },
        });
      } catch (recordingError: any) {
        this.logger.error(
          `Failed to persist cover-image failure for tour ${tourId}: ${recordingError?.message ?? recordingError}`,
        );
      }
      this.logger.warn(`Failed to generate cover image: ${message}`);
      throw error;
    }
  }

  private objectMetadata(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
