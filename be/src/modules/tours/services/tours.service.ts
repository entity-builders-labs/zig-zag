import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { CreateTourDto } from '../dto/create-tour.dto';
import { UpdateTourDto } from '../dto/update-tour.dto';
import { isValidId } from '@shared/utils/id-validator';
import { prepareActivityDataForCreate } from '../utils/activity-transformer.util';
import { OutboxService } from '../../outbox/services/outbox.service';

@Injectable()
export class ToursService {
  private readonly logger = new Logger(ToursService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Create a tour - flexible method that accepts partial data.
   *
   * Canonical wizard-generated tours are created atomically with their
   * TourGenerationRequested event. The database outbox is therefore the durable
   * source of work; there is no crash window between committing the Tour and
   * scheduling its generation.
   */
  async create(createTourDto: CreateTourDto) {
    const { activities, ...tourData } = createTourDto;

    if (activities?.length) {
      const activityIds = activities
        .map((a) => a.activityId)
        .filter((id): id is string => isValidId(id));

      if (activityIds.length > 0) {
        try {
          const existingActivities = await this.prisma.activity.findMany({
            where: { id: { in: activityIds } },
          });

          if (existingActivities.length !== activityIds.length) {
            this.logger.warn(
              `Some activity IDs are invalid. Expected ${activityIds.length}, found ${existingActivities.length}`,
            );
          }
        } catch (error) {
          this.logger.error(`Error validating activity IDs: ${error.message}`);
        }
      }
    }

    const tourDataClean: any = {
      ownerId: tourData.ownerId,
      name: tourData.name,
      description: tourData.description,
      price: tourData.price,
      duration: tourData.duration,
      maxGroupSize: tourData.maxGroupSize,
      startDates: tourData.startDates || [],
      totalDays: tourData.totalDays,
      totalDistance: tourData.totalDistance,
      estimatedBudget: tourData.estimatedBudget,
      recommendedGroupSize: tourData.recommendedGroupSize,
      prompt: tourData.prompt,
      query: tourData.query,
      metadata: tourData.metadata,
      categories: tourData.categories,
    };

    Object.keys(tourDataClean).forEach(
      (key) => tourDataClean[key] === undefined && delete tourDataClean[key],
    );

    return this.prisma.$transaction(async (tx) => {
      const tour = await tx.tour.create({
        data: {
          ...tourDataClean,
          activities: {
            create:
              activities?.map((activityDto, index) =>
                prepareActivityDataForCreate(activityDto, index),
              ) || [],
          },
        },
        include: {
          activities: {
            include: {
              activity: true,
            },
          },
          experiences: {
            include: {
              experience: {
                include: {
                  components: true,
                  traits: true,
                },
              },
              components: true,
            },
            orderBy: [{ dayNumber: 'asc' }, { order: 'asc' }],
          },
        },
      });

      const metadata = tourData.metadata as any;
      const isCanonicalPendingGeneration =
        metadata?.generationStatus === 'pending' &&
        metadata?.generationRequest?.contractVersion === 1;
      if (isCanonicalPendingGeneration) {
        await this.outboxService.createInTx(tx, {
          eventType: 'TourGenerationRequested',
          payload: {
            eventKey: `tour-generation:${tour.id}`,
            tourId: tour.id,
            userId: tour.ownerId ?? undefined,
            requestedAt: new Date().toISOString(),
          },
        });
      }

      return tour;
    });
  }

  async findAll(
    ownerId: string,
    page = 1,
    limit = 100,
    category?: string,
    latitude?: number,
    longitude?: number,
    radius?: number,
  ) {
    const skip = (page - 1) * limit;

    const where: any = { ownerId };

    if (category) {
      where.categories = {
        has: category,
      };
    }

    if (
      latitude !== undefined &&
      longitude !== undefined &&
      radius !== undefined
    ) {
      where.activities = {
        some: {
          activityLatitude: {
            gte: latitude - radius,
            lte: latitude + radius,
          },
          activityLongitude: {
            gte: longitude - radius,
            lte: longitude + radius,
          },
        },
      };
    }

    const [total, tours] = await this.prisma.$transaction([
      this.prisma.tour.count({
        where,
      }),

      this.prisma.tour.findMany({
        where,
        take: limit,
        skip: skip,
        include: {
          activities: {
            include: {
              activity: true,
            },
          },
          experiences: {
            include: {
              experience: {
                include: {
                  components: true,
                  traits: true,
                },
              },
              components: true,
            },
            orderBy: [{ dayNumber: 'asc' }, { order: 'asc' }],
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
    ]);

    return {
      tours,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * `ownerId` is omitted by trusted internal callers (background activity
   * generation, which runs without an HTTP/user context); the HTTP-facing
   * controller always passes it to enforce that tours are private per owner.
   */
  async findOne(id: string, ownerId?: string) {
    const tour = await this.prisma.tour.findUnique({
      where: { id },
      include: {
        activities: {
          include: {
            activity: true,
            waypoints: {
              include: { waypointActivity: true },
              orderBy: { order: 'asc' },
            },
          },
          orderBy: {
            order: 'asc',
          },
        },
      },
    });

    if (!tour) {
      throw new NotFoundException(`Tour with ID ${id} not found`);
    }

    if (ownerId !== undefined) {
      this.assertOwnership(tour.ownerId, ownerId);
    }

    return tour;
  }

  private assertOwnership(tourOwnerId: string | null, ownerId: string) {
    if (tourOwnerId !== ownerId) {
      throw new ForbiddenException('You do not have access to this tour');
    }
  }

  async update(id: string, updateTourDto: UpdateTourDto, ownerId: string) {
    const { activities, ...tourData } = updateTourDto;

    try {
      const existing = await this.prisma.tour.findUnique({
        where: { id },
        select: { ownerId: true },
      });

      if (!existing) {
        throw new NotFoundException(`Tour with ID ${id} not found`);
      }

      this.assertOwnership(existing.ownerId, ownerId);

      if (activities?.length) {
        const activityIds = activities
          .map((a) => a.activityId)
          .filter((id): id is string => isValidId(id));

        if (activityIds.length > 0) {
          const existingActivities = await this.prisma.activity.findMany({
            where: { id: { in: activityIds } },
          });

          if (existingActivities.length !== activityIds.length) {
            throw new BadRequestException('Some activity IDs are invalid');
          }
        }
      }

      return await this.prisma.$transaction(async (tx) => {
        await tx.tourActivity.deleteMany({
          where: { tourId: id },
        });

        const updatedTour = await tx.tour.update({
          where: { id },
          data: {
            ...tourData,
            activities: {
              create:
                activities?.map((activity, index) =>
                  prepareActivityDataForCreate(activity, index),
                ) || [],
            },
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
        });

        return updatedTour;
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      if (error.code === 'P2025') {
        throw new NotFoundException(`Tour with ID ${id} not found`);
      }
      if (error.code === 'P2003') {
        throw new BadRequestException('Invalid activity reference');
      }
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to update tour');
    }
  }

  async remove(id: string, ownerId: string) {
    try {
      const existing = await this.prisma.tour.findUnique({
        where: { id },
        select: { ownerId: true },
      });

      if (!existing) {
        throw new NotFoundException(`Tour with ID ${id} not found`);
      }

      this.assertOwnership(existing.ownerId, ownerId);

      return await this.prisma.$transaction(async (tx) => {
        await tx.tourActivity.deleteMany({
          where: { tourId: id },
        });

        const deletedTour = await tx.tour.delete({
          where: { id },
          include: {
            activities: true,
          },
        });

        return deletedTour;
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      if (error.code === 'P2025') {
        throw new NotFoundException(`Tour with ID ${id} not found`);
      }
      if (error.code === 'P2003') {
        throw new BadRequestException('Failed to delete tour relations');
      }
      throw new BadRequestException('Failed to delete tour');
    }
  }
}
