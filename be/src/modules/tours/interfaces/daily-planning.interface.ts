import { PlanningPreference } from './preference-utility.interface';
import { TravelPace, TransportationMode } from './tour-generation.interface';

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

/**
 * Persisted shape of the legacy `Experience.openingHours` (weekly ranges, no
 * provenance). The planner never consumes it: the transitional projection
 * turns it into per-day `PlanningDayOpeningHours` with
 * `LEGACY_EXPERIENCE_OPENING_HOURS` provenance.
 */
export type NormalizedOpeningHours =
  | NormalizedOpeningHoursKnown
  | NormalizedOpeningHoursUnknown;

// ── Planning facts and their provenance ──────────────────────────────────

/**
 * Transitional provenance (owner, 2026-10-15). It means only that the value
 * came from the existing Experience pipeline and has not yet been replaced by
 * evidence-backed GeoEntity knowledge. It is not an authority class and not
 * evidence: it is never persisted as knowledge (L2, research evidence or
 * GeoEntity facts) and is removed from the planning path by group 41. No
 * feature may depend on it semantically; code may only transport and expose
 * it.
 */
export const LEGACY_EXPERIENCE_DURATION = 'LEGACY_EXPERIENCE_DURATION';
/** Transitional provenance for legacy `Experience.openingHours`; same rules. */
export const LEGACY_EXPERIENCE_OPENING_HOURS =
  'LEGACY_EXPERIENCE_OPENING_HOURS';

export interface LegacyExperienceDurationProvenance {
  source: typeof LEGACY_EXPERIENCE_DURATION;
  evidenceBacked: false;
}

export interface GeoEntityVisitDurationProvenance {
  source: 'GEO_ENTITY_VISIT_DURATION';
  evidenceBacked: true;
  geoEntityId: string;
  authorityClass: string | null;
  evidenceQuality: string | null;
  evidence: unknown;
  resolverVersion: string;
  resolvedAt: string;
}
export type PlanningDurationProvenance =
  | LegacyExperienceDurationProvenance
  | GeoEntityVisitDurationProvenance;

export interface PlanningDuration {
  minutes: number;
  provenance: PlanningDurationProvenance;
}

export interface LegacyExperienceOpeningHoursProvenance {
  source: typeof LEGACY_EXPERIENCE_OPENING_HOURS;
  evidenceBacked: false;
}

export interface GeoEntityOpeningHoursProvenance {
  source: 'GEO_ENTITY_OPENING_HOURS';
  evidenceBacked: boolean;
  geoEntityId: string;
  provider: string | null;
  sourceRecordRef: string | null;
  parserVersion: string | null;
  retrievedAt: string | null;
  timezone: string | null;
  scheduleVersion: number | null;
}
export type PlanningOpeningHoursProvenance =
  | LegacyExperienceOpeningHoursProvenance
  | GeoEntityOpeningHoursProvenance;

export interface PlanningOpeningWindow {
  startMinutesFromMidnight: number;
  endMinutesFromMidnight: number;
  /** Null when no last admission is known. */
  lastAdmissionMinutesFromMidnight: number | null;
}

/** Opening-hours knowledge for one planning day (destination-local time). */
export type PlanningDayOpeningHours =
  | {
      status: 'KNOWN_OPEN_WINDOW';
      windows: PlanningOpeningWindow[];
      provenance: PlanningOpeningHoursProvenance;
    }
  | { status: 'KNOWN_CLOSED'; provenance: PlanningOpeningHoursProvenance }
  | { status: 'UNKNOWN'; provenance: PlanningOpeningHoursProvenance };

/**
 * The facts of one visit. `openingHoursByDay[i]` is the knowledge for
 * request day `i + 1` (`DailyPlanningInput.days[i]`), so it always has one
 * entry per planning day.
 */
export interface PlanningVisitFacts {
  duration: PlanningDuration;
  openingHoursByDay: PlanningDayOpeningHours[];
}

// ── Candidates ───────────────────────────────────────────────────────────

export type PlanningComponentParticipation = 'VISIT' | 'TRAVERSE';

/** A bounded required traversal of a ROUTE (design C0). */
export interface RequiredTraversalConstraint {
  routeGeoEntityId: string;
  from: Coordinate;
  to: Coordinate;
  directed: boolean;
  geometry: SimplifiedLineGeometry;
  /** Provider and route-geometry version the segment was built from. */
  geometrySource: string;
}

export interface PlanningComponent {
  /** Position inside the Experience, ascending; the planner never reorders it. */
  order: number;
  /**
   * Null only for a legacy area-scope member (`role = area`), which has no
   * participation until the task 43 consumer audit (design C14,
   * "Participation migration strategy").
   */
  participation: PlanningComponentParticipation | null;
  required: boolean;
  geoEntityId: string;
  footprint: SpatialFootprint;
  /**
   * VISIT facts. Null for TRAVERSE and area members, and for every member of
   * a legacy composite whose facts exist only for the whole Experience
   * (`PlanningExperienceCandidate.legacyExperienceFacts`).
   */
  visit: PlanningVisitFacts | null;
  /** Null when the component is not a bounded required traversal. */
  requiredTraversal: RequiredTraversalConstraint | null;
}

/** One planner candidate per Experience, never per component. */
export interface PlanningExperienceCandidate {
  /** Canonical V2 identity used by the planner. */
  experienceId: string;
  title: string;
  /**
   * Ordered components (at least one). A single-place Experience has one
   * VISIT component, and its facts are the Experience's facts.
   */
  components: PlanningComponent[];
  /**
   * Transitional (removed at group 41): the facts the legacy pipeline holds
   * only for the Experience as a whole, used when they cannot be attributed
   * to one VISIT component (a legacy composite). Null when the facts live on
   * the VISIT component.
   */
  legacyExperienceFacts: PlanningVisitFacts | null;
  spatialFootprint: SpatialFootprint;
  /**
   * Derived once at normalization: the first/last component footprints when
   * there are ≥2 components, otherwise both equal `spatialFootprint`.
   * Inter-candidate travel/ordering must route end→start using these — a
   * multi-component Experience (walk/route) is not a single point, and
   * routing/ordering by the generic `spatialFootprint` (its centroid) makes a
   * route-shaped Experience zigzag against its neighbors instead of
   * connecting at its real endpoints.
   */
  startFootprint: SpatialFootprint;
  endFootprint: SpatialFootprint;
  /**
   * The canonical preference utility of this Experience (task 25.2): its
   * typed numeric breakdown, the policy version and its strict
   * within-request rank. The planner orders by rank and never recombines
   * the breakdown into a score.
   */
  preference: PlanningPreference;
  /** Request-declared inclusion constraint (a resolved MUST venue anchor). */
  mustInclude: boolean;
  /** Internal routing of the components; filled by the solver when absent. */
  mobility?: {
    internalWalkingMinutes?: number;
    internalWalkingDistanceMeters?: number;
    /** Longest single internal walking leg between consecutive components. */
    maxInternalContinuousWalkingDistanceMeters?: number;
    internalTravelMinutes?: number;
    internalCyclingMinutes?: number;
    /** Longest single internal bicycle leg between consecutive components. */
    maxInternalContinuousCyclingMinutes?: number;
    routingProviderCounts?: Record<string, number>;
    routingFallbackCount?: number;
  };
}

// ── Request ──────────────────────────────────────────────────────────────

export interface DailyPlanningWindow {
  startMinutesFromMidnight: number;
  endMinutesFromMidnight: number;
}

/** UNRESOLVED keeps an unknown destination timezone explicit; never guessed. */
export type PlanningTimezone =
  | { status: 'RESOLVED'; iana: string }
  | { status: 'UNRESOLVED' };

export interface PlanningAnchor {
  label: string;
  footprint: SpatialFootprint;
}

export interface PlanningDay {
  dayNumber: number;
  /**
   * Calendar date (YYYY-MM-DD) in destination-local time. Null when the
   * request carries no dates; every per-day fact for that day is UNKNOWN.
   */
  date: string | null;
  timezone: PlanningTimezone;
  window: DailyPlanningWindow;
  /**
   * Never invented. Null means first- and last-mile travel is excluded, and
   * the plan records that exclusion.
   */
  startAnchor: PlanningAnchor | null;
  endAnchor: PlanningAnchor | null;
  unavailableWindows: DailyPlanningWindow[];
}

/**
 * Where a resolved cycling limit came from, without naming the interaction
 * surface: USER_STATED covers any surface on which the traveller stated it.
 */
export type CyclingLimitSource =
  | { kind: 'USER_STATED' }
  | { kind: 'MOBILITY_PROFILE'; profileName: string; profileVersion: string };

/**
 * Hard cycling limits (owner D3), measured on the routing provider's bicycle
 * durations. Feasibility constraints, never objective weights; no universal
 * default exists.
 */
export interface ResolvedCyclingLimits {
  /** Maximum duration of any single bicycle leg. */
  maxContinuousCyclingMinutes: number;
  /** Optional maximum of cumulative bicycle travel within one planning day. */
  maxDailyCyclingMinutes: number | null;
  source: CyclingLimitSource;
}

export interface PlanningMobilityConstraints {
  allowedTransportationModes: TransportationMode[];
  maxWalkingDistancePerDayMeters: number;
  maxContinuousWalkingDistanceMeters: number;
  /**
   * Resolved by the input adapter before planning. Required whenever CYCLING
   * is allowed (an unresolved limit is invalid planning input); null when
   * cycling is not allowed.
   */
  cycling: ResolvedCyclingLimits | null;
}

export type UnknownOpeningHoursPolicyMode =
  | 'ALLOW_WITH_UNCERTAINTY'
  | 'PENALIZE'
  | 'EXCLUDE';

/** The versioned planner policies in force, recorded with the plan. */
export interface PlanningPolicyVersions {
  rankingPolicyVersion: string;
  objectivePolicyVersion: string;
  unknownOpeningHours: {
    mode: UnknownOpeningHoursPolicyMode;
    version: string;
  };
}

export interface DailyPlanningInput {
  /** One entry per requested day, `days[i].dayNumber === i + 1`. */
  days: PlanningDay[];
  candidates: PlanningExperienceCandidate[];
  mobility: PlanningMobilityConstraints;
  travelPace: TravelPace;
  policies: PlanningPolicyVersions;
}

// ── Input errors (never feasibility reasons, never defaulted) ───────────

export type PlanningCandidateInputErrorCode =
  | 'MISSING_REQUIRED_DURATION'
  | 'DUPLICATE_EXPERIENCE'
  | 'INVALID_SPATIAL_FOOTPRINT'
  | 'INVALID_COMPOSITE'
  | 'INVALID_VISIT_FACTS';

export type PlanningRequestInputErrorCode =
  | 'UNRESOLVED_CYCLING_LIMIT'
  | 'INVALID_PLANNING_DAYS';

export type PlanningInputError =
  | {
      scope: 'CANDIDATE';
      experienceId: string;
      code: PlanningCandidateInputErrorCode;
      detail: string;
    }
  | { scope: 'REQUEST'; code: PlanningRequestInputErrorCode; detail: string };

// ── Travel ───────────────────────────────────────────────────────────────

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

// ── Output ───────────────────────────────────────────────────────────────

/** The opening-hours knowledge a scheduled visit was checked against. */
export type AppliedOpeningHours =
  | {
      status: 'WINDOW';
      window: PlanningOpeningWindow;
      provenance: PlanningOpeningHoursProvenance;
    }
  | { status: 'UNKNOWN'; provenance: PlanningOpeningHoursProvenance };

/** A constraint the planned visit touches exactly. */
export type PlanningBindingConstraint =
  | 'DAY_WINDOW_START'
  | 'DAY_WINDOW_END'
  | 'OPENING_WINDOW_START'
  | 'OPENING_WINDOW_END'
  | 'LAST_ADMISSION';

export interface PlannedExperience {
  experienceId: string;
  startMinutesFromMidnight: number;
  endMinutesFromMidnight: number;
  /** Null for the first Experience of a day without a start anchor. */
  travelFromPrevious: TravelEstimate | null;
  duration: PlanningDuration;
  openingHours: AppliedOpeningHours;
  bindingConstraints: PlanningBindingConstraint[];
}

export interface PlannerResidualCapacity {
  dayNumber: number;
  availableMinutes: number;
  meaningful: boolean;
}

export interface PlannedDay {
  dayNumber: number;
  date: string | null;
  experiences: PlannedExperience[];
  totalExperienceMinutes: number;
  totalTravelMinutes: number;
  totalWalkingMinutes: number;
  utilizationMinutes: number;
  /** Remaining time with the planner's meaningful-residual judgement. */
  residual: PlannerResidualCapacity;
  firstLastMileTravel: 'EXCLUDED_NO_ANCHOR' | 'INCLUDED';
}

export type PlanningRejectionReason =
  | 'DAILY_TIME_CAPACITY_EXCEEDED'
  | 'MAX_WALKING_PER_DAY_EXCEEDED'
  | 'MAX_CONTINUOUS_WALKING_EXCEEDED'
  | 'CYCLING_LIMIT'
  | 'NO_ALLOWED_TRAVEL_MODE'
  | 'OPENING_HOURS_INCOMPATIBLE'
  | 'NO_FEASIBLE_DAY'
  | 'LOWER_RANKED_THAN_SELECTED';

/**
 * Typed, deterministic diagnostics for a walking-related planner rejection.
 *
 * These facts are computed by the same canonical helpers the planner uses to
 * enforce walking feasibility (`daily-planning-placement.util.ts`); they are
 * observability data only and MUST NOT become input to the planning policy.
 */
export interface PlanningWalkingDiagnostics {
  /** Projected daily walking meters (internal + incoming travel) had the candidate been placed. */
  dailyWalkingMeters: number;
  dailyWalkingLimitMeters: number;
  /** Longest single continuous walking leg (max of incoming travel leg and internal legs). */
  longestContinuousWalkingMeters: number;
  continuousWalkingLimitMeters: number;
  /** Walking contributed by the candidate's own internal components (route legs). */
  internalWalkingContributionMeters: number;
  /** Walking contributed by travel from the previous Experience. */
  incomingTravelWalkingContributionMeters: number;
}

export interface UnselectedPlanningCandidate {
  experienceId: string;
  reasons: PlanningRejectionReason[];
  /** Present only when the rejection was walking-related. */
  walkingDiagnostics?: PlanningWalkingDiagnostics;
}

/** Legs actually used by the plan, by mode and by estimate quality. */
export interface PlannedLegSummary {
  byMode: Partial<Record<TransportationMode, number>>;
  providerBacked: number;
  approximate: number;
}

export interface DailyPlanningSolution {
  days: PlannedDay[];
  unselected: UnselectedPlanningCandidate[];
  /** Invalid candidates excluded before planning; never feasibility reasons. */
  inputErrors: PlanningInputError[];
  score: number;
  metadata: {
    solver: string;
    policies: PlanningPolicyVersions;
    approximateTravel: boolean;
    iterations?: number;
    convergence?: {
      stopReason:
        | 'CAPACITY_SATURATED_OR_TINY_GAPS'
        | 'RESERVOIR_EXHAUSTED'
        | 'PROMOTION_BUDGET_EXHAUSTED'
        | 'NO_PROGRESS';
      promotionAttempts: number;
      acquisitionPasses: number;
    };
    capacityDeficits?: PlannerCapacityDeficit[];
    routing: {
      externalEstimateCount: number;
      internalEstimateCount: number;
      approximateEstimateCount: number;
      fallbackCount: number;
      providerCounts: Record<string, number>;
    };
    legs: PlannedLegSummary;
    /** Snapshot of the actual constraints the solver evaluated. This is
     * observability data only; it does not participate in the algorithm. */
    constraints: PlannerConstraintSnapshot;
  };
}

/**
 * Canonical snapshot of the mobility/time constraints the solver evaluated for
 * a given run. Observed values only, never recomputed from presentation.
 */
export interface PlannerConstraintSnapshot {
  days: PlanningDay[];
  allowedTransportationModes: TransportationMode[];
  maxWalkingDistancePerDayMeters: number;
  maxContinuousWalkingDistanceMeters: number;
  cycling: ResolvedCyclingLimits | null;
  travelPace: TravelPace;
}

export interface PlannerCapacityDeficit {
  origin: 'planner_capacity';
  dayNumber: number;
  availableMinutes: number;
  preferredFacets: Array<{
    dimension: string;
    key: string;
  }>;
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
