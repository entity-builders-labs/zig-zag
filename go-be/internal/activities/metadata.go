package activities

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
)

// Chatter is the narrow slice of ai.ChatService's surface MetadataService needs.
type Chatter interface {
	GenerateChatResponse(ctx context.Context, systemPromptTemplate, userPromptTemplate string, variables map[string]string) (string, error)
}

// ImageGenerator is the narrow slice of ai.ImageGenerator's surface needed.
type ImageGenerator interface {
	GenerateImage(ctx context.Context, prompt string, size string, bypass bool) string
}

// MetadataService ports ActivityMetadataService
// (be/src/modules/activities/services/activity-metadata.service.ts) — only
// GenerateMetadata and GenerateActivityImage are ported: those are the
// only two methods ActivitiesService.Create actually calls.
// GenerateEnhancedDescription/GenerateTags/GenerateTargetAudience exist in
// the Nest source but aren't wired to any HTTP-reachable path there
// either — skipped rather than speculatively ported.
type MetadataService struct {
	chat  Chatter
	image ImageGenerator
}

func NewMetadataService(chat Chatter, image ImageGenerator) *MetadataService {
	return &MetadataService{chat: chat, image: image}
}

// ActivityInfo is the subset of activity fields the metadata prompt is
// built from — matches the `ActivityInfo` object in generateMetadata().
type ActivityInfo struct {
	Name         string
	Description  string
	Type         string
	Difficulty   string
	LocationText string
	Price        *float64
	Duration     *float64
}

// GenerateImage builds the DALL-E prompt for an activity cover image and
// delegates to ImageGenerator — mirrors generateActivityImage. Errors are
// swallowed (returns ""), matching the original's catch-and-return-null.
func (s *MetadataService) GenerateImage(ctx context.Context, name, activityType, description string) string {
	desc := description
	if desc == "" {
		desc = name
	}
	prompt := fmt.Sprintf(
		"A high quality, photorealistic travel photography image of %s. \n      Activity type: %s. \n      Description: %s. \n      The image should be inviting, vibrant, professional, and suitable for a travel website. \n      No text, no watermarks, no collages.",
		name, activityType, desc,
	)
	return s.image.GenerateImage(ctx, prompt, "1024x1024", true)
}

// GenerateMetadata mirrors generateMetadata: builds the activity-info JSON,
// runs it through the (giant) metadata prompt template, and parses the
// result as a generic JSON object — callers only ever read back the
// "enhancedDescription" key specifically, everything else is stored
// opaquely in Activity.metadata, so this isn't unmarshaled into 50
// individually-typed fields.
func (s *MetadataService) GenerateMetadata(ctx context.Context, info ActivityInfo) (map[string]any, error) {
	locationText := info.LocationText

	infoPayload := map[string]any{
		"name":        info.Name,
		"description": info.Description,
		"type":        info.Type,
		"difficulty":  defaultString(info.Difficulty, "MEDIUM"),
		"location":    locationText,
		"price":       info.Price,
		"duration":    info.Duration,
	}
	infoJSON, err := json.Marshal(infoPayload)
	if err != nil {
		return fallbackMetadata(info.Description), nil
	}

	result, err := s.chat.GenerateChatResponse(ctx, metadataPromptTemplate, "", map[string]string{"activity": string(infoJSON)})
	if err != nil {
		slog.Error("error generating activity metadata", "error", err)
		return fallbackMetadata(info.Description), nil
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(result), &parsed); err != nil {
		slog.Error("error parsing metadata result", "error", err)
		return map[string]any{}, nil
	}
	return parsed, nil
}

// fallbackMetadata mirrors generateMetadata's catch block: minimal metadata
// so activity creation doesn't fail outright when AI is disabled or errors.
func fallbackMetadata(description string) map[string]any {
	return map[string]any{
		"enhancedDescription": description,
		"tags":                []string{},
		"targetAudience":      "General",
		"bestTimeToVisit":     "any time",
	}
}

func defaultString(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// metadataPromptTemplate mirrors createMetadataPrompt's template
// (activity-metadata.service.ts) verbatim — the {activity} placeholder is
// resolved by ChatService.GenerateChatResponse.
const metadataPromptTemplate = `
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
    - seasonalityScore: {
        "spring": Rate from 1 to 5,
        "summer": Rate from 1 to 5,
        "fall": Rate from 1 to 5,
        "winter": Rate from 1 to 5
    }
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
    - groupSizeRecommendation: {
        "min": Number between 1 and 100,
        "max": Number between 1 and 100,
        "ideal": Number between 1 and 100
    }

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
    - energyLevel: {
        "before": Rate from 1 to 5,
        "after": Rate from 1 to 5
    }
    - mealCompatibility: {
        preMeal: boolean (can be done right after eating),
        postMeal: boolean (can be done right before eating)
      }
    - combinationScore: {
        "cultural": Rate from 1 to 5,
        "adventure": Rate from 1 to 5,
        "nature": Rate from 1 to 5,
        "relaxation": Rate from 1 to 5,
        "shopping": Rate from 1 to 5,
        "food": Rate from 1 to 5,
        "educational": Rate from 1 to 5,
        "entertainment": Rate from 1 to 5
    }
    - transitionTime: {
        "beforeActivity": Number of minutes,
        "afterActivity": Number of minutes
    }
      - complementaryActivities: {
        before: Array of activity types that work well before,
        after: Array of activity types that work well after
      }

    Special Considerations:
    - weatherCancellationRisk: Rate 1-5 likelihood of weather cancellation
    - childFriendliness: Rate 1-5 suitability for children
    - seniorFriendliness: Rate 1-5 suitability for seniors
    - petFriendly: Boolean if pets are allowed
    - photographyRestrictions: Any restrictions on photography
    - dietaryConsiderations: Any relevant food/dietary information

    Return ONLY the JSON object with no additional text.
    Response format:
    {
      "enhancedDescription": string,
      "tags": string[],
      "targetAudience": string,
      "bestTimeToVisit": string,
      "accessibilityInfo": string,
      "recommendedEquipment": string,
      "culturalRelevance": string,
      "sustainabilityRating": number,
      "seasonalityScore": {
        "spring": number,
        "summer": number,
        "fall": number,
        "winter": number
      },
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
      "transportationNeeds": {
        "publicTransport": boolean,
        "car": boolean,
      }
      "groupSizeRecommendation": {
        "min": number,
        "max": number,
        "ideal": number
      },
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
      "seasonalityScore": {
        "spring": number,
        "summer": number,
        "fall": number,
        "winter": number
      },
      "timeOfDayPreference": string[],
      "weatherSensitivity": number,
      "timeSlotFlexibility": number,
      "environmentalImpact": number,
      "seasonalAvailability": boolean,
      "weatherDependency": number,
      "mealCompatibility": {
        "preMeal": boolean,
        "postMeal": boolean
      },
      "combinationScore": {
        "cultural": number,
        "adventure": number,
        "nature": number,
        "relaxation": number,
        "shopping": number,
        "food": number,
        "educational": number,
        "entertainment": number
      },
      "transitionTime": {
        "beforeActivity": number,
        "afterActivity": number
      },
      "complementaryActivities": {
        "before": string[],
        "after": string[]
      },
      "weatherCancellationRisk": number,
      "childFriendliness": number,
      "seniorFriendliness": number,
      "petFriendly": boolean,
      "photographyRestrictions": string[],
      "dietaryConsiderations": string[]
    }
    `
