import { Injectable, Logger } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { GoogleMapsService } from '../crawlers/google-maps/google-maps.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HybridSearchService {
  private readonly logger = new Logger(HybridSearchService.name);
  private readonly SEARCH_RADIUS_THRESHOLD = 0.01; // ~1km
  private readonly CACHE_EXPIRY_HOURS = 24;

  constructor(
    private readonly activitiesService: ActivitiesService,
    private readonly googleMapsService: GoogleMapsService,
    private readonly prisma: PrismaService,
  ) {}

  async searchActivitiesWithCrawling(params: {
    latitude: number;
    longitude: number;
    radius: number;
    limit?: number;
    forceRefresh?: boolean;
  }) {
    const {
      latitude,
      longitude,
      radius,
      limit = 50,
      forceRefresh = false,
    } = params;

    const dbActivities = await this.activitiesService.findAll(
      latitude.toString(),
      longitude.toString(),
      radius,
      limit,
    );

    const shouldCrawl = await this.shouldTriggerCrawling(
      latitude,
      longitude,
      forceRefresh,
    );

    if (shouldCrawl) {
      this.triggerBackgroundCrawling(latitude, longitude, radius).catch(
        (error) => {
          this.logger.error('Background crawling failed:', error);
        },
      );
    }

    return {
      activities: dbActivities,
      fromCache: !shouldCrawl,
      crawlingTriggered: shouldCrawl,
      message: shouldCrawl
        ? 'Searching for new activities in background...'
        : 'Results from database',
    };
  }

  private async shouldTriggerCrawling(
    latitude: number,
    longitude: number,
    forceRefresh: boolean,
  ): Promise<boolean> {
    if (forceRefresh) return true;

    const recentSearch = await this.prisma.crawlerSearch.findFirst({
      where: {
        AND: [
          { latitude: { gte: latitude - this.SEARCH_RADIUS_THRESHOLD } },
          { latitude: { lte: latitude + this.SEARCH_RADIUS_THRESHOLD } },
          { longitude: { gte: longitude - this.SEARCH_RADIUS_THRESHOLD } },
          { longitude: { lte: longitude + this.SEARCH_RADIUS_THRESHOLD } },
          {
            createdAt: {
              gte: new Date(
                Date.now() - this.CACHE_EXPIRY_HOURS * 60 * 60 * 1000,
              ),
            },
          },
        ],
      },
    });

    return !recentSearch;
  }

  private async triggerBackgroundCrawling(
    latitude: number,
    longitude: number,
    radius: number,
  ): Promise<void> {
    this.logger.log(
      `Triggering background crawling for ${latitude}, ${longitude}`,
    );

    try {
      await this.googleMapsService.crawlAndSaveActivities({
        latitude,
        longitude,
        radius: Math.min(radius, 5000),
      });

      this.logger.log(
        `Background crawling completed for ${latitude}, ${longitude}`,
      );
    } catch (error) {
      this.logger.error(
        `Background crawling failed for ${latitude}, ${longitude}:`,
        error,
      );
      throw error;
    }
  }

  async getUpdatedResults(params: {
    latitude: number;
    longitude: number;
    radius: number;
    limit?: number;
  }) {
    const { latitude, longitude, radius, limit = 50 } = params;

    return this.activitiesService.findAll(
      latitude.toString(),
      longitude.toString(),
      radius,
      limit,
    );
  }
}
