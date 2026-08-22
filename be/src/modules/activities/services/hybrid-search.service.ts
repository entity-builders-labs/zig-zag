import { Injectable, Logger } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { GooglePlacesService } from '../../integrations/google-places/google-places.service';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class HybridSearchService {
  private readonly logger = new Logger(HybridSearchService.name);
  private readonly SEARCH_RADIUS_THRESHOLD = 0.01; // ~1km
  private readonly CACHE_EXPIRY_HOURS = 24;
  private readonly inFlightCrawls = new Set<string>();

  constructor(
    private readonly activitiesService: ActivitiesService,
    private readonly googlePlacesService: GooglePlacesService,
    private readonly prisma: PrismaService,
  ) {}

  async searchActivitiesWithCrawling(params: {
    latitude: number;
    longitude: number;
    radius: number;
    limit?: number;
    forceRefresh?: boolean;
    types?: string[];
  }) {
    const {
      latitude,
      longitude,
      radius,
      limit = 50,
      forceRefresh = false,
      types,
    } = params;

    // Base query por proximidad
    // Use default radius from env if not provided
    const effectiveRadius =
      typeof radius === 'number'
        ? radius
        : Number(process.env.BACKEND_DEFAULT_RADIUS_METERS ?? 3000);

    let dbActivities = await this.activitiesService.findAll(
      latitude.toString(),
      longitude.toString(),
      effectiveRadius,
      limit,
      types,
    );

    // Filtro por tipo si viene especificado
    if (types && types.length > 0) {
      const typeSet = new Set(types.map((t) => t.toLowerCase()));
      dbActivities = dbActivities.filter((a: any) =>
        a.knownActivityTypeName
          ? typeSet.has(String(a.knownActivityTypeName).toLowerCase())
          : false,
      );
    }

    const shouldCrawl = await this.shouldTriggerCrawling(
      latitude,
      longitude,
      forceRefresh,
    );

    const crawlingTriggered = shouldCrawl
      ? this.startBackgroundCrawling(latitude, longitude, effectiveRadius)
      : false;

    return {
      activities: dbActivities,
      fromCache: !crawlingTriggered,
      crawlingTriggered,
      message: crawlingTriggered
        ? 'Searching for new activities in background...'
        : 'Results from database',
    };
  }

  private crawlKey(latitude: number, longitude: number): string {
    return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  }

  private startBackgroundCrawling(
    latitude: number,
    longitude: number,
    radius: number,
  ): boolean {
    const key = this.crawlKey(latitude, longitude);
    if (this.inFlightCrawls.has(key)) {
      this.logger.debug(`Background crawl already running for ${key}`);
      return false;
    }

    this.inFlightCrawls.add(key);
    this.triggerBackgroundCrawling(latitude, longitude, radius)
      .catch((error) => {
        this.logger.error('Background crawling failed:', error);
      })
      .finally(() => this.inFlightCrawls.delete(key));
    return true;
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
      const attemptedAt = new Date();
      await this.prisma.crawlerSearch.upsert({
        where: { latitude_longitude: { latitude, longitude } },
        create: { latitude, longitude, createdAt: attemptedAt },
        update: { createdAt: attemptedAt },
      });

      await this.googlePlacesService.crawlAndSaveActivities({
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
