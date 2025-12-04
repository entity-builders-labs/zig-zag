import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { ActivitiesService } from '@activities/services/activities.service';
import { LangChainService } from '@shared/ai/langchain.service';
import { VectorStoreService } from '@shared/ai/services/vector-store.service';
import { GooglePlacesService } from '@integrations/google-places/google-places.service';
import { ToursService } from './tours.service';
import { TourImageService } from './tour-image.service';
import { GenerateTourOptions } from '../interfaces/tour-generation.interface';
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
} from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { JsonOutputFunctionsParser } from 'langchain/output_parsers';
import {
  CREATE_TOUR_JSON_SYSTEM_PROMPT,
  CREATE_TOUR_SYSTEM_PROMPT,
  createTourJsonUserPrompt,
} from '../prompts/create-tour.prompt';
import { extractAndCleanJson, repairJson } from '../utils/json-parser.util';
import { transformAiActivitiesToDto } from '../utils/activity-transformer.util';

@Injectable()
export class TourActivityGenerationService {
  private readonly logger = new Logger(TourActivityGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toursService: ToursService,
    private readonly activitiesService: ActivitiesService,
    private readonly langChainService: LangChainService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly googlePlacesService: GooglePlacesService,
    private readonly tourImageService: TourImageService,
  ) {}

  private createTourChain() {
    const chatModel = this.langChainService.getChatModel();
    const provider = this.langChainService['config']?.provider || 'openai';

    // If chatModel is null OR provider is Ollama/Groq (which don't support function calling)
    // use a custom chain that uses generateChatResponse with JSON format instructions
    if (!chatModel || provider === 'ollama' || provider === 'groq') {
      return {
        invoke: async (input: { input: string; activities: string }) => {
          const systemPrompt = CREATE_TOUR_JSON_SYSTEM_PROMPT;

          const userPrompt = createTourJsonUserPrompt(
            input.input,
            input.activities,
          );

          const response = await this.langChainService.generateChatResponse(
            systemPrompt,
            userPrompt,
            {},
            {},
          );

          // Clean and extract JSON from response
          const cleanedResponse = extractAndCleanJson(response);

          try {
            return JSON.parse(cleanedResponse);
          } catch (parseError: any) {
            this.logger.error(
              `Failed to parse AI response as JSON: ${parseError.message}`,
            );
            this.logger.debug(
              `Cleaned response (first 500 chars): ${cleanedResponse.substring(0, 500)}`,
            );
            this.logger.debug(
              `Error position: ${parseError.message.match(/position (\d+)/)?.[1] || 'unknown'}`,
            );

            // Try to repair common JSON issues
            try {
              const repaired = repairJson(cleanedResponse);
              this.logger.warn('Attempting to use repaired JSON');
              return JSON.parse(repaired);
            } catch (repairError) {
              this.logger.error(
                `JSON repair also failed: ${repairError.message}`,
              );
              throw new BadRequestException(
                `AI returned invalid JSON format: ${parseError.message}. ` +
                  `Please try again or simplify your prompt.`,
              );
            }
          }
        },
      };
    }

    // OpenAI provider - use function calling
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
      SystemMessagePromptTemplate.fromTemplate(CREATE_TOUR_SYSTEM_PROMPT),
      HumanMessagePromptTemplate.fromTemplate('{input}'),
    ]);

    return RunnableSequence.from([
      prompt,
      chatModel.bind({
        functions: [tourSchema],
        function_call: { name: 'tour' },
      }),
      new JsonOutputFunctionsParser(),
    ]);
  }

  /**
   * Helper method to update generation status and message
   */
  private async updateGenerationStatus(
    tourId: string,
    status: string,
    message?: string,
  ) {
    const tour = await this.toursService.findOne(tourId);
    const metadata = tour.metadata as any;
    await this.prisma.tour.update({
      where: { id: tourId },
      data: {
        metadata: {
          ...metadata,
          generationStatus: status,
          generationMessage: message,
          ...(status === 'generating' && !metadata?.generationStartedAt
            ? { generationStartedAt: new Date().toISOString() }
            : {}),
        },
      },
    });
  }

  /**
   * Generate activities for an existing tour
   * This method generates activities in the background for a tour that was created with skipActivities=true
   */
  async generateTourActivities(tourId: string) {
    const tour = await this.toursService.findOne(tourId);
    if (!tour) {
      throw new NotFoundException(`Tour with ID ${tourId} not found`);
    }

    // Check if activities are already being generated or completed
    const metadata = tour.metadata as any;
    if (metadata?.generationStatus === 'generating') {
      throw new BadRequestException(
        'Activities are already being generated for this tour',
      );
    }
    if (
      metadata?.generationStatus === 'completed' &&
      tour.activities.length > 0
    ) {
      throw new BadRequestException('Activities have already been generated');
    }

    // Update status to generating
    await this.updateGenerationStatus(
      tourId,
      'generating',
      'Iniciando generación de actividades...',
    );

    try {
      // Get options from metadata
      const options = metadata?.options as GenerateTourOptions;
      if (!options) {
        throw new BadRequestException(
          'Tour does not have generation options stored',
        );
      }

      // Rebuild the prompt and generate activities
      const prompt = metadata?.originalPrompt || metadata?.enhancedPrompt;
      if (!prompt) {
        throw new BadRequestException('Tour does not have a prompt stored');
      }

      // Call the internal generation logic but only for activities
      // We'll reuse the logic from generateTour but only create activities
      const enhancedPrompt = metadata?.enhancedPrompt || prompt;
      let availableActivitiesText = '';

      // Search for existing activities if location provided
      if (options?.latitude && options?.longitude) {
        const radius = options.radius || 25000;
        const activityLimit = 20;

        // Update status: searching for activities
        await this.updateGenerationStatus(
          tourId,
          'generating',
          `Buscando actividades en la zona (radio ${Math.round(radius / 1000)}km)...`,
        );

        try {
          const nearbyActivities = await Promise.race([
            this.activitiesService.findAll(
              options.latitude.toString(),
              options.longitude.toString(),
              radius,
              activityLimit,
            ),
            new Promise<any[]>((_, reject) =>
              setTimeout(
                () => reject(new Error('Activity search timeout')),
                10000,
              ),
            ),
          ]);

          if (nearbyActivities.length > 0) {
            // Update status: activities found, processing
            await this.updateGenerationStatus(
              tourId,
              'generating',
              `${nearbyActivities.length} actividades encontradas. Ordenando según tus preferencias...`,
            );

            availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${nearbyActivities
              .slice(0, 15)
              .map(
                (act: any, idx: number) =>
                  `${idx + 1}. ${act.name} (${act.type || 'Activity'}) - ${(act.description || 'No description').substring(0, 100)} - Location: ${act.latitude}, ${act.longitude} - Duration: ${act.duration || 'Unknown'} minutes`,
              )
              .join('\n')}`;
          } else {
            // Update status: no activities found, triggering Google Maps crawl
            await this.updateGenerationStatus(
              tourId,
              'generating',
              'No se encontraron actividades locales. Buscando en Google Maps...',
            );

            try {
              // Trigger Google Maps crawling
              await this.googlePlacesService.crawlAndSaveActivities({
                latitude: options.latitude,
                longitude: options.longitude,
                radius: Math.min(radius, 5000), // Cap radius for Google Maps
              });

              // Try searching again after crawling
              const refreshedActivities = await this.activitiesService.findAll(
                options.latitude.toString(),
                options.longitude.toString(),
                radius,
                activityLimit,
              );

              if (refreshedActivities.length > 0) {
                await this.updateGenerationStatus(
                  tourId,
                  'generating',
                  `¡Encontrados ${refreshedActivities.length} lugares nuevos en Google Maps! Analizando...`,
                );

                availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${refreshedActivities
                  .slice(0, 15)
                  .map(
                    (act: any, idx: number) =>
                      `${idx + 1}. ${act.name} (${act.type || 'Activity'}) - ${(act.description || 'No description').substring(0, 100)} - Location: ${act.latitude}, ${act.longitude} - Duration: ${act.duration || 'Unknown'} minutes`,
                  )
                  .join('\n')}`;
              } else {
                await this.updateGenerationStatus(
                  tourId,
                  'generating',
                  'No se encontraron actividades en Google Maps. Generando con IA creativa...',
                );
              }
            } catch (crawlError) {
              this.logger.error(
                `Google Maps crawling failed: ${crawlError.message}`,
              );
              // Continue with creative AI generation if crawling fails
              await this.updateGenerationStatus(
                tourId,
                'generating',
                'Búsqueda en mapas falló. Usando generación creativa...',
              );
            }
          }
        } catch (error) {
          this.logger.warn(
            `Activity search failed or timed out: ${error.message}`,
          );
          await this.updateGenerationStatus(
            tourId,
            'generating',
            'Búsqueda de actividades completada. Generando itinerario con IA...',
          );
        }
      } else {
        // No location provided, generate directly
        await this.updateGenerationStatus(
          tourId,
          'generating',
          'Generando itinerario personalizado con IA...',
        );
      }

      // Generate activities using AI
      await this.updateGenerationStatus(
        tourId,
        'generating',
        'Creando itinerario optimizado con inteligencia artificial...',
      );

      const tourChain = this.createTourChain();
      const fullPrompt = enhancedPrompt + availableActivitiesText;
      const generationTimeout = this.langChainService.getGenerationTimeout();

      const aiResponse = (await Promise.race([
        tourChain.invoke({
          input: fullPrompt,
          activities:
            availableActivitiesText ||
            'No specific activities provided. Create a general tour.',
        }),
        new Promise<any>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`AI generation timeout after ${generationTimeout}ms`),
              ),
            generationTimeout,
          ),
        ),
      ])) as any;

      // Update status: AI response received, processing activities
      await this.updateGenerationStatus(
        tourId,
        'generating',
        'Itinerario generado. Guardando actividades...',
      );

      // Transform AI response activities to CreateTourDto format
      const activities = transformAiActivitiesToDto(
        aiResponse.activities || [],
      );

      // Update tour with activities
      await this.prisma.$transaction(async (tx) => {
        // Delete any existing activities (should be none, but just in case)
        await tx.tourActivity.deleteMany({
          where: { tourId },
        });

        // Create new activities
        await tx.tourActivity.createMany({
          data: activities.map((activity: any) => ({
            tourId,
            activityId: activity.activityId,
            activityName: activity.activityName,
            activityType: activity.activityType,
            activityLatitude: activity.activityLatitude,
            activityLongitude: activity.activityLongitude,
            activityData: activity.activityData,
            duration: activity.duration,
            startTime: activity.startTime,
            notes: activity.notes,
            dayNumber: activity.dayNumber,
            travelTimeToNext: activity.travelTimeToNext,
            distanceToNext: activity.distanceToNext,
            order: activity.order,
          })),
        });

        // Update tour metadata to mark as completed
        await tx.tour.update({
          where: { id: tourId },
          data: {
            metadata: {
              ...metadata,
              generationStatus: 'completed',
              generationMessage: `¡Listo! ${activities.length} actividades generadas exitosamente.`,
              generationCompletedAt: new Date().toISOString(),
            },
          },
        });
      });

      this.logger.log(
        `Activities generated successfully for tour ${tourId} (${activities.length} activities)`,
      );

      // Generate cover image (optional, don't block on this)
      try {
        await this.updateGenerationStatus(
          tourId,
          'generating',
          'Generando imagen de portada...',
        );
        await this.tourImageService.generateTourCoverImage(tourId);
      } catch (imgError) {
        this.logger.warn(`Failed to generate cover image: ${imgError.message}`);
      } finally {
        // Always update status to completed after image generation (even if bypassed or failed)
        // This ensures the frontend knows generation is complete
        await this.updateGenerationStatus(
          tourId,
          'completed',
          `¡Listo! ${activities.length} actividades generadas exitosamente.`,
        );
      }

      // Return updated tour
      return this.toursService.findOne(tourId);
    } catch (error) {
      // Update status to failed
      await this.updateGenerationStatus(
        tourId,
        'failed',
        `Error: ${error?.message || 'No se pudo generar el itinerario'}`,
      );
      await this.prisma.tour.update({
        where: { id: tourId },
        data: {
          metadata: {
            ...metadata,
            generationError: error?.message || String(error),
            generationFailedAt: new Date().toISOString(),
          },
        },
      });

      this.logger.error(
        `Failed to generate activities for tour ${tourId}: ${error.message}`,
        error.stack,
      );

      throw new BadRequestException(
        `Failed to generate activities: ${error.message}`,
      );
    }
  }
}
