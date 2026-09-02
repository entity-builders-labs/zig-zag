import { Injectable } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';

@Injectable()
export class TourLocationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get nearby tours matching a category.
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

    // Nearby lookup is read-only. New tours are created exclusively through
    // the canonical wizard request and its async outbox pipeline.
    return nearbyTours;
  }
}
