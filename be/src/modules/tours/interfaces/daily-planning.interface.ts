import {
  MobilityPreferences,
  TravelPace,
  TransportationMode,
} from './tour-generation.interface';
import { DestinationResolution } from '../services/destination-resolution.service';

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type SimplifiedLineGeometry = Coordinate[];

export type SpatialFootprint =
  | { type: 'POINT'; centroid: Coordinate }
  | { type: 'AREA'; centroid: Coordinate; bounds?: BoundingBox }
  | {
      type: 'LINE';
      centroid: Coordinate;
      bounds?: BoundingBox;
      geometry?: SimplifiedLineGeometry;
    };

export interface NormalizedOpeningHoursRange {
  startMinutesFromMidnight: number;
  endMinutesFromMidnight: number;
}

export interface NormalizedOpeningHoursKnown {
  status: 'known';
  rangesByWeekday: Record<number, NormalizedOpeningHoursRange[]>;
}

export interface NormalizedOpeningHoursUnknown {
  status: 'unknown';
}

export type NormalizedOpeningHours =
  | NormalizedOpeningHoursKnown
  | NormalizedOpeningHoursUnknown;

export interface PlanningExperienceCandidate {
  /** Canonical V2 identity used by the planner. */
  experienceId: string;
  title: string;
  durationMinutes: number;
  spatialFootprint: SpatialFootprint;
  /** Ordered required components retained so internal routing can use the
   * same request mobility constraints as inter-Experience routing. */
  componentFootprints?: SpatialFootprint[];
  openingHours?: NormalizedOpeningHours;
  /** Raw semantic similarity remains separately observable. */
  semanticScore: number;
  /**
   * Deterministic relevance score produced by the catalog ranking boundary.
   * It preserves preference, semantic, quality, proximity and diversity
   * contributions when candidates cross into the planner. Older/direct
   * planner callers may omit it and fall back to semanticScore.
   */
  rankingScore?: number;
  qualityScore?: number;
  themes?: string[];
  mobility?: {
    internalWalkingMinutes?: number;
    internalWalkingDistanceMeters?: number;
    /** Longest single internal walking leg between consecutive components. */
    maxInternalContinuousWalkingDistanceMeters?: number;
    internalTravelMinutes?: number;
    routingProviderCounts?: Record<string, number>;
    routingFallbackCount?: number;
  };
  metadata?: {
    source?: string;
    rating?: number;
    userRatingCount?: number;
  };
}

export interface DailyPlanningWindow {
  startMinutesFromMidnight: number;
  endMinutesFromMidnight: number;
}

export interface DailyPlanningInput {
  destination: DestinationResolution;
  requestedDays: number;
  candidates: PlanningExperienceCandidate[];
  mobility: MobilityPreferences;
  travelPace: TravelPace;
  planningWindow: DailyPlanningWindow;
  startDates: string[];
}

export interface TravelEstimate {
  mode: TransportationMode;
  durationMinutes: number;
  distanceMeters: number;
  walkingMinutes: number;
  walkingDistanceMeters: number;
  approximate: boolean;
  provider?: string;
  fallbackReason?: string;
}

export const TRAVEL_ESTIMATE_PROVIDER = 'TRAVEL_ESTIMATE_PROVIDER';

export interface TravelEstimateProvider {
  estimate(
    from: SpatialFootprint,
    to: SpatialFootprint,
    allowedModes: TransportationMode[],
  ): Promise<TravelEstimate>;
}

export interface PlannedExperience {
  experienceId: string;
  startMinutesFromMidnight: number;
  endMinutesFromMidnight: number;
  travelFromPrevious?: TravelEstimate;
}

export interface PlannedDay {
  dayNumber: number;
  experiences: PlannedExperience[];
  totalExperienceMinutes: number;
  totalTravelMinutes: number;
  totalWalkingMinutes: number;
  utilizationMinutes: number;
}

export type PlanningRejectionReason =
  | 'DAILY_TIME_CAPACITY_EXCEEDED'
  | 'MAX_WALKING_PER_DAY_EXCEEDED'
  | 'MAX_CONTINUOUS_WALKING_EXCEEDED'
  | 'NO_ALLOWED_TRAVEL_MODE'
  | 'OPENING_HOURS_INCOMPATIBLE'
  | 'DUPLICATE_EXPERIENCE'
  | 'INVALID_SPATIAL_FOOTPRINT'
  | 'INVALID_COMPOSITE'
  | 'NO_FEASIBLE_DAY'
  | 'LOWER_RANKED_THAN_SELECTED';

export interface UnselectedPlanningCandidate {
  experienceId: string;
  reasons: PlanningRejectionReason[];
}

export interface DailyPlanningSolution {
  days: PlannedDay[];
  unselected: UnselectedPlanningCandidate[];
  score: number;
  metadata: {
    solver: string;
    approximateTravel: boolean;
    iterations?: number;
    routing?: {
      externalEstimateCount: number;
      internalEstimateCount: number;
      approximateEstimateCount: number;
      fallbackCount: number;
      providerCounts: Record<string, number>;
    };
    /** Snapshot of the actual constraints the solver evaluated. This is
     * observability data only; it does not participate in the algorithm. */
    constraints?: {
      requestedDays: number;
      planningWindow: DailyPlanningWindow;
      allowedTransportationModes: TransportationMode[];
      maxWalkingDistancePerDayMeters: number;
      maxContinuousWalkingDistanceMeters: number;
      travelPace: TravelPace;
      startDates: string[];
    };
  };
}

export const DAILY_PLANNING_SOLVER = 'DAILY_PLANNING_SOLVER';

export interface DailyPlanningSolver {
  solve(input: DailyPlanningInput): Promise<DailyPlanningSolution>;
}

export interface PlanningFeasibilityIssue {
  code: string;
  message: string;
}

export interface PlanningFeasibilityResult {
  valid: boolean;
  issues: PlanningFeasibilityIssue[];
}

export const TOUR_PLANNING_FEASIBILITY_VALIDATOR =
  'TOUR_PLANNING_FEASIBILITY_VALIDATOR';

export interface TourPlanningFeasibilityValidator {
  validate(
    solution: DailyPlanningSolution,
    input: DailyPlanningInput,
  ): PlanningFeasibilityResult;
}
