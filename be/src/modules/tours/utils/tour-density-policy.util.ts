import { TravelPace } from '../interfaces/tour-generation.interface';

// An operational floor for TourCompletenessValidator, mirrored 1:1 into
// TOUR_PLANNING_POLICY_PROMPT's "DAY COMPLETENESS AND DENSITY" guidance —
// keep both in sync if these numbers change.

/** Minimum duration (hours) for an activity to count as "substantial"
 * toward a day's density, rather than a quick stop. */
export const SUBSTANTIAL_ACTIVITY_HOURS = 0.75;

/** A meal stop that isn't the trip's focus contributes at most this many
 * hours toward a day's "meaningful" time — so a long lunch alone can't
 * make an otherwise thin day look complete. */
export const MEAL_HOURS_CAP_WHEN_NOT_FOCUSED = 1;

export interface TourDensityPolicyEntry {
  minSubstantialActivities: number;
  minMeaningfulHours: number;
}

export const TOUR_DENSITY_POLICY: Record<TravelPace, TourDensityPolicyEntry> = {
  [TravelPace.RELAXED]: { minSubstantialActivities: 2, minMeaningfulHours: 3 },
  [TravelPace.MODERATE]: { minSubstantialActivities: 3, minMeaningfulHours: 4 },
  [TravelPace.FAST]: { minSubstantialActivities: 4, minMeaningfulHours: 5 },
};
