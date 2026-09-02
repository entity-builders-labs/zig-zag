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
    // Search tours through their immutable Experience snapshots.
    // This is a rough approximation using bounding box logic for better performance
    const latDelta = radius / 111000; // Roughly 1 degree lat = 111km
    const lngDelta = radius / (111000 * Math.cos((latitude * Math.PI) / 180));

    const nearbyTours = await this.prisma.tour.findMany({
      where: {
        experiences: {
          some: {
            experience: {
              components: {
                some: {
                  geoEntity: {
                    latitude: { gte: latitude - latDelta, lte: latitude + latDelta },
                    longitude: { gte: longitude - lngDelta, lte: longitude + lngDelta },
                  },
                },
              },
            },
          },
        },
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
        experiences: {
          include: {
            experience: true,
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
