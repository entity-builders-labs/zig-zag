import {
  PlanningExperienceCandidate,
  PlanningMobilityConstraints,
  PlanningWalkingDiagnostics,
  ResolvedCyclingLimits,
  TravelEstimate,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';

export type WalkingRejectionReason =
  | 'MAX_WALKING_PER_DAY_EXCEEDED'
  | 'MAX_CONTINUOUS_WALKING_EXCEEDED';

export type WalkingLimits = Pick<
  PlanningMobilityConstraints,
  | 'allowedTransportationModes'
  | 'maxWalkingDistancePerDayMeters'
  | 'maxContinuousWalkingDistanceMeters'
>;

export interface WalkingFeasibility {
  reasons: WalkingRejectionReason[];
  /** Day walking meters (external legs + internal walking) had the candidate
   * been appended after `dayWalkingMetersBefore`. */
  projectedDayWalkingMeters: number;
  /** Present only when a walking limit is exceeded. Observability only. */
  diagnostics?: PlanningWalkingDiagnostics;
}

export function internalWalkingMeters(
  candidate: PlanningExperienceCandidate,
  policy: DailyPlanningPolicy,
): number {
  if (candidate.mobility?.internalWalkingDistanceMeters !== undefined) {
    return candidate.mobility.internalWalkingDistanceMeters;
  }
  if (
    candidate.mobility?.internalWalkingDistanceMeters === undefined &&
    candidate.mobility?.internalWalkingMinutes === undefined
  ) {
    if (candidate.spatialFootprint.type === 'POINT') return 0;
    return (
      (policy.internalWalking.unknownFallbackMinutes *
        policy.travel.walkingSpeedKmh *
        1000) /
      60
    );
  }
  return 0;
}

function maxInternalContinuousWalkingMeters(
  candidate: PlanningExperienceCandidate,
  policy: DailyPlanningPolicy,
): number {
  return (
    candidate.mobility?.maxInternalContinuousWalkingDistanceMeters ??
    internalWalkingMeters(candidate, policy)
  );
}

/**
 * Single walking-feasibility authority for appending `candidate` to a day,
 * reached via `inboundTravel` (absent for the day's first Experience).
 * Placement and routed ordering both call this, so a leg ordering creates
 * after placement is held to exactly the same continuous and daily limits.
 */
export function evaluateWalkingFeasibility(
  candidate: PlanningExperienceCandidate,
  inboundTravel: TravelEstimate | null | undefined,
  dayWalkingMetersBefore: number,
  limits: WalkingLimits,
  policy: DailyPlanningPolicy,
): WalkingFeasibility {
  const reasons: WalkingRejectionReason[] = [];
  const legWalkingMeters = inboundTravel?.walkingDistanceMeters ?? 0;
  const candidateInternalWalkingMeters = internalWalkingMeters(
    candidate,
    policy,
  );
  const internalContinuousWalkingMeters = maxInternalContinuousWalkingMeters(
    candidate,
    policy,
  );
  const projectedDayWalkingMeters =
    dayWalkingMetersBefore + candidateInternalWalkingMeters + legWalkingMeters;

  if (
    limits.allowedTransportationModes.includes(TransportationMode.WALKING) &&
    projectedDayWalkingMeters > limits.maxWalkingDistancePerDayMeters
  ) {
    reasons.push('MAX_WALKING_PER_DAY_EXCEEDED');
  }

  const maxContinuousWalkingMeters = limits.maxContinuousWalkingDistanceMeters;
  if (
    legWalkingMeters > maxContinuousWalkingMeters ||
    internalContinuousWalkingMeters > maxContinuousWalkingMeters
  ) {
    reasons.push('MAX_CONTINUOUS_WALKING_EXCEEDED');
  }

  if (reasons.length === 0) return { reasons, projectedDayWalkingMeters };

  return {
    reasons,
    projectedDayWalkingMeters,
    // Observability only: the same canonical walking facts computed above,
    // projected against the configured limits. Never fed back into policy.
    diagnostics: {
      dailyWalkingMeters: projectedDayWalkingMeters,
      dailyWalkingLimitMeters: limits.maxWalkingDistancePerDayMeters,
      longestContinuousWalkingMeters: Math.max(
        legWalkingMeters,
        internalContinuousWalkingMeters,
      ),
      continuousWalkingLimitMeters: maxContinuousWalkingMeters,
      internalWalkingContributionMeters: candidateInternalWalkingMeters,
      incomingTravelWalkingContributionMeters: legWalkingMeters,
    },
  };
}

export interface CyclingFeasibility {
  violated: boolean;
  /** Day bicycle minutes (external legs + internal legs) had the candidate
   * been appended after `dayCyclingMinutesBefore`. */
  projectedDayCyclingMinutes: number;
}

/**
 * Single cycling-feasibility authority (owner D3): every bicycle leg stays
 * within the continuous limit and, when one is set, the day's bicycle total
 * stays within the daily limit. Measured on the routing provider's bicycle
 * durations. Input validation guarantees resolved limits whenever cycling is
 * allowed, so without limits no bicycle leg can be planned and nothing is
 * checked here.
 */
export function evaluateCyclingFeasibility(
  candidate: PlanningExperienceCandidate,
  inboundTravel: TravelEstimate | null | undefined,
  dayCyclingMinutesBefore: number,
  limits: ResolvedCyclingLimits | null,
): CyclingFeasibility {
  const legMinutes =
    inboundTravel?.mode === TransportationMode.CYCLING
      ? inboundTravel.durationMinutes
      : 0;
  const projectedDayCyclingMinutes =
    dayCyclingMinutesBefore +
    legMinutes +
    (candidate.mobility?.internalCyclingMinutes ?? 0);
  if (!limits) return { violated: false, projectedDayCyclingMinutes };
  const longestLeg = Math.max(
    legMinutes,
    candidate.mobility?.maxInternalContinuousCyclingMinutes ?? 0,
  );
  return {
    violated:
      longestLeg > limits.maxContinuousCyclingMinutes ||
      (limits.maxDailyCyclingMinutes !== null &&
        projectedDayCyclingMinutes > limits.maxDailyCyclingMinutes),
    projectedDayCyclingMinutes,
  };
}
