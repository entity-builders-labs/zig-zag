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
import { Prisma, Activity } from '@prisma/client';
import { ActivityMetadataDto } from '../dto/activity-metadata.dto';
import { JsonValue } from '@prisma/client/runtime/library';
import { LangChainService } from '../../../shared/ai/langchain.service';
import { ActivityMetadataService } from './activity-metadata.service';

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

      // Prepare data - only include fields that exist
      const activityData: any = {
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
        sourceId: createActivityDto.sourceId,
        externalId: createActivityDto.externalId,
        knownActivityTypeName: createActivityDto.knownActivityTypeName,
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

      // Remove undefined values
      Object.keys(activityData).forEach(
        (key) => activityData[key] === undefined && delete activityData[key],
      );

      // Optionally generate metadata if not provided
      if (!activityData.metadata && createActivityDto.name) {
        try {
          const metadata =
            await this.metadataService.generateMetadata(createActivityDto);
          activityData.metadata = metadata as unknown as JsonValue;
          if (metadata.enhancedDescription && !activityData.description) {
            activityData.description = metadata.enhancedDescription;
          }
        } catch (error) {
          this.logger.warn(
            `Failed to generate metadata, continuing without it: ${error.message}`,
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

  async generateMetadata(id: string): Promise<ActivityMetadataDto> {
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
      // Create activities one by one to handle duplicates properly
      const createdActivities: Activity[] = [];
      let duplicates = 0;
      let errors = 0;

      for (const dto of createActivityDto) {
        try {
          const activity = await this.prisma.activity.create({
            data: {
              ...dto,
              location: {
                createOrConnect: {
                  where: {
                    id: dto.location,
                  },
                  create: dto.location,
                },
              },
            },
          });
          createdActivities.push(activity);
        } catch (error) {
          if (error.code === 'P2002') {
            // Unique constraint violation
            duplicates++;
          } else {
            errors++;
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
      const radiusInDegrees = radius / 111.32;

      // Using MongoDB's $geoNear for geospatial queries
      const activities = await this.prisma.activity.findMany({
        where: {
          AND: [
            { latitude: { gte: lat - radiusInDegrees } },
            { latitude: { lte: lat + radiusInDegrees } },
            { longitude: { gte: long - radiusInDegrees } },
            { longitude: { lte: long + radiusInDegrees } },
          ],
        },
        take: Number(limit),
      });

      // Calculate distances and sort
      const activitiesWithDistance = activities
        .map((activity) => {
          const distance = this.calculateDistance(
            lat,
            long,
            activity.latitude,
            activity.longitude,
          );
          return { ...activity, distance };
        })
        .filter((activity) => activity.distance <= radius)
        .sort((a, b) => a.distance - b.distance);

      this.logger.debug(
        `Retrieved ${activitiesWithDistance.length} activities`,
      );

      if (!activitiesWithDistance) {
        this.logger.debug('No activities found');

        return [];
      }

      return activitiesWithDistance;
    } catch (error) {
      this.logger.error('Error retrieving activities', error.stack);
      throw error;
    }
  }

  async findOne(id: string): Promise<Activity> {
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
    id: string,
    updateActivityDto: UpdateActivityDto,
  ): Promise<Activity> {
    try {
      this.logger.debug(
        `Updating activity ${id} with: ${JSON.stringify(updateActivityDto)}`,
      );

      // Check if activity exists (throws if not found)
      await this.findOne(id);

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

  async remove(id: string): Promise<Activity> {
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
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

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
