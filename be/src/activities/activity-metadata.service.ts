import { Injectable, Logger } from '@nestjs/common';
import { LangChainService } from '../shared/ai/langchain.service';
import { ActivityMetadataDto } from './dto/activity-metadata.dto';
import { PromptTemplate } from '@langchain/core/prompts';
import { CreateActivityDto } from './dto/create-activity.dto';
import { Activity } from '@prisma/client';

@Injectable()
export class ActivityMetadataService {
  private readonly logger = new Logger(ActivityMetadataService.name);

  constructor(private readonly langChainService: LangChainService) {}

  /**
   * Generate complete metadata for an activity
   */
  async generateMetadata(
    activity: Activity | CreateActivityDto,
  ): Promise<ActivityMetadataDto> {
    try {
      this.logger.debug(`Generating metadata for activity: ${activity.name}`);

      const prompt = this.createMetadataPrompt();

      const activityInfo = {
        name: activity.name,
        description: activity.description || '',
        type: activity.type,
        difficulty: activity.difficulty || 'MEDIUM',
        location:
          typeof activity.location === 'object'
            ? JSON.stringify(activity.location)
            : activity.location || '',
        price: activity.price,
        duration: activity.duration,
      };

      const result = await this.langChainService.generateChatResponse(
        prompt.template as string,
        '',
        {
          activity: JSON.stringify(activityInfo),
        },
        { temperature: 0.7 },
      );

      // Parse the result JSON
      try {
        return JSON.parse(result);
      } catch (parseError) {
        this.logger.error(
          `Error parsing metadata result: ${parseError.message}`,
        );
        return {} as ActivityMetadataDto;
      }
    } catch (error) {
      this.logger.error(`Error generating activity metadata: ${error.message}`);
      return {} as ActivityMetadataDto;
    }
  }

  /**
   * Generate only enhanced description for an activity
   */
  async generateEnhancedDescription(
    activity: Activity | CreateActivityDto,
  ): Promise<string> {
    try {
      this.logger.debug(
        `Generating enhanced description for activity: ${activity.name}`,
      );

      const prompt = this.createDescriptionPrompt();

      const activityInfo = {
        name: activity.name,
        description: activity.description || '',
        type: activity.type,
        difficulty: activity.difficulty || 'MEDIUM',
      };

      const result = await this.langChainService.generateChatResponse(
        prompt.template as string,
        '',
        {
          activity: JSON.stringify(activityInfo),
        },
        { temperature: 0.7 },
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Error generating enhanced description: ${error.message}`,
      );
      return '';
    }
  }

  /**
   * Generate tags for an activity
   */
  async generateTags(
    activity: Activity | CreateActivityDto,
  ): Promise<string[]> {
    try {
      this.logger.debug(`Generating tags for activity: ${activity.name}`);

      const prompt = this.createTagsPrompt();

      const activityInfo = {
        name: activity.name,
        description: activity.description || '',
        type: activity.type,
        difficulty: activity.difficulty || 'MEDIUM',
      };

      const result = await this.langChainService.generateChatResponse(
        prompt.template as string,
        '',
        {
          activity: JSON.stringify(activityInfo),
        },
        { temperature: 0.5 },
      );

      try {
        return JSON.parse(result);
      } catch (parseError) {
        this.logger.error(`Error parsing tags result: ${parseError.message}`);
        return [];
      }
    } catch (error) {
      this.logger.error(`Error generating tags: ${error.message}`);
      return [];
    }
  }

  /**
   * Generate target audience information for an activity
   */
  async generateTargetAudience(
    activity: Activity | CreateActivityDto,
  ): Promise<string> {
    try {
      this.logger.debug(
        `Generating target audience for activity: ${activity.name}`,
      );

      const prompt = this.createTargetAudiencePrompt();

      const activityInfo = {
        name: activity.name,
        description: activity.description || '',
        type: activity.type,
        difficulty: activity.difficulty || 'MEDIUM',
        price: activity.price,
        duration: activity.duration,
      };

      const result = await this.langChainService.generateChatResponse(
        prompt.template as string,
        '',
        {
          activity: JSON.stringify(activityInfo),
        },
        { temperature: 0.6 },
      );

      return result;
    } catch (error) {
      this.logger.error(`Error generating target audience: ${error.message}`);
      return '';
    }
  }

  /**
   * Create a prompt template for generating complete metadata
   */
  private createMetadataPrompt(): PromptTemplate {
    const template = `
    You are an expert travel and activity consultant with detailed knowledge about global attractions and activities. 
    Your task is to generate rich, detailed metadata for an activity based on the provided information.
    
    Here is the activity information:
    {activity}
    
    Generate comprehensive metadata for this activity in valid JSON format with the following fields:

    Basic Information:
    - enhancedDescription: A rich, engaging, and detailed description of the activity (200-300 words)
    - tags: An array of 5-10 relevant tags/keywords related to this activity
    - targetAudience: Description of who this activity is best suited for
    
    Temporal & Environmental Factors:
    - bestTimeToVisit: When is the optimal time to do this activity
    - weatherConsiderations: How weather impacts this activity
    - seasonalityScore: {{
        "spring": Rate from 1 to 5,
        "summer": Rate from 1 to 5,
        "fall": Rate from 1 to 5,
        "winter": Rate from 1 to 5
    s}}
    - timeOfDayPreference: Array of best times ["morning", "afternoon", "evening", "night"]
    - weatherSensitivity: Rate 1-5 how much weather affects this activity
    - timeSlotFlexibility: Rate 1-5 how flexible the start time can be
    - durationFlexibility: Rate 1-5 how flexible the duration can be
    
    Physical & Accessibility:
    - accessibilityInfo: Detailed accessibility features or limitations
    - physicalIntensity: Rate 1-5 how physically demanding
    - mobilityRequirements: Rate 1-5 the level of mobility needed
    - minAge: Recommended minimum age
    - maxAge: Recommended maximum age (if applicable)
    - fitnessLevel: Required fitness level 1-5
    
    Logistics & Planning:
    - recommendedEquipment: Array of required/recommended items
    - preparationTime: Minutes needed before activity starts
    - recoveryTime: Recommended rest time after activity (minutes)
    - transportationNeeds: Object describing transport requirements
    - groupSizeRecommendation: {{
        "min": Number between 1 and 100,
        "max": Number between 1 and 100,
        "ideal": Number between 1 and 100
    }}
    
    Experience Characteristics:
    - paceRating: Rate 1-5 how fast-paced the activity is
    - indoorOutdoor: Rate 1-5 (1: fully indoor, 5: fully outdoor)
    - noiseLevel: Rate 1-5 the typical noise level
    - crowdLevel: Rate 1-5 typical crowd density
    - photographyValue: Rate 1-5 for photo opportunities
    - learningValue: Rate 1-5 for educational content
    
    Cultural & Social Aspects:
    - culturalRelevance: Cultural or historical significance
    - languageRequirements: Array of languages activity is available in
    - socialInteractionLevel: Rate 1-5 amount of social interaction
    - localCommunityImpact: Rate 1-5 benefit to local community
    - culturalSensitivity: Rate 1-5 cultural awareness needed
    
    Environmental & Sustainability:
    - sustainabilityRating: Rate 1-5 how eco-friendly
    - environmentalImpact: Rate 1-5 (1: minimal impact, 5: significant impact)
    - seasonalAvailability: Boolean for if it's seasonal
    - weatherDependency: Rate 1-5 dependency on good weather
    
    Tour Integration Metrics:
    - energyLevel: {{
        "before": Rate from 1 to 5,
        "after": Rate from 1 to 5
    }}
    - mealCompatibility: {{
        preMeal: boolean (can be done right after eating),
        postMeal: boolean (can be done right before eating)
      }}
    - combinationScore: {{
        "cultural": Rate from 1 to 5,
        "adventure": Rate from 1 to 5,
        "nature": Rate from 1 to 5,
        "relaxation": Rate from 1 to 5,
        "shopping": Rate from 1 to 5,
        "food": Rate from 1 to 5,
        "educational": Rate from 1 to 5,
        "entertainment": Rate from 1 to 5
    }}
    - transitionTime: {{
        "beforeActivity": Number of minutes,
        "afterActivity": Number of minutes
    }}
      - complementaryActivities: {{
        before: Array of activity types that work well before,
        after: Array of activity types that work well after
      }}
    
    Special Considerations:
    - weatherCancellationRisk: Rate 1-5 likelihood of weather cancellation
    - childFriendliness: Rate 1-5 suitability for children
    - seniorFriendliness: Rate 1-5 suitability for seniors
    - petFriendly: Boolean if pets are allowed
    - photographyRestrictions: Any restrictions on photography
    - dietaryConsiderations: Any relevant food/dietary information
    
    Return ONLY the JSON object with no additional text.
    Response format:
    {{
      "enhancedDescription": string,
      "tags": string[],
      "targetAudience": string,
      "bestTimeToVisit": string,
      "accessibilityInfo": string,
      "recommendedEquipment": string,
      "culturalRelevance": string,
      "sustainabilityRating": number,
      "seasonalityScore": {{
        "spring": number,
        "summer": number,
        "fall": number,
        "winter": number
      }}, 
      "timeOfDayPreference": string[],  
      "weatherSensitivity": number,
      "timeSlotFlexibility": number,
      "durationFlexibility": number,
      "physicalIntensity": number,
      "mobilityRequirements": number,
      "minAge": number,
      "maxAge": number,
      "fitnessLevel": number,
      "preparationTime": number,
      "recoveryTime": number,
      "transportationNeeds": {{
        "publicTransport": boolean,
        "car": boolean,
      }}
      "groupSizeRecommendation": {{
        "min": number,
        "max": number,
        "ideal": number
      }},
      "paceRating": number,
      "indoorOutdoor": number,
      "noiseLevel": number,
      "crowdLevel": number,
      "photographyValue": number,
      "learningValue": number,
      "culturalRelevance": string,
      "languageRequirements": string[],
      "socialInteractionLevel": number,
      "localCommunityImpact": number,
      "culturalSensitivity": number,
      "sustainabilityRating": number,
      "seasonalityScore": {{
        "spring": number,
        "summer": number,
        "fall": number,
        "winter": number
      }},
      "timeOfDayPreference": string[],
      "weatherSensitivity": number,
      "timeSlotFlexibility": number,
      "environmentalImpact": number,
      "seasonalAvailability": boolean,
      "weatherDependency": number,
      "mealCompatibility": {{
        "preMeal": boolean,
        "postMeal": boolean
      }},
      "combinationScore": {{
        "cultural": number,
        "adventure": number,
        "nature": number,
        "relaxation": number,
        "shopping": number,
        "food": number,
        "educational": number,
        "entertainment": number
      }},
      "transitionTime": {{
        "beforeActivity": number,
        "afterActivity": number
      }},
      "complementaryActivities": {{
        "before": string[],
        "after": string[]
      }},
      "weatherCancellationRisk": number,
      "childFriendliness": number,
      "seniorFriendliness": number,
      "petFriendly": boolean,
      "photographyRestrictions": string[],
      "dietaryConsiderations": string[]
    }}
    `;

    return this.langChainService.createPromptTemplate(template, ['activity']);
  }

  /**
   * Create a prompt template for generating enhanced descriptions
   */
  private createDescriptionPrompt(): PromptTemplate {
    const template = `
    You are an expert travel writer who specializes in creating engaging and descriptive content for tourism activities.
    
    Here is information about an activity:
    {activity}
    
    Create an enhanced, engaging description for this activity that:
    1. Is 200-300 words in length
    2. Uses vivid language and sensory details
    3. Highlights the unique aspects of the activity
    4. Includes relevant information about the experience, surroundings, and what visitors can expect
    5. Has an enthusiastic but professional tone
    
    Return only the enhanced description, with no additional comments or text.
    `;

    return this.langChainService.createPromptTemplate(template, ['activity']);
  }

  /**
   * Create a prompt template for generating tags
   */
  private createTagsPrompt(): PromptTemplate {
    const template = `
    You are an expert in categorization and tagging for tourism and activity platforms.
    
    Here is information about an activity:
    {activity}
    
    Generate a list of 5-10 relevant tags for this activity. The tags should:
    1. Be relevant to the type of activity
    2. Include features, themes, and attributes that would help users discover this activity
    3. Be concise (1-3 words per tag)
    4. Include a mix of general categories and specific attributes
    
    Return only an array of tags in valid JSON format, with no additional text.
    Example: ["adventure", "family-friendly", "mountain", "guided-tour", "half-day", "photography"]
    `;

    return this.langChainService.createPromptTemplate(template, ['activity']);
  }

  /**
   * Create a prompt template for generating target audience information
   */
  private createTargetAudiencePrompt(): PromptTemplate {
    const template = `
    You are an expert in tourism and activity planning with deep knowledge of different demographic needs and interests.
    
    Here is information about an activity:
    {activity}
    
    Analyze this activity and generate a concise description of its ideal target audience. Consider:
    1. Age groups that would most enjoy this activity
    2. Interest profiles (adventure seekers, nature lovers, culture enthusiasts, etc.)
    3. Required physical abilities or skill levels
    4. Any specific groups this activity would particularly appeal to

    Return only the target audience description in a concise paragraph of 2-3 sentences, with no additional text.
    `;

    return this.langChainService.createPromptTemplate(template, ['activity']);
  }
}
