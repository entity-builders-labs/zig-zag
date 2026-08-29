import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateActivityDto } from '../dto/create-activity.dto';
import { UpdateActivityDto } from '../dto/update-activity.dto';
import { FindNearbyDto } from '../dto/find-nearby.dto';
import { Prisma, Activity, ActivityKind } from '@prisma/client';
import { ActivityMetadataDto } from '../dto/activity-metadata.dto';
import { ActivityMetadataService } from './activity-metadata.service';
import { VectorStoreService } from '../../../shared/ai/services/vector-store.service';
import {
  ActivityWithDistance,
  CreateManyResult,
} from '../interfaces/activity.interface';

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  // Constants for weighted rating calculation
  private readonly PRIOR_MEAN = 4.0; // Prior average rating C
  private readonly PRIOR_WEIGHT = 50; // Minimum ratings to offset small v

  // Constants for distance calculations
  private readonly EARTH_RADIUS_KM = 6371; // Earth's radius in kilometers
  private readonly DEGREES_PER_KM = 111.32; // Approximate degrees per kilometer
  private readonly SCORE_COMPARISON_EPSILON = 1e-9; // Epsilon for floating point comparison

  // Constants for radius conversion
  private readonly METERS_TO_KM_THRESHOLD = 100; // Threshold to determine if radius is in meters

  constructor(
    private readonly prisma: PrismaService,
    private readonly metadataService: ActivityMetadataService,
    private readonly vectorStore: VectorStoreService,
  ) {}

  /**
   * Create a new activity
   * @param createActivityDto Activity data to create
   * @returns Created activity
   */
  async create(createActivityDto: CreateActivityDto): Promise<Activity> {
    // Fast-path: avoid duplicate error by checking the composite unique first
    if (createActivityDto.sourceId && createActivityDto.externalId) {
      const existing = await this.prisma.activity.findUnique({
        where: {
          sourceId_externalId: {
            sourceId: createActivityDto.sourceId,
            externalId: createActivityDto.externalId,
          },
        },
      });
      if (existing) return existing;
    }

    try {
      this.logger.debug(
        `Creating new activity: ${JSON.stringify(createActivityDto)}`,
      );

      // Prepare data - only include fields that exist
      const activityData: Prisma.ActivityCreateInput = {
        name: createActivityDto.name,
        description: createActivityDto.description,
        type: createActivityDto.type,
        difficulty: createActivityDto.difficulty,
        duration: createActivityDto.duration,
        price: createActivityDto.price,
        maxGroupSize: createActivityDto.maxGroupSize,
        latitude: createActivityDto.latitude,
        longitude: createActivityDto.longitude,
        address: createActivityDto.address,
        location: createActivityDto.location,
        photos: createActivityDto.photos,
        source: {
          connect: {
            id: createActivityDto.sourceId,
          },
        },
        externalId: createActivityDto.externalId,
        KnownActivityType: {
          connect: {
            name: createActivityDto.knownActivityTypeName,
          },
        },
        metadata: createActivityDto.metadata,
        // Google Places fields
        rating: createActivityDto.rating,
        ratingCount: createActivityDto.ratingCount,
        formattedAddress: createActivityDto.formattedAddress,
        phoneNumber: createActivityDto.phoneNumber,
        website: createActivityDto.website,
        businessStatus: createActivityDto.businessStatus,
        priceLevel: createActivityDto.priceLevel,
      };

      // Remove undefined values to avoid Prisma errors
      Object.keys(activityData).forEach((key) => {
        if (activityData[key as keyof typeof activityData] === undefined) {
          delete activityData[key as keyof typeof activityData];
        }
      });

      // Optionally generate metadata if not provided
      if (!activityData.metadata && createActivityDto.name) {
        try {
          const metadata =
            await this.metadataService.generateMetadata(createActivityDto);
          activityData.metadata = metadata as unknown as Prisma.InputJsonValue;
          if (metadata.enhancedDescription && !activityData.description) {
            activityData.description = metadata.enhancedDescription;
          }
        } catch (error) {
          this.logger.warn(
            `Failed to generate metadata, continuing without it: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }

      // Optionally generate image if photos are empty
      if (
        (!activityData.photos ||
          (Array.isArray(activityData.photos) &&
            activityData.photos.length === 0)) &&
        createActivityDto.name
      ) {
        try {
          const imageUrl =
            await this.metadataService.generateActivityImage(createActivityDto);
          if (imageUrl) {
            activityData.photos = [imageUrl];
          }
        } catch (error) {
          this.logger.warn(
            `Failed to generate activity image: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }

      // Create activity
      const activity = await this.prisma.activity.create({
        data: activityData,
      });

      this.logger.debug(
        `Activity created successfully with id: ${activity.id}`,
      );
      return activity;
    } catch (error) {
      this.logger.error(`Failed to create activity: ${error.message}`);
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new BadRequestException(`Database error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Generate metadata for an activity
   * @param id Activity ID
   * @returns Generated metadata
   * @throws NotFoundException if activity not found
   */
  async generateMetadata(id: string): Promise<ActivityMetadataDto> {
    const activity = await this.findOne(id);
    return this.metadataService.generateMetadata(activity);
  }

  /**
   * Create multiple activities, handling duplicates and errors
   * @param createActivityDto Array of activities to create
   * @returns Object with counts of created, duplicate, and error activities
   */
  async createMany(
    createActivityDto: CreateActivityDto[],
  ): Promise<CreateManyResult> {
    this.logger.debug(
      `Attempting to create ${createActivityDto.length} activities`,
    );

    if (!createActivityDto.length) {
      this.logger.debug('No activities to create, returning empty array');
      return {
        created: 0,
        duplicates: 0,
        errors: 0,
        activities: [],
      };
    }

    try {
      // Create activities one by one to handle duplicates properly
      const createdActivities: Activity[] = [];
      let duplicates = 0;
      let errors = 0;

      for (const dto of createActivityDto) {
        try {
          const activityData: Prisma.ActivityCreateInput = {
            ...dto,
          };

          if (dto.location) {
            activityData.location = {
              createOrConnect: {
                where: {
                  id:
                    typeof dto.location === 'string'
                      ? dto.location
                      : (dto.location as any).id,
                },
                create:
                  typeof dto.location === 'object' ? dto.location : undefined,
              },
            };
          }

          const activity = await this.prisma.activity.create({
            data: activityData,
          });
          createdActivities.push(activity);
        } catch (error: unknown) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'P2002'
          ) {
            // Unique constraint violation
            duplicates++;
            this.logger.debug(
              `Duplicate activity skipped: ${JSON.stringify(dto)}`,
            );
          } else {
            errors++;
            this.logger.warn(
              `Error creating activity: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
          }
        }
      }

      // Generate metadata for created activities
      for (const activity of createdActivities) {
        const metadata = await this.metadataService.generateMetadata(activity);
        await this.prisma.activity.update({
          where: { id: activity.id },
          data: { metadata: JSON.stringify(metadata) },
        });
      }

      return {
        created: createdActivities.length,
        duplicates,
        errors,
        activities: createdActivities,
      };
    } catch (error) {
      this.logger.error(`Failed to create activities: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find all activities near a location with optional filtering
   * @param latitude Latitude coordinate (string or number)
   * @param longitude Longitude coordinate (string or number)
   * @param radius Search radius in meters
   * @param limit Maximum number of results
   * @param types Optional array of activity types to filter by
   * @returns Array of activities with distance and weighted score
   */
  async findAll(
    latitude: string | number = '-34.5748341',
    longitude: string | number = '-58.4084219',
    radius: number = 50000,
    limit: number = 100,
    types?: string[],
  ): Promise<ActivityWithDistance[]> {
    try {
      this.logger.debug(
        `Retrieving activities near (${latitude}, ${longitude}) within ${radius}m, limit: ${limit}`,
      );

      // Normalize coordinates by replacing commas with decimal points
      const normalizedLat = String(latitude).replace(',', '.');
      const normalizedLong = String(longitude).replace(',', '.');

      // Validate coordinates
      const lat = Number(normalizedLat);
      const long = Number(normalizedLong);

      if (isNaN(lat) || isNaN(long)) {
        throw new BadRequestException('Invalid latitude or longitude values');
      }

      this.logger.debug(`Retrieving activities near (${lat}, ${long})`);

      // Interpret incoming radius in meters; convert to km and degrees
      const radiusKm = Number(radius) / 1000;
      const radiusInDegrees = radiusKm / this.DEGREES_PER_KM;

      // Build where clause with optional type filtering
      const lowerTypes = (types || []).map((t) => String(t).toLowerCase());
      const whereClause: Prisma.ActivityWhereInput = {
        AND: [
          { latitude: { gte: lat - radiusInDegrees } },
          { latitude: { lte: lat + radiusInDegrees } },
          { longitude: { gte: long - radiusInDegrees } },
          { longitude: { lte: long + radiusInDegrees } },
          // Discovery-surface filter shared by every candidate/browse query:
          // AREA is a geographic container, not "something to do" — never a
          // recommendation on its own. Archived activities (retired POIs,
          // or variants that fell below their minimum viable waypoint
          // count) are kept in the DB — tours that already reference them
          // read their own TourActivityWaypoint snapshot unaffected — but
          // stop surfacing here. POI and non-archived variants (curated or
          // not) are included by default.
          { kind: { not: ActivityKind.AREA } },
          { isArchived: false },
        ],
      };

      if (lowerTypes.length > 0) {
        if (Array.isArray(whereClause.AND)) {
          whereClause.AND.push({ knownActivityTypeName: { in: lowerTypes } });
        } else {
          whereClause.AND = [{ knownActivityTypeName: { in: lowerTypes } }];
        }
      }

      // No `take` here: the DB has no way to know weightedScore/distance
      // ahead of time (those are computed below), so truncating at the query
      // level would return an arbitrary subset of the bounding box instead
      // of the actual top-`limit` results — e.g. a famous, highly-rated
      // landmark could be excluded purely by chance of row order.
      const activities = await this.prisma.activity.findMany({
        where: whereClause,
      });

      // Calculate distances, compute weighted Google rating, and sort
      const activitiesWithDistance: ActivityWithDistance[] = activities
        .map((activity) => {
          const distance = this.calculateDistance(
            lat,
            long,
            activity.latitude,
            activity.longitude,
          );
          const v = Number(activity.ratingCount ?? 0);
          const R = Number(activity.rating ?? 0);
          const weightedScore =
            v + this.PRIOR_WEIGHT > 0
              ? (v / (v + this.PRIOR_WEIGHT)) * R +
                (this.PRIOR_WEIGHT / (v + this.PRIOR_WEIGHT)) * this.PRIOR_MEAN
              : 0;
          return { ...activity, distance, weightedScore };
        })
        .filter((activity) => activity.distance <= radiusKm)
        .sort((a, b) => {
          // Primary: weighted score desc; Secondary: distance asc
          const scoreDiff = (b.weightedScore ?? 0) - (a.weightedScore ?? 0);
          if (Math.abs(scoreDiff) > this.SCORE_COMPARISON_EPSILON) {
            return scoreDiff;
          }
          return a.distance - b.distance;
        })
        .slice(0, Number(limit));

      this.logger.debug(
        `Retrieved ${activitiesWithDistance.length} activities`,
      );

      return activitiesWithDistance;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        'Error retrieving activities',
        error instanceof Error ? error.stack : error,
      );
      throw new BadRequestException(
        `Failed to retrieve activities: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Fetch specific activities by id, shaped identically to findAll's
   * distance/weightedScore output — used by PR 9's unified candidate pool
   * to re-query rows just persisted by discovery resolution (a targeted
   * fetch, not reliant on the geographic query's own rank-then-cap
   * incidentally including them).
   * @param ids Activity ids to fetch
   * @param originLatitude Latitude to compute distance from
   * @param originLongitude Longitude to compute distance from
   */
  async findManyByIds(
    ids: string[],
    originLatitude: number,
    originLongitude: number,
  ): Promise<ActivityWithDistance[]> {
    if (ids.length === 0) return [];

    const activities = await this.prisma.activity.findMany({
      where: { id: { in: ids }, isArchived: false },
    });

    return activities.map((activity) => {
      const distance = this.calculateDistance(
        originLatitude,
        originLongitude,
        activity.latitude,
        activity.longitude,
      );
      const v = Number(activity.ratingCount ?? 0);
      const R = Number(activity.rating ?? 0);
      const weightedScore =
        v + this.PRIOR_WEIGHT > 0
          ? (v / (v + this.PRIOR_WEIGHT)) * R +
            (this.PRIOR_WEIGHT / (v + this.PRIOR_WEIGHT)) * this.PRIOR_MEAN
          : 0;
      return { ...activity, distance, weightedScore };
    });
  }

  /**
   * Find a single activity by ID
   * @param id Activity ID
   * @returns Activity if found
   * @throws NotFoundException if activity not found
   */
  async findOne(id: string): Promise<Activity> {
    this.logger.debug(`Retrieving activity with id: ${id}`);

    const activity = await this.prisma.activity.findUnique({
      where: { id },
    });

    if (!activity) {
      this.logger.debug(`Activity with id ${id} not found`);
      throw new NotFoundException(`Activity with ID ${id} not found`);
    }

    return activity;
  }

  /**
   * Same lookup as findOne, but for the single-activity detail endpoint —
   * also resolves this activity's own composite waypoints (a no-op include
   * for a plain POI, which just comes back empty). Kept separate from
   * findOne because that method is also used internally (update/delete/
   * etc.) where the extra relation isn't wanted and would loosen its
   * return type away from the plain Prisma `Activity` those call sites
   * expect.
   * @param id Activity ID
   * @throws NotFoundException if activity not found
   */
  async findOneWithWaypoints(id: string) {
    this.logger.debug(`Retrieving activity with waypoints, id: ${id}`);

    const activity = await this.prisma.activity.findUnique({
      where: { id },
      include: {
        compositeWaypoints: {
          include: {
            waypointActivity: {
              select: { id: true, name: true, latitude: true, longitude: true },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!activity) {
      this.logger.debug(`Activity with id ${id} not found`);
      throw new NotFoundException(`Activity with ID ${id} not found`);
    }

    const { compositeWaypoints, ...rest } = activity;
    return { ...rest, waypoints: compositeWaypoints };
  }

  /**
   * Update an existing activity
   * @param id Activity ID
   * @param updateActivityDto Activity data to update
   * @returns Updated activity
   * @throws NotFoundException if activity not found
   */
  async update(
    id: string,
    updateActivityDto: UpdateActivityDto,
  ): Promise<Activity> {
    this.logger.debug(
      `Updating activity ${id} with: ${JSON.stringify(updateActivityDto)}`,
    );

    // Check if activity exists (throws if not found)
    await this.findOne(id);

    try {
      const activity = await this.prisma.activity.update({
        where: { id },
        data: updateActivityDto,
      });

      this.logger.debug(`Activity ${id} updated successfully`);
      return activity;
    } catch (error) {
      this.logger.error(
        `Failed to update activity: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new BadRequestException(`Database error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Delete an activity
   * @param id Activity ID
   * @returns Deleted activity
   * @throws NotFoundException if activity not found
   */
  async remove(id: string): Promise<Activity> {
    this.logger.debug(`Removing activity with id: ${id}`);

    // Check if activity exists (throws if not found)
    await this.findOne(id);

    const activity = await this.prisma.activity.delete({
      where: { id },
    });

    this.logger.debug(`Activity ${id} removed successfully`);
    return activity;
  }

  /**
   * Find similar activities using pgvector similarity search
   * @param id Activity ID to find similar activities for
   * @param limit Maximum number of similar activities to return
   * @returns Array of similar activities
   * @throws NotFoundException if activity not found
   */
  async findSimilar(id: string, limit: number = 10): Promise<Activity[]> {
    await this.findOne(id);

    const results = await this.vectorStore.findSimilarActivitiesForActivity(
      id,
      limit + 1,
    );

    if (!results || results.length === 0) return [];

    // Extract candidate IDs from metadata or document id
    const candidateIds: string[] = [];
    for (const doc of results) {
      const meta = (doc.metadata ?? {}) as Record<string, unknown>;
      const candidateId =
        (meta.activityId as string) ||
        (meta.id as string) ||
        ((doc as { id?: string }).id as string);
      if (candidateId && candidateId !== id) {
        candidateIds.push(String(candidateId));
      }
      if (candidateIds.length >= limit) break;
    }

    if (candidateIds.length === 0) return [];

    // Fetch activities by IDs (UUID or ObjectId strings - supports both during migration)
    const activities = await this.prisma.activity.findMany({
      where: { id: { in: candidateIds } },
    });
    // Preserve order by similarity (candidateIds order)
    const order = new Map(candidateIds.map((aid, idx) => [aid, idx]));
    return activities.sort(
      (a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0),
    );
  }

  /**
   * Find activities near a location
   * @param findNearbyDto Search parameters
   * @returns Array of activities with distance
   */
  async findNearbyActivities(
    findNearbyDto: FindNearbyDto,
  ): Promise<ActivityWithDistance[]> {
    const { latitude, longitude, radius, limit = 10 } = findNearbyDto;

    this.logger.debug(
      `Finding nearby activities at (${latitude}, ${longitude}) within ${radius}km, limit: ${limit}`,
    );

    try {
      // Interpret incoming radius - if > 100, assume it's in meters, otherwise km
      const radiusKm =
        Number(radius) > this.METERS_TO_KM_THRESHOLD
          ? Number(radius) / 1000
          : Number(radius);
      const radiusInDegrees = radiusKm / this.DEGREES_PER_KM;

      // Calculate bounding box
      const minLat = Number(latitude) - radiusInDegrees;
      const maxLat = Number(latitude) + radiusInDegrees;
      const minLong =
        Number(longitude) -
        radiusInDegrees / Math.cos(Number(latitude) * (Math.PI / 180));
      const maxLong =
        Number(longitude) +
        radiusInDegrees / Math.cos(Number(latitude) * (Math.PI / 180));

      const activities = await this.prisma.activity.findMany({
        where: {
          AND: [
            { latitude: { gte: minLat } },
            { latitude: { lte: maxLat } },
            { longitude: { gte: minLong } },
            { longitude: { lte: maxLong } },
          ],
        },
        take: Number(limit),
      });

      // Calculate exact distances and filter
      const activitiesWithDistance: ActivityWithDistance[] = activities
        .map((activity) => {
          const distance = this.calculateDistance(
            Number(latitude),
            Number(longitude),
            activity.latitude,
            activity.longitude,
          );
          return { ...activity, distance };
        })
        .filter((activity) => activity.distance <= radiusKm)
        .sort((a, b) => a.distance - b.distance);

      this.logger.debug(
        `Found ${activitiesWithDistance.length} nearby activities`,
      );
      return activitiesWithDistance;
    } catch (error) {
      this.logger.error(
        `Failed to find nearby activities: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new BadRequestException(
        `Failed to find nearby activities: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   * @param lat1 Latitude of first point
   * @param lon1 Longitude of first point
   * @param lat2 Latitude of second point
   * @param lon2 Longitude of second point
   * @returns Distance in kilometers
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return this.EARTH_RADIUS_KM * c;
  }

  /**
   * Convert degrees to radians
   * @param degrees Angle in degrees
   * @returns Angle in radians
   */
  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Refresh metadata for an existing activity
   * @param id Activity ID to refresh metadata for
   * @returns Updated activity with refreshed metadata
   */
  async refreshMetadata(id: string): Promise<Activity> {
    try {
      this.logger.debug(`Refreshing metadata for activity with id: ${id}`);

      // Get the existing activity
      const activity = await this.findOne(id);

      // Generate new metadata
      const metadata = await this.metadataService.generateMetadata(activity);

      // Update the activity with new metadata
      const updatedActivity = await this.prisma.activity.update({
        where: { id },
        data: {
          description: metadata.enhancedDescription || activity.description,
          metadata: JSON.stringify(metadata),
        },
      });

      this.logger.debug(`Metadata refreshed for activity ${id}`);
      return updatedActivity;
    } catch (error) {
      this.logger.error(`Failed to refresh metadata: ${error.message}`);
      throw error;
    }
  }

  /**
   * Batch generate metadata for multiple activities
   * @param activityIds Array of activity IDs to generate metadata for
   * @returns Array of updated activities with metadata
   */
  async batchGenerateMetadata(activityIds: string[]): Promise<Activity[]> {
    try {
      this.logger.debug(
        `Batch generating metadata for ${activityIds.length} activities`,
      );

      const updatedActivities: Activity[] = [];

      // Process activities in batches to avoid overwhelming the AI service
      for (const id of activityIds) {
        try {
          const updatedActivity = await this.refreshMetadata(id);
          updatedActivities.push(updatedActivity);
          // Add a small delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          this.logger.error(
            `Error processing activity ${id}: ${error.message}`,
          );
          // Continue with other activities even if one fails
        }
      }

      this.logger.debug(
        `Successfully generated metadata for ${updatedActivities.length}/${activityIds.length} activities`,
      );
      return updatedActivities;
    } catch (error) {
      this.logger.error(`Failed to batch generate metadata: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get metadata for an activity
   * @param id Activity ID to get metadata for
   * @returns Activity metadata
   */
  async getActivityMetadata(id: string): Promise<ActivityMetadataDto> {
    try {
      const activity = await this.findOne(id);
      // If activity has metadata field, parse and return it
      if (activity.metadata) {
        try {
          // Check if metadata is already an object or if it's a string that needs parsing
          if (
            typeof activity.metadata === 'object' &&
            activity.metadata !== null
          ) {
            return activity.metadata as ActivityMetadataDto;
          } else if (typeof activity.metadata === 'string') {
            return JSON.parse(activity.metadata) as ActivityMetadataDto;
          } else {
            // Handle other types by attempting to stringify then parse
            return JSON.parse(
              JSON.stringify(activity.metadata),
            ) as ActivityMetadataDto;
          }
        } catch (error) {
          this.logger.error(
            `Failed to parse existing metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }

      // Generate new metadata if none exists or parsing failed
      return await this.metadataService.generateMetadata(activity);
    } catch (error) {
      this.logger.error(
        `Failed to get activity metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }
}
