import {
  DailyPlanningWindow,
  PlannedActivity,
  PlannedDay,
  PlanningActivityCandidate,
  TravelEstimate,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { sortCandidatesDeterministically } from './daily-planning-candidate-sort.util';
import { resolveWeekday } from './daily-planning-placement.util';
import { isOpenDuring } from './normalized-opening-hours.util';
import { footprintDistanceMeters } from './spatial-footprint.util';

export interface OrderingContext {
  travelEstimateProvider: TravelEstimateProvider;
  planningWindow: DailyPlanningWindow;
  allowedTransportationModes: TransportationMode[];
  /** ISO date strings — empty means no confirmed base date, so the weekday
   * is unresolvable and the opening-hours preference below is skipped
   * entirely (same unknown-day policy as the placement pass). */
  startDates: string[];
}

function pickNearest(
  from: PlanningActivityCandidate,
  candidates: PlanningActivityCandidate[],
): PlanningActivityCandidate {
  let best = candidates[0];
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = footprintDistanceMeters(
      from.spatialFootprint,
      candidate.spatialFootprint,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** Scheduled span a candidate would occupy if started right now — the same
 * arithmetic the scheduling loop below uses for `end`, so the hours
 * preference and the emitted schedule can never disagree. */
function occupiedMinutes(candidate: PlanningActivityCandidate): number {
  return (
    candidate.durationMinutes + (candidate.mobility?.internalTravelMinutes ?? 0)
  );
}

/** Picks the next stop: among the remaining candidates, prefers the nearest
 * one whose *known* opening hours actually admit it at `cursorMinutes`, and
 * only falls back to pure nearest-neighbor when none of them do.
 *
 * Candidates with unknown/absent hours always qualify (this domain's
 * unknown-availability policy), so when no candidate has real hours data the
 * preferred set is the full remaining set and the choice is exactly the
 * previous pure-geographic one — geography still wins whenever there is no
 * hours conflict to resolve. */
function pickNext(
  from: PlanningActivityCandidate | null,
  remaining: PlanningActivityCandidate[],
  weekday: number | undefined,
  cursorMinutes: number,
): PlanningActivityCandidate {
  if (weekday !== undefined) {
    const openAtCursor = remaining.filter(
      (candidate) =>
        !candidate.openingHours ||
        isOpenDuring(
          candidate.openingHours,
          weekday,
          cursorMinutes,
          cursorMinutes + occupiedMinutes(candidate),
        ),
    );
    if (openAtCursor.length > 0) {
      return from ? pickNearest(from, openAtCursor) : openAtCursor[0];
    }
  }
  return from ? pickNearest(from, remaining) : remaining[0];
}

/** Orders one day's already-assigned candidates and turns them into a
 * scheduled PlannedDay. Deterministic-sort start point, then, for each
 * subsequent stop, the nearest remaining candidate that is also open at the
 * current cursor time — the spec's "opening-hours-constrained first,
 * otherwise nearest feasible" heuristic in its simplified V1 form.
 *
 * This is a genuine best-effort preference, NOT a guarantee. It evaluates
 * each candidate's window at the cursor *before* the inbound travel leg is
 * priced (the leg is only estimated for the stop actually chosen), and when
 * no remaining candidate is open at the cursor it deliberately falls back to
 * pure nearest-neighbor rather than stalling the day — so a stop can still
 * end up scheduled outside its known hours.
 *
 * Nothing downstream catches that: `TourPlanningFeasibilityValidator` was
 * built deliberately independent of the opening-hours utilities and performs
 * no opening-hours re-check at all. Residual post-reordering opening-hours
 * drift is therefore a known, tracked V1 gap, not a covered case. */
export async function orderAndScheduleDay(
  dayNumber: number,
  candidates: PlanningActivityCandidate[],
  context: OrderingContext,
): Promise<PlannedDay> {
  if (candidates.length === 0) {
    return {
      dayNumber,
      activities: [],
      totalActivityMinutes: 0,
      totalTravelMinutes: 0,
      totalWalkingMinutes: 0,
      utilizationMinutes: 0,
    };
  }

  const remaining = sortCandidatesDeterministically(candidates);
  const weekday = resolveWeekday(context.startDates, dayNumber);
  const scheduled: PlannedActivity[] = [];
  let cursorMinutes = context.planningWindow.startMinutesFromMidnight;
  let totalTravelMinutes = 0;
  let totalWalkingMinutes = 0;
  let previous: PlanningActivityCandidate | null = null;

  while (remaining.length > 0) {
    const next = pickNext(previous, remaining, weekday, cursorMinutes);
    remaining.splice(remaining.indexOf(next), 1);

    let travel: TravelEstimate | undefined;
    if (previous) {
      travel = await context.travelEstimateProvider.estimate(
        previous.spatialFootprint,
        next.spatialFootprint,
        context.allowedTransportationModes,
      );
      cursorMinutes += travel.durationMinutes;
      totalTravelMinutes += travel.durationMinutes;
      totalWalkingMinutes += travel.walkingMinutes;
    }

    const start = cursorMinutes;
    const end =
      start +
      next.durationMinutes +
      (next.mobility?.internalTravelMinutes ?? 0);
    scheduled.push({
      experienceId: next.experienceId,
      activityId: next.activityId,
      startMinutesFromMidnight: start,
      endMinutesFromMidnight: end,
      travelFromPrevious: travel,
    });
    totalWalkingMinutes += next.mobility?.internalWalkingMinutes ?? 0;
    cursorMinutes = end;
    previous = next;
  }

  const totalActivityMinutes = candidates.reduce(
    (sum, c) => sum + c.durationMinutes,
    0,
  );

  return {
    dayNumber,
    activities: scheduled,
    totalActivityMinutes,
    totalTravelMinutes,
    totalWalkingMinutes,
    utilizationMinutes:
      cursorMinutes - context.planningWindow.startMinutesFromMidnight,
  };
}
