import {
  DailyPlanningWindow,
  PlannedExperience,
  PlannedDay,
  PlanningExperienceCandidate,
  PlanningRejectionReason,
  TravelEstimate,
  TravelEstimateProvider,
  UnselectedPlanningCandidate,
} from '../interfaces/daily-planning.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';
import { sortCandidatesDeterministically } from './daily-planning-candidate-sort.util';
import { resolveWeekday } from './daily-planning-placement.util';
import {
  evaluateWalkingFeasibility,
  WalkingLimits,
} from './daily-planning-walking-feasibility.util';
import { isOpenDuring } from './normalized-opening-hours.util';
import { footprintDistanceMeters } from './spatial-footprint.util';

export interface OrderingContext {
  travelEstimateProvider: TravelEstimateProvider;
  planningWindow: DailyPlanningWindow;
  /** The same walking limits placement enforced: every leg routed ordering
   * creates is re-checked against them, never trusted from placement. */
  mobility: WalkingLimits;
  policy: DailyPlanningPolicy;
  startDates: string[];
}

export interface OrderedDayWithRepair {
  day: PlannedDay;
  unselected: UnselectedPlanningCandidate[];
}

function occupiedMinutes(candidate: PlanningExperienceCandidate): number {
  return (
    candidate.durationMinutes + (candidate.mobility?.internalTravelMinutes ?? 0)
  );
}

interface RoutedChoice {
  candidate: PlanningExperienceCandidate;
  travel?: TravelEstimate;
  startMinutes: number;
  endMinutes: number;
  distanceMeters: number;
  projectedDayWalkingMeters: number;
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

function isCandidateOpen(
  candidate: PlanningExperienceCandidate,
  weekday: number | undefined,
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (weekday === undefined || !candidate.openingHours) return true;
  return isOpenDuring(
    candidate.openingHours,
    weekday,
    startMinutes,
    endMinutes,
  );
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
  weekday: number | undefined,
  cursorMinutes: number,
  dayWalkingMeters: number,
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
    const endMinutes = startMinutes + occupiedMinutes(candidate);
    if (endMinutes > context.planningWindow.endMinutesFromMidnight) {
      rejections.add('DAILY_TIME_CAPACITY_EXCEEDED');
      continue;
    }
    if (!isCandidateOpen(candidate, weekday, startMinutes, endMinutes)) {
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
    });
  }

  if (choices.length === 0) {
    const precedence: PlanningRejectionReason[] = [
      'MAX_CONTINUOUS_WALKING_EXCEEDED',
      'MAX_WALKING_PER_DAY_EXCEEDED',
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
  const weekday = resolveWeekday(context.startDates, dayNumber);
  const scheduled: PlannedExperience[] = [];
  let cursorMinutes = context.planningWindow.startMinutesFromMidnight;
  let totalTravelMinutes = 0;
  let totalWalkingMinutes = 0;
  let dayWalkingMeters = 0;
  let previous: PlanningExperienceCandidate | null = null;

  while (remaining.length > 0) {
    const pick = await pickNextRouted(
      previous,
      remaining,
      weekday,
      cursorMinutes,
      dayWalkingMeters,
      context,
    );
    if ('reason' in pick) return { ok: false, reason: pick.reason };

    const {
      candidate: next,
      travel,
      startMinutes: start,
      endMinutes: end,
      projectedDayWalkingMeters,
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
      travelFromPrevious: travel,
    });
    totalWalkingMinutes += next.mobility?.internalWalkingMinutes ?? 0;
    dayWalkingMeters = projectedDayWalkingMeters;
    cursorMinutes = end;
    previous = next;
  }

  return {
    ok: true,
    day: {
      dayNumber,
      experiences: scheduled,
      // Must include internal travel, same as occupiedMinutes() above and
      // every `end` timestamp already scheduled — otherwise this total
      // silently disagrees with its own day's schedule (a shorter number
      // next to `end` timestamps that already account for it).
      totalExperienceMinutes: candidates.reduce(
        (sum, candidate) => sum + occupiedMinutes(candidate),
        0,
      ),
      totalTravelMinutes,
      totalWalkingMinutes,
      utilizationMinutes:
        cursorMinutes - context.planningWindow.startMinutesFromMidnight,
    },
  };
}

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
      day: {
        dayNumber,
        experiences: [],
        totalExperienceMinutes: 0,
        totalTravelMinutes: 0,
        totalWalkingMinutes: 0,
        utilizationMinutes: 0,
      },
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
    day: {
      dayNumber,
      experiences: [],
      totalExperienceMinutes: 0,
      totalTravelMinutes: 0,
      totalWalkingMinutes: 0,
      utilizationMinutes: 0,
    },
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
