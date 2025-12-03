import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateTourDto } from '../dto/create-tour.dto';
import { UpdateTourDto } from '../dto/update-tour.dto';
import {
  BudgetLevel,
  TransportationMode,
  GroupType,
  TravelPace,
} from '../dto/create-tour-from-prompt.dto';
// import { Activity } from '@prisma/client';
import { ActivitiesService } from '../../activities/services/activities.service';
import { LangChainService } from '../../../shared/ai/langchain.service';
import { ImageGenerationService } from '../../../shared/ai/image-generation.service';
import { isValidId } from '../../../shared/utils/id-validator';
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
} from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { JsonOutputFunctionsParser } from 'langchain/output_parsers';
import { Activity } from '@prisma/client';
import { GoogleMapsService } from '../../../modules/crawlers/google-maps/google-maps.service';
import {
  CREATE_TOUR_JSON_SYSTEM_PROMPT,
  CREATE_TOUR_SYSTEM_PROMPT,
  createTourJsonUserPrompt,
} from '../prompts/create-tour.prompt';
import {
  buildComplementaryPrompt,
  generateRecommendationReasoningPrompt,
  RECOMMENDATION_SYSTEM_PROMPT,
} from '../prompts/activity-recommendation.prompt';
import {
  CONTEXTUAL_ACTIVITIES_SYSTEM_PROMPT,
  generateContextualActivitiesPrompt,
} from '../prompts/contextual-activities.prompt';
import { generateCoverImagePrompt } from '../prompts/media-generation.prompt';
import { generateNearbyTourPrompt } from '../prompts/nearby-tour.prompt';

export interface GenerateTourOptions {
  latitude?: number;
  longitude?: number;
  radius?: number; // in meters, default 25000 (25km)
  includeExistingActivities?: boolean; // Whether to search for existing activities in DB
  days?: number;
  budgetLevel?: BudgetLevel;
  interests?: string[];
  transportationMode?: TransportationMode[];
  groupType?: GroupType;
  travelPace?: TravelPace;
  dietaryRestrictions?: string[];
  destination?: string;
  destinationLatitude?: number;
  destinationLongitude?: number;
  skipImageGeneration?: boolean;
  skipActivities?: boolean; // If true, create tour without activities
  // New fields for auto-prompt generation
  name?: string;
  description?: string;
  totalDistance?: number;
  price?: number;
  estimatedBudget?: number;
  maxGroupSize?: number;
  recommendedGroupSize?: number;
  startDates?: string[];
  categories?: string[];
  excludeTours?: string[];
}

@Injectable()
export class ToursService {
  private readonly logger = new Logger(ToursService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activitiesService: ActivitiesService,
    private readonly langChainService: LangChainService,
    private readonly imageGenerationService: ImageGenerationService,
    private readonly googleMapsService: GoogleMapsService,
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
          const cleanedResponse = this.extractAndCleanJson(response);

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
              const repaired = this.repairJson(cleanedResponse);
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

  async getNextActivity(
    activityId: string,
    options?: {
      excludeIds?: string[];
      preferenceWeights?: {
        complementarity: number;
        diversity: number;
        proximity: number;
        timeCompatibility: number;
      };
      maxDistance?: number;
      contextualHints?: string[];
    },
  ) {
    // await this.langChainService.rebuildVectorStore();
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      include: {
        targetRelations: {
          include: {
            targetActivity: true,
          },
          where: {
            relationType: 'COMPLEMENTARY',
          },
          orderBy: {
            compatibilityScore: 'desc',
          },
        },
      },
    });

    const aiActivities = await this.generateAIActivitiesWithContext(
      activity,
      activity.metadata,
      3,
    );

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    // Parse metadata
    const metadata =
      typeof activity.metadata === 'string'
        ? JSON.parse(activity.metadata)
        : activity.metadata || {};

    // Default options
    const defaultOptions = {
      excludeIds: [activityId],
      preferenceWeights: {
        complementarity: 0.4,
        diversity: 0.25,
        proximity: 0.2,
        timeCompatibility: 0.15,
      },
      maxDistance: 50000, // 50km
      contextualHints: [] as string[],
    };

    const finalOptions = { ...defaultOptions, ...options };
    const allExcludeIds = [...(finalOptions.excludeIds || []), activityId];

    // Step 1: Check if we have pre-calculated relationships
    const existingRelations = activity.targetRelations?.filter(
      (rel) => !allExcludeIds.includes(rel.targetActivity.id),
    );

    if (existingRelations && existingRelations.length > 0) {
      // Use existing relationship if available and score is good
      const bestRelation = existingRelations[0];
      if (bestRelation.compatibilityScore >= 70) {
        return {
          activity: bestRelation.targetActivity,
          compatibilityScore: bestRelation.compatibilityScore,
          reasoning: bestRelation.reasoning,
          source: 'pre-calculated-relationship',
        };
      }
    }

    // Step 2: Use AI-powered semantic search for complementary activities
    const complementaryPrompt = this.buildComplementaryPrompt(
      activity,
      metadata,
      finalOptions,
    );

    try {
      const searchResults = await this.langChainService.findSimilarActivities(
        complementaryPrompt,
        20, // Get more candidates for better filtering
        {
          activityId: { $nin: allExcludeIds },
        },
      );

      console.log(
        'Search results structure:',
        JSON.stringify(searchResults[0], null, 2),
      );

      if (!searchResults || searchResults.length === 0) {
        // Fallback: find any nearby activity with different type
        return this.findFallbackActivity(activity, allExcludeIds);
      }

      // Step 3: Convert search results to activities and score them
      const candidateActivities = await this.extractActivitiesFromSearchResults(
        searchResults,
        allExcludeIds,
      );

      if (aiActivities.length > 0) {
        candidateActivities.push(...aiActivities);
      }

      if (candidateActivities.length === 0) {
        return this.findFallbackActivity(activity, allExcludeIds);
      }

      const scoredCandidates = await Promise.all(
        candidateActivities.map((candidateActivity) =>
          this.scoreActivityCandidate(
            activity,
            candidateActivity,
            finalOptions.preferenceWeights,
            metadata,
          ),
        ),
      );

      // Step 4: Apply diversity and novelty filters
      const filteredCandidates = this.applyDiversityFilters(
        scoredCandidates,
        activity,
        metadata,
      );

      // Step 5: Select the best candidate with randomization
      const topCandidates = filteredCandidates
        .sort((a, b) => b.totalScore - a.totalScore)
        .slice(0, Math.min(5, filteredCandidates.length)); // Top 5 candidatos

      // Agregar randomización entre los mejores candidatos
      const bestCandidate =
        topCandidates.length > 1
          ? topCandidates[
              Math.floor(Math.random() * Math.min(3, topCandidates.length))
            ] // Random entre top 3
          : topCandidates[0];

      if (!bestCandidate) {
        return this.findFallbackActivity(activity, allExcludeIds);
      }

      // Step 6: Generate contextual reasoning
      const reasoning = await this.generateActivityRecommendationReasoning(
        activity,
        bestCandidate.activity,
        bestCandidate,
      );

      return {
        activity: bestCandidate.activity,
        compatibilityScore: Math.round(bestCandidate.totalScore),
        reasoning,
        source: 'ai-semantic-analysis',
        breakdown: {
          complementarityScore: bestCandidate.complementarityScore,
          diversityScore: bestCandidate.diversityScore,
          proximityScore: bestCandidate.proximityScore,
          timeCompatibilityScore: bestCandidate.timeCompatibilityScore,
        },
      };
    } catch (error) {
      console.error('Error in semantic search:', error);
      return this.findFallbackActivity(activity, allExcludeIds);
    }
  }

  private buildComplementaryPrompt(
    activity: Activity,
    metadata: any,
    options: any,
  ): string {
    return buildComplementaryPrompt(activity, metadata, options);
  }

  private async extractActivitiesFromSearchResults(
    searchResults: any[],
    excludeIds: string[],
  ): Promise<Activity[]> {
    const activityIds: string[] = [];

    // Extract activity IDs from search results
    for (const result of searchResults) {
      try {
        // The activity ID should be in result.metadata.activityId
        const activityId = result.metadata?.activityId;
        if (activityId) {
          // Convert to string if it's a number
          const activityIdString =
            typeof activityId === 'number' ? activityId.toString() : activityId;

          if (!excludeIds.includes(activityIdString)) {
            activityIds.push(activityIdString);
          }
        }
      } catch (error) {
        console.warn('Error extracting activity ID from search result:', error);
      }
    }

    console.log('Extracted activity IDs:', activityIds);
    console.log(
      'Activity IDs types:',
      activityIds.map((id) => typeof id),
    );

    if (activityIds.length === 0) {
      return [];
    }

    // Fetch the actual activities from database
    const activities = await this.prisma.activity.findMany({
      where: {
        id: { in: activityIds }, // Now all are strings
      },
    });

    console.log('Found activities count:', activities.length);

    return activities;
  }

  private async scoreActivityCandidate(
    sourceActivity: Activity,
    candidateActivity: Activity,
    weights: any,
    sourceMetadata: any,
  ): Promise<{
    activity: Activity;
    totalScore: number;
    complementarityScore: number;
    diversityScore: number;
    proximityScore: number;
    timeCompatibilityScore: number;
  }> {
    // Safely parse candidate metadata
    let candidateMetadata = {};
    try {
      candidateMetadata = candidateActivity.metadata
        ? typeof candidateActivity.metadata === 'string'
          ? JSON.parse(candidateActivity.metadata)
          : candidateActivity.metadata
        : {};
    } catch (error) {
      console.warn(
        `Error parsing metadata for activity ${candidateActivity.id}:`,
        error,
      );
      candidateMetadata = {};
    }

    // 1. Complementarity Score (how well they work together)
    const complementarityScore = this.calculateComplementarityScore(
      sourceMetadata,
      candidateMetadata,
    );

    // 2. Diversity Score (variety but not too different)
    const diversityScore = this.calculateDiversityScore(
      sourceActivity,
      candidateActivity,
      sourceMetadata,
      candidateMetadata,
    );

    // 3. Proximity Score (geographical distance)
    const proximityScore = this.calculateProximityScore(
      sourceActivity,
      candidateActivity,
    );

    // 4. Time Compatibility Score
    const timeCompatibilityScore = this.calculateTimeCompatibilityScore(
      sourceMetadata,
      candidateMetadata,
    );

    const totalScore =
      complementarityScore * weights.complementarity +
      diversityScore * weights.diversity +
      proximityScore * weights.proximity +
      timeCompatibilityScore * weights.timeCompatibility;

    return {
      activity: candidateActivity,
      totalScore,
      complementarityScore,
      diversityScore,
      proximityScore,
      timeCompatibilityScore,
    };
  }

  private calculateComplementarityScore(
    sourceMetadata: any,
    candidateMetadata: any,
  ): number {
    let score = 0;

    // Check if candidate is in complementary activities list
    const complementaryAfter =
      sourceMetadata.complementaryActivities?.after || [];
    if (complementaryAfter.includes(candidateMetadata.type)) {
      score += 40;
    }

    // Energy level flow (source after -> candidate before)
    const sourceEnergyAfter = sourceMetadata.energyLevel?.after || 3;
    const candidateEnergyBefore = candidateMetadata.energyLevel?.before || 3;
    const energyDiff = Math.abs(sourceEnergyAfter - candidateEnergyBefore);
    score += Math.max(0, 30 - energyDiff * 10);

    // Combination score alignment
    const sourceCombination = sourceMetadata.combinationScore || {};
    const candidateCombination = candidateMetadata.combinationScore || {};

    let combinationAlignment = 0;
    Object.keys(sourceCombination).forEach((key) => {
      if (candidateCombination[key]) {
        combinationAlignment += Math.min(
          sourceCombination[key],
          candidateCombination[key],
        );
      }
    });
    score +=
      (combinationAlignment / Object.keys(sourceCombination).length) * 10;

    // Meal compatibility
    const sourceMealCompat = sourceMetadata.mealCompatibility || {};
    const candidateMealCompat = candidateMetadata.mealCompatibility || {};
    if (sourceMealCompat.postMeal && candidateMealCompat.preMeal) {
      score += 20;
    }

    return Math.min(100, score);
  }

  private calculateDiversityScore(
    sourceActivity: Activity,
    candidateActivity: Activity,
    sourceMetadata: any,
    candidateMetadata: any,
  ): number {
    let score = 50; // Base score

    // Type diversity (different but not too different)
    if (sourceActivity.type !== candidateActivity.type) {
      score += 30;
    } else {
      score -= 20; // Penalize same type
    }

    // Physical intensity variation (moderate variation is good)
    const intensityDiff = Math.abs(
      (sourceMetadata.physicalIntensity || 3) -
        (candidateMetadata.physicalIntensity || 3),
    );
    if (intensityDiff >= 1 && intensityDiff <= 2) {
      score += 15; // Good variation
    } else if (intensityDiff > 3) {
      score -= 15; // Too much difference
    }

    // Indoor/outdoor balance
    const sourceIO = sourceMetadata.indoorOutdoor || 3;
    const candidateIO = candidateMetadata.indoorOutdoor || 3;
    if (Math.abs(sourceIO - candidateIO) >= 2) {
      score += 10; // Good indoor/outdoor variety
    }

    return Math.max(0, Math.min(100, score));
  }

  private calculateProximityScore(
    sourceActivity: Activity,
    candidateActivity: Activity,
  ): number {
    const distance = this.calculateDistance(
      {
        latitude: sourceActivity.latitude,
        longitude: sourceActivity.longitude,
      },
      {
        latitude: candidateActivity.latitude,
        longitude: candidateActivity.longitude,
      },
    );

    // Score based on distance (closer is better, but not too close)
    if (distance < 1000) return 60; // Too close might be redundant
    if (distance < 5000) return 100; // Optimal range
    if (distance < 15000) return 80; // Good range
    if (distance < 30000) return 60; // Acceptable range
    return Math.max(0, 60 - (distance - 30000) / 1000); // Decreasing score for far distances
  }

  private calculateTimeCompatibilityScore(
    sourceMetadata: any,
    candidateMetadata: any,
  ): number {
    let score = 50; // Base score

    // Transition time consideration
    const sourceTransitionAfter =
      sourceMetadata.transitionTime?.afterActivity || 30;
    const candidateTransitionBefore =
      candidateMetadata.transitionTime?.beforeActivity || 30;
    const totalTransitionTime =
      sourceTransitionAfter + candidateTransitionBefore;

    if (totalTransitionTime <= 45) {
      score += 25; // Quick transition
    } else if (totalTransitionTime <= 90) {
      score += 15; // Reasonable transition
    }

    // Time of day compatibility
    const sourceTimePrefs = sourceMetadata.timeOfDayPreference || [];
    const candidateTimePrefs = candidateMetadata.timeOfDayPreference || [];

    const timeOverlap = sourceTimePrefs.filter((time: string) =>
      candidateTimePrefs.includes(time),
    );
    score += (timeOverlap.length / Math.max(sourceTimePrefs.length, 1)) * 25;

    // Duration flexibility
    const sourceDurationFlex = sourceMetadata.durationFlexibility || 3;
    const candidateDurationFlex = candidateMetadata.durationFlexibility || 3;
    score += ((sourceDurationFlex + candidateDurationFlex) / 2) * 2;

    return Math.min(100, score);
  }

  private applyDiversityFilters(
    candidates: any[],
    sourceActivity: Activity,
    sourceMetadata: any,
  ): any[] {
    // Remove candidates that are too similar to recent activities
    // This would require tracking recent recommendations in the database
    // For now, prioritize different types and characteristics

    return candidates.filter((candidate) => {
      const candidateMetadata =
        typeof candidate.activity.metadata === 'string'
          ? JSON.parse(candidate.activity.metadata)
          : candidate.activity.metadata || {};

      // Filter out activities that are too similar
      if (
        candidate.activity.type === sourceActivity.type &&
        Math.abs(
          (candidateMetadata.physicalIntensity || 3) -
            (sourceMetadata.physicalIntensity || 3),
        ) < 1
      ) {
        return candidate.totalScore > 75; // Only keep very high scoring similar activities
      }

      return candidate.totalScore > 50; // General threshold
    });
  }

  private async generateActivityRecommendationReasoning(
    sourceActivity: Activity,
    candidateActivity: any,
    scores: any,
  ): Promise<string> {
    const prompt = generateRecommendationReasoningPrompt(
      sourceActivity.name,
      candidateActivity.name,
      scores,
    );

    return this.langChainService.generateChatResponse(
      RECOMMENDATION_SYSTEM_PROMPT,
      prompt,
      {},
      { temperature: 0.7, maxTokens: 150 },
    );
  }

  private async findFallbackActivity(
    sourceActivity: Activity,
    excludeIds: string[],
  ): Promise<any> {
    // Simple fallback: find the closest activity of a different type
    const fallbackActivity = await this.prisma.activity.findFirst({
      where: {
        id: { notIn: excludeIds },
        type: { not: sourceActivity.type },
      },
      orderBy: [
        // You could add a raw query here to order by distance
        { createdAt: 'desc' },
      ],
    });

    return {
      activity: fallbackActivity,
      compatibilityScore: 50,
      reasoning:
        'Selected as a nearby alternative activity with a different experience type.',
      source: 'fallback',
    };
  }

  private calculateDistance(
    coord1: { latitude: number; longitude: number },
    coord2: { latitude: number; longitude: number },
  ): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (coord1.latitude * Math.PI) / 180;
    const φ2 = (coord2.latitude * Math.PI) / 180;
    const Δφ = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
    const Δλ = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Create a tour - flexible method that accepts partial data
   */
  async create(createTourDto: CreateTourDto) {
    const { activities, ...tourData } = createTourDto;

    // Validate activity IDs if provided
    if (activities?.length) {
      // Validate activity IDs (supports both UUID and ObjectId for migration)
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
          // Don't throw, just log the error and continue
        }
      }
    }

    // Prepare tour data - only include defined fields
    const tourDataClean: any = {
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
    };

    // Remove undefined values
    Object.keys(tourDataClean).forEach(
      (key) => tourDataClean[key] === undefined && delete tourDataClean[key],
    );

    return this.prisma.$transaction(async (tx) => {
      const tour = await tx.tour.create({
        data: {
          ...tourDataClean,
          activities: {
            create:
              activities?.map((activityDto, index) => {
                const activityData: any = {
                  order: activityDto.order || index + 1,
                  activityId: activityDto.activityId,
                  activityName: activityDto.activityName,
                  activityType: activityDto.activityType,
                  activityLatitude: activityDto.activityLatitude,
                  activityLongitude: activityDto.activityLongitude,
                  activityData: activityDto.activityData,
                  duration: activityDto.duration,
                  notes: activityDto.notes,
                  dayNumber: activityDto.dayNumber,
                  travelTimeToNext: activityDto.travelTimeToNext,
                  distanceToNext: activityDto.distanceToNext,
                };

                // Parse startTime if it's a string
                // Handle time strings like "09:00" vs full ISO dates
                if (activityDto.startTime) {
                  if (typeof activityDto.startTime === 'string') {
                    // Check if it's just a time string (HH:MM format) or a full date
                    const timePattern = /^\d{1,2}:\d{2}(:\d{2})?$/;
                    if (timePattern.test(activityDto.startTime)) {
                      // It's just a time string, don't convert to Date
                      // Store as string or null (Prisma DateTime needs full date)
                      activityData.startTime = undefined; // Skip for now, or implement date + time combination
                    } else {
                      // Try to parse as ISO date
                      const parsedDate = new Date(activityDto.startTime);
                      if (!isNaN(parsedDate.getTime())) {
                        activityData.startTime = parsedDate;
                      } else {
                        // Invalid date, skip
                        activityData.startTime = undefined;
                      }
                    }
                  } else if (activityDto.startTime instanceof Date) {
                    // Already a Date object
                    activityData.startTime = activityDto.startTime;
                  }
                }

                // Remove undefined values
                Object.keys(activityData).forEach(
                  (key) =>
                    activityData[key] === undefined && delete activityData[key],
                );

                return activityData;
              }) || [],
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

  /**
   * Generate a cover image for a tour
   */
  async generateTourCoverImage(tourId: string): Promise<string | null> {
    try {
      const tour = await this.prisma.tour.findUnique({
        where: { id: tourId },
        include: { activities: true },
      });

      if (!tour) return null;

      this.logger.debug(`Generating cover image for tour: ${tour.name}`);

      // Create a rich prompt based on tour details
      const activityNames = tour.activities
        .slice(0, 3)
        .map((a) => a.activityName)
        .join(', ');

      const prompt = generateCoverImagePrompt(
        tour.name,
        tour.description || tour.name,
        activityNames,
      );

      const imageUrl = await this.imageGenerationService.generateImage(prompt);

      if (imageUrl) {
        // Save to DB
        await this.prisma.tour.update({
          where: { id: tour.id },
          data: { coverImage: imageUrl },
        });
        this.logger.log(`Generated and saved cover image for tour ${tourId}`);
      }

      return imageUrl;
    } catch (error) {
      this.logger.error(`Error generating tour cover image: ${error.message}`);
      return null;
    }
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

    const finalPrompt = this.buildPromptFromParams({
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
      const preferences: any = {};
      if (options?.destination) {
        preferences.destination = options.destination;
      }
      if (options?.destinationLatitude !== undefined) {
        preferences.destinationLatitude = options.destinationLatitude;
      }
      if (options?.destinationLongitude !== undefined) {
        preferences.destinationLongitude = options.destinationLongitude;
      }
      if (options?.interests?.length) {
        preferences.interests = options.interests;
      }
      if (options?.transportationMode) {
        preferences.transportationMode = options.transportationMode;
      }
      if (options?.travelPace) {
        preferences.travelPace = options.travelPace;
      }
      if (options?.dietaryRestrictions?.length) {
        preferences.dietaryRestrictions = options.dietaryRestrictions;
      }
      if (options?.budgetLevel) {
        preferences.budgetLevel = options.budgetLevel;
      }
      if (options?.groupType) {
        preferences.groupType = options.groupType;
      }
      if (options?.startDates?.length) {
        preferences.startDates = options.startDates;
      }

      // Create basic tour structure (without activities)
      // Use destination as name if name is not provided
      const tourName = options?.name || options?.destination || 'Nuevo Tour';

      const tourData: CreateTourDto = {
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
      const tour = await this.create(tourData);
      const createTime = Date.now() - createStartTime;

      this.logger.log(
        `Tour created successfully with ID: ${tour.id} (DB time: ${createTime}ms). Starting activity generation in background...`,
      );

      // Start activity generation in background (don't await)
      this.generateTourActivities(tour.id).catch((error) => {
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
      finalPrompt = this.buildPromptFromParams({
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
                this.langChainService.findSimilarActivities(
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
      // Build preferences object from options
      const preferences: any = {};
      if (options?.destination) {
        preferences.destination = options.destination;
      }
      if (options?.destinationLatitude !== undefined) {
        preferences.destinationLatitude = options.destinationLatitude;
      }
      if (options?.destinationLongitude !== undefined) {
        preferences.destinationLongitude = options.destinationLongitude;
      }
      if (options?.interests?.length) {
        preferences.interests = options.interests;
      }
      if (options?.transportationMode) {
        preferences.transportationMode = options.transportationMode;
      }
      if (options?.travelPace) {
        preferences.travelPace = options.travelPace;
      }
      if (options?.dietaryRestrictions?.length) {
        preferences.dietaryRestrictions = options.dietaryRestrictions;
      }
      if (options?.budgetLevel) {
        preferences.budgetLevel = options.budgetLevel;
      }
      if (options?.groupType) {
        preferences.groupType = options.groupType;
      }
      if (options?.startDates?.length) {
        preferences.startDates = options.startDates;
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
        activities: options?.skipActivities
          ? [] // Skip activities if flag is set
          : aiResponse.activities?.map((act: any, index: number) => {
              // Validate activityId if provided (supp  orts UUID and ObjectId)

              const validActivityId =
                act.activityId && isValidId(act.activityId)
                  ? act.activityId
                  : undefined;

              // Parse startTime - handle time strings vs full dates
              let parsedStartTime: Date | string | undefined = act.startTime;
              if (act.startTime && typeof act.startTime === 'string') {
                const timePattern = /^\d{1,2}:\d{2}(:\d{2})?$/;
                if (timePattern.test(act.startTime)) {
                  // It's just a time string, we'll store it as-is in activityData
                  // For startTime field, we'll skip it or try to combine with a date
                  parsedStartTime = undefined; // Skip for now since we don't have a base date
                } else {
                  // Try to parse as ISO date
                  const parsedDate = new Date(act.startTime);
                  parsedStartTime = !isNaN(parsedDate.getTime())
                    ? parsedDate
                    : undefined;
                }
              }

              return {
                activityId: validActivityId,
                activityName: act.activityName || act.type || 'Activity',
                activityType: act.type || act.activityType,
                activityLatitude: act.latitude,
                activityLongitude: act.longitude,
                duration: act.duration,
                startTime: parsedStartTime,
                notes: act.notes,
                dayNumber: act.dayNumber,
                travelTimeToNext: act.travelTimeToNext,
                distanceToNext: act.distanceToNext,
                order: index + 1,
                // Store full activity data if activityId is not valid or not provided
                activityData: validActivityId
                  ? undefined
                  : ({
                      name: act.activityName || act.type,
                      type: act.type,
                      latitude: act.latitude,
                      longitude: act.longitude,
                      startTime: act.startTime, // Store original startTime string in activityData
                      ...act,
                    } as any),
              };
            }),
      };

      // Step 4: Create and return the tour
      const createStartTime = Date.now();
      const tour = await this.create(tourData);
      const createTime = Date.now() - createStartTime;

      // If skipActivities is true, don't generate activities now
      // They will be generated later via generateTourActivities endpoint
      if (!options?.skipActivities) {
        // Generate cover image (asynchronously to not block too long, or await if critical)
        // We'll await it to ensure the user gets a complete tour
        try {
          await this.generateTourCoverImage(tour.id);
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

  /**
   * Helper method to update generation status and message
   */
  private async updateGenerationStatus(
    tourId: string,
    status: string,
    message?: string,
  ) {
    const tour = await this.findOne(tourId);
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
    const tour = await this.findOne(tourId);
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
              await this.googleMapsService.crawlAndSaveActivities({
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
      const activities =
        aiResponse.activities?.map((act: any, index: number) => {
          const validActivityId =
            act.activityId && isValidId(act.activityId)
              ? act.activityId
              : undefined;

          let parsedStartTime: Date | string | undefined = act.startTime;
          if (act.startTime && typeof act.startTime === 'string') {
            const timePattern = /^\d{1,2}:\d{2}(:\d{2})?$/;
            if (timePattern.test(act.startTime)) {
              parsedStartTime = undefined;
            } else {
              const parsedDate = new Date(act.startTime);
              parsedStartTime = !isNaN(parsedDate.getTime())
                ? parsedDate
                : undefined;
            }
          }

          return {
            activityId: validActivityId,
            activityName: act.activityName || act.type || 'Activity',
            activityType: act.type || act.activityType,
            activityLatitude: act.latitude,
            activityLongitude: act.longitude,
            duration: act.duration,
            startTime: parsedStartTime,
            notes: act.notes,
            dayNumber: act.dayNumber,
            travelTimeToNext: act.travelTimeToNext,
            distanceToNext: act.distanceToNext,
            order: index + 1,
            activityData: validActivityId
              ? undefined
              : ({
                  name: act.activityName || act.type,
                  type: act.type,
                  latitude: act.latitude,
                  longitude: act.longitude,
                  startTime: act.startTime,
                  ...act,
                } as any),
          };
        }) || [];

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
        await this.generateTourCoverImage(tourId);
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
      return this.findOne(tourId);
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

  /**
   * Legacy method: Create a tour from a pre-formatted AI response
   * This accepts the raw AI response and saves it flexibly
   * @deprecated Use createFromPrompt with prompt string instead
   */
  async createFromPromptResponse(
    prompt: string,
    aiResponse: {
      title?: string;
      description?: string;
      estimatedDuration?: number;
      totalDays?: number;
      totalDistance?: number;
      estimatedBudget?: number;
      recommendedGroupSize?: number;
      activities?: Array<{
        activityId?: string;
        activityName?: string;
        activityType?: string;
        latitude?: number;
        longitude?: number;
        dayNumber?: number;
        startTime?: string;
        duration?: number;
        travelTimeToNext?: number;
        distanceToNext?: number;
        notes?: string;
        [key: string]: any; // Allow additional fields
      }>;
      [key: string]: any; // Allow additional fields in response
    },
  ) {
    const tourData: CreateTourDto = {
      name: aiResponse.title || 'Untitled Tour',
      description: aiResponse.description,
      duration: aiResponse.estimatedDuration,
      totalDays: aiResponse.totalDays,
      totalDistance: aiResponse.totalDistance,
      estimatedBudget: aiResponse.estimatedBudget,
      recommendedGroupSize: aiResponse.recommendedGroupSize,
      prompt: prompt,
      metadata: aiResponse, // Store full AI response in metadata
      activities: aiResponse.activities?.map((act, index) => {
        // Validate activityId if provided (supports UUID and ObjectId)
        const validActivityId =
          act.activityId && isValidId(act.activityId)
            ? act.activityId
            : undefined;

        return {
          activityId: validActivityId,
          activityName: act.activityName,
          activityType: act.activityType,
          activityLatitude: act.latitude,
          activityLongitude: act.longitude,
          duration: act.duration,
          startTime: act.startTime,
          notes: act.notes,
          dayNumber: act.dayNumber,
          travelTimeToNext: act.travelTimeToNext,
          distanceToNext: act.distanceToNext,
          order: index + 1,
          // Store full activity data if activityId is not valid or not provided
          activityData: validActivityId
            ? undefined
            : ({
                name: act.activityName,
                type: act.activityType,
                latitude: act.latitude,
                longitude: act.longitude,
                ...act,
              } as any),
        };
      }),
    };

    return this.create(tourData);
  }

  /**
   * Get nearby tours matching a category, or generate if none found
   */
  async getNearbyTours(
    latitude: number,
    longitude: number,
    category: string = 'walking',
    radius: number = 5000, // 5km default
  ) {
    // 1. Search for existing tours in the area
    // We'll check if any activity in the tour is within the radius
    // This is a rough approximation using bounding box logic for better performance
    const latDelta = radius / 111000; // Roughly 1 degree lat = 111km
    const lngDelta = radius / (111000 * Math.cos((latitude * Math.PI) / 180));

    const nearbyTours = await this.prisma.tour.findMany({
      where: {
        OR: [
          // Check inline activities
          {
            activities: {
              some: {
                activityLatitude: {
                  gte: latitude - latDelta,
                  lte: latitude + latDelta,
                },
                activityLongitude: {
                  gte: longitude - lngDelta,
                  lte: longitude + lngDelta,
                },
              },
            },
          },
          // Check linked activities
          {
            activities: {
              some: {
                activity: {
                  latitude: {
                    gte: latitude - latDelta,
                    lte: latitude + latDelta,
                  },
                  longitude: {
                    gte: longitude - lngDelta,
                    lte: longitude + lngDelta,
                  },
                },
              },
            },
          },
        ],
        // Filter by category (case insensitive search in name/description)
        AND: [
          {
            OR: [
              { name: { contains: category, mode: 'insensitive' } },
              { description: { contains: category, mode: 'insensitive' } },
              // { metadata: { path: ['category'], string_contains: category } } // If we had structured category
            ],
          },
        ],
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
      take: 10,
    });

    // 2. If we found enough tours, return them
    if (nearbyTours.length >= 3) {
      return nearbyTours;
    }

    // 3. If not enough tours, generate a new one using AI
    // We'll generate one tour to add to the collection
    try {
      const prompt = generateNearbyTourPrompt(category);

      // Generate tour (this saves it to DB)
      const generatedTour = await this.generateTour(prompt, {
        latitude,
        longitude,
        radius: radius * 2, // Search slightly wider for activities
        includeExistingActivities: true,
      });

      // Add to our results
      return [...nearbyTours, generatedTour];
    } catch (error) {
      this.logger.error(
        `Failed to generate nearby tour: ${error.message}`,
        error.stack,
      );
      // If generation fails, just return what we found (if any)
      return nearbyTours;
    }
  }

  async findAll(
    page = 1,
    limit = 100,
    category?: string,
    latitude?: number,
    longitude?: number,
    radius?: number,
  ) {
    const skip = (page - 1) * limit;

    // If lat/lng/radius provided, use nearby search logic if no category or combined
    // But if category is provided, we filter by category
    // The previous implementation of findAll just paginated everything.
    // We need to support the filters passed from controller.

    const where: any = {};

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

    // Note: Prisma doesn't support geospatial queries directly on standard fields easily without raw queries
    // or extensions. For now, we'll filter by category and simple pagination.
    // If latitude/longitude is provided, we might want to use findNearby logic instead?
    // However, findNearby returns an array, not a paginated result with meta.
    // Let's stick to basic filtering for now.

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

  async findOne(id: string) {
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

  async update(id: string, updateTourDto: UpdateTourDto) {
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

  async remove(id: string) {
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
    startingActivityId: string,
    numberOfActivities: number = 5,
    // preferences: {
    //   timeOfDay?: string[];
    //   physicalIntensity?: number;
    //   indoorOutdoor?: number;
    //   tags?: string[];
    // } = {},
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
    // const tourActivities = [startActivity];
    // Create a tour with the selected activities
    return nextActivity;
  }

  private async createTourFromActivities(activities: Activity[]) {
    // Use your existing tour creation logic or the AI-based tour chain
    const tourChain = this.createTourChain();

    // Convert activities array to a formatted string
    const activitiesString = activities
      .map(
        (a) =>
          `${a.name} (${a.type}) - ${a.description || 'No description'}. Location: ${a.latitude}, ${a.longitude}. Duration: ${a.duration}min. Price: $${a.price}`,
      )
      .join('\n');

    const result = await tourChain.invoke({
      input: `Create a tour with these activities: ${activities.map((a) => a.name).join(', ')}`,
      activities: activitiesString,
    });

    return result;
  }

  private async generateAIActivitiesWithContext(
    sourceActivity: Activity,
    sourceMetadata: any,
    count: number = 3,
  ): Promise<Activity[]> {
    // Obtener contexto geográfico
    const nearbyActivities = await this.prisma.activity.findMany({
      where: {
        latitude: {
          gte: sourceActivity.latitude - 0.1,
          lte: sourceActivity.latitude + 0.1,
        },
        longitude: {
          gte: sourceActivity.longitude - 0.1,
          lte: sourceActivity.longitude + 0.1,
        },
      },
      take: 5,
    });

    const localContext = nearbyActivities
      .map((a) => `${a.name} (${a.type})`)
      .join(', ');

    const prompt = generateContextualActivitiesPrompt(
      sourceActivity,
      sourceMetadata,
      localContext,
      count,
    );

    try {
      const response = await this.langChainService.generateChatResponse(
        CONTEXTUAL_ACTIVITIES_SYSTEM_PROMPT,
        prompt,
        {},
        { temperature: 0.7, maxTokens: 3000 },
      );

      // Limpiar la respuesta de markdown
      let cleanedResponse = response.trim();

      // Remover ```json y ``` si están presentes
      if (cleanedResponse.startsWith('```json')) {
        cleanedResponse = cleanedResponse.replace(/^```json\s*/, '');
      }
      if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.replace(/^```\s*/, '');
      }
      if (cleanedResponse.endsWith('```')) {
        cleanedResponse = cleanedResponse.replace(/\s*```$/, '');
      }

      console.log('Cleaned AI response:', cleanedResponse);

      const aiActivities = JSON.parse(cleanedResponse);

      return aiActivities.map((aiActivity: any, index: number) => ({
        id: `ai-generated-${Date.now()}-${index}`,
        name: aiActivity.name,
        type: aiActivity.type,
        description: aiActivity.description,
        latitude: aiActivity.latitude,
        longitude: aiActivity.longitude,
        duration: aiActivity.duration,
        formattedAddress: aiActivity.formattedAddress,
        price: 0,
        maxGroupSize: 10,
        difficulty: 'MEDIUM',
        metadata: JSON.stringify({
          enhancedDescription: aiActivity.description,
          tags: [aiActivity.type.toLowerCase(), 'ai-generated', 'contextual'],
          targetAudience: 'General public',
          physicalIntensity: sourceMetadata.physicalIntensity || 3,
          aiGenerated: true,
          localTips: aiActivity.localTips,
          reasoning: aiActivity.whyNext,
          generatedFrom: sourceActivity.id,
        }),
        sourceId: 'ai-generated',
        externalId: `ai-contextual-${Date.now()}-${index}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    } catch (error) {
      console.error('Error generating contextual AI activities:', error);
      console.error('Raw response was:', error); // Para debug
      return [];
    }
  }

  /**
   * Extract and clean JSON from AI response text
   * Handles markdown code blocks, extra text, and common formatting issues
   */
  private extractAndCleanJson(text: string): string {
    let cleaned = text.trim();

    // Remove markdown code blocks
    cleaned = cleaned.replace(/^```json\s*/i, '');
    cleaned = cleaned.replace(/^```\s*/, '');
    cleaned = cleaned.replace(/\s*```$/g, '');

    // Try to find JSON object boundaries using balanced braces
    const extractJsonObject = (text: string): string | null => {
      const startIdx = text.indexOf('{');
      if (startIdx === -1) return null;

      let depth = 0;
      let inString = false;
      let escapeNext = false;

      for (let i = startIdx; i < text.length; i++) {
        const char = text[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          continue;
        }

        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === '{') {
            depth++;
          } else if (char === '}') {
            depth--;
            if (depth === 0) {
              // Found the complete object
              return text.substring(startIdx, i + 1);
            }
          }
        }
      }

      return null;
    };

    // Try to extract JSON object
    const extractedJson = extractJsonObject(cleaned);
    if (extractedJson) {
      cleaned = extractedJson;
    } else {
      // Fallback: simple boundary detection
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd = cleaned.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
      }
    }

    // Remove any leading/trailing whitespace
    cleaned = cleaned.trim();

    // Remove common prefixes/suffixes that models sometimes add
    cleaned = cleaned.replace(
      /^Here's? (the|your|a) (JSON|json|response):\s*/i,
      '',
    );
    cleaned = cleaned.replace(/^(JSON|json):\s*/i, '');
    cleaned = cleaned.replace(
      /\s*This is (the|your|a) (JSON|json|response)\.?\s*$/i,
      '',
    );

    return cleaned;
  }

  private buildPromptFromParams(params: any): string {
    const parts: string[] = [];

    if (params.name) parts.push(`Tour Name: ${params.name}`);
    if (params.description) parts.push(`Description: ${params.description}`);
    if (params.categories?.length)
      parts.push(`Categories: ${params.categories.join(', ')}`);
    if (params.interests?.length)
      parts.push(`Interests: ${params.interests.join(', ')}`);

    if (params.latitude && params.longitude) {
      parts.push(`Location: ${params.latitude}, ${params.longitude}`);
    }

    // Add other params as needed for the base prompt
    if (parts.length === 0) {
      return 'Create a general tour itinerary';
    }

    return `Create a tour based on: ${parts.join('; ')}`;
  }

  /**
   * Attempt to repair common JSON formatting issues
   */
  private repairJson(jsonString: string): string {
    let repaired = jsonString;

    // Fix trailing commas before closing brackets/braces (most common issue)
    repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

    // Remove comments (JSON doesn't support comments)
    repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');
    repaired = repaired.replace(/\/\/.*$/gm, '');

    // Fix unescaped newlines and carriage returns in string values
    // This is safer than the previous approach - only fix within string contexts
    let inString = false;
    let escapeNext = false;
    let result = '';

    for (let i = 0; i < repaired.length; i++) {
      const char = repaired[i];

      if (escapeNext) {
        result += char;
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        result += char;
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        result += char;
        continue;
      }

      if (inString) {
        // Inside a string - escape newlines and carriage returns
        if (char === '\n') {
          result += '\\n';
        } else if (char === '\r') {
          result += '\\r';
        } else if (char === '\t') {
          result += '\\t';
        } else {
          result += char;
        }
      } else {
        result += char;
      }
    }

    repaired = result;

    return repaired;
  }
}
