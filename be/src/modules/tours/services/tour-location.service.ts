import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { generateNearbyTourPrompt } from '../prompts/nearby-tour.prompt';
import { TourGenerationService } from './tour-generation.service';

@Injectable()
export class TourLocationService {
  private readonly logger = new Logger(TourLocationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tourGenerationService: TourGenerationService,
  ) {}

  /**
   * Get nearby tours matching a category, or generate if none found
   */
  async getNearbyTours(
    latitude: number,
    longitude: number,
    category: string = 'walking',
    radius: number = 5000, // 5km default
  ) {
    // 1. Search for existing tours in the area
    // We'll check if any activity in the tour is within the radius
    // This is a rough approximation using bounding box logic for better performance
    const latDelta = radius / 111000; // Roughly 1 degree lat = 111km
    const lngDelta = radius / (111000 * Math.cos((latitude * Math.PI) / 180));

    const nearbyTours = await this.prisma.tour.findMany({
      where: {
        OR: [
          // Check inline activities
          {
            activities: {
              some: {
                activityLatitude: {
                  gte: latitude - latDelta,
                  lte: latitude + latDelta,
                },
                activityLongitude: {
                  gte: longitude - lngDelta,
                  lte: longitude + lngDelta,
                },
              },
            },
          },
          // Check linked activities
          {
            activities: {
              some: {
                activity: {
                  latitude: {
                    gte: latitude - latDelta,
                    lte: latitude + latDelta,
                  },
                  longitude: {
                    gte: longitude - lngDelta,
                    lte: longitude + lngDelta,
                  },
                },
              },
            },
          },
        ],
        // Filter by category (case insensitive search in name/description)
        AND: [
          {
            OR: [
              { name: { contains: category, mode: 'insensitive' } },
              { description: { contains: category, mode: 'insensitive' } },
              // { metadata: { path: ['category'], string_contains: category } } // If we had structured category
            ],
          },
        ],
      },
      include: {
        activities: {
          include: {
            activity: true,
          },
          orderBy: {
            order: 'asc',
          },
        },
      },
      take: 10,
    });

    // 2. If we found enough tours, return them
    if (nearbyTours.length >= 3) {
      return nearbyTours;
    }

    // 3. If not enough tours, generate a new one using AI
    // We'll generate one tour to add to the collection
    try {
      const prompt = generateNearbyTourPrompt(category);

      // Generate tour (this saves it to DB)
      const generatedTour = await this.tourGenerationService.generateTour(
        prompt,
        {
          latitude,
          longitude,
          radius: radius * 2, // Search slightly wider for activities
          includeExistingActivities: true,
        },
      );

      // Add to our results
      return [...nearbyTours, generatedTour];
    } catch (error) {
      this.logger.error(
        `Failed to generate nearby tour: ${error.message}`,
        error.stack,
      );
      // If generation fails, just return what we found (if any)
      return nearbyTours;
    }
  }
}
