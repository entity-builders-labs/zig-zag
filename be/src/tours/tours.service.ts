import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTourDto } from './dto/create-tour.dto';
import { UpdateTourDto } from './dto/update-tour.dto';
import { Activity } from '@prisma/client';
import { ActivitiesService } from '../activities/activities.service';
import { LangChainService } from '../shared/ai/langchain.service';
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
} from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { JsonOutputFunctionsParser } from 'langchain/output_parsers';

@Injectable()
export class ToursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activitiesService: ActivitiesService,
    private readonly langChainService: LangChainService,
  ) {}

  private createTourChain() {
    const tourSchema = {
      name: 'tour',
      description:
        'Create a tour itinerary with detailed notes for each activity',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          estimatedDuration: { type: 'number' },
          activities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                activityId: { type: 'string' },
                dayNumber: { type: 'number' },
                startTime: { type: 'string' },
                duration: { type: 'number' },
                travelTimeToNext: { type: 'number' },
                distanceToNext: { type: 'number' },
                notes: {
                  type: 'string',
                  description:
                    'Detailed notes about the activity, including what to expect, highlights, and practical tips',
                },
                type: { type: 'string' },
                latitude: { type: 'number' },
                longitude: { type: 'number' },
              },
              required: [
                'activityId',
                'dayNumber',
                'startTime',
                'duration',
                'notes',
              ],
            },
          },
          totalDays: { type: 'number' },
          totalDistance: { type: 'number' },
          estimatedBudget: { type: 'number' },
          recommendedGroupSize: { type: 'number' },
          activitiesLatLng: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lat: { type: 'number' },
                lng: { type: 'number' },
              },
            },
          },
        },
        required: ['title', 'description', 'activities'],
      },
    };

    const prompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(
        `You are a tour planning expert. Create well-organized tour itineraries by:
    - Following a logical geographical sequence
    - Progressing naturally throughout the day
    - Considering operational hours
    - Including reasonable transition times
    - Creating balanced activity type mixes
    
    For each activity, provide detailed notes that include:
    - What visitors can expect to see or experience
    - Key highlights and points of interest
    - Practical tips (best photo spots, recommended items to bring, etc.)
    - Any relevant historical or cultural context
    - Specific recommendations based on the activity type
    
    Available activities: {activities}`,
      ),
      HumanMessagePromptTemplate.fromTemplate('{input}'),
    ]);

    return RunnableSequence.from([
      prompt,
      this.langChainService.getChatModel().bind({
        functions: [tourSchema],
        function_call: { name: 'tour' },
      }),
      new JsonOutputFunctionsParser(),
    ]);
  }

  async getNextActivity(activityId: number) {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
    });

    const nextActivity = await this.langChainService.findSimilarActivities(
      `Find an activity that not combines  with: ${activity}`,
      4,
      {
        id: { $ne: activityId },
      },
    );

    return nextActivity;
  }

  async create(createTourDto: CreateTourDto) {
    const { activities, ...tourData } = createTourDto;

    if (activities?.length) {
      const activityIds = activities.map((a) => a.activityId);
      const existingActivities = await this.prisma.activity.findMany({
        where: { id: { in: activityIds } },
      });

      if (existingActivities.length !== activityIds.length) {
        throw new BadRequestException('Some activity ids are invalid');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const tour = await tx.tour.create({
        data: {
          ...tourData,
          activities: {
            create:
              activities?.map((activity, index) => ({
                activityId: activity.activityId,
                duration: activity.duration,
                startTime: activity.startTime,
                notes: activity.notes,
                order: index + 1,
              })) || [],
          },
        },
        include: {
          activities: {
            include: {
              activity: true,
            },
          },
        },
      });
      return tour;
    });
  }

  async findAll(page = 1, limit = 100) {
    const skip = (page - 1) * limit;

    const [total, tours] = await this.prisma.$transaction([
      this.prisma.tour.count(),
      this.prisma.tour.findMany({
        take: limit,
        skip: skip,
        include: {
          activities: {
            include: {
              activity: true,
            },
          },
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

  async findOne(id: number) {
    const tour = await this.prisma.tour.findUnique({
      where: { id },
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

    if (!tour) {
      throw new NotFoundException(`Tour with ID ${id} not found`);
    }

    return tour;
  }

  async update(id: number, updateTourDto: UpdateTourDto) {
    const { activities, ...tourData } = updateTourDto;

    try {
      // Validate activity IDs if provided
      if (activities?.length) {
        const activityIds = activities.map((a) => a.activityId);
        const existingActivities = await this.prisma.activity.findMany({
          where: { id: { in: activityIds } },
        });

        if (existingActivities.length !== activityIds.length) {
          throw new BadRequestException('Some activity IDs are invalid');
        }
      }

      return await this.prisma.$transaction(async (tx) => {
        // First delete existing activities
        await tx.tourActivity.deleteMany({
          where: { tourId: id },
        });

        // Update tour and create new activities
        const updatedTour = await tx.tour.update({
          where: { id },
          data: {
            ...tourData,
            activities: {
              create:
                activities?.map((activity, index) => ({
                  activityId: activity.activityId,
                  duration: activity.duration,
                  startTime: activity.startTime,
                  notes: activity.notes,
                  order: index + 1,
                })) || [],
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

  async remove(id: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // First delete all associated activities
        await tx.tourActivity.deleteMany({
          where: { tourId: id },
        });

        // Then delete the tour
        const deletedTour = await tx.tour.delete({
          where: { id },
          include: {
            activities: true,
          },
        });

        return deletedTour;
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new NotFoundException(`Tour with ID ${id} not found`);
      }
      if (error.code === 'P2003') {
        throw new BadRequestException('Failed to delete tour relations');
      }
      throw new BadRequestException('Failed to delete tour');
    }
  }

  async generateTourSuggestion(
    startingActivityId: number,
    numberOfActivities: number = 5,
    preferences: {
      timeOfDay?: string[];
      physicalIntensity?: number;
      indoorOutdoor?: number;
      tags?: string[];
    } = {},
  ) {
    // Get the starting activity
    const startActivity = await this.prisma.activity.findUnique({
      where: { id: startingActivityId },
    });

    if (!startActivity) {
      throw new NotFoundException('Starting activity not found');
    }

    const metadata =
      typeof startActivity.metadata === 'string'
        ? JSON.parse(startActivity.metadata)
        : startActivity.metadata;

    const nextActivity = await this.langChainService.findSimilarActivities(
      `Find an activity that combines well with: ${metadata.combinationScore}`,
      1,
      {
        id: { $ne: startActivity.id },
      },
    );

    // Initialize tour with starting activity
    const tourActivities = [startActivity];

    // Create a tour with the selected activities
    return nextActivity;
  }

  private async createTourFromActivities(activities: Activity[]) {
    // Use your existing tour creation logic or the AI-based tour chain
    const tourChain = this.createTourChain();

    const result = await tourChain.invoke({
      input: `Create a tour with these activities: ${activities.map((a) => a.name).join(', ')}`,
      activities: activities,
    });

    return result;
  }
}
