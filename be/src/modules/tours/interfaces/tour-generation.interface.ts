export enum BudgetLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum TransportationMode {
  WALKING = 'walking',
  DRIVING = 'driving',
  PUBLIC_TRANSPORT = 'public_transport',
  CYCLING = 'cycling',
}

export enum GroupType {
  SOLO = 'solo',
  COUPLE = 'couple',
  FAMILY = 'family',
  FRIENDS = 'friends',
}

export enum TravelPace {
  RELAXED = 'relaxed',
  MODERATE = 'moderate',
  FAST = 'fast',
}

export enum ExplorationStyle {
  ICONIC = 'iconic',
  BALANCED = 'balanced',
  LOCAL_DEEP_DIVE = 'local_deep_dive',
}

export enum DestinationScaleHint {
  SETTLEMENT = 'settlement',
  SPECIFIC_POINT = 'specific_point',
}

export interface TourIntent {
  interests: string[];
  explorationStyle: ExplorationStyle;
  additionalPreferences?: string;
  /** LLM-normalized language; deterministic services enforce exclusions. */
  normalizedPreferences?: {
    preferredThemes: string[];
    preferredTraits: string[];
    excludedThemes: string[];
    excludedTraits: string[];
    hardExclusions: string[];
    positiveSemanticQuery: string;
    notes: string[];
  };
}

export interface MobilityPreferences {
  allowedTransportationModes: TransportationMode[];
  maxWalkingDistancePerDayMeters: number;
  maxContinuousWalkingDistanceMeters: number;
  travelPace: TravelPace;
  accessibilityNeeds: string[];
}

export interface TourDestinationSelection {
  label?: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  scaleHint: DestinationScaleHint;
}

/**
 * Canonical wizard request after validation and normalization. This is the
 * only shape persisted for background generation; provider-specific
 * autocomplete fields never cross this boundary.
 */
export interface TourGenerationRequest {
  contractVersion: 1;
  destination: TourDestinationSelection;
  days: number;
  budgetLevel: BudgetLevel;
  groupType: GroupType;
  intent: TourIntent;
  mobility: MobilityPreferences;
  dietaryRestrictions: string[];
  startDates: string[];
  includeExistingExperiences: boolean;
  skipImageGeneration: boolean;
  excludeTours: string[];
  categories: string[];
}

/**
 * Legacy internal options used only by the deprecated nearby-tour generator.
 * Wizard generation uses TourGenerationRequest and must not accept this flat
 * shape.
 */
export interface GenerateTourOptions {
  ownerId?: string;
  latitude?: number;
  longitude?: number;
  radius?: number; // in meters, default 25000 (25km)
  includeExistingExperiences?: boolean;
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
  skipExperiences?: boolean;
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
