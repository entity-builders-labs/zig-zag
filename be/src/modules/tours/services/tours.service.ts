// @ts-nocheck
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateTourDto } from '../dto/create-tour.dto';
import { UpdateTourDto } from '../dto/update-tour.dto';
// import { Activity } from '@prisma/client';
import { ActivitiesService } from '../../activities/services/activities.service';
import { LangChainService } from '../../../shared/ai/langchain.service';
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
} from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { JsonOutputFunctionsParser } from 'langchain/output_parsers';

@Injectable()
export class ToursService {
  private readonly logger = new Logger(ToursService.name);

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

    console.log('$$$ AI ACTIVITIES:', aiActivities.length);

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
        console.log('$$$ aiActivities:', aiActivities);
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
    const timeOfDay = metadata.timeOfDayPreference?.join(', ') || 'flexible';
    const complementaryAfter =
      metadata.complementaryActivities?.after?.join(', ') || '';
    const energyAfter = metadata.energyLevel?.after || 3;
    const physicalIntensity = metadata.physicalIntensity || 3;
    const combinationScores = metadata.combinationScore || {};

    // Build contextual hints
    const contextualInfo =
      options.contextualHints?.length > 0
        ? `Additional context: ${options.contextualHints.join(', ')}.`
        : '';

    return `Find activities that complement and flow well after "${activity.name}".

Current activity details:
- Type: ${activity.type}
- Physical intensity: ${physicalIntensity}/5
- Best time: ${timeOfDay}
- Energy level after: ${energyAfter}/5
- Complementary activity types: ${complementaryAfter}
- Strong combination areas: ${Object.entries(combinationScores)
      .filter(([_, score]: [string, number]) => score >= 4)
      .map(([type, _]) => type)
      .join(', ')}

${contextualInfo}

Looking for activities that:
1. Create a natural progression from the current activity
2. Match the energy level and flow expectations
3. Offer complementary experiences (different but harmonious)
4. Consider transition time and logistics
5. Provide variety while maintaining coherence

Prioritize activities that would make someone think "this is the perfect next thing to do".`;
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
    const prompt = `Explain why "${candidateActivity.name}" is a great follow-up activity after "${sourceActivity.name}".

Scoring breakdown:
- Complementarity: ${scores.complementarityScore}/100
- Diversity: ${scores.diversityScore}/100  
- Proximity: ${scores.proximityScore}/100
- Time compatibility: ${scores.timeCompatibilityScore}/100

Provide a concise, engaging explanation (2-3 sentences) that highlights the main reasons why this combination works well, focusing on the flow, experience, and practical benefits.`;

    return this.langChainService.generateChatResponse(
      'You are a travel experience designer who creates seamless activity transitions.',
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
      // Helper function to validate MongoDB ObjectID
      const isValidObjectId = (id: any): id is string => {
        if (!id || typeof id !== 'string') return false;
        // MongoDB ObjectID is 24 hex characters
        return /^[0-9a-fA-F]{24}$/.test(id);
      };

      const activityIds = activities
        .map((a) => a.activityId)
        .filter((id): id is string => isValidObjectId(id));

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
   * Generate a tour from a prompt using LangChain and AI
   * This method uses the LangChain service to generate structured tour data from a natural language prompt
   */
  async createFromPrompt(
    prompt: string,
    options?: {
      latitude?: number;
      longitude?: number;
      radius?: number; // in meters, default 50000 (50km)
      includeExistingActivities?: boolean; // Whether to search for existing activities in DB
    },
  ) {
    this.logger.log(
      `Generating tour from prompt: ${prompt.substring(0, 100)}...`,
    );

    try {
      // Step 1: If location provided, search for existing activities
      let availableActivitiesText = '';
      if (options?.latitude && options?.longitude) {
        const radius = options.radius || 50000; // 50km default
        const nearbyActivities = await this.activitiesService.findAll(
          options.latitude.toString(),
          options.longitude.toString(),
          radius,
          50, // limit to 50 activities
        );

        if (nearbyActivities.length > 0) {
          availableActivitiesText = `\n\nAvailable activities in the area (within ${radius / 1000}km):\n${nearbyActivities
            .map(
              (act, idx) =>
                `${idx + 1}. ${act.name} (${act.type || 'Activity'}) - ${act.description || 'No description'} - Location: ${act.latitude}, ${act.longitude} - Duration: ${act.duration || 'Unknown'} minutes`,
            )
            .join('\n')}`;
        } else if (options.includeExistingActivities) {
          // Try semantic search if no nearby activities found
          try {
            const semanticResults =
              await this.langChainService.findSimilarActivities(
                `Activities in ${options.latitude}, ${options.longitude}: ${prompt}`,
                10,
              );

            if (semanticResults.length > 0) {
              availableActivitiesText = `\n\nRelevant activities found:\n${semanticResults
                .map(
                  (result: any, idx: number) =>
                    `${idx + 1}. ${result.metadata?.activityName || 'Activity'} - ${result.pageContent.substring(0, 100)}...`,
                )
                .join('\n')}`;
            }
          } catch (error) {
            this.logger.warn(`Semantic search failed: ${error.message}`);
          }
        }
      }

      // Step 2: Create the tour using LangChain
      const tourChain = this.createTourChain();

      // Prepare the input with available activities context
      const fullPrompt = prompt + availableActivitiesText;

      this.logger.debug(
        `Invoking tour chain with prompt: ${fullPrompt.substring(0, 200)}...`,
      );

      const aiResponse = (await tourChain.invoke({
        input: fullPrompt,
        activities:
          availableActivitiesText ||
          'No specific activities provided. Create a general tour.',
      })) as any; // Type assertion for AI response

      this.logger.debug(
        `AI generated tour response: ${JSON.stringify(aiResponse).substring(0, 200)}...`,
      );

      // Step 3: Convert AI response to CreateTourDto format
      const tourData: CreateTourDto = {
        name: aiResponse.title || 'Untitled Tour',
        description: aiResponse.description || aiResponse.title,
        duration: aiResponse.estimatedDuration,
        totalDays: aiResponse.totalDays,
        totalDistance: aiResponse.totalDistance,
        estimatedBudget: aiResponse.estimatedBudget,
        recommendedGroupSize: aiResponse.recommendedGroupSize,
        prompt: prompt,
        metadata: {
          ...(aiResponse as object),
          generatedAt: new Date().toISOString(),
          options: options,
        }, // Store full AI response in metadata
        activities: aiResponse.activities?.map((act: any, index: number) => {
          // Validate activityId if provided
          const isValidObjectId = (id: any): id is string => {
            if (!id || typeof id !== 'string') return false;
            return /^[0-9a-fA-F]{24}$/.test(id);
          };

          const validActivityId =
            act.activityId && isValidObjectId(act.activityId)
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
      const tour = await this.create(tourData);
      this.logger.log(`Tour created successfully with ID: ${tour.id}`);

      return tour;
    } catch (error) {
      this.logger.error(
        `Error generating tour from prompt: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Failed to generate tour from prompt: ${error.message}`,
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
        // Validate activityId if provided
        const isValidObjectId = (id: any): id is string => {
          if (!id || typeof id !== 'string') return false;
          return /^[0-9a-fA-F]{24}$/.test(id);
        };

        const validActivityId =
          act.activityId && isValidObjectId(act.activityId)
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

    const prompt = `You are generating complementary activities near "${sourceActivity.name}" in this area.

LOCATION CONTEXT:
- Coordinates: ${sourceActivity.latitude}, ${sourceActivity.longitude}
- Address: ${sourceActivity.formattedAddress}
- Nearby existing activities: ${localContext}

CURRENT ACTIVITY:
- Name: ${sourceActivity.name}
- Type: ${sourceActivity.type}
- Description: ${sourceActivity.description}
- Duration: ${sourceActivity.duration} minutes
- Energy level after: ${sourceMetadata.energyLevel?.after || 3}/5

REQUIREMENTS:
Generate ${count} realistic activities that:
1. Actually exist or could realistically exist in this specific area
2. Are within 2-5km of the source location
3. Complement the energy flow and experience type
4. Avoid duplicating nearby existing activities: ${localContext}

For each activity, provide these fields:
- name: Specific, realistic business/location name
- type: Activity category
- description: Detailed description with local context
- latitude: realistic latitude nearby
- longitude: realistic longitude nearby
- duration: duration in minutes
- formattedAddress: Realistic street address
- localTips: Specific tips for this location
- whyNext: Why this works well after the source activity

Return as a valid JSON array with these exact field names.`;

    try {
      const response = await this.langChainService.generateChatResponse(
        'You are a local tourism expert with access to real-time location data and deep knowledge of what activities exist in specific geographic areas.',
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
}
