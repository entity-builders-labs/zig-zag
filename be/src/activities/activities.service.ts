import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { FindNearbyDto } from './dto/find-nearby.dto';
import { Prisma, Activity } from '@prisma/client';
import { ActivityMetadataService } from './activity-metadata.service';
import { ActivityMetadataDto } from './dto/activity-metadata.dto';
import { JsonValue } from '@prisma/client/runtime/library';
import { LangChainService } from '../shared/ai/langchain.service';

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metadataService: ActivityMetadataService,
    private readonly aiService: LangChainService,
  ) {}

  async create(createActivityDto: CreateActivityDto): Promise<Activity> {
    try {
      this.logger.debug(
        `Creating new activity: ${JSON.stringify(createActivityDto)}`,
      );

      // Generate metadata for the activity
      const metadata =
        await this.metadataService.generateMetadata(createActivityDto);

      // Create activity with metadata
      const activity = await this.prisma.activity.create({
        data: {
          ...createActivityDto,
          location: {
            create: createActivityDto.location,
          },
          photos: {
            create: createActivityDto.photos,
          },
          // Add enhanced description if available
          description:
            metadata.enhancedDescription || createActivityDto.description,
          // Store the complete metadata as JSON in a metadata field (assuming this field exists in Prisma schema)
          metadata: metadata as unknown as JsonValue,
        },
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

  async generateMetadata(id: number): Promise<ActivityMetadataDto> {
    const activity = await this.findOne(id);
    return this.metadataService.generateMetadata(activity);
  }

  /**
   * Create multiple activities, handling duplicates and errors
   * @param createActivityDto Array of activities to create
   * @returns Object with counts of created, duplicate, and error activities
   */
  async createMany(createActivityDto: CreateActivityDto[]): Promise<{
    created: number;
    duplicates: number;
    errors: number;
    activities: Activity[];
  }> {
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
      const activities = await this.prisma.activity.createMany({
        data: createActivityDto.map((dto) => ({
          ...dto,
          location: {
            createOrConnect: {
              where: {
                id: dto.location,
              },
              create: dto.location,
            },
          },
        })),
        skipDuplicates: true,
      });

      // Obtener las actividades recién creadas
      const createdActivities = await this.prisma.activity.findMany({
        where: {
          OR: createActivityDto.map((dto) => ({
            AND: [{ name: dto.name }, { sourceId: dto.sourceId }],
          })),
        },
        orderBy: { createdAt: 'desc' },
        take: activities.count,
      });

      for (const activity of createdActivities) {
        const metadata = await this.metadataService.generateMetadata(activity);
        await this.prisma.activity.update({
          where: { id: activity.id },
          data: { metadata: JSON.stringify(metadata) },
        });
      }

      return {
        created: activities.count,
        duplicates: 0,
        errors: 0,
        activities: createdActivities as Activity[],
      };
    } catch (error) {
      // Handle transaction-level errors
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new BadRequestException(`Database error: ${error.message}`);
      }

      // If there's a transaction-level error, return an error response
      return {
        created: 0,
        duplicates: 0,
        errors: createActivityDto.length,
        activities: [],
      };
    }
  }

  async findAll(
    latitude = '-34.5748341',
    longitude = '-58.4084219',
    radius = 50000,
    limit = 100,
  ): Promise<any[]> {
    try {
      this.logger.debug(
        `Retrieving activities near (${latitude}, ${longitude}) within ${radius}km, limit: ${limit}`,
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

      // Convert radius from kilometers to degrees
      const radiusInDegrees = radius / 111.32; // 111.32 km per degree at the equator

      // Using Haversine formula in Prisma query for more accurate results
      const activities = await this.prisma.$queryRaw<
        (Activity & { distance: number })[]
      >`
       SELECT 
        a.id,
        a.name,
        a.description,
        a.difficulty,
        a.type,
        a.duration,
        a.price,
        a."maxGroupSize",
        a.latitude,
        a.longitude,
        ST_AsText(a.coords) as coords,
        a.rating,
        a."ratingCount",
        a."formattedAddress",
        a."phoneNumber",
        a.website,
        a."businessStatus",
        a."priceLevel",
        a.photos,
        a."openingHours",
        a."createdAt",
        a."updatedAt",
        a."knownActivityTypeName",
        a."externalId",
        a.metadata,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(a.longitude::float8, a.latitude::float8), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${long}::float8, ${lat}::float8), 4326)::geography
        ) / 1000 as distance
      FROM activity a
      WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(a.longitude::float8, a.latitude::float8), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${long}::float8, ${lat}::float8), 4326)::geography,
        ${radiusInDegrees * 1000}
      )
      ORDER BY distance
      LIMIT ${Number(limit)}
      `;

      /*       await this.aiService.saveActivityEmbedding(activities);
      const activityEmbeddings = await this.aiService.findSimilarActivities(
        'places to know about the culture of the country',
      ); */

      this.logger.debug(`Retrieved ${activities.length} activities`);
      return activities;
    } catch (error) {
      this.logger.error('Error retrieving activities', error.stack);
      throw error;
    }
  }

  async findOne(id: number): Promise<Activity> {
    try {
      this.logger.debug(`Retrieving activity with id: ${id}`);

      const activity = await this.prisma.activity.findUnique({
        where: { id },
      });

      /**
       *  
       *  await this.aiService.initializeVectorStore();
       *  const activities = await this.prisma.activity.findMany({
       *    where: {
       *      id: {
       *        not: id,
       *      },
       *    },
       *  });
       *  TODO: use this AI in another service/place
       *  for (const activity of activities) {
       *    await this.aiService.addActivityToVectorStore(activity);
       *  }
      const activityEmbeddings = await this.aiService.findSimilarActivities(
        'places to eat argentinian food',
      );
      const activityRelated = await this.prisma.activity.findUnique({
        where: {
          id: Number(
            activityEmbeddings[activityEmbeddings.length - 1].metadata
              .activityId,
          ),
        },
      });
      
      return activityRelated;
 */

      if (!activity) {
        this.logger.debug(`Activity with id ${id} not found`);
        throw new NotFoundException(`Activity with ID ${id} not found`);
      }

      return activity;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to retrieve activity: ${error.message}`);
      throw error;
    }
  }

  async update(
    id: number,
    updateActivityDto: UpdateActivityDto,
  ): Promise<Activity> {
    try {
      this.logger.debug(
        `Updating activity ${id} with: ${JSON.stringify(updateActivityDto)}`,
      );

      // Check if activity exists
      const existingActivity = await this.findOne(id);

      const activity = await this.prisma.activity.update({
        where: { id },
        data: updateActivityDto,
      });

      this.logger.debug(`Activity ${id} updated successfully`);
      return activity;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to update activity: ${error.message}`);
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new BadRequestException(`Database error: ${error.message}`);
      }
      throw error;
    }
  }

  async remove(id: number): Promise<Activity> {
    try {
      this.logger.debug(`Removing activity with id: ${id}`);

      // Check if activity exists
      await this.findOne(id);

      const activity = await this.prisma.activity.delete({
        where: { id },
      });

      this.logger.debug(`Activity ${id} removed successfully`);
      return activity;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to remove activity: ${error.message}`);
      throw error;
    }
  }

  async findNearbyActivities(
    findNearbyDto: FindNearbyDto,
  ): Promise<Activity[]> {
    try {
      const { latitude, longitude, radius, limit = 10 } = findNearbyDto;

      this.logger.debug(
        `Finding nearby activities at (${latitude}, ${longitude}) within ${radius}km, limit: ${limit}`,
      );

      // Convert radius from kilometers to degrees (approximate)
      const radiusInDegrees = Number(radius) / 111.32;

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
      const activitiesWithDistance = activities
        .map((activity) => {
          const distance = this.calculateDistance(
            Number(latitude),
            Number(longitude),
            activity.latitude,
            activity.longitude,
          );
          return { ...activity, distance };
        })
        .filter((activity) => activity.distance <= Number(radius))
        .sort((a, b) => a.distance - b.distance);

      this.logger.debug(
        `Found ${activitiesWithDistance.length} nearby activities`,
      );
      return activitiesWithDistance;
    } catch (error) {
      this.logger.error(`Failed to find nearby activities: ${error.message}`);
      throw new BadRequestException(
        `Failed to find nearby activities: ${error.message}`,
      );
    }
  }

  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Refresh metadata for an existing activity
   * @param id Activity ID to refresh metadata for
   * @returns Updated activity with refreshed metadata
   */
  async refreshMetadata(id: number): Promise<Activity> {
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
  async batchGenerateMetadata(activityIds: number[]): Promise<Activity[]> {
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
  async getActivityMetadata(id: number): Promise<ActivityMetadataDto> {
    try {
      const activity = await this.findOne(id);
      // If activity has metadata field, parse and return it
      if (activity['metadata']) {
        try {
          // Check if metadata is already an object or if it's a string that needs parsing
          if (
            typeof activity['metadata'] === 'object' &&
            activity['metadata'] !== null
          ) {
            return activity['metadata'] as ActivityMetadataDto;
          } else if (typeof activity['metadata'] === 'string') {
            return JSON.parse(activity['metadata']);
          } else {
            // Handle other types by attempting to stringify then parse
            return JSON.parse(JSON.stringify(activity['metadata']));
          }
        } catch (error) {
          this.logger.error(
            `Failed to parse existing metadata: ${error.message}`,
          );
        }
      }

      // Generate new metadata if none exists or parsing failed
      return await this.metadataService.generateMetadata(activity);
    } catch (error) {
      this.logger.error(`Failed to get activity metadata: ${error.message}`);
      throw error;
    }
  }
}
