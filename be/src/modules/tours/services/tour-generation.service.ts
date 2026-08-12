import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { CreateTourDto } from '../dto/create-tour.dto';
import { GenerateTourOptions } from '../interfaces/tour-generation.interface';
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
  CREATE_TOUR_SYSTEM_PROMPT,
  createTourJsonUserPrompt,
} from '../prompts/create-tour.prompt';
import { extractAndCleanJson, repairJson } from '../utils/json-parser.util';
import {
  buildPromptFromParams,
  buildPreferencesObject,
} from '../utils/prompt-builder.util';
import { transformAiActivitiesToDto } from '../utils/activity-transformer.util';
import { updateTravelTimesForActivities } from '../utils/travel-time-calculator.util';
import { ToursService } from './tours.service';
import { TourImageService } from './tour-image.service';
import { TourActivityGenerationService } from './tour-activity-generation.service';

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
    private readonly tourActivityGenerationService: TourActivityGenerationService,
  ) {}

  private createTourChain() {
    const chatModel = this.langChainService.getChatModel();
    const provider = this.langChainService['config']?.provider || 'openai'; // Access provider config

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
   * Create a basic tour from wizard preferences
   * This creates the tour structure first, then generates activities in background
   */
  async createTourFromWizard(options: GenerateTourOptions) {
    const startTime = Date.now();

    // Build prompt from options
    // Use destination as name if name is not provided
    const promptName = options?.name || options?.destination;

    const finalPrompt = buildPromptFromParams({
      name: promptName,
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
      destination: options?.destination,
    });

    this.logger.log(
      `Creating tour from wizard with prompt: ${finalPrompt.substring(0, 100)}...`,
    );

    try {
      // Build preferences object from options
      const preferences = buildPreferencesObject(options);

      // Create basic tour structure (without activities)
      // Use destination as name if name is not provided
      const tourName = options?.name || options?.destination || 'Nuevo Tour';

      const tourData: CreateTourDto = {
        ownerId: options?.ownerId,
        name: tourName,
        description: options?.description || 'Tour personalizado',
        duration: undefined,
        totalDays: options?.days,
        totalDistance: options?.totalDistance,
        estimatedBudget: options?.estimatedBudget,
        recommendedGroupSize: options?.recommendedGroupSize,
        prompt: finalPrompt,
        categories: options?.categories || [],
        metadata: {
          generatedAt: new Date().toISOString(),
          options: options as any,
          originalPrompt: finalPrompt,
          preferences:
            Object.keys(preferences).length > 0 ? preferences : undefined,
          generationStatus: 'pending',
        },
        activities: [], // No activities yet
      };

      // Create the tour
      const createStartTime = Date.now();
      const tour = await this.toursService.create(tourData);
      const createTime = Date.now() - createStartTime;

      this.logger.log(
        `Tour created successfully with ID: ${tour.id} (DB time: ${createTime}ms). Starting activity generation in background...`,
      );

      // Start activity generation in background (don't await)
      this.tourActivityGenerationService
        .generateTourActivities(tour.id)
        .catch((error) => {
          this.logger.error(
            `Background activity generation failed for tour ${tour.id}: ${error.message}`,
          );
        });

      const totalTime = Date.now() - startTime;
      this.logger.log(
        `Tour creation completed in ${totalTime}ms. Activities generating in background.`,
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

    // Build prompt automatically if not provided
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
      // Enhance prompt with options
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

      // Handle excluded tours to ensure variety
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
      // Step 1: If location provided, search for existing activities
      let availableActivitiesText = '';
      if (options?.latitude && options?.longitude) {
        const searchStartTime = Date.now();
        const radius = options.radius || 25000; // 25km default (reduced from 50km)
        const activityLimit = 20; // Reduced from 50 to improve performance

        try {
          const nearbyActivities = await Promise.race([
            this.activitiesService.findAll(
              options.latitude.toString(),
              options.longitude.toString(),
              radius,
              activityLimit,
            ),
            new Promise<any[]>(
              (_, reject) =>
                setTimeout(
                  () => reject(new Error('Activity search timeout')),
                  10000,
                ), // 10s timeout
            ),
          ]);

          const searchTime = Date.now() - searchStartTime;
          this.logger.debug(`Activity search completed in ${searchTime}ms`);

          if (nearbyActivities.length > 0) {
            // Limit description length to avoid huge prompts
            availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${nearbyActivities
              .slice(0, 15) // Limit to top 15 for prompt size
              .map(
                (act, idx) =>
                  `${idx + 1}. ${act.name} (${act.type || 'Activity'}) - ${(act.description || 'No description').substring(0, 100)} - Location: ${act.latitude}, ${act.longitude} - Duration: ${act.duration || 'Unknown'} minutes`,
              )
              .join('\n')}`;
          } else if (options.includeExistingActivities) {
            // Try semantic search if no nearby activities found (with timeout)
            try {
              const semanticStartTime = Date.now();
              const semanticResults = await Promise.race([
                this.vectorStoreService.findSimilarActivities(
                  `Activities in ${options.latitude}, ${options.longitude}: ${finalPrompt}`,
                  5, // Reduced from 10 to improve performance
                ),
                new Promise<any[]>(
                  (_, reject) =>
                    setTimeout(
                      () => reject(new Error('Semantic search timeout')),
                      5000,
                    ), // 5s timeout
                ),
              ]);

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
              // Continue without semantic results
            }
          }
        } catch (error) {
          this.logger.warn(
            `Activity search failed or timed out: ${error.message}`,
          );
          // Continue without activity context
        }
      }

      // Step 2: Create the tour using LangChain
      const chainStartTime = Date.now();
      const tourChain = this.createTourChain();

      // Prepare the input with available activities context
      const fullPrompt = enhancedPrompt + availableActivitiesText;

      this.logger.debug(
        `Invoking tour chain with prompt: ${fullPrompt.substring(0, 200)}...`,
      );

      // Add timeout to AI chain invocation
      // Use provider-aware timeout (longer for Ollama, which is slower)
      const generationTimeout = this.langChainService.getGenerationTimeout();
      this.logger.debug(
        `Using ${generationTimeout}ms timeout for AI generation (provider-aware)`,
      );

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
      ])) as any; // Type assertion for AI response

      const chainTime = Date.now() - chainStartTime;
      this.logger.debug(
        `AI generated tour response in ${chainTime}ms: ${JSON.stringify(aiResponse).substring(0, 200)}...`,
      );

      // Step 3: Convert AI response to CreateTourDto format
      const preferences = buildPreferencesObject(options);

      // Transform activities and calculate travel times if not skipping
      let activities = options?.skipActivities
        ? [] // Skip activities if flag is set
        : transformAiActivitiesToDto(aiResponse.activities || []);

      // Calculate travel times using real coordinates if activities exist
      if (activities.length > 0) {
        // Get all activity entities from database if they have activityId
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
          // Store preferences in a structured way
          preferences:
            Object.keys(preferences).length > 0 ? preferences : undefined,
          // Track generation status
          generationStatus: 'pending',
          generationMessage: 'Preparando generación de actividades...',
        }, // Store full AI response in metadata
        activities,
      };

      // Step 4: Create and return the tour
      const createStartTime = Date.now();
      const tour = await this.toursService.create(tourData);
      const createTime = Date.now() - createStartTime;

      // If skipActivities is true, don't generate activities now
      // They will be generated later via generateTourActivities endpoint
      if (!options?.skipActivities) {
        // Generate cover image (asynchronously to not block too long, or await if critical)
        // We'll await it to ensure the user gets a complete tour
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

      // Detect memory/resource errors from Ollama
      const isMemoryError =
        errorMessage.includes('memory') ||
        errorMessage.includes('Memory error') ||
        errorMessage.includes('requires more system memory') ||
        errorMessage.includes('unable to load full model');

      // Detect timeout errors
      const isTimeoutError = errorMessage.includes('timeout');

      // Use ServiceUnavailableException (503) for resource/memory issues
      // This indicates the service is temporarily unavailable due to resource constraints
      if (isMemoryError || isTimeoutError) {
        throw new ServiceUnavailableException(
          `Failed to generate tour from prompt: ${errorMessage}`,
        );
      }

      // Use BadRequestException (400) for other errors (invalid input, etc.)
      throw new BadRequestException(
        `Failed to generate tour from prompt: ${errorMessage}`,
      );
    }
  }
}
