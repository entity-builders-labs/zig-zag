import {
  BudgetLevel,
  TransportationMode,
  GroupType,
  TravelPace,
} from '../dto/create-tour-from-prompt.dto';

export interface GenerateTourOptions {
  ownerId?: string;
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
