import {
  DailyPlanningWindow,
  PlannedExperience,
  PlannedDay,
  PlanningExperienceCandidate,
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
  startDates: string[];
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
 * Evaluates the real inbound travel leg before choosing the next Experience.
 * This deliberately routes first and then checks the resulting start/end
 * window, so geographic reordering can never silently move a known-hours
 * Experience outside its opening hours.
 */
async function pickNextRouted(
  previous: PlanningExperienceCandidate | null,
  remaining: PlanningExperienceCandidate[],
  weekday: number | undefined,
  cursorMinutes: number,
  context: OrderingContext,
): Promise<RoutedChoice | undefined> {
  const choices: RoutedChoice[] = [];

  for (const candidate of remaining) {
    const travel = previous
      ? await context.travelEstimateProvider.estimate(
          previous.spatialFootprint,
          candidate.spatialFootprint,
          context.allowedTransportationModes,
        )
      : undefined;
    const startMinutes = cursorMinutes + (travel?.durationMinutes ?? 0);
    const endMinutes = startMinutes + occupiedMinutes(candidate);
    if (endMinutes > context.planningWindow.endMinutesFromMidnight) continue;
    if (!isCandidateOpen(candidate, weekday, startMinutes, endMinutes)) continue;

    choices.push({
      candidate,
      travel,
      startMinutes,
      endMinutes,
      distanceMeters: previous
        ? footprintDistanceMeters(
            previous.spatialFootprint,
            candidate.spatialFootprint,
          )
        : 0,
    });
  }

  if (!previous) return choices[0];
  return choices.sort(
    (left, right) =>
      left.distanceMeters - right.distanceMeters ||
      left.startMinutes - right.startMinutes ||
      left.candidate.experienceId.localeCompare(right.candidate.experienceId),
  )[0];
}

/**
 * Orders one day's already-assigned Experiences while preserving hard temporal
 * feasibility after routing. Known opening hours are checked against the final
 * routed start/end time, not merely against the pre-travel cursor.
 */
export async function orderAndScheduleDay(
  dayNumber: number,
  candidates: PlanningExperienceCandidate[],
  context: OrderingContext,
): Promise<PlannedDay> {
  if (candidates.length === 0) {
    return {
      dayNumber,
      experiences: [],
      totalExperienceMinutes: 0,
      totalTravelMinutes: 0,
      totalWalkingMinutes: 0,
      utilizationMinutes: 0,
    };
  }

  const remaining = sortCandidatesDeterministically(candidates);
  const weekday = resolveWeekday(context.startDates, dayNumber);
  const scheduled: PlannedExperience[] = [];
  let cursorMinutes = context.planningWindow.startMinutesFromMidnight;
  let totalTravelMinutes = 0;
  let totalWalkingMinutes = 0;
  let previous: PlanningExperienceCandidate | null = null;

  while (remaining.length > 0) {
    const choice = await pickNextRouted(
      previous,
      remaining,
      weekday,
      cursorMinutes,
      context,
    );
    if (!choice) {
      const unresolved = remaining.map((item) => item.experienceId).join(', ');
      throw new Error(
        `OPENING_HOURS_INCOMPATIBLE_AFTER_ROUTING: day ${dayNumber}; remaining ${unresolved}`,
      );
    }

    const { candidate: next, travel, startMinutes: start, endMinutes: end } =
      choice;
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
    cursorMinutes = end;
    previous = next;
  }

  const totalExperienceMinutes = candidates.reduce(
    (sum, candidate) => sum + candidate.durationMinutes,
    0,
  );

  return {
    dayNumber,
    experiences: scheduled,
    totalExperienceMinutes,
    totalTravelMinutes,
    totalWalkingMinutes,
    utilizationMinutes:
      cursorMinutes - context.planningWindow.startMinutesFromMidnight,
  };
}
