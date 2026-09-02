import { registerAs } from '@nestjs/config';

export interface DailyPlanningPolicy {
  paceTargets: {
    relaxed: { preferredExperiencesMin: number; preferredExperiencesMax: number };
    moderate: {
      preferredExperiencesMin: number;
      preferredExperiencesMax: number;
    };
    fast: { preferredExperiencesMin: number; preferredExperiencesMax: number };
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
  /** Policy constant used as the planning duration of a composite Experience
   * (`NEIGHBORHOOD_WALK`/`ROUTE`/`EXPERIENCE`) whose own `duration` is unset —
   * which is every composite today, since nothing in the codebase populates
   * it. Never derived from `duration` or from internal walking: it is an
   * explicit, configurable product assumption about how long a multi-stop
   * experience occupies the day, not an inference. */
  compositeDefaultDurationMinutes: number;
  scoring: {
    semanticWeight: number;
    qualityWeight: number;
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
      relaxed: { preferredExperiencesMin: 2, preferredExperiencesMax: 4 },
      moderate: { preferredExperiencesMin: 3, preferredExperiencesMax: 5 },
      fast: { preferredExperiencesMin: 4, preferredExperiencesMax: 7 },
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
    compositeDefaultDurationMinutes: Number(
      process.env.DAILY_PLANNING_COMPOSITE_DEFAULT_DURATION_MINUTES ?? 90,
    ),
    scoring: {
      semanticWeight: 1,
      qualityWeight: 0.5,
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
