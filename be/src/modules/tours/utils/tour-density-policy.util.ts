import { TravelPace } from '../interfaces/tour-generation.interface';

// An operational floor for TourCompletenessValidator, mirrored 1:1 into
// TOUR_PLANNING_POLICY_PROMPT's "DAY COMPLETENESS AND DENSITY" guidance —
// keep both in sync if these numbers change.

/** Minimum duration (hours) for an experience to count as "substantial"
 * toward a day's density, rather than a quick stop. */
export const SUBSTANTIAL_EXPERIENCE_HOURS = 0.75;

/** A meal stop that isn't the trip's focus contributes at most this many
 * hours toward a day's "meaningful" time — so a long lunch alone can't
 * make an otherwise thin day look complete. */
export const MEAL_HOURS_CAP_WHEN_NOT_FOCUSED = 1;

export interface TourDensityPolicyEntry {
  minSubstantialExperiences: number;
  minMeaningfulHours: number;
}

export const TOUR_DENSITY_POLICY: Record<TravelPace, TourDensityPolicyEntry> = {
  [TravelPace.RELAXED]: { minSubstantialExperiences: 2, minMeaningfulHours: 3 },
  [TravelPace.MODERATE]: {
    minSubstantialExperiences: 3,
    minMeaningfulHours: 4,
  },
  [TravelPace.FAST]: { minSubstantialExperiences: 4, minMeaningfulHours: 5 },
};
