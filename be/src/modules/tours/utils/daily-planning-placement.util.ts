import {
  PlanningDay,
  PlanningExperienceCandidate,
  PlanningMobilityConstraints,
  PlanningRejectionReason,
  PlanningWalkingDiagnostics,
  TravelEstimateProvider,
  UnselectedPlanningCandidate,
} from '../interfaces/daily-planning.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';
import { evaluateVisitOpeningHours } from './normalized-opening-hours.util';
import {
  evaluateCyclingFeasibility,
  evaluateWalkingFeasibility,
  internalWalkingMeters,
} from './daily-planning-walking-feasibility.util';
import {
  requireCollapsedVisitFacts,
  visitOpeningHoursOnDay,
} from './planning-candidate-facts.util';

export interface DayAccumulator {
  dayNumber: number;
  assigned: PlanningExperienceCandidate[];
  totalExperienceMinutes: number;
  totalWalkingMeters: number;
  totalCyclingMinutes: number;
}

export interface PlacementContext {
  policy: DailyPlanningPolicy;
  mobility: PlanningMobilityConstraints;
  /** The request's planning days; `days[n - 1]` is day `n`. */
  days: PlanningDay[];
  travelEstimateProvider: TravelEstimateProvider;
}

export function planningDay(
  days: PlanningDay[],
  dayNumber: number,
): PlanningDay {
  return days[dayNumber - 1];
}

export function candidateExperienceMinutes(
  candidate: PlanningExperienceCandidate,
): number {
  return (
    requireCollapsedVisitFacts(candidate).duration.minutes +
    (candidate.mobility?.internalTravelMinutes ?? 0)
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
  const day = planningDay(context.days, acc.dayNumber);

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
    day.window.endMinutesFromMidnight - day.window.startMinutesFromMidnight;
  const projectedExperienceMinutes =
    acc.totalExperienceMinutes +
    candidateExperienceMinutes(candidate) +
    (travel?.durationMinutes ?? 0);
  if (projectedExperienceMinutes > dayWindowMinutes) {
    reasons.push('DAILY_TIME_CAPACITY_EXCEEDED');
  }

  const walking = evaluateWalkingFeasibility(
    candidate,
    travel,
    acc.totalWalkingMeters,
    context.mobility,
    context.policy,
  );
  reasons.push(...walking.reasons);
  const walkingDiagnostics = walking.diagnostics;

  if (
    evaluateCyclingFeasibility(
      candidate,
      travel,
      acc.totalCyclingMinutes,
      context.mobility.cycling,
    ).violated
  ) {
    reasons.push('CYCLING_LIMIT');
  }

  const proposedStart =
    day.window.startMinutesFromMidnight + acc.totalExperienceMinutes;
  // Must match what the scheduler actually books (visit duration + internal
  // travel) — using the visit duration alone here validates a shorter window
  // than the one that ends up scheduled.
  const proposedEnd = proposedStart + candidateExperienceMinutes(candidate);
  if (
    !evaluateVisitOpeningHours(
      visitOpeningHoursOnDay(
        requireCollapsedVisitFacts(candidate),
        acc.dayNumber,
      ),
      proposedStart,
      proposedEnd,
    )
  ) {
    reasons.push('OPENING_HOURS_INCOMPATIBLE');
  }

  return {
    feasible: reasons.length === 0,
    reasons,
    ...(walkingDiagnostics ? { walkingDiagnostics } : {}),
  };
}

/**
 * Chooses among the feasible days for one candidate. The candidate's
 * preference is identical on every day, so only day balance decides; the
 * planner never turns preference into a score (task 25.2).
 */
export function scoreDayForCandidate(
  acc: DayAccumulator,
  context: PlacementContext,
): number {
  return context.policy.scoring.dayBalanceWeight * (1 / (acc.assigned.length + 1));
}

/**
 * Places validated candidates (distinct identities, valid footprints and
 * single-visit facts: `validatePlanningInput` runs first).
 */
export async function placeCandidates(
  sortedCandidates: PlanningExperienceCandidate[],
  context: PlacementContext,
): Promise<{
  days: Map<number, DayAccumulator>;
  unselected: UnselectedPlanningCandidate[];
}> {
  const days = new Map<number, DayAccumulator>();
  for (const day of context.days) {
    days.set(day.dayNumber, {
      dayNumber: day.dayNumber,
      assigned: [],
      totalExperienceMinutes: 0,
      totalWalkingMeters: 0,
      totalCyclingMinutes: 0,
    });
  }

  const unselected: UnselectedPlanningCandidate[] = [];

  for (const candidate of sortedCandidates) {
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
      const score = scoreDayForCandidate(acc, context);
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
    acc.totalCyclingMinutes = evaluateCyclingFeasibility(
      candidate,
      travel,
      acc.totalCyclingMinutes,
      context.mobility.cycling,
    ).projectedDayCyclingMinutes;
  }

  return { days, unselected };
}
