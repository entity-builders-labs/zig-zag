import { Injectable } from '@nestjs/common';
import {
  DailyPlanningInput,
  DailyPlanningSolution,
  PlanningFeasibilityIssue,
  PlanningFeasibilityResult,
  TourPlanningFeasibilityValidator,
} from '../interfaces/daily-planning.interface';

/**
 * Independent safety-net cross-check for a `DailyPlanningSolution`.
 *
 * This deliberately re-derives feasibility from scratch by reading only the
 * plain data on the solution and its input — it must never call into the
 * solver's own hard-constraint/placement/scoring logic and must never treat
 * the solution's own metadata as evidence of validity.
 *
 * This validator checks only physical and temporal feasibility. Experience
 * preference satisfaction is intentionally evaluated elsewhere and never
 * becomes an ActivityKind/format gate.
 */
@Injectable()
export class TourPlanningFeasibilityValidatorService
  implements TourPlanningFeasibilityValidator
{
  validate(
    solution: DailyPlanningSolution,
    input: DailyPlanningInput,
  ): PlanningFeasibilityResult {
    const issues: PlanningFeasibilityIssue[] = [];

    if (solution.days.length !== input.requestedDays) {
      issues.push({
        code: 'DAY_COUNT_MISMATCH',
        message: `Expected ${input.requestedDays} days, got ${solution.days.length}.`,
      });
    }

    const seenActivityIds = new Set<string>();

    for (const day of solution.days) {
      let cursor = input.planningWindow.startMinutesFromMidnight;
      let dayWalkingMeters = 0;

      for (const activity of day.activities) {
        if (seenActivityIds.has(activity.activityId)) {
          issues.push({
            code: 'DUPLICATE_ACTIVITY',
            message: `Activity ${activity.activityId} is scheduled more than once.`,
          });
        }
        seenActivityIds.add(activity.activityId);

        if (activity.startMinutesFromMidnight < cursor) {
          issues.push({
            code: 'CHRONOLOGICAL_ORDER_VIOLATION',
            message: `Day ${day.dayNumber}: activity ${activity.activityId} starts before the previous activity ends.`,
          });
        }
        cursor = activity.endMinutesFromMidnight;

        const candidate = input.candidates.find(
          (candidate) => candidate.activityId === activity.activityId,
        );
        if (!candidate) {
          issues.push({
            code: 'UNKNOWN_ACTIVITY',
            message: `Activity ${activity.activityId} is not part of the offered candidate pool.`,
          });
          continue;
        }

        if (activity.travelFromPrevious) {
          dayWalkingMeters += activity.travelFromPrevious.walkingDistanceMeters;
          if (
            !input.mobility.allowedTransportationModes.includes(
              activity.travelFromPrevious.mode,
            )
          ) {
            issues.push({
              code: 'DISALLOWED_TRAVEL_MODE',
              message: `Day ${day.dayNumber}: the leg into ${activity.activityId} used a disallowed transportation mode.`,
            });
          }
          if (
            activity.travelFromPrevious.walkingDistanceMeters >
            input.mobility.maxContinuousWalkingDistanceMeters
          ) {
            issues.push({
              code: 'MAX_CONTINUOUS_WALKING_EXCEEDED',
              message: `Day ${day.dayNumber}: the leg into ${activity.activityId} exceeds the continuous walking limit.`,
            });
          }
        }
        dayWalkingMeters +=
          candidate.mobility?.internalWalkingDistanceMeters ?? 0;
      }

      if (cursor > input.planningWindow.endMinutesFromMidnight) {
        issues.push({
          code: 'DAILY_TIME_CAPACITY_EXCEEDED',
          message: `Day ${day.dayNumber} runs past the planning window.`,
        });
      }
      if (dayWalkingMeters > input.mobility.maxWalkingDistancePerDayMeters) {
        issues.push({
          code: 'MAX_WALKING_PER_DAY_EXCEEDED',
          message: `Day ${day.dayNumber} exceeds the daily walking limit.`,
        });
      }
      if (day.dayNumber < 1 || day.dayNumber > input.requestedDays) {
        issues.push({
          code: 'INVALID_DAY_NUMBER',
          message: `Day number ${day.dayNumber} is outside the requested range.`,
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
