import {
  AppliedOpeningHours,
  PlannedExperience,
  PlannedDay,
  PlanningBindingConstraint,
  PlanningDay,
  PlanningExperienceCandidate,
  PlanningMobilityConstraints,
  PlanningRejectionReason,
  TravelEstimate,
  TravelEstimateProvider,
  UnselectedPlanningCandidate,
} from '../interfaces/daily-planning.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';
import { sortCandidatesDeterministically } from './daily-planning-candidate-sort.util';
import {
  candidateExperienceMinutes,
  planningDay,
} from './daily-planning-placement.util';
import {
  evaluateCyclingFeasibility,
  evaluateWalkingFeasibility,
} from './daily-planning-walking-feasibility.util';
import { evaluateVisitOpeningHours } from './normalized-opening-hours.util';
import {
  requireCollapsedVisitFacts,
  visitOpeningHoursOnDay,
} from './planning-candidate-facts.util';
import { footprintDistanceMeters } from './spatial-footprint.util';
import { dayResidualCapacity } from './daily-planning-convergence.util';

export interface OrderingContext {
  travelEstimateProvider: TravelEstimateProvider;
  /** The request's planning days; `days[n - 1]` is day `n`. */
  days: PlanningDay[];
  /** The same mobility limits placement enforced: every leg routed ordering
   * creates is re-checked against them, never trusted from placement. */
  mobility: PlanningMobilityConstraints;
  policy: DailyPlanningPolicy;
}

export interface OrderedDayWithRepair {
  day: PlannedDay;
  unselected: UnselectedPlanningCandidate[];
}

interface RoutedChoice {
  candidate: PlanningExperienceCandidate;
  travel?: TravelEstimate;
  startMinutes: number;
  endMinutes: number;
  distanceMeters: number;
  projectedDayWalkingMeters: number;
  projectedDayCyclingMinutes: number;
  openingHours: AppliedOpeningHours;
}

type RoutedPick =
  | { ok: true; choice: RoutedChoice }
  | { ok: false; reason: PlanningRejectionReason };

interface ScheduleAttemptSuccess {
  ok: true;
  day: PlannedDay;
}

interface ScheduleAttemptFailure {
  ok: false;
  reason: PlanningRejectionReason;
}

type ScheduleAttempt = ScheduleAttemptSuccess | ScheduleAttemptFailure;

function isScheduleAttemptFailure(
  attempt: ScheduleAttempt,
): attempt is ScheduleAttemptFailure {
  return attempt.ok === false;
}

/** The constraints a planned visit touches exactly (schedule evidence). */
export function bindingConstraintsOf(
  day: PlanningDay,
  startMinutes: number,
  endMinutes: number,
  openingHours: AppliedOpeningHours,
): PlanningBindingConstraint[] {
  const binding: PlanningBindingConstraint[] = [];
  if (startMinutes === day.window.startMinutesFromMidnight) {
    binding.push('DAY_WINDOW_START');
  }
  if (endMinutes === day.window.endMinutesFromMidnight) {
    binding.push('DAY_WINDOW_END');
  }
  if (openingHours.status === 'WINDOW') {
    const { window } = openingHours;
    if (startMinutes === window.startMinutesFromMidnight) {
      binding.push('OPENING_WINDOW_START');
    }
    if (endMinutes === window.endMinutesFromMidnight) {
      binding.push('OPENING_WINDOW_END');
    }
    if (startMinutes === window.lastAdmissionMinutesFromMidnight) {
      binding.push('LAST_ADMISSION');
    }
  }
  return binding;
}

/**
 * Chooses the nearest feasible next Experience. A candidate is feasible only
 * if it fits the planning window, is open on arrival, and passes the shared
 * walking-feasibility authority for the leg this ordering would create.
 * When none is feasible, the binding constraint is reported with precedence
 * continuous walking > daily walking > opening hours > time capacity; a
 * walking reason is reported only for a candidate that fit time and hours.
 */
async function pickNextRouted(
  previous: PlanningExperienceCandidate | null,
  remaining: PlanningExperienceCandidate[],
  day: PlanningDay,
  cursorMinutes: number,
  dayWalkingMeters: number,
  dayCyclingMinutes: number,
  context: OrderingContext,
): Promise<RoutedPick> {
  const choices: RoutedChoice[] = [];
  const rejections = new Set<PlanningRejectionReason>();

  for (const candidate of remaining) {
    const travel = previous
      ? await context.travelEstimateProvider.estimate(
          previous.endFootprint,
          candidate.startFootprint,
          context.mobility.allowedTransportationModes,
        )
      : undefined;
    const startMinutes = cursorMinutes + (travel?.durationMinutes ?? 0);
    const endMinutes = startMinutes + candidateExperienceMinutes(candidate);
    if (endMinutes > day.window.endMinutesFromMidnight) {
      rejections.add('DAILY_TIME_CAPACITY_EXCEEDED');
      continue;
    }
    const openingHours = evaluateVisitOpeningHours(
      visitOpeningHoursOnDay(
        requireCollapsedVisitFacts(candidate),
        day.dayNumber,
      ),
      startMinutes,
      endMinutes,
    );
    if (!openingHours) {
      rejections.add('OPENING_HOURS_INCOMPATIBLE');
      continue;
    }
    const walking = evaluateWalkingFeasibility(
      candidate,
      travel,
      dayWalkingMeters,
      context.mobility,
      context.policy,
    );
    if (walking.reasons.length > 0) {
      walking.reasons.forEach((reason) => rejections.add(reason));
      continue;
    }
    const cycling = evaluateCyclingFeasibility(
      candidate,
      travel,
      dayCyclingMinutes,
      context.mobility.cycling,
    );
    if (cycling.violated) {
      rejections.add('CYCLING_LIMIT');
      continue;
    }

    choices.push({
      candidate,
      travel,
      startMinutes,
      endMinutes,
      // Same end→start pairing as the travel estimate above — otherwise a
      // route-shaped candidate gets ranked by its centroid distance while
      // actually routed by its real endpoint, and the "nearest" pick can
      // visibly zigzag against what was actually estimated/scheduled.
      distanceMeters: previous
        ? footprintDistanceMeters(
            previous.endFootprint,
            candidate.startFootprint,
          )
        : 0,
      projectedDayWalkingMeters: walking.projectedDayWalkingMeters,
      projectedDayCyclingMinutes: cycling.projectedDayCyclingMinutes,
      openingHours,
    });
  }

  if (choices.length === 0) {
    const precedence: PlanningRejectionReason[] = [
      'MAX_CONTINUOUS_WALKING_EXCEEDED',
      'MAX_WALKING_PER_DAY_EXCEEDED',
      'CYCLING_LIMIT',
      'OPENING_HOURS_INCOMPATIBLE',
    ];
    return {
      ok: false,
      reason:
        precedence.find((reason) => rejections.has(reason)) ??
        'DAILY_TIME_CAPACITY_EXCEEDED',
    };
  }
  if (!previous) return { ok: true, choice: choices[0] };
  return {
    ok: true,
    choice: choices.sort(
      (left, right) =>
        left.distanceMeters - right.distanceMeters ||
        left.startMinutes - right.startMinutes ||
        left.candidate.experienceId.localeCompare(right.candidate.experienceId),
    )[0],
  };
}

async function tryScheduleDay(
  dayNumber: number,
  candidates: PlanningExperienceCandidate[],
  context: OrderingContext,
): Promise<ScheduleAttempt> {
  const remaining = sortCandidatesDeterministically(candidates);
  const day = planningDay(context.days, dayNumber);
  const scheduled: PlannedExperience[] = [];
  let cursorMinutes = day.window.startMinutesFromMidnight;
  let totalTravelMinutes = 0;
  let totalWalkingMinutes = 0;
  let dayWalkingMeters = 0;
  let dayCyclingMinutes = 0;
  let previous: PlanningExperienceCandidate | null = null;

  while (remaining.length > 0) {
    const pick = await pickNextRouted(
      previous,
      remaining,
      day,
      cursorMinutes,
      dayWalkingMeters,
      dayCyclingMinutes,
      context,
    );
    if ('reason' in pick) return { ok: false, reason: pick.reason };

    const {
      candidate: next,
      travel,
      startMinutes: start,
      endMinutes: end,
      projectedDayWalkingMeters,
      projectedDayCyclingMinutes,
      openingHours,
    } = pick.choice;
    remaining.splice(remaining.indexOf(next), 1);

    if (travel) {
      totalTravelMinutes += travel.durationMinutes;
      totalWalkingMinutes += travel.walkingMinutes;
    }

    scheduled.push({
      experienceId: next.experienceId,
      startMinutesFromMidnight: start,
      endMinutesFromMidnight: end,
      travelFromPrevious: travel ?? null,
      duration: requireCollapsedVisitFacts(next).duration,
      openingHours,
      bindingConstraints: bindingConstraintsOf(day, start, end, openingHours),
    });
    totalWalkingMinutes += next.mobility?.internalWalkingMinutes ?? 0;
    dayWalkingMeters = projectedDayWalkingMeters;
    dayCyclingMinutes = projectedDayCyclingMinutes;
    cursorMinutes = end;
    previous = next;
  }

  return {
    ok: true,
    day: plannedDay(day, context, {
      experiences: scheduled,
      // Must include internal travel, same as candidateExperienceMinutes()
      // above and every `end` timestamp already scheduled — otherwise this
      // total silently disagrees with its own day's schedule (a shorter
      // number next to `end` timestamps that already account for it).
      totalExperienceMinutes: candidates.reduce(
        (sum, candidate) => sum + candidateExperienceMinutes(candidate),
        0,
      ),
      totalTravelMinutes,
      totalWalkingMinutes,
      utilizationMinutes: cursorMinutes - day.window.startMinutesFromMidnight,
    }),
  };
}

function plannedDay(
  day: PlanningDay,
  context: OrderingContext,
  schedule: Pick<
    PlannedDay,
    | 'experiences'
    | 'totalExperienceMinutes'
    | 'totalTravelMinutes'
    | 'totalWalkingMinutes'
    | 'utilizationMinutes'
  >,
): PlannedDay {
  return {
    dayNumber: day.dayNumber,
    date: day.date,
    ...schedule,
    residual: dayResidualCapacity(
      day,
      schedule.utilizationMinutes,
      context.policy.backfill.minimumUsefulResidualMinutes,
    ),
    // The greedy solver plans no anchor legs; it refuses anchored days
    // before planning.
    firstLastMileTravel: 'EXCLUDED_NO_ANCHOR',
  };
}

const EMPTY_SCHEDULE: Pick<
  PlannedDay,
  | 'experiences'
  | 'totalExperienceMinutes'
  | 'totalTravelMinutes'
  | 'totalWalkingMinutes'
  | 'utilizationMinutes'
> = {
  experiences: [],
  totalExperienceMinutes: 0,
  totalTravelMinutes: 0,
  totalWalkingMinutes: 0,
  utilizationMinutes: 0,
};

/**
 * Routes and schedules a day. If real routing/reordering makes the initially
 * assigned set infeasible, the solver repairs it deterministically instead of
 * aborting the whole Tour: the lowest-priority candidate is removed, the day
 * is rerouted from scratch, and the process repeats until the retained set is
 * feasible. Every removed candidate is returned with the concrete hard reason
 * so the caller can preserve it in `solution.unselected` and the Bitácora.
 */
export async function orderAndScheduleDayWithRepair(
  dayNumber: number,
  candidates: PlanningExperienceCandidate[],
  context: OrderingContext,
): Promise<OrderedDayWithRepair> {
  if (candidates.length === 0) {
    return {
      day: plannedDay(planningDay(context.days, dayNumber), context, {
        ...EMPTY_SCHEDULE,
      }),
      unselected: [],
    };
  }

  const retained = sortCandidatesDeterministically(candidates);
  const unselected: UnselectedPlanningCandidate[] = [];

  while (retained.length > 0) {
    const attempt = await tryScheduleDay(dayNumber, retained, context);
    if (!isScheduleAttemptFailure(attempt)) {
      return { day: attempt.day, unselected };
    }

    let removableIndex = -1;
    for (let index = retained.length - 1; index >= 0; index--) {
      if (retained[index].mustInclude !== true) {
        removableIndex = index;
        break;
      }
    }
    const removed = retained.splice(
      removableIndex >= 0 ? removableIndex : retained.length - 1,
      1,
    )[0];
    unselected.push({
      experienceId: removed.experienceId,
      reasons: [attempt.reason],
    });
  }

  return {
    day: plannedDay(planningDay(context.days, dayNumber), context, {
      ...EMPTY_SCHEDULE,
    }),
    unselected,
  };
}

/** Compatibility wrapper for direct callers that only need the repaired day. */
export async function orderAndScheduleDay(
  dayNumber: number,
  candidates: PlanningExperienceCandidate[],
  context: OrderingContext,
): Promise<PlannedDay> {
  return (await orderAndScheduleDayWithRepair(dayNumber, candidates, context))
    .day;
}
