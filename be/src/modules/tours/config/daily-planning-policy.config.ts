import { registerAs } from '@nestjs/config';

export interface DailyPlanningPolicy {
  paceTargets: {
    relaxed: { preferredActivitiesMin: number; preferredActivitiesMax: number };
    moderate: {
      preferredActivitiesMin: number;
      preferredActivitiesMax: number;
    };
    fast: { preferredActivitiesMin: number; preferredActivitiesMax: number };
  };
  travel: {
    detourFactor: number;
    walkingSpeedKmh: number;
    bikeSpeedKmh: number;
    carUrbanSpeedKmh: number;
  };
  internalWalking: {
    /** Applied only when a composite's own internal-walking estimate is
     * unknown and mobility constraints are actively being checked. */
    unknownFallbackMinutes: number;
  };
  scoring: {
    semanticWeight: number;
    qualityWeight: number;
    formatWeight: number;
    familyVariantPenaltyWeight: number;
    dayBalanceWeight: number;
  };
  localImprovement: {
    maxIterations: number;
  };
  window: {
    startMinutesFromMidnight: number;
    endMinutesFromMidnight: number;
  };
}

export default registerAs(
  'dailyPlanningPolicy',
  (): DailyPlanningPolicy => ({
    paceTargets: {
      relaxed: { preferredActivitiesMin: 2, preferredActivitiesMax: 4 },
      moderate: { preferredActivitiesMin: 3, preferredActivitiesMax: 5 },
      fast: { preferredActivitiesMin: 4, preferredActivitiesMax: 7 },
    },
    travel: {
      detourFactor: Number(process.env.DAILY_PLANNING_DETOUR_FACTOR ?? 1.3),
      walkingSpeedKmh: Number(
        process.env.DAILY_PLANNING_WALKING_SPEED_KMH ?? 4.5,
      ),
      bikeSpeedKmh: Number(process.env.DAILY_PLANNING_BIKE_SPEED_KMH ?? 13),
      carUrbanSpeedKmh: Number(
        process.env.DAILY_PLANNING_CAR_URBAN_SPEED_KMH ?? 25,
      ),
    },
    internalWalking: {
      unknownFallbackMinutes: Number(
        process.env.DAILY_PLANNING_INTERNAL_WALKING_FALLBACK_MINUTES ?? 20,
      ),
    },
    scoring: {
      semanticWeight: 1,
      qualityWeight: 0.5,
      formatWeight: 0.75,
      familyVariantPenaltyWeight: 0.5,
      dayBalanceWeight: 0.25,
    },
    localImprovement: {
      maxIterations: Number(
        process.env.DAILY_PLANNING_LOCAL_IMPROVEMENT_MAX_ITERATIONS ?? 50,
      ),
    },
    window: {
      startMinutesFromMidnight: Number(
        process.env.DAILY_PLANNING_WINDOW_START_MINUTES ?? 9 * 60,
      ),
      endMinutesFromMidnight: Number(
        process.env.DAILY_PLANNING_WINDOW_END_MINUTES ?? 20 * 60,
      ),
    },
  }),
);
