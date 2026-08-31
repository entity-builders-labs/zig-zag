import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { CreateTourDto } from '../dto/create-tour.dto';
import {
  GenerateTourOptions,
  TourGenerationRequest,
} from '../interfaces/tour-generation.interface';
import { LangChainService } from '@shared/ai/langchain.service';
import { VectorStoreService } from '@shared/ai/services/vector-store.service';
import { ActivitiesService } from '@activities/services/activities.service';
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
} from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { JsonOutputFunctionsParser } from 'langchain/output_parsers';
import {
  CREATE_TOUR_JSON_SYSTEM_PROMPT,
  CREATE_TOUR_RESPONSE_SCHEMA,
  CREATE_TOUR_SYSTEM_PROMPT,
  GROQ_TOUR_MAX_COMPLETION_TOKENS,
  createTourJsonUserPrompt,
} from '../prompts/create-tour.prompt';
import { extractAndCleanJson, repairJson } from '../utils/json-parser.util';
import {
  buildPromptFromParams,
  buildPreferencesObject,
  buildWizardSelectionInput,
} from '../utils/prompt-builder.util';
import { transformAiActivitiesToDto } from '../utils/activity-transformer.util';
import { updateTravelTimesForActivities } from '../utils/travel-time-calculator.util';
import { ToursService } from './tours.service';
import { TourImageService } from './tour-image.service';

@Injectable()
export class TourGenerationService {
  private readonly logger = new Logger(TourGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activitiesService: ActivitiesService,
    private readonly langChainService: LangChainService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly toursService: ToursService,
    private readonly tourImageService: TourImageService,
  ) {}

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private createTourChain() {
    const chatModel = this.langChainService.getChatModel();
    const provider = this.langChainService['config']?.provider || 'openai';

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
            {
              groq: {
                maxCompletionTokens: GROQ_TOUR_MAX_COMPLETION_TOKENS,
                reasoningEffort: 'low',
                includeReasoning: false,
              },
              responseFormat: {
                type: 'json_schema',
                json_schema: {
                  name: 'tour_generation',
                  strict: true,
                  schema: CREATE_TOUR_RESPONSE_SCHEMA,
                },
              },
            },
          );

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
   * Creates the canonical wizard Tour and its durable generation request.
   * ToursService writes both records in one transaction; generation is owned by
   * TourGenerationProcessorService, not by this HTTP request process.
   */
  async createTourFromWizard(request: TourGenerationRequest, ownerId: string) {
    const startTime = Date.now();
    const selectorInput = buildWizardSelectionInput(request);

    this.logger.log(
      `Creating tour from wizard with canonical intent: ${selectorInput.substring(0, 100)}...`,
    );

    try {
      const tourName = request.destination.label || 'Nuevo Tour';

      const tourData: CreateTourDto = {
        ownerId,
        name: tourName,
        description: 'Tour personalizado',
        duration: undefined,
        totalDays: request.days,
        prompt: selectorInput,
        categories: request.categories,
        metadata: {
          generatedAt: new Date().toISOString(),
          generationRequest: request as any,
          generationStatus: 'pending',
        },
        activities: [],
      };

      const createStartTime = Date.now();
      const tour = await this.toursService.create(tourData);
      const createTime = Date.now() - createStartTime;
      const totalTime = Date.now() - startTime;

      this.logger.log(
        `Tour created with ID ${tour.id} and durable generation request (DB: ${createTime}ms, total: ${totalTime}ms).`,
      );
      return tour;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      const errorMessage = error?.message || String(error);

      this.logger.error(
        `Error creating tour from wizard after ${totalTime}ms: ${errorMessage}`,
        error.stack,
      );

      throw new BadRequestException(`Failed to create tour: ${errorMessage}`);
    }
  }

  /**
   * Generate a tour from a prompt using LangChain and AI
   * This method uses the LangChain service to generate structured tour data from a natural language prompt
   * @deprecated Use createTourFromWizard for new tours. This method generates everything at once.
   */
  async generateTour(
    prompt: string | undefined,
    options?: GenerateTourOptions,
  ) {
    const startTime = Date.now();

    let finalPrompt = prompt;
    if (!finalPrompt || finalPrompt.trim() === '') {
      finalPrompt = buildPromptFromParams({
        name: options?.name,
        description: options?.description,
        days: options?.days,
        totalDistance: options?.totalDistance,
        price: options?.price,
        estimatedBudget: options?.estimatedBudget,
        maxGroupSize: options?.maxGroupSize,
        recommendedGroupSize: options?.recommendedGroupSize,
        startDates: options?.startDates,
        categories: options?.categories,
        interests: options?.interests,
        budgetLevel: options?.budgetLevel,
        transportationMode: options?.transportationMode,
        travelPace: options?.travelPace,
        dietaryRestrictions: options?.dietaryRestrictions,
        groupType: options?.groupType,
        latitude: options?.latitude,
        longitude: options?.longitude,
      });
      this.logger.log(
        `Auto-generated prompt: ${finalPrompt.substring(0, 100)}...`,
      );
    } else {
      this.logger.log(
        `Using provided prompt: ${finalPrompt.substring(0, 100)}...`,
      );
    }

    try {
      let enhancedPrompt = finalPrompt;
      const constraints: string[] = [];

      if (options?.destination)
        constraints.push(`Destination: ${options.destination}`);
      if (options?.days)
        constraints.push(`Target Duration: ${options.days} days`);
      if (options?.budgetLevel)
        constraints.push(`Budget Level: ${options.budgetLevel}`);
      if (options?.interests?.length)
        constraints.push(`Interests: ${options.interests.join(', ')}`);
      if (options?.transportationMode?.length)
        constraints.push(
          `Transportation Mode: ${options.transportationMode.join(', ')}`,
        );
      if (options?.groupType)
        constraints.push(`Group Type: ${options.groupType}`);
      if (options?.travelPace)
        constraints.push(`Travel Pace: ${options.travelPace}`);
      if (options?.dietaryRestrictions?.length)
        constraints.push(
          `Dietary Restrictions: ${options.dietaryRestrictions.join(', ')}`,
        );
      if (options?.startDates?.length)
        constraints.push(`Start Dates: ${options.startDates.join(', ')}`);

      if (options?.excludeTours?.length) {
        try {
          const excludedTours = await this.prisma.tour.findMany({
            where: { id: { in: options.excludeTours } },
            select: { name: true, description: true },
          });

          if (excludedTours.length > 0) {
            constraints.push(
              `CRITICAL: The user has already seen/rejected the following tours. You MUST generate a completely DIFFERENT tour experience (different theme, activities, or focus):`,
            );
            excludedTours.forEach((t) => {
              constraints.push(
                `- Avoid: "${t.name}" (${(t.description || '').substring(0, 100)}...)`,
              );
            });
            constraints.push(
              `Focus on uncovering hidden gems or alternative themes not covered above.`,
            );
          }
        } catch (err) {
          this.logger.warn(`Failed to fetch excluded tours: ${err.message}`);
        }
      }

      if (constraints.length > 0) {
        enhancedPrompt += `\n\nAdditional Constraints & Preferences:\n- ${constraints.join('\n- ')}`;
      }
      let availableActivitiesText = '';
      if (options?.latitude && options?.longitude) {
        const searchStartTime = Date.now();
        const radius = options.radius || 25000;
        const activityLimit = 20;

        try {
          const nearbyActivities = await this.withTimeout(
            this.activitiesService.findAll(
              options.latitude.toString(),
              options.longitude.toString(),
              radius,
              activityLimit,
            ),
            10000,
            'Activity search timeout',
          );

          const searchTime = Date.now() - searchStartTime;
          this.logger.debug(`Activity search completed in ${searchTime}ms`);

          if (nearbyActivities.length > 0) {
            availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${nearbyActivities
              .slice(0, 15)
              .map(
                (act, idx) =>
                  `${idx + 1}. ${act.name} (${act.type || 'Activity'}) - ${(act.description || 'No description').substring(0, 100)} - Location: ${act.latitude}, ${act.longitude} - Duration: ${act.duration || 'Unknown'} hours`,
              )
              .join('\n')}`;
          } else if (options.includeExistingActivities) {
            try {
              const semanticStartTime = Date.now();
              const semanticResults = await this.withTimeout(
                this.vectorStoreService.findSimilarActivities(
                  `Activities in ${options.latitude}, ${options.longitude}: ${finalPrompt}`,
                  5,
                ),
                5000,
                'Semantic search timeout',
              );

              const semanticTime = Date.now() - semanticStartTime;
              this.logger.debug(
                `Semantic search completed in ${semanticTime}ms`,
              );

              if (semanticResults.length > 0) {
                availableActivitiesText = `\n\nRelevant activities found:\n${semanticResults
                  .map(
                    (result: any, idx: number) =>
                      `${idx + 1}. ${result.metadata?.activityName || 'Activity'} - ${result.pageContent.substring(0, 80)}...`,
                  )
                  .join('\n')}`;
              }
            } catch (error) {
              this.logger.warn(
                `Semantic search failed or timed out: ${error.message}`,
              );
            }
          }
        } catch (error) {
          this.logger.warn(
            `Activity search failed or timed out: ${error.message}`,
          );
        }
      }

      const chainStartTime = Date.now();
      const tourChain = this.createTourChain();

      this.logger.debug(
        `Invoking tour chain with prompt: ${enhancedPrompt.substring(0, 200)}...`,
      );

      const generationTimeout = this.langChainService.getGenerationTimeout();
      this.logger.debug(
        `Using ${generationTimeout}ms timeout for AI generation (provider-aware)`,
      );

      const aiResponse = (await this.withTimeout(
        tourChain.invoke({
          input: enhancedPrompt,
          activities:
            availableActivitiesText ||
            'No specific activities provided. Create a general tour.',
        }),
        generationTimeout,
        `AI generation timeout after ${generationTimeout}ms`,
      )) as any;

      const chainTime = Date.now() - chainStartTime;
      this.logger.debug(
        `AI generated tour response in ${chainTime}ms: ${JSON.stringify(aiResponse).substring(0, 200)}...`,
      );

      const preferences = buildPreferencesObject(options);

      let activities = options?.skipActivities
        ? []
        : transformAiActivitiesToDto(aiResponse.activities || []);

      if (activities.length > 0) {
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

        activities = updateTravelTimesForActivities(activities, activitiesMap);
      }

      const tourData: CreateTourDto = {
        name: aiResponse.title || 'Untitled Tour',
        description: aiResponse.description || aiResponse.title,
        duration: aiResponse.estimatedDuration,
        totalDays: aiResponse.totalDays,
        totalDistance: aiResponse.totalDistance,
        estimatedBudget: aiResponse.estimatedBudget,
        recommendedGroupSize: aiResponse.recommendedGroupSize,
        prompt: finalPrompt,
        categories: options?.categories || [],
        metadata: {
          ...(aiResponse as object),
          generatedAt: new Date().toISOString(),
          options: options as any,
          originalPrompt: prompt,
          enhancedPrompt: enhancedPrompt,
          preferences:
            Object.keys(preferences).length > 0 ? preferences : undefined,
          generationStatus: 'pending',
          generationMessage: 'Preparando generación de actividades...',
        },
        activities,
      };

      const createStartTime = Date.now();
      const tour = await this.toursService.create(tourData);
      const createTime = Date.now() - createStartTime;

      if (!options?.skipActivities) {
        try {
          await this.tourImageService.generateTourCoverImage(tour.id);
        } catch (imgError) {
          this.logger.warn(
            `Failed to generate cover image: ${imgError.message}`,
          );
        }
      }

      const totalTime = Date.now() - startTime;
      this.logger.log(
        `Tour created successfully with ID: ${tour.id} (Total time: ${totalTime}ms, AI: ${chainTime}ms, DB: ${createTime}ms, Activities: ${options?.skipActivities ? 'skipped' : 'generated'})`,
      );

      return tour;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      const errorMessage = error?.message || String(error);

      this.logger.error(
        `Error generating tour from prompt after ${totalTime}ms: ${errorMessage}`,
        error.stack,
      );

      const isMemoryError =
        errorMessage.includes('memory') ||
        errorMessage.includes('Memory error') ||
        errorMessage.includes('requires more system memory') ||
        errorMessage.includes('unable to load full model');

      const isTimeoutError = errorMessage.includes('timeout');

      if (isMemoryError || isTimeoutError) {
        throw new ServiceUnavailableException(
          `Failed to generate tour from prompt: ${errorMessage}`,
        );
      }

      throw new BadRequestException(
        `Failed to generate tour from prompt: ${errorMessage}`,
      );
    }
  }
}
