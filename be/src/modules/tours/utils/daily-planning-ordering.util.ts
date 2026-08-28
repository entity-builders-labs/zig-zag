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
import { footprintDistanceMeters } from './spatial-footprint.util';

export interface OrderingContext {
  travelEstimateProvider: TravelEstimateProvider;
  planningWindow: DailyPlanningWindow;
  allowedTransportationModes: TransportationMode[];
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

/** Orders one day's already-assigned candidates and turns them into a
 * scheduled PlannedDay. Deterministic-sort start point, then nearest-
 * neighbor for the rest — matches the spec's "opening-hours-constrained
 * first, otherwise nearest feasible" heuristic in its simplified V1 form;
 * genuine opening-hours re-validation after reordering is the independent
 * TourPlanningFeasibilityValidator's job (Task 11), not duplicated here. */
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
  const scheduled: PlannedActivity[] = [];
  let cursorMinutes = context.planningWindow.startMinutesFromMidnight;
  let totalTravelMinutes = 0;
  let totalWalkingMinutes = 0;
  let previous: PlanningActivityCandidate | null = null;

  while (remaining.length > 0) {
    const next = previous ? pickNearest(previous, remaining) : remaining[0];
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
