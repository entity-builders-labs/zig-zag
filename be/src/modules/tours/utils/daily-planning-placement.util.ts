import {
  DailyPlanningWindow,
  PlanningExperienceCandidate,
  PlanningRejectionReason,
  PlanningWalkingDiagnostics,
  TravelEstimateProvider,
  UnselectedPlanningCandidate,
} from '../interfaces/daily-planning.interface';
import {
  MobilityPreferences,
  TransportationMode,
} from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';
import { isOpenDuring } from './normalized-opening-hours.util';
import { plannerRelevanceScore } from './daily-planning-candidate-sort.util';

const candidateIdentity = (candidate: PlanningExperienceCandidate): string =>
  candidate.experienceId;

export interface DayAccumulator {
  dayNumber: number;
  assigned: PlanningExperienceCandidate[];
  totalExperienceMinutes: number;
  totalWalkingMeters: number;
}

export interface PlacementContext {
  policy: DailyPlanningPolicy;
  mobility: MobilityPreferences;
  planningWindow: DailyPlanningWindow;
  travelEstimateProvider: TravelEstimateProvider;
  /** ISO date strings — empty means no confirmed base date, so weekday-
   * specific opening-hours checks are skipped rather than guessed. */
  startDates: string[];
}

export function resolveWeekday(
  startDates: string[],
  dayNumber: number,
): number | undefined {
  if (startDates.length === 0) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDates[0]);
  if (!match) return undefined;
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const target = new Date(year, month - 1, day + (dayNumber - 1));
  if (Number.isNaN(target.getTime())) return undefined;
  return target.getDay();
}

export function candidateExperienceMinutes(
  candidate: PlanningExperienceCandidate,
): number {
  return (
    candidate.durationMinutes + (candidate.mobility?.internalTravelMinutes ?? 0)
  );
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

export async function checkHardConstraints(
  candidate: PlanningExperienceCandidate,
  acc: DayAccumulator,
  context: PlacementContext,
): Promise<{
  feasible: boolean;
  reasons: PlanningRejectionReason[];
  walkingDiagnostics?: PlanningWalkingDiagnostics;
}> {
  const reasons: PlanningRejectionReason[] = [];

  if (
    !Number.isFinite(candidate.spatialFootprint.centroid.lat) ||
    !Number.isFinite(candidate.spatialFootprint.centroid.lng)
  ) {
    return { feasible: false, reasons: ['INVALID_SPATIAL_FOOTPRINT'] };
  }

  const previous = acc.assigned[acc.assigned.length - 1];
  const travel = previous
    ? await context.travelEstimateProvider.estimate(
        previous.endFootprint,
        candidate.startFootprint,
        context.mobility.allowedTransportationModes,
      )
    : null;

  if (
    travel &&
    !context.mobility.allowedTransportationModes.includes(travel.mode)
  ) {
    reasons.push('NO_ALLOWED_TRAVEL_MODE');
  }

  const dayWindowMinutes =
    context.planningWindow.endMinutesFromMidnight -
    context.planningWindow.startMinutesFromMidnight;
  const projectedExperienceMinutes =
    acc.totalExperienceMinutes +
    candidateExperienceMinutes(candidate) +
    (travel?.durationMinutes ?? 0);
  if (projectedExperienceMinutes > dayWindowMinutes) {
    reasons.push('DAILY_TIME_CAPACITY_EXCEEDED');
  }

  const legWalkingMeters = travel?.walkingDistanceMeters ?? 0;
  const candidateInternalWalkingMeters = internalWalkingMeters(
    candidate,
    context.policy,
  );
  const internalContinuousWalkingMeters = maxInternalContinuousWalkingMeters(
    candidate,
    context.policy,
  );
  const projectedWalkingMeters =
    acc.totalWalkingMeters + candidateInternalWalkingMeters + legWalkingMeters;

  let walkingDailyExceeded = false;
  if (
    context.mobility.allowedTransportationModes.includes(
      TransportationMode.WALKING,
    ) &&
    projectedWalkingMeters > context.mobility.maxWalkingDistancePerDayMeters
  ) {
    reasons.push('MAX_WALKING_PER_DAY_EXCEEDED');
    walkingDailyExceeded = true;
  }

  const maxContinuousWalkingMeters =
    context.mobility.maxContinuousWalkingDistanceMeters;
  let walkingContinuousExceeded = false;
  if (
    legWalkingMeters > maxContinuousWalkingMeters ||
    internalContinuousWalkingMeters > maxContinuousWalkingMeters
  ) {
    reasons.push('MAX_CONTINUOUS_WALKING_EXCEEDED');
    walkingContinuousExceeded = true;
  }

  // Observability only: the same canonical walking facts computed above,
  // projected against the configured limits. Never fed back into policy.
  let walkingDiagnostics: PlanningWalkingDiagnostics | undefined;
  if (walkingDailyExceeded || walkingContinuousExceeded) {
    walkingDiagnostics = {
      dailyWalkingMeters: projectedWalkingMeters,
      dailyWalkingLimitMeters: context.mobility.maxWalkingDistancePerDayMeters,
      longestContinuousWalkingMeters: Math.max(
        legWalkingMeters,
        internalContinuousWalkingMeters,
      ),
      continuousWalkingLimitMeters: maxContinuousWalkingMeters,
      internalWalkingContributionMeters: candidateInternalWalkingMeters,
      incomingTravelWalkingContributionMeters: legWalkingMeters,
    };
  }

  if (candidate.openingHours) {
    const weekday = resolveWeekday(context.startDates, acc.dayNumber);
    if (weekday !== undefined) {
      const proposedStart =
        context.planningWindow.startMinutesFromMidnight +
        acc.totalExperienceMinutes;
      // Must match what the scheduler actually books (durationMinutes +
      // internal travel) — using durationMinutes alone here validates a
      // shorter window than the one that ends up scheduled.
      const proposedEnd = proposedStart + candidateExperienceMinutes(candidate);
      if (
        !isOpenDuring(
          candidate.openingHours,
          weekday,
          proposedStart,
          proposedEnd,
        )
      ) {
        reasons.push('OPENING_HOURS_INCOMPATIBLE');
      }
    }
  }

  return {
    feasible: reasons.length === 0,
    reasons,
    ...(walkingDiagnostics ? { walkingDiagnostics } : {}),
  };
}

export function scoreCandidateForDay(
  candidate: PlanningExperienceCandidate,
  acc: DayAccumulator,
  context: PlacementContext,
): number {
  const { scoring } = context.policy;
  // This is the sole planner soft-relevance normalization path. Preference is
  // already the sum of distinct strong requested facets; quality is raw on the
  // canonical 0..5 scale and normalized here exactly once. Unknown quality is
  // neutral because it has no contribution, not because it is a fake score.
  const relevance = plannerRelevanceScore(candidate, scoring);
  const dayBalanceBonus =
    scoring.dayBalanceWeight * (1 / (acc.assigned.length + 1));
  return relevance + dayBalanceBonus;
}

export async function placeCandidates(
  sortedCandidates: PlanningExperienceCandidate[],
  requestedDays: number,
  context: PlacementContext,
): Promise<{
  days: Map<number, DayAccumulator>;
  unselected: UnselectedPlanningCandidate[];
}> {
  const days = new Map<number, DayAccumulator>();
  for (let d = 1; d <= requestedDays; d++) {
    days.set(d, {
      dayNumber: d,
      assigned: [],
      totalExperienceMinutes: 0,
      totalWalkingMeters: 0,
    });
  }

  const placedIds = new Set<string>();
  const unselected: UnselectedPlanningCandidate[] = [];

  for (const candidate of sortedCandidates) {
    if (placedIds.has(candidateIdentity(candidate))) {
      unselected.push({
        experienceId: candidate.experienceId,
        reasons: ['DUPLICATE_EXPERIENCE'],
      });
      continue;
    }

    let bestDay: number | null = null;
    let bestScore = -Infinity;
    const dayFailureReasons = new Set<PlanningRejectionReason>();
    // First walking-failure diagnostics in ascending day order; deterministic
    // because day iteration order is fixed and the same canonical helpers are
    // used everywhere. Observability only, never policy input.
    let walkingDiagnostics: PlanningWalkingDiagnostics | undefined;

    for (const [dayNumber, acc] of days) {
      const feasibility = await checkHardConstraints(candidate, acc, context);
      if (!feasibility.feasible) {
        feasibility.reasons.forEach((r) => dayFailureReasons.add(r));
        if (!walkingDiagnostics && feasibility.walkingDiagnostics) {
          walkingDiagnostics = feasibility.walkingDiagnostics;
        }
        continue;
      }
      const score = scoreCandidateForDay(candidate, acc, context);
      if (score > bestScore) {
        bestScore = score;
        bestDay = dayNumber;
      }
    }

    if (bestDay === null) {
      unselected.push({
        experienceId: candidate.experienceId,
        reasons:
          dayFailureReasons.size > 0
            ? Array.from(dayFailureReasons)
            : ['NO_FEASIBLE_DAY'],
        ...(walkingDiagnostics ? { walkingDiagnostics } : {}),
      });
      continue;
    }

    const acc = days.get(bestDay)!;
    const previous = acc.assigned[acc.assigned.length - 1];
    const travel = previous
      ? await context.travelEstimateProvider.estimate(
          previous.endFootprint,
          candidate.startFootprint,
          context.mobility.allowedTransportationModes,
        )
      : null;

    acc.assigned.push(candidate);
    acc.totalExperienceMinutes +=
      candidateExperienceMinutes(candidate) + (travel?.durationMinutes ?? 0);
    acc.totalWalkingMeters +=
      internalWalkingMeters(candidate, context.policy) +
      (travel?.walkingDistanceMeters ?? 0);
    placedIds.add(candidateIdentity(candidate));
  }

  return { days, unselected };
}
