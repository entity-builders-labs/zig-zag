import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { updateTravelTimesForActivities } from '../utils/travel-time-calculator.util';
import { optimizeActivityOrder } from '../utils/route-optimizer.util';
import { verifyAndDedupeActivities } from '../utils/activity-verification.util';

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
    private readonly configService: ConfigService,
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
      // Real activity ids we actually offered the model — anything it
      // returns outside this set gets dropped as a hallucination, since
      // every stop must be a real, verified place.
      const candidateActivityIds = new Set<string>();

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

            const nearbyActivitiesSample = nearbyActivities.slice(0, 15);
            nearbyActivitiesSample.forEach((act: any) =>
              candidateActivityIds.add(act.id),
            );
            availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${nearbyActivitiesSample
              .map(
                (act: any) =>
                  `id: ${act.id} - ${act.name} (${act.type || 'Activity'}) - ${(act.description || 'No description').substring(0, 100)} - Location: ${act.latitude}, ${act.longitude} - Duration: ${act.duration || 'Unknown'} minutes`,
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

                const refreshedActivitiesSample = refreshedActivities.slice(
                  0,
                  15,
                );
                refreshedActivitiesSample.forEach((act: any) =>
                  candidateActivityIds.add(act.id),
                );
                availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${refreshedActivitiesSample
                  .map(
                    (act: any) =>
                      `id: ${act.id} - ${act.name} (${act.type || 'Activity'}) - ${(act.description || 'No description').substring(0, 100)} - Location: ${act.latitude}, ${act.longitude} - Duration: ${act.duration || 'Unknown'} minutes`,
                  )
                  .join('\n')}`;
              } else {
                await this.updateGenerationStatus(
                  tourId,
                  'generating',
                  'No se encontraron lugares reales cerca de esta ubicación.',
                );
              }
            } catch (crawlError) {
              this.logger.error(
                `Google Maps crawling failed: ${crawlError.message}`,
              );
              await this.updateGenerationStatus(
                tourId,
                'generating',
                'La búsqueda en Google Maps falló.',
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
      }

      // Never let the AI invent activities out of thin air — every stop must
      // come from real places found in our database or crawled from
      // Google/Geoapify. If neither search nor crawl turned up anything
      // real for this location, fail loudly instead of hallucinating a tour.
      if (!availableActivitiesText) {
        throw new Error(
          'No se encontraron lugares reales para esta ubicación. Probá con otro destino o un radio de búsqueda más amplio.',
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
          activities: availableActivitiesText,
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

      // Hard safety net: drop any activity the model returned that doesn't
      // match one of the real candidates we offered it (prompt instructions
      // alone aren't reliable enough to stop hallucination), and any repeat
      // visit to the same place.
      const rawActivities: any[] = aiResponse.activities || [];
      const {
        verified: uniqueActivities,
        hallucinatedCount,
        duplicateCount,
      } = verifyAndDedupeActivities(rawActivities, candidateActivityIds);
      if (hallucinatedCount > 0) {
        this.logger.warn(
          `Dropped ${hallucinatedCount} activity/activities for tour ${tourId} that did not match a real candidate (model ignored the provided list).`,
        );
      }
      if (duplicateCount > 0) {
        this.logger.warn(
          `Dropped ${duplicateCount} duplicate activity/activities for tour ${tourId} (model repeated the same place).`,
        );
      }
      if (uniqueActivities.length === 0) {
        throw new Error(
          'No se encontraron lugares reales para esta ubicación. Probá con otro destino o un radio de búsqueda más amplio.',
        );
      }

      // The AI has no real geographic reasoning — it just lists activities
      // in whatever order seemed plausible. Reorder them with Google's own
      // route optimizer (real streets, not crow-flies distance) so the
      // itinerary doesn't zigzag back and forth across the search area.
      let orderedActivities = uniqueActivities;
      if (options?.latitude && options?.longitude) {
        orderedActivities = await optimizeActivityOrder(
          { latitude: options.latitude, longitude: options.longitude },
          uniqueActivities,
          this.configService.get<string>('GOOGLE_MAPS_API_KEY'),
        );
      }

      // Transform AI response activities to CreateTourDto format
      let activities = transformAiActivitiesToDto(orderedActivities);

      // Calculate travel times using real coordinates
      // First, get all activity entities from database if they have activityId
      const activityIds = activities
        .map((a) => a.activityId)
        .filter((id): id is string => !!id);

      let activitiesMap: Map<string, any> | undefined;
      if (activityIds.length > 0) {
        const activityEntities = await this.prisma.activity.findMany({
          where: { id: { in: activityIds } },
          select: {
            id: true,
            latitude: true,
            longitude: true,
          },
        });

        activitiesMap = new Map(activityEntities.map((act) => [act.id, act]));
      }

      // Update travel times and distances using real coordinates
      activities = updateTravelTimesForActivities(activities, activitiesMap);

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
      // Update status to failed, and record the error alongside it in the
      // same write — a separate update spreading the pre-generation metadata
      // would clobber the 'failed' status back to whatever it was before.
      const latestTour = await this.toursService.findOne(tourId);
      await this.prisma.tour.update({
        where: { id: tourId },
        data: {
          metadata: {
            ...(latestTour.metadata as any),
            generationStatus: 'failed',
            generationMessage: `Error: ${error?.message || 'No se pudo generar el itinerario'}`,
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
