import { GenerateTourOptions } from '../interfaces/tour-generation.interface';

/**
 * Build a prompt from tour generation parameters
 */
export function buildPromptFromParams(params: {
  name?: string;
  description?: string;
  days?: number;
  totalDistance?: number;
  price?: number;
  estimatedBudget?: number;
  maxGroupSize?: number;
  recommendedGroupSize?: number;
  startDates?: string[];
  categories?: string[];
  interests?: string[];
  budgetLevel?: string;
  transportationMode?: string[];
  travelPace?: string;
  dietaryRestrictions?: string[];
  groupType?: string;
  latitude?: number;
  longitude?: number;
  destination?: string;
}): string {
  const parts: string[] = [];

  if (params.name) parts.push(`Tour Name: ${params.name}`);
  if (params.description) parts.push(`Description: ${params.description}`);
  if (params.categories?.length)
    parts.push(`Categories: ${params.categories.join(', ')}`);
  if (params.interests?.length)
    parts.push(`Interests: ${params.interests.join(', ')}`);
  if (params.budgetLevel) parts.push(`Budget level: ${params.budgetLevel}`);
  if (params.transportationMode?.length)
    parts.push(`Transportation: ${params.transportationMode.join(', ')}`);
  if (params.travelPace) parts.push(`Travel pace: ${params.travelPace}`);
  if (params.dietaryRestrictions?.length)
    parts.push(
      `Dietary restrictions: ${params.dietaryRestrictions.join(', ')}`,
    );
  if (params.groupType) parts.push(`Group type: ${params.groupType}`);

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
 * Build preferences object from GenerateTourOptions
 */
export function buildPreferencesObject(
  options?: GenerateTourOptions,
): Record<string, any> {
  const preferences: Record<string, any> = {};

  if (!options) return preferences;

  if (options.destination) {
    preferences.destination = options.destination;
  }
  if (options.destinationLatitude !== undefined) {
    preferences.destinationLatitude = options.destinationLatitude;
  }
  if (options.destinationLongitude !== undefined) {
    preferences.destinationLongitude = options.destinationLongitude;
  }
  if (options.interests?.length) {
    preferences.interests = options.interests;
  }
  if (options.transportationMode) {
    preferences.transportationMode = options.transportationMode;
  }
  if (options.travelPace) {
    preferences.travelPace = options.travelPace;
  }
  if (options.dietaryRestrictions?.length) {
    preferences.dietaryRestrictions = options.dietaryRestrictions;
  }
  if (options.budgetLevel) {
    preferences.budgetLevel = options.budgetLevel;
  }
  if (options.groupType) {
    preferences.groupType = options.groupType;
  }
  if (options.startDates?.length) {
    preferences.startDates = options.startDates;
  }

  return preferences;
}
