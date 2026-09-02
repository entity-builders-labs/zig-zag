export const TOUR_INTENT_CONTRACT_VERSION = 1 as const;
export const ADDITIONAL_PREFERENCES_MAX_LENGTH = 500;

export type BudgetLevel = 'low' | 'medium' | 'high';
export type GroupType = 'solo' | 'couple' | 'family' | 'friends';
export type TravelPace = 'relaxed' | 'moderate' | 'fast';
export type TransportationMode =
  | 'walking'
  | 'driving'
  | 'public_transport'
  | 'cycling';
export type ExplorationStyle = 'iconic' | 'balanced' | 'local_deep_dive';
export type DestinationScaleHint = 'settlement' | 'specific_point';

export interface TourDestinationSelection {
  label?: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  scaleHint: DestinationScaleHint;
}

export interface TourIntent {
  interests: string[];
  explorationStyle: ExplorationStyle;
  additionalPreferences?: string;
}

export interface MobilityPreferences {
  allowedTransportationModes: TransportationMode[];
  maxWalkingDistancePerDayMeters: number;
  maxContinuousWalkingDistanceMeters: number;
  travelPace: TravelPace;
  accessibilityNeeds: string[];
}

export interface GenerateTourDto {
  destination: TourDestinationSelection;
  days: number;
  budgetLevel: BudgetLevel;
  groupType: GroupType;
  intent: TourIntent;
  mobility: MobilityPreferences;
  dietaryRestrictions?: string[];
  startDates?: string[];
  skipImageGeneration?: boolean;
  excludeTours?: string[];
  categories?: string[];
}

export type WalkingEffortProfile =
  | 'minimize'
  | 'moderate'
  | 'enjoys_walking'
  | 'custom';

export interface WalkingEffortLimits {
  dailyMeters: number;
  continuousMeters: number;
}

// Presentation presets live in one product contract. The backend persists the
// resulting deterministic values; prompts and route utilities never recreate
// these kilometer defaults.
export const WALKING_EFFORT_PRESETS: Record<
  Exclude<WalkingEffortProfile, 'custom'>,
  WalkingEffortLimits
> = {
  minimize: { dailyMeters: 2000, continuousMeters: 500 },
  moderate: { dailyMeters: 5000, continuousMeters: 1500 },
  enjoys_walking: { dailyMeters: 10000, continuousMeters: 3000 }
};
